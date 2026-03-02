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
  private taskStartTimeMs: number;
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

    if (options.taskCategory) {
      this.taskCategory = options.taskCategory;
    }

    this.agentInstanceId = options.agentInstanceId || globalThis.crypto.randomUUID();
    this.taskStartTimeMs = Date.now();
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

    // ── Check tasks.json for crash recovery ────────────────────────────────
    if (!this.executionPlan && !this.options.isSubAgent && this.options.workspacePath) {
      try {
        const electron = (await import('./electron')).default;
        const result = await electron.fs.readInternalFile(this.options.workspacePath, 'tasks.json');
        if (result.success && result.content) {
          this.executionPlan = JSON.parse(result.content);
          console.log('[AgentRuntime] Recovered execution plan from tasks.json');

          // Sync recovered plan to tasks.json to ensure file is up-to-date
          import('./task-manager').then(m => m.syncPlanToFile(this.options.workspacePath, this.executionPlan!));
        }
      } catch (e) {
        console.warn('[AgentRuntime] Failed to recover tasks.json:', e);
      }
    }

    // ── Handoff detection (AgentStateService) ────────────────────────────────
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
    let activeAssistantMessageId: string | undefined;

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
      const messageIdResult = this.addMessage(assistantMsg);
      if (typeof messageIdResult === "string") {
        activeAssistantMessageId = messageIdResult;
      }

      // Sync tool calls to assistantMsg local tracking
      if (!(assistantMsg as any).toolCalls) {
        (assistantMsg as any).toolCalls = response.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments
        }));
      }

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

        // ── Update UI with tool result ─────────────────────────────────────
        if (activeAssistantMessageId && this.options.onMessageUpdate) {
          const currentToolCalls = (assistantMsg as any).toolCalls || [];
          const storeToolCalls = currentToolCalls.map((t: any) =>
            t.id === call.id ? { ...t, result: truncated } : t
          );
          (assistantMsg as any).toolCalls = storeToolCalls;
          this.options.onMessageUpdate(activeAssistantMessageId, {
            toolCalls: storeToolCalls
          } as any);
        }

        // ── Progress calculation (Gap 2 fix) ──────────────────────────────
        // Runs unconditionally — not just when there's presentable data.
        // This ensures the progress bar advances for every tool call,
        // including browser_navigate, browser_click, fs_read, etc.
        if (!this.options.isSubAgent && this.options.onProgressUpdate) {
          // Crude iteration-based estimate as the floor
          let progress = Math.min(Math.round(((iterationCount + 1) / this.maxIterations) * 100), 95);

          // If we have an execution plan, use the more accurate step-based progress
          if (this.executionPlan && this.executionPlan.steps.length > 0) {
            const totalSteps = this.executionPlan.steps.length;
            const completedSteps = this.executionPlan.steps.filter(s => s.status === 'completed').length;
            const activeSteps = this.executionPlan.steps.filter(s => s.status === 'active').length;
            // Active steps count as 50% done for progress calculation
            const rawProgress = ((completedSteps + (activeSteps * 0.5)) / totalSteps) * 100;
            progress = Math.min(Math.max(Math.round(rawProgress), progress), 98);
          }

          let etaSeconds: number | undefined;
          if (progress > 0) {
            const elapsedMs = Date.now() - this.taskStartTimeMs;
            const rate = progress / elapsedMs;
            const remainingMs = Math.max(0, (100 - progress) / rate);
            etaSeconds = Math.round(remainingMs / 1000);
          }

          this.options.onProgressUpdate(progress, etaSeconds, this.executionPlan ?? undefined);
        }

        // ── Incremental finding reporting ──────────────────────────────────
        // Only surfaces data-rich tool outputs (e.g. page content, file reads)
        // as annotated findings on the tool call card. Does NOT update progress.
        if (!this.options.isSubAgent) {
          const findingSummary = reportFinding(call.name, resultStr);
          if (findingSummary && activeAssistantMessageId && this.options.onMessageUpdate) {
            const currentToolCalls = (assistantMsg as any).toolCalls || [];
            const storeToolCalls = currentToolCalls.map((t: any) =>
              t.id === call.id ? { ...t, isPresentable: true, finding: findingSummary.summary } : t
            );
            (assistantMsg as any).toolCalls = storeToolCalls;
            this.options.onMessageUpdate(activeAssistantMessageId, {
              toolCalls: storeToolCalls
            } as any);
          }
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

  // ── Private: Special Tool Handlers ────────────────────────────────────────

  private _handleCreateExecutionPlan(args: any, iterationCount: number): string {
    const steps = args.steps || [];
    this.executionPlan = {
      goal: args.goal || "Unknown goal",
      steps: steps.map((s: any) => ({
        id: s.id,
        description: s.description,
        status: s.status || "pending",
        assigned_agent: s.assigned_agent,
      })),
    };

    // Keep it in sync
    import('./task-manager').then(m => m.syncPlanToFile(this.options.workspacePath, this.executionPlan!));

    console.log(`[AgentRuntime] Plan created with ${steps.length} steps:`, args.goal);
    return `Execution plan created: ${args.goal}\n\nSteps:\n${steps
      .map((s: any) => `${s.id}. ${s.description} [${s.assigned_agent}]`)
      .join("\n")}\n\nI will now execute each step sequentially.`;
  }

  private async _handleScanPageAccessibility(): Promise<string> {
    console.log("[AgentRuntime] Scanning page accessibility tree...");
    const script = `
      (function() {
        function getAccessibilityTree(element) {
          if (!element) return null;
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return null;
          const role = element.getAttribute('role') || element.tagName.toLowerCase();
          const label = element.getAttribute('aria-label') || element.innerText || '';
          const interestingRoles = ['button', 'link', 'input', 'textarea', 'select', 'heading', 'article', 'section', 'nav', 'main', 'form', 'img', 'a'];
          const isInteresting = interestingRoles.includes(role) || (element.onclick != null) ||
            (role === 'div' && (element.className.includes('btn') || element.className.includes('button')));
          if (!isInteresting && element.children.length === 0 && !label.trim()) return null;
          const node = {
            role: role,
            name: (label.substring(0, 50) + (label.length > 50 ? '...' : '')).replace(/\\n/g, ' ').trim(),
          };
          if (element.id) node.id = element.id;
          if (element.value) node.value = element.value;
          if (element.href) node.href = element.href;
          if (element.children.length > 0) {
            const children = Array.from(element.children).map(child => getAccessibilityTree(child)).filter(c => c !== null);
            if (children.length > 0) node.children = children;
          }
          if (!isInteresting && node.children) {
            return node.children.length === 1 ? node.children[0] : { role: 'group', children: node.children };
          }
          if (!isInteresting && !node.children) return null;
          return node;
        }
        return JSON.stringify(getAccessibilityTree(document.body));
      })()
    `;

    try {
      let result;
      try {
        result = await executeToolCall("browser_evaluate", { script, tabId: this.options.tabId });
      } catch (e) {
        console.warn("[AgentRuntime] browser_evaluate failed, trying browser_run_code...");
      }
      if (!result || result.error) {
        result = await executeToolCall("browser_run_code", { code: script, tabId: this.options.tabId });
      }
      if (result.error) {
        return `Error scanning page: ${result.error}. Try using browser_snapshot instead if this persists.`;
      }
      const tree =
        typeof result.result === "string" ? result.result : JSON.stringify(result.result);
      const output = `Page Accessibility Tree (Semantic Structure):\n${tree.substring(0, 15000)}`;
      console.log(`[AgentRuntime] Accessibility scan complete (${output.length} chars)`);
      return output;
    } catch (err: any) {
      return `Error executing accessibility scan: ${err.message}`;
    }
  }

  private async _handleUpdateProgressSummary(args: any, iterationCount: number): Promise<string> {
    const summary = args.summary || "";
    if (summary.trim()) {
      this.lastCheckpoint = { step: iterationCount, summary, timestamp: Date.now() };
      await executeToolCall("memory_update_entity", {
        name: `AgentState_${this.agentInstanceId}`,
        Metadata: {
          lastCheckpoint: this.lastCheckpoint,
          status: "active",
          iterationCount,
        },
      });
      console.log(`[AgentRuntime] Progress checkpoint saved to memory (Step ${iterationCount})`);
    }
    return JSON.stringify({
      success: true,
      message: "Progress checkpoint saved to persistent memory.",
      checkpointStep: iterationCount,
    });
  }

  private async _handleDelegateSubTask(args: any): Promise<string> {
    const instruction = args.instruction || "";
    let context = args.context || "";

    if (context.length > 5000) {
      console.warn(`[AgentRuntime] Sub-agent context too large (${context.length} chars), truncating to 5000`);
      context = context.substring(0, 5000) + "\n...[truncated for efficiency]...";
    }

    console.log(`[AgentRuntime] Delegating to sub-agent: ${instruction}`);

    const subAgentId = globalThis.crypto.randomUUID();

    // Pre-seed memory for the sub-agent
    const { preSeedSubAgentMemory } = await import("./agent/AgentStateService");
    await preSeedSubAgentMemory(
      subAgentId,
      this.agentInstanceId,
      this.options.activeSessionId,
      [
        `Sequential sub-agent for task: ${instruction.substring(0, 100)}`,
        `Initialized at ${new Date().toISOString()}`,
      ].join("\n"),
      { instruction: instruction.substring(0, 200) }
    );

    // Provision a dedicated browser tab
    let subAgentTabId: number | undefined;
    try {
      const { browserLock } = await import("./resource-lock");
      const tabResult = await browserLock.runExclusive(async () =>
        executeToolCall("new_tab", { url: "about:blank" })
      );
      // Extract tabId from the MCP content envelope (or raw fallback)
      const subAgentTabIdResult = parseTabIdFromResult(tabResult);
      if (subAgentTabIdResult !== undefined) {
        subAgentTabId = subAgentTabIdResult;
        console.log(`[AgentRuntime] Provisioned tab ${subAgentTabId} for sub-agent`);
      } else {
        console.warn("[AgentRuntime] new_tab result did not contain a tabId:", tabResult.result);
      }
    } catch (e) {
      console.warn("[AgentRuntime] Failed to provision tab for sub-agent", e);
    }

    const subAgent = this._makeSubAgentFactory()({
      agentInstanceId: subAgentId,
      parentAgentId: this.agentInstanceId,
      isSubAgent: true,
      tabId: subAgentTabId,
      taskCategory: this.taskCategory,
      requireConfirmation: false,
      onMessage: (msg: LLMMessage) => {
        const contentStr =
          typeof msg.content === "string"
            ? msg.content
            : (msg.content as any[])
              .map((c: any) => (c.type === "text" ? c.text : "[Image]"))
              .join(" ");
        console.log(`[SubAgent Tab:${subAgentTabId ?? "default"}] ${msg.role}: ${contentStr?.substring(0, 50)}`);
      },
    });

    try {
      const prompt = `${instruction}${context ? `\n\nContext: ${context}` : ""}\n\nReturn key findings only. End with "✓ Done".`;
      const finalRes = await subAgent.chat(prompt);
      const finalContent =
        typeof finalRes.content === "string"
          ? finalRes.content
          : (finalRes.content as any[]).map((c: any) => (c.type === "text" ? c.text : "")).join("");

      // Close the sub-agent's tab
      if (subAgentTabId !== undefined) {
        try {
          const { browserLock } = await import("./resource-lock");
          await browserLock.runExclusive(async () =>
            executeToolCall("close_tab", { tabId: subAgentTabId })
          );
          console.log(`[AgentRuntime] Closed sub-agent tab ${subAgentTabId}`);
        } catch (e) {
          console.warn(`[AgentRuntime] Failed to close sub-agent tab ${subAgentTabId}`, e);
        }
      }

      // ── Detect sub-agent bailout vs clean completion ──────────────────────
      // When consecutiveErrors >= maxConsecutiveErrors the sub-agent emits a
      // bailout message starting with "I encountered N consecutive errors".
      // In that case we salvage any partial data from its tool history so the
      // parent LLM can still make use of what the sub-agent did collect.
      const isBailout = finalContent.includes("consecutive errors") ||
        finalContent.includes("stopping to prevent an infinite loop");

      if (isBailout) {
        // Extract partial tool outputs from the sub-agent's history
        const subAgentHistory = (subAgent as any).getHistory?.() as LLMMessage[] | undefined;
        const partialFindings: string[] = [];

        if (subAgentHistory) {
          for (const msg of subAgentHistory) {
            if (msg.role === "tool") {
              const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
              // Only salvage non-error, non-trivial outputs
              if (!content.includes('"error":') && content.length > 50) {
                const { analyzeToolOutput } = await import("./result-reporter");
                const analysis = analyzeToolOutput("tool", content);
                if (analysis.hasPresentableData && analysis.summary) {
                  partialFindings.push(analysis.summary.substring(0, 300));
                }
              }
            }
          }
        }

        // Mark matching plan step as "failed" so tasks.json is accurate
        if (this.executionPlan) {
          const matchingStep = this.executionPlan.steps.find(
            (s) =>
              s.status === "pending" &&
              (instruction.toLowerCase().includes(s.description.toLowerCase().substring(0, 20)) ||
                s.description.toLowerCase().includes(instruction.toLowerCase().substring(0, 20)))
          );
          if (matchingStep) {
            matchingStep.status = "failed";
            matchingStep.result = `Failed after partial execution. ${partialFindings.length} findings salvaged.`;
            import('./task-manager').then(m => m.syncPlanToFile(this.options.workspacePath, this.executionPlan!));
          }
        }

        // Return partial data + error so the parent LLM can adapt
        const partialSection = partialFindings.length > 0
          ? `\n\nPartial data collected before failure:\n${partialFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}`
          : "";
        console.warn(`[AgentRuntime] Sub-agent bailed out. Salvaged ${partialFindings.length} partial findings.`);
        return `Sub-agent encountered errors and stopped.${partialSection}\n\nPlease use the partial data above if useful, or try a different approach for: ${instruction}`;
      }

      // ── Clean completion path ──────────────────────────────────────────────
      // Update execution plan if we have one
      if (this.executionPlan) {
        const matchingStep = this.executionPlan.steps.find(
          (s) =>
            s.status === "pending" &&
            (instruction.toLowerCase().includes(s.description.toLowerCase().substring(0, 20)) ||
              s.description.toLowerCase().includes(instruction.toLowerCase().substring(0, 20)))
        );
        if (matchingStep) {
          matchingStep.status = "completed";
          matchingStep.result = finalContent.substring(0, 200);

          // Keep it in sync
          import('./task-manager').then(m => m.syncPlanToFile(this.options.workspacePath, this.executionPlan!));

          const completed = this.executionPlan.steps.filter((s) => s.status === "completed").length;
          const total = this.executionPlan.steps.length;
          console.log(`[AgentRuntime] Plan progress: ${completed}/${total} steps completed`);
        }
      }

      return finalContent.trim();
    } catch (err: any) {
      return `Sub-agent failed: ${err.message}`;
    }
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
    return (overrides) => {
      const subAgentOptions: AgentRuntimeOptions = {
        ...this.options,
        ...overrides,
        // WHY always strip onProgressUpdate for sub-agents:
        // Sub-agents must NEVER fire global UI progress updates. Progress is
        // managed by the parent agent only. Stripping it here is an explicit
        // boundary, not just relying on the `!isSubAgent` guard in _runLoop.
        onProgressUpdate: undefined,
      };
      return new AgentRuntime(subAgentOptions);
    };
  }
}
