/**
 * agent-runtime.ts — Facade that wires together the agent subsystem services.
 *
 * Architecture: This file is the ONLY public entry point for running an agent.
 *   It implements IAgentClient and delegates to three focused services:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  useAgent.ts (UI hook)                                          │
 *   │    └── new AgentRuntime(options, history)  ← only this changes  │
 *   │          in Phase 3 (swap to RemoteAgentClient)                 │
 *   └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                    AgentRuntime (this file)
 *                    implements IAgentClient
 *                              │
 *          ┌───────────────────┼───────────────────┐
 *          ▼                   ▼                   ▼
 *   AgentStateService   ToolExecutionService  OrchestrationService
 *   (memory lifecycle)  (self-healing calls)  (sub-agent spawning)
 *
 * Phase 3 readiness: Replace `new AgentRuntime(...)` in useAgent.ts with
 *   `new RemoteAgentClient(...)` — both implement IAgentClient. Done.
 *
 * Consumed by: useAgent.ts, memory-reflector.ts
 */

import { chat } from "./llm";
import { LLMMessage, LLMTool, ServerInfo, type LLMResponse } from "./types";
import { pruneContext } from "./dcp";
import { executeToolCall, getAllTools, getServers, parseTabIdFromResult } from "./mcp";
import { CLIENT_TOOLS } from "./client-tools";
import { analyzeTask } from "./confirmation-message";
import type { IAgentClient } from "./agent/IAgentClient";
import {
  initializeSessionState,
  loadParentContext,
  detectHandoff,
  createHandoff,
  cleanupState,
} from "./agent/AgentStateService";
import {
  checkForLoop,
  executeWithSelfHealing,
  formatToolResult,
  truncateToolOutput,
  reportFinding,
  MAX_IDENTICAL_CALLS,
} from "./agent/ToolExecutionService";
import {
  executeParallelSubAgents,
  executeSequentialSubAgents,
  continueWithSubAgent,
  type SubAgentFactory,
} from "./agent/OrchestrationService";
import { analyzeTaskForDecomposition } from "./task-decomposer";
import { MemoryReflector } from "./memory-reflector";

// Re-export types for backward compatibility.
// Files that import AgentRuntimeOptions from this module continue to work.
export type { AgentRuntimeOptions, AgentStatusCallback } from "./agent/types";
import type { AgentRuntimeOptions, AgentCheckpoint, ExecutionPlan } from "./agent/types";

/**
 * AgentRuntime — Local implementation of IAgentClient.
 *
 * Owns:
 *   - Message history (`this.messages`)
 *   - Iteration tracking and limits
 *   - The main LLM + tool call loop
 *   - Inline handlers for special tools (create_execution_plan, scan_page_accessibility,
 *     update_progress_summary, delegate_sub_task)
 *
 * Delegates:
 *   - Memory lifecycle → AgentStateService
 *   - Tool execution + retries → ToolExecutionService
 *   - Sub-agent spawning → OrchestrationService
 */
import { SpecialToolHandlers } from "./agent/SpecialToolHandlers";

export class AgentRuntime implements IAgentClient {
  private messages: LLMMessage[] = [];
  private options: AgentRuntimeOptions;
  private maxIterations: number;
  private maxConsecutiveErrors = 3;
  private executionPlan: ExecutionPlan | null = null;
  private taskCategory?: string;
  private totalIterations = 0;
  private readonly ABSOLUTE_MAX_ITERATIONS = 150;
  private toolCallHistory = new Set<string>();
  private agentInstanceId: string;
  private lastCheckpoint: AgentCheckpoint | null = null;
  private specialHandlers: SpecialToolHandlers;

  constructor(options: AgentRuntimeOptions, initialHistory: LLMMessage[] = []) {
    this.options = options;
    this.agentInstanceId = options.agentInstanceId || globalThis.crypto.randomUUID();

    if (options.isSubAgent) {
      this.messages = [];
      console.log("[AgentRuntime] Sub-agent created with FRESH context (0 messages)");
    } else {
      this.messages = [...initialHistory];
      console.log(`[AgentRuntime] Main agent created with ${this.messages.length} historical messages`);
    }

    this.maxIterations = options.isSubAgent ? 15 : 50;
    if (options.taskCategory) this.taskCategory = options.taskCategory;

    this.specialHandlers = new SpecialToolHandlers(
      this.agentInstanceId,
      this.options,
      this.taskCategory,
      (msg) => this.addMessage(msg),
      () => this._makeSubAgentFactory()
    );
  }

