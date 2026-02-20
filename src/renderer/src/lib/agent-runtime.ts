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
import { executeToolCall, getAllTools, getServers } from "./mcp";
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

  constructor(options: AgentRuntimeOptions, initialHistory: LLMMessage[] = []) {
    this.options = options;

    // CRITICAL: Sub-agents MUST start with empty context for token efficiency.
    // They receive a specific instruction — they don't need the full chat history.
    if (options.isSubAgent) {
      this.messages = [];
      console.log("[AgentRuntime] Sub-agent created with FRESH context (0 messages)");
    } else {
      this.messages = [...initialHistory];
      console.log(`[AgentRuntime] Main agent created with ${this.messages.length} historical messages`);
    }

    // Sub-agents get 15 iterations (enough for most tasks).
    // Main agents get 50 to allow for deep reasoning/thinking chains.
    this.maxIterations = options.isSubAgent ? 15 : 50;

    if (options.taskCategory) {
      this.taskCategory = options.taskCategory;
    }

    this.agentInstanceId = options.agentInstanceId || globalThis.crypto.randomUUID();
  }

  // ── IAgentClient: chat ─────────────────────────────────────────────────────

  /**
   * Main entry point: run the agent with the given user message.
   *
   * Flow:
   * 1. Prepare attachment context
   * 2. Initialize session state in memory (AgentStateService)
   * 3. Detect and resume from pending handoffs (AgentStateService)
   * 4. Task analysis + optional confirmation
   * 5. Task decomposition → parallel or sequential sub-agents (OrchestrationService)
   * 6. Main LLM + tool call loop
   * 7. Cleanup (AgentStateService)
   */
  async chat(
    userContent: string,
    attachments?: { name: string; path: string; type: string }[]
  ): Promise<LLMMessage> {
    let finalPrompt = userContent;

    // ── Attachment context ───────────────────────────────────────────────────
    // Appended to the user message so the agent knows about attached files.
    // WHY append (not system message): Survives system prompt replacement in llm.ts.
    let attachmentContext = "";
    if (attachments && attachments.length > 0) {
      const resourceList = attachments.map((a) => `- ${a.name} (Path: ${a.path})`).join("\n");
      const toolHint = `\n\n[To analyze these files, use the 'convert_to_markdown' tool with file:// URIs. Example: convert_to_markdown(uri="file:///absolute/path")]`;
      attachmentContext = `\n\n[System Note: User attached the following files. Use absolute paths to access them.]\n${resourceList}${toolHint}`;
      console.log("[AgentRuntime] Prepared attachment context:", resourceList);
    }

    // ── State initialization (AgentStateService) ─────────────────────────────
    const { restoredCheckpoint } = await initializeSessionState(
      this.agentInstanceId,
      this.options.activeSessionId,
      this.options.parentAgentId
    );
    if (restoredCheckpoint) this.lastCheckpoint = restoredCheckpoint;

    // Load parent context for sub-agents
    if (this.options.parentAgentId) {
      const parentContextMsg = await loadParentContext(this.options.parentAgentId);
      if (parentContextMsg) this.messages.push(parentContextMsg);
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

    // ── Task analysis + confirmation ─────────────────────────────────────────
    let taskComplexity: "simple" | "moderate" | "complex" = "moderate";

    if (this.options.requireConfirmation && this.options.onConfirmationNeeded) {
      try {
        const isSimpleReply =
          /^(yes|no|ok|okay|sure|nope|continue|stop|proceed|go ahead|skip|next|back)$/i.test(
            userContent.trim()
          );
        const lastMessage = this.messages[this.messages.length - 1];
        const lastContent =
          typeof lastMessage?.content === "string" ? lastMessage.content : "";
        const isReplyToQuestion =
          lastMessage?.role === "assistant" && lastContent.includes("?");

        if (isSimpleReply && isReplyToQuestion) {
          console.log("[AgentRuntime] Simple reply to agent question. Skipping confirmation.");
          taskComplexity = "simple";
        } else {
          console.log("[AgentRuntime] Analyzing task for ambiguity...");
          const analysis = await analyzeTask(userContent, this.options.settings, attachments);

          if (analysis.category) {
            this.taskCategory = analysis.category;
            console.log(`[AgentRuntime] Identified task category: ${this.taskCategory}`);
          }
          if (analysis.complexity) {
            taskComplexity = analysis.complexity.level;
            console.log(`[AgentRuntime] Task complexity: ${taskComplexity}`);
          }

          if (analysis.shouldConfirm) {
            console.log("[AgentRuntime] Task needs confirmation. Asking user...");
            const enrichedPrompt = await this.options.onConfirmationNeeded(analysis);
            if (enrichedPrompt === null) {
              return { role: "assistant", content: "Task cancelled. Let me know when you want to try again!" };
            }
            finalPrompt = enrichedPrompt;
            console.log("[AgentRuntime] Using enriched prompt:", finalPrompt);
          } else {
            console.log("[AgentRuntime] Task is clear. Skipping confirmation.");
          }
        }
      } catch (error) {
        console.error("[AgentRuntime] Confirmation analysis failed:", error);
      }
    }

    // ── Dynamic handoff confirmation ─────────────────────────────────────────
    const lastMsg = this.messages[this.messages.length - 1];
    const isConfirmingHandoff =
      lastMsg?.role === "assistant" &&
      lastMsg?.content?.toString().includes("reached the maximum number of steps") &&
      /^(yes|continue|proceed|go ahead|sure)$/i.test(userContent.trim());

    if (isConfirmingHandoff) {
      console.log("[AgentRuntime] User confirmed handoff. Triggering sub-agent...");
      this.addMessage({ role: "user", content: userContent });
      const originalGoal =
        this.messages.find((m) => m.role === "user")?.content?.toString() || "Complete the task";
      const stepsTaken = Math.floor(this.messages.length / 2);
      const progressContext = this.lastCheckpoint
        ? `Last Checkpoint: ${this.lastCheckpoint.summary}`
        : "No detailed progress recorded yet.";
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

    // ── Task decomposition ───────────────────────────────────────────────────
    if (!this.options.isSubAgent && taskComplexity !== "simple") {
      console.log("[AgentRuntime] Running task decomposition analysis...");
      const decomposition = await analyzeTaskForDecomposition(finalPrompt, this.options.settings);
      console.log("[AgentRuntime] Task decomposition:", decomposition);

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
        console.log(
          `[AgentRuntime] Complex single-context task: ${decomposition.estimatedActions} actions - using sequential sub-agents`
        );
        return executeSequentialSubAgents(
          finalPrompt,
          decomposition,
          this.options,
          this.agentInstanceId,
          (msg) => this.addMessage(msg),
          this._makeSubAgentFactory()
        );
      }
    } else if (!this.options.isSubAgent && taskComplexity === "simple") {
      console.log("[AgentRuntime] Simple task detected - skipping decomposition for faster response");
    }

    // ── User message injection ───────────────────────────────────────────────
    const lastMessage = this.messages[this.messages.length - 1];
    const alreadyHasMessage =
      lastMessage?.role === "user" && lastMessage?.content === finalPrompt;

    if (alreadyHasMessage && lastMessage) {
      lastMessage.content = finalPrompt + attachmentContext;
      console.log("[AgentRuntime] Updated existing user message with attachment context");
    } else {
      this.addMessage({ role: "user", content: finalPrompt + attachmentContext });
    }

    // ── Main LLM + tool call loop ────────────────────────────────────────────
    return this._runLoop(finalPrompt);
  }

  // ── IAgentClient: getHistory ───────────────────────────────────────────────

  getHistory(): LLMMessage[] {
    return this.messages;
  }

  // ── IAgentClient: abort ────────────────────────────────────────────────────

  /**
   * Signals intent to abort. The loop checks `this.options.signal?.aborted`
   * on every iteration. The actual abort is triggered by the chatStore's
   * AbortController (via `abortProcessing()`).
   */
  abort(): void {
    console.log("[AgentRuntime] abort() called — signal will be checked on next iteration");
  }

  // ── Private: Main Loop ─────────────────────────────────────────────────────

  private async _runLoop(finalPrompt: string): Promise<LLMMessage> {
    let iterationCount = 0;
    let consecutiveErrors = 0;
    const recentToolCalls: string[] = [];

    while (iterationCount < this.maxIterations) {
      this.totalIterations++;

      // ── Context limit check → handoff ──────────────────────────────────────
      const contextText = JSON.stringify(this.messages);
      const estimatedTokens = Math.ceil(contextText.length / 4);
      const contextLimit = 100000;
      const isApproachingLimit = estimatedTokens > contextLimit * 0.8;

      if (isApproachingLimit && !this.options.isSubAgent) {
        console.warn(
          `[AgentRuntime] Approaching context limit: ${estimatedTokens} tokens (~${Math.round(
            (estimatedTokens / contextLimit) * 100
          )}%)`
        );
        const originalGoalMsg = this.messages.find((m) => m.role === "user");
        const originalGoal = originalGoalMsg?.content?.toString() || "";
        const summary = this.lastCheckpoint?.summary || "";
        const looksComplete = /complete|done|finished|success/i.test(summary);

        if (!looksComplete) {
          try {
            await createHandoff(
              this.agentInstanceId,
              this.options.activeSessionId,
              originalGoal,
              this.lastCheckpoint,
              estimatedTokens
            );
            const handoffMsg: LLMMessage = {
              role: "assistant",
              content: `I'm approaching my context limit (${estimatedTokens} tokens) and haven't fully completed the task yet. I've saved my progress and will hand off to a fresh agent instance to continue.\n\n**Progress So Far:**\n${this.lastCheckpoint?.summary || "Working on the task..."
                }\n\nPlease send your next message to continue with a fresh agent.`,
            };
            this.addMessage(handoffMsg);
            return handoffMsg;
          } catch (err) {
            console.error(`[AgentRuntime] Failed to create handoff: ${err}`);
          }
        }
      }

      if (this.options.signal?.aborted) throw new Error("Aborted by user");

      // ── Context pruning ────────────────────────────────────────────────────
      this.messages = pruneContext(this.messages);

      // ── Tool preparation ───────────────────────────────────────────────────
      const mcpTools = getAllTools();
      const llmTools: LLMTool[] = mcpTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));
      const clientLlmTools: LLMTool[] = CLIENT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));

      // Deduplicate tools by name (MCP tools take precedence over client tools)
      const toolMap = new Map<string, LLMTool>();
      for (const tool of [...llmTools, ...clientLlmTools]) {
        if (!toolMap.has(tool.name)) toolMap.set(tool.name, tool);
      }
      const allTools = Array.from(toolMap.values());

      const servers = getServers();
      const serverInfo: ServerInfo[] = servers
        .filter((s) => s.connected)
        .map((s) => ({
          name: s.name,
          description: s.description.substring(0, 40),
          toolCount: s.tools.length,
          isReasoningServer:
            s.name.includes("sequential-thinking") ||
            s.name.includes("sequential") ||
            s.description.toLowerCase().includes("reasoning"),
        }));

      // ── Dynamic rules (prompt library) ────────────────────────────────────
      let dynamicRules: string | undefined;
      const { getComposedPrompts } = await import("./prompt-library");
      const promptsToLoad: string[] = [];
      if (this.taskCategory) promptsToLoad.push(this.taskCategory);
      if (promptsToLoad.length > 0) {
        dynamicRules = getComposedPrompts(promptsToLoad, this.options.isSubAgent);
        console.log(`[AgentRuntime] Injected dynamic rules for: ${promptsToLoad.join(" + ")}`);
      }

      if (this.options.isSubAgent) {
        console.log(
          `[SubAgent] LLM call with ${this.messages.length} messages (should be 1-3 for fresh sub-agent)`
        );
      }

      if (this.options.signal?.aborted) throw new Error("Aborted by user");

      // ── LLM call ──────────────────────────────────────────────────────────
      console.log(`[AgentRuntime] Iteration ${iterationCount + 1}: Calling LLM...`);

      if (this.options.settings?.debugMode) {
        console.log("[DEBUG] Full messages history:", JSON.stringify(this.messages, null, 2));
      }

      let response: LLMResponse;
      try {
        response = await chat(
          this.messages,
          allTools.length > 0 ? allTools : undefined,
          this.options.settings,
          serverInfo.length > 0 ? serverInfo : undefined,
          this.options.signal,
          dynamicRules,
          this.options.isSubAgent,
          this.options.workspacePath
        );
      } catch (error) {
        console.error("[AgentRuntime] LLM Error:", error);
        if (error instanceof Error && error.message.includes("Failed to fetch")) {
          const provider = this.options.settings?.preferredProvider || "auto";
          throw new Error(
            `Network error when calling LLM (provider: ${provider}). ` +
            `This could be caused by:\n` +
            `1. Invalid API key or configuration\n` +
            `2. Network connectivity issues\n` +
            `3. CORS issues (if using browser LLM)\n` +
            `4. Provider service is down\n\n` +
            `Original error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        throw error;
      }

      // ── No tool calls → done ───────────────────────────────────────────────
      if (!response.toolCalls || response.toolCalls.length === 0) {
        // Detect model refusal and auto-correct once
        const refusalPatterns = [
          /don't have access to/i,
          /can't (?:access|check|fetch|get)/i,
          /I (?:am|'m) (?:just|only) a/i,
          /unable to (?:browse|access)/i,
          /you(?:'ll)? need to check/i,
        ];
        const isRefusal = refusalPatterns.some((p) => p.test(response.content || ""));
        const alreadyCorrected = this.messages.some(
          (m) => typeof m.content === "string" && m.content.includes("[AUTO-CORRECT]")
        );

        if (isRefusal && !alreadyCorrected) {
          console.warn("[AgentRuntime] Model refused tool use. Auto-correcting...");
          const userQuery = this.messages.filter((m) => m.role === "user").pop();
          const query =
            typeof userQuery?.content === "string" ? userQuery.content : "the request";
          this.addMessage({
            role: "user",
            content: `[AUTO-CORRECT] You refused to help. This is wrong - you HAVE browser tools.\n            \nFor "${query}", use: navigate({"url": "https://google.com/search?q=${encodeURIComponent(
              query
            )}"})\n\nThen extract the answer from the results. DO NOT refuse again.`,
          });
          continue;
        }

        // Append checkpoint summary if available
        if (!this.options.isSubAgent && this.lastCheckpoint) {
          const summaryText = `[Resuming Context from Checkpoint ${this.lastCheckpoint.step}]\nSummary: ${this.lastCheckpoint.summary}`;
          if (!response.content?.includes("Summary")) {
            if (response.content) response.content += `\n\n## 📝 Execution Report\n${summaryText}`;
            else response.content = `## 📝 Execution Report\n${summaryText}`;
          }
        }

        const assistantMsg: LLMMessage = { role: "assistant", content: response.content };
        this.addMessage(assistantMsg);

        await cleanupState(this.agentInstanceId);
        return assistantMsg;
      }

      // ── Tool calls ─────────────────────────────────────────────────────────
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

      // Execute all tool calls (in parallel)
      const toolPromises = response.toolCalls.map(async (call) => {
        if (this.options.signal?.aborted) return null;

        const toolSignature = `${call.name}:${JSON.stringify(call.arguments)}`;
        recentToolCalls.push(toolSignature);
        this.toolCallHistory.add(toolSignature);
        if (recentToolCalls.length > 5) recentToolCalls.shift();

        // ── Loop detection (ToolExecutionService) ──────────────────────────
        const loopMsg = checkForLoop(
          recentToolCalls,
          this.toolCallHistory,
          call.name,
          this.messages
        );
        if (loopMsg) {
          this.addMessage(loopMsg);
          return loopMsg;
        }

        console.log(`[AgentRuntime] Executing tool: ${call.name}`);
        let resultStr = "";

        // ── Special internal tools ─────────────────────────────────────────
        if (call.name === "create_execution_plan") {
          resultStr = this._handleCreateExecutionPlan(call.arguments as any, iterationCount);
        } else if (call.name === "scan_page_accessibility") {
          resultStr = await this._handleScanPageAccessibility();
        } else if (call.name === "update_progress_summary") {
          resultStr = await this._handleUpdateProgressSummary(call.arguments as any, iterationCount);
        } else if (call.name === "delegate_sub_task") {
          resultStr = await this._handleDelegateSubTask(call.arguments as any);
        } else {
          // ── Standard MCP tool (ToolExecutionService) ───────────────────
          try {
            const rawResult = await executeWithSelfHealing(
              call.name,
              call.arguments as Record<string, unknown>,
              this.options.tabId,
              this.options.workspacePath,
              this.options.signal
            );
            const { resultStr: formatted, isError } = formatToolResult(call.name, rawResult);
            resultStr = formatted;
            if (isError) {
              consecutiveErrors++;
            } else {
              consecutiveErrors = 0;
            }
          } catch (err: any) {
            resultStr = JSON.stringify({ error: err.message || "Unknown error" });
            consecutiveErrors++;
          }

          // Bailout after too many consecutive errors
          if (consecutiveErrors >= this.maxConsecutiveErrors) {
            console.error(`[AgentRuntime] Bailing out after ${consecutiveErrors} consecutive errors`);
            const bailoutMsg: LLMMessage = {
              role: "assistant",
              content: `I encountered ${consecutiveErrors} consecutive errors and am stopping to prevent an infinite loop. The last error was: ${resultStr}\n\nPlease try a different approach or simplify the task.`,
            };
            this.addMessage(bailoutMsg);
            return bailoutMsg;
          }
        }

        // ── Truncate + add tool result ─────────────────────────────────────
        const truncated = truncateToolOutput(call.name, resultStr);
        this.addMessage({ role: "tool", content: truncated, tool_call_id: call.id });

        // ── Incremental finding reporting ──────────────────────────────────
        if (!this.options.isSubAgent) {
          reportFinding(call.name, resultStr, (msg) => this.addMessage(msg));
        }

        return undefined;
      });

      const results = await Promise.all(toolPromises);

      // Check for bailouts (loop detection or consecutive error bailout)
      const bailout = results.find((r) => r && r.role === "assistant");
      if (bailout) return bailout;

      iterationCount++;

      // ── Checkpoint request ─────────────────────────────────────────────────
      const CHECKPOINT_INTERVAL = 15;
      if (
        !this.options.isSubAgent &&
        iterationCount % CHECKPOINT_INTERVAL === 0 &&
        iterationCount > 0
      ) {
        const lastRecordedIteration = this.lastCheckpoint?.step || 0;
        if (lastRecordedIteration < iterationCount) {
          console.log(`[AgentRuntime] Checkpoint ${iterationCount}: Requesting progress summary...`);
          this.addMessage({
            role: "user",
            content: `[CHECKPOINT ${iterationCount}] Please call update_progress_summary now with a brief summary of your findings and progress in the last ${CHECKPOINT_INTERVAL} steps.`,
          });
        }
      }

      // ── Fallback auto-checkpoint ───────────────────────────────────────────
      const lastRecordedIteration = this.lastCheckpoint?.step || 0;
      const iterationsSinceLastCheckpoint = iterationCount - lastRecordedIteration;
      const shouldHaveCheckpoint =
        iterationCount >= CHECKPOINT_INTERVAL && iterationCount % CHECKPOINT_INTERVAL <= 3;

      if (
        !this.options.isSubAgent &&
        shouldHaveCheckpoint &&
        iterationsSinceLastCheckpoint >= CHECKPOINT_INTERVAL + 3
      ) {
        console.warn(`[AgentRuntime] Checkpoint overdue. Auto-generating summary...`);
        const recentToolMessages = this.messages
          .filter((m) => m.role === "tool")
          .slice(-5)
          .map((m) => {
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            return content.substring(0, 100);
          });
        this.lastCheckpoint = {
          step: iterationCount,
          summary: `Auto-generated checkpoint at iteration ${iterationCount}. Recent actions: ${recentToolMessages.join("; ") || "Processing..."
            }`.substring(0, 200),
          timestamp: Date.now(),
        };
      }
    }

    // ── Max iterations reached ─────────────────────────────────────────────
    if (!this.options.isSubAgent) {
      console.log(`[AgentRuntime] Max iterations (${this.maxIterations}) reached.`);
      const recentToolOutputs = this.messages
        .filter((m) => m.role === "tool")
        .slice(-2)
        .map((m) => {
          const content = typeof m.content === "string" ? m.content : "";
          return content.substring(0, 300) + (content.length > 300 ? "..." : "");
        })
        .join("\n\n");

      const uniqueToolsUsed = this.toolCallHistory.size;
      const progressIndicator =
        uniqueToolsUsed > iterationCount * 0.5
          ? "✅ Making diverse progress"
          : "⚠️ Possibly stuck in a loop";

      const summary = this.lastCheckpoint
        ? this.lastCheckpoint.summary
        : "No progress summaries recorded yet.";

      const handoffMsg: LLMMessage = {
        role: "assistant",
        content: `I've worked for **${this.maxIterations} steps** but haven't finished yet.\n\n**Progress Status:** ${progressIndicator} (${uniqueToolsUsed} unique tool calls so far)\n\n**Progress Summary:**\n${summary || "Executed several actions."
          }\n\n**Latest Results:**\n${recentToolOutputs || "Processing data..."}\n\nWould you like me to continue with a fresh sub-agent?`,
        actions: [
          { type: "continue", label: "▶️ Continue Task", payload: { goal: finalPrompt } },
          { type: "cancel", label: "⏹️ Stop Here", payload: {} },
        ],
      };
      this.addMessage(handoffMsg);
      return handoffMsg;
    }

    throw new Error(`Max iterations (${this.maxIterations}) reached. Task appears stuck or too complex.`);
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
        result = await executeToolCall("browser_evaluate", { script });
      } catch (e) {
        console.warn("[AgentRuntime] browser_evaluate failed, trying browser_run_code...");
      }
      if (!result || result.error) {
        result = await executeToolCall("browser_run_code", { code: script });
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
      const resAny = tabResult.result as any;
      if (resAny?.tabId !== undefined) {
        subAgentTabId = resAny.tabId;
        console.log(`[AgentRuntime] Provisioned tab ${subAgentTabId} for sub-agent`);
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

  // ── Private: Helpers ───────────────────────────────────────────────────────

  private addMessage(msg: LLMMessage): string | void {
    this.messages.push(msg);
    if (this.options.onMessage) {
      return this.options.onMessage(msg);
    }
  }

  /**
   * Creates a SubAgentFactory bound to this agent's options.
   *
   * WHY a factory: OrchestrationService needs to create AgentRuntime instances
   * but cannot import AgentRuntime directly (circular dependency). The factory
   * is provided by AgentRuntime at call time, breaking the cycle.
   */
  private _makeSubAgentFactory(): SubAgentFactory {
    return (overrides) => {
      const subAgentOptions: AgentRuntimeOptions = {
        ...this.options,
        ...overrides,
      };
      return new AgentRuntime(subAgentOptions);
    };
  }
}