  async chat(
    userContent: string,
    attachments?: { name: string; path: string; type: string }[]
  ): Promise<LLMMessage> {
    let finalPrompt = userContent;

    let attachmentContext = "";
    if (attachments && attachments.length > 0) {
      const resourceList = attachments.map((a) => `- ${a.name} (Path: ${a.path})`).join("\n");
      const toolHint = `\n\n[To analyze these files, use the 'convert_to_markdown' tool with file:// URIs. Example: convert_to_markdown(uri="file:///absolute/path")]`;
      attachmentContext = `\n\n[System Note: User attached the following files. Use absolute paths to access them.]\n${resourceList}${toolHint}`;
    }

    const { restoredCheckpoint } = await initializeSessionState(
      this.agentInstanceId,
      this.options.activeSessionId,
      this.options.parentAgentId
    );
    if (restoredCheckpoint) this.lastCheckpoint = restoredCheckpoint;

    if (this.options.parentAgentId) {
      const parentContextMsg = await loadParentContext(this.options.parentAgentId);
      if (parentContextMsg) this.messages.push(parentContextMsg);
    }

    if (!this.options.isSubAgent) {
      const handoff = await detectHandoff(this.options.activeSessionId);
      if (handoff.found) {
        if (handoff.checkpoint) this.lastCheckpoint = handoff.checkpoint;
        this.messages.push({
          role: "system",
          content: `[Resuming from previous agent session]\nPrevious progress: ${handoff.checkpoint?.summary || "In progress..."
            }\nOriginal goal: ${handoff.originalGoal || userContent}\n\nContinue from where the previous agent left off.`,
        });
      }
    }

    let taskComplexity: "simple" | "moderate" | "complex" = "moderate";

    if (this.options.requireConfirmation && this.options.onConfirmationNeeded) {
      try {
        const isSimpleReply = /^(yes|no|ok|okay|sure|nope|continue|stop|proceed|go ahead|skip|next|back)$/i.test(userContent.trim());
        const lastMessage = this.messages[this.messages.length - 1];
        const lastContent = typeof lastMessage?.content === "string" ? lastMessage.content : "";
        const isReplyToQuestion = lastMessage?.role === "assistant" && lastContent.includes("?");

        if (isSimpleReply && isReplyToQuestion) {
          taskComplexity = "simple";
        } else {
          const analysis = await analyzeTask(userContent, this.options.settings, attachments);
          if (analysis.category) this.taskCategory = analysis.category;
          if (analysis.complexity) taskComplexity = analysis.complexity.level;

          if (analysis.shouldConfirm) {
            const enrichedPrompt = await this.options.onConfirmationNeeded(analysis);
            if (enrichedPrompt === null) {
              return { role: "assistant", content: "Task cancelled. Let me know when you want to try again!" };
            }
            finalPrompt = enrichedPrompt;
          }
        }
      } catch (error) {
        console.error("[AgentRuntime] Confirmation analysis failed:", error);
      }
    }

    const lastMsg = this.messages[this.messages.length - 1];
    const isConfirmingHandoff =
      lastMsg?.role === "assistant" &&
      lastMsg?.content?.toString().includes("reached the maximum number of steps") &&
      /^(yes|continue|proceed|go ahead|sure)$/i.test(userContent.trim());

    if (isConfirmingHandoff) {
      this.addMessage({ role: "user", content: userContent });
      const originalGoal =
        this.messages.find((m) => m.role === "user")?.content?.toString() || "Complete the task";
      const stepsTaken = Math.floor(this.messages.length / 2);
      const progressContext = this.lastCheckpoint ? `Last Checkpoint: ${this.lastCheckpoint.summary}` : "No detailed progress recorded yet.";
      return continueWithSubAgent(
        originalGoal,
        stepsTaken,
        progressContext,
        this.options,
        this.agentInstanceId,
        (msg) => this.addMessage(msg),
        this._makeSubAgentFactory()
      );
    }

    if (!this.options.isSubAgent && taskComplexity !== "simple") {
      const decomposition = await analyzeTaskForDecomposition(finalPrompt, this.options.settings);
      if (decomposition.shouldFork && decomposition.type === "multi_context") {
        const result = await executeParallelSubAgents(
          finalPrompt,
          decomposition,
          this.options,
          this.agentInstanceId,
          (msg) => this.addMessage(msg),
          this._makeSubAgentFactory()
        );
        MemoryReflector.getInstance().analyze(this.messages, this.options.settings);
        return result;
      }

      if (decomposition.shouldFork && decomposition.type === "single_context") {
        return executeSequentialSubAgents(
          finalPrompt,
          decomposition,
          this.options,
          this.agentInstanceId,
          (msg) => this.addMessage(msg),
          this._makeSubAgentFactory()
        );
      }
    }

    const lastMessage = this.messages[this.messages.length - 1];
    const alreadyHasMessage = lastMessage?.role === "user" && lastMessage?.content === finalPrompt;

    if (alreadyHasMessage && lastMessage) {
      lastMessage.content = finalPrompt + attachmentContext;
    } else {
      this.addMessage({ role: "user", content: finalPrompt + attachmentContext });
    }

    return this._runLoop(finalPrompt);
  }

  getHistory(): LLMMessage[] {
    return this.messages;
  }

  abort(): void {
    console.log("[AgentRuntime] abort() called");
  }

  private async _runLoop(finalPrompt: string): Promise<LLMMessage> {
    let iterationCount = 0;
    let consecutiveErrors = 0;
    const recentToolCalls: string[] = [];

    while (iterationCount < this.maxIterations) {
      this.totalIterations++;
      if (this.options.signal?.aborted) throw new Error("Aborted by user");

      await this._handleContextLimits();
      this.messages = pruneContext(this.messages);

      const allTools = this._getAvailableTools();
      const serverInfo = this._getServerInfo();
      const dynamicRules = await this._getDynamicRules();

      console.log(`[AgentRuntime] Iteration ${iterationCount + 1}: Calling LLM...`);
      let response: LLMResponse;
      try {
        response = await chat(
          this.messages,
          allTools,
          this.options.settings,
          serverInfo,
          this.options.signal,
          dynamicRules,
          this.options.isSubAgent,
          this.options.workspacePath
        );
      } catch (error) {
        console.error("[AgentRuntime] LLM Error:", error);
        throw error;
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        const refusal = this._handleModelRefusal(response);
        if (refusal) continue;

        const assistantMsg: LLMMessage = { role: "assistant", content: response.content };
        this._appendCheckpointReport(assistantMsg);
        this.addMessage(assistantMsg);

        await cleanupState(this.agentInstanceId);
        return assistantMsg;
      }

      const assistantMsg: LLMMessage = {
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })) as any,
      };
      this.addMessage(assistantMsg);

      const toolPromises = response.toolCalls.map(async (call) => {
        if (this.options.signal?.aborted) return null;

        const toolSignature = `${call.name}:${JSON.stringify(call.arguments)}`;
        recentToolCalls.push(toolSignature);
        this.toolCallHistory.add(toolSignature);
        if (recentToolCalls.length > 5) recentToolCalls.shift();

        const loopMsg = checkForLoop(recentToolCalls, this.toolCallHistory, call.name, this.messages);
        if (loopMsg) {
          this.addMessage(loopMsg);
          return loopMsg;
        }

        console.log(`[AgentRuntime] Executing tool: ${call.name}`);
        let resultStr = "";

        if (call.name === "create_execution_plan") {
          const { result, plan } = this.specialHandlers.handleCreateExecutionPlan(call.arguments);
          this.executionPlan = plan;
          resultStr = result;
        } else if (call.name === "scan_page_accessibility") {
          resultStr = await this.specialHandlers.handleScanPageAccessibility();
        } else if (call.name === "update_progress_summary") {
          const { result, checkpoint } = await this.specialHandlers.handleUpdateProgressSummary(call.arguments, iterationCount);
          this.lastCheckpoint = checkpoint;
          resultStr = result;
        } else if (call.name === "delegate_sub_task") {
          const { result, planUpdate } = await this.specialHandlers.handleDelegateSubTask(call.arguments, this.executionPlan);
          if (planUpdate) this.executionPlan = planUpdate;
          resultStr = result;
        } else {
          try {
            const rawResult = await executeWithSelfHealing(
              call.name,
              call.arguments as Record<string, unknown>,
              this.options.tabId,
              this.options.workspacePath,
              this.options.signal,
              this.options.isHeadless
            );
            const { resultStr: formatted, isError } = formatToolResult(call.name, rawResult);
            resultStr = formatted;
            consecutiveErrors = isError ? consecutiveErrors + 1 : 0;
          } catch (err: any) {
            resultStr = JSON.stringify({ error: err.message || "Unknown error" });
            consecutiveErrors++;
          }

          if (consecutiveErrors >= this.maxConsecutiveErrors) {
            const bailoutMsg: LLMMessage = {
              role: "assistant",
              content: `Bailing out after ${consecutiveErrors} consecutive errors. Last error: ${resultStr}`,
            };
            this.addMessage(bailoutMsg);
            return bailoutMsg;
          }
        }

        const truncated = truncateToolOutput(call.name, resultStr);
        this.addMessage({ role: "tool", content: truncated, tool_call_id: call.id });

        if (!this.options.isSubAgent) {
          reportFinding(call.name, resultStr, (msg) => this.addMessage(msg));
        }
        return undefined;
      });

      const results = await Promise.all(toolPromises);
      const bailout = results.find((r) => r && r.role === "assistant");
      if (bailout) return bailout as LLMMessage;

      iterationCount++;
      await this._handleCheckpoints(iterationCount);
    }

    return this._handleMaxIterations(finalPrompt);
  }

  private async _handleContextLimits() {
    const contextText = JSON.stringify(this.messages);
    const estimatedTokens = Math.ceil(contextText.length / 4);
    const contextLimit = 100000;
    if (estimatedTokens > contextLimit * 0.8 && !this.options.isSubAgent) {
      const originalGoalMsg = this.messages.find((m) => m.role === "user");
      await createHandoff(
        this.agentInstanceId,
        this.options.activeSessionId,
        originalGoalMsg?.content?.toString() || "",
        this.lastCheckpoint,
        estimatedTokens
      );
    }
  }

  private _getAvailableTools(): LLMTool[] {
    const mcpTools = getAllTools();
    const toolMap = new Map<string, LLMTool>();
    const all = [
      ...mcpTools.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema })),
      ...CLIENT_TOOLS.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema }))
    ];
    for (const tool of all) {
      if (!toolMap.has(tool.name)) toolMap.set(tool.name, tool);
    }
    return Array.from(toolMap.values());
  }

  private _getServerInfo(): ServerInfo[] {
    return getServers().filter(s => s.connected).map(s => ({
      name: s.name,
      description: s.description.substring(0, 40),
      toolCount: s.tools.length,
      isReasoningServer: s.name.includes("sequential") || s.description.toLowerCase().includes("reasoning")
    }));
  }

  private async _getDynamicRules(): Promise<string | undefined> {
    const { getComposedPrompts } = await import("./prompt-library");
    const promptsToLoad: string[] = [];
    if (this.taskCategory) promptsToLoad.push(this.taskCategory);
    return promptsToLoad.length > 0 ? getComposedPrompts(promptsToLoad, this.options.isSubAgent) : undefined;
  }

  private _handleModelRefusal(response: LLMResponse): boolean {
    const refusalPatterns = [/don't have access to/i, /can't (?:access|check|fetch|get)/i, /unable to (?:browse|access)/i];
    if (refusalPatterns.some(p => p.test(response.content || "")) && !this.messages.some(m => m.content?.toString().includes("[AUTO-CORRECT]"))) {
      const query = this.messages.filter(m => m.role === "user").pop()?.content?.toString() || "the request";
      this.addMessage({
        role: "user",
        content: `[AUTO-CORRECT] You refused to help. You HAVE browser tools. Use navigate to search for "${query}".`
      });
      return true;
    }
    return false;
  }

  private _appendCheckpointReport(msg: LLMMessage) {
    if (!this.options.isSubAgent && this.lastCheckpoint && !msg.content?.toString().includes("Summary")) {
      const summaryText = `\n\n## 📝 Execution Report\n[Checkpoint ${this.lastCheckpoint.step}]: ${this.lastCheckpoint.summary}`;
      msg.content = (msg.content || "") + summaryText;
    }
  }

  private async _handleCheckpoints(iterationCount: number) {
    if (this.options.isSubAgent) return;
    const INTERVAL = 15;
    if (iterationCount % INTERVAL === 0) {
      this.addMessage({
        role: "user",
        content: `[CHECKPOINT ${iterationCount}] Please call update_progress_summary now.`
      });
    }
  }

  private _handleMaxIterations(finalPrompt: string): LLMMessage {
    if (this.options.isSubAgent) throw new Error("Max iterations reached");
    const handoffMsg: LLMMessage = {
      role: "assistant",
      content: `I've worked for ${this.maxIterations} steps. Current summary: ${this.lastCheckpoint?.summary || "Working..."}. Continue?`,
      actions: [
        { type: "continue", label: "▶️ Continue Task", payload: { goal: finalPrompt } },
        { type: "cancel", label: "⏹️ Stop Here", payload: {} }
      ]
    };
    this.addMessage(handoffMsg);
    return handoffMsg;
  }

  private addMessage(msg: LLMMessage): string | void {
    this.messages.push(msg);
    return this.options.onMessage?.(msg);
  }

  private _makeSubAgentFactory(): SubAgentFactory {
    return (overrides) => new AgentRuntime({ ...this.options, ...overrides });
  }
}
