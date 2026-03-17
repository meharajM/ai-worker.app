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
import { getAllTools, getServers } from "./mcp";
import { CLIENT_TOOLS } from "./client-tools";
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
 * A single tool call entry in the master accumulator for the live UI bubble.
 * Typed explicitly to satisfy the no-any policy (typescript-standards.md).
 */
interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  isPresentable?: boolean;
  finding?: string;
  startedAt?: number;
  completedAt?: number;
}

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
  /** Tracks last emitted progress % for incremental orchestration ticks */
  private _lastProgressPct = 0;
  /** Incremental estimate of context size in bytes — avoids JSON.stringify on every iteration */
  private _estimatedContextBytes = 0;
  /** Counter to trigger periodic full context resync */
  private _contextResyncCounter = 0;

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

    if (attachments && attachments.length > 0) {
      // Filter out files that have no native path (non-Electron environments or
      // files that were selected in a way that didn't expose .path).
      const validAttachments = attachments.filter(a => a.path && a.path.trim() !== "");

      if (validAttachments.length > 0) {
        // Build one explicit tool-call line per file so the model cannot
        // accidentally reconstruct a URI from just the filename.
        const callLines = validAttachments.map((a, i) => {
          // Ensure triple-slash absolute URI — a.path always starts with '/' on macOS/Linux
          const uri = a.path.startsWith("file://") ? a.path : `file://${a.path}`;
          return `${i + 1}. ${a.name}\n   → convert_to_markdown(uri="${uri}")`;
        }).join("\n");

        finalPrompt +=
          `\n\n[ATTACHED FILES — act on these immediately and read each one NOW using the exact call shown]\n` +
          `${callLines}\n\n` +
          `CRITICAL: Copy the uri argument CHARACTER-FOR-CHARACTER from above. ` +
          `Do NOT use just the filename. Do NOT construct a URI yourself. ` +
          `Reading attached files does NOT require a workspace to be selected.`;
      }
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


    const lastMsg = this.messages[this.messages.length - 1];
    const isConfirmingHandoff =
      lastMsg?.role === "assistant" &&
      lastMsg?.content?.toString().includes("reached the maximum number of steps") &&
      /^(yes|continue|proceed|go ahead|sure)$/i.test(userContent.trim());

    if (isConfirmingHandoff) {
      this.addMessage({ role: "user", content: finalPrompt });
      const originalGoal =
        this.messages.find((m) => m.role === "user")?.content?.toString() || "Complete the task";
      const stepsTaken = Math.floor(this.messages.length / 2);
      const progressContext = this.lastCheckpoint ? `Last Checkpoint: ${this.lastCheckpoint.summary}` : "No detailed progress recorded yet.";
      // ── Emit progress for continuation handoff path ──────────────────────
      this._emitProgress(5);
      const continuationResult = await continueWithSubAgent(
        originalGoal,
        stepsTaken,
        progressContext,
        this.options,
        this.agentInstanceId,
        (msg) => this.addMessage(msg),
        this._makeSubAgentFactory()
      );
      this._emitProgress(100);
      return continuationResult;
    }

    if (!this.options.isSubAgent) {
      // ── Trivially-short prompt guard ────────────────────────────────────────
      // Skip the decomposition LLM call entirely for very short inputs.
      // "yes", "ok", "continue", "no" etc. should never spawn sub-agents — they
      // are conversational replies that belong in _runLoop directly.
      // The task-decomposer already has a follow-up guard (< 80 chars) for
      // prompts with conversation history, but this fires even with empty history.
      const TRIVIAL_PROMPT_LENGTH = 20;
      const isTrivialPrompt = finalPrompt.trim().length <= TRIVIAL_PROMPT_LENGTH;

      const decomposition = isTrivialPrompt
        ? { shouldFork: false, type: 'single_context' as const, contexts: ['current_page'], estimatedActions: 1 }
        : await analyzeTaskForDecomposition(
          finalPrompt,
          this.options.settings,
          undefined,
          this.messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : ''
            }))
        );

      if (decomposition.shouldFork && decomposition.type === "multi_context") {
        // ── Emit progress for parallel orchestration path ────────────────────
        const ctxCount = decomposition.contexts?.length || 1;
        this._emitProgress(5);
        const result = await executeParallelSubAgents(
          finalPrompt,
          decomposition,
          this.options,
          this.agentInstanceId,
          (msg) => {
            // Tick progress forward as each sub-agent message arrives
            this._emitProgress(Math.min(90, this._lastProgressPct + Math.round(80 / (ctxCount * 3))));
            return this.addMessage(msg);
          },
          this._makeSubAgentFactory()
        );
        this._emitProgress(100);
        MemoryReflector.getInstance().analyze(this.messages, this.options.settings);
        return result;
      }

      if (decomposition.shouldFork && decomposition.type === "single_context") {
        // ── Emit progress for sequential orchestration path ──────────────────
        const stepCount = decomposition.contexts?.length || 3;
        this._emitProgress(5);
        const seqResult = await executeSequentialSubAgents(
          finalPrompt,
          decomposition,
          this.options,
          this.agentInstanceId,
          (msg) => {
            // Advance progress by one step slice as each step message arrives
            this._emitProgress(Math.min(90, this._lastProgressPct + Math.round(80 / (stepCount * 2))));
            return this.addMessage(msg);
          },
          this._makeSubAgentFactory()
        );
        this._emitProgress(100);
        MemoryReflector.getInstance().analyze(this.messages, this.options.settings);
        return seqResult;
      }
    }

    const lastMessage = this.messages[this.messages.length - 1];
    const alreadyHasMessage = lastMessage?.role === "user" && lastMessage?.content === finalPrompt;

    if (alreadyHasMessage && lastMessage) {
      lastMessage.content = finalPrompt;
    } else {
      this.addMessage({ role: "user", content: finalPrompt });
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
    // WHY: Tracks whether the agent explicitly called mark_task_complete.
    // The loop can ONLY exit cleanly when this is true or an abort/hard-limit fires.
    let taskComplete = false;
    let taskSuccess = true;
    let taskSummary = "";
    const recentToolCalls: string[] = [];
    // Tracks the single live UI bubble created for ALL tool-calling iterations.
    // Only one bubble is ever created per agent run; all tool calls accumulate into it.
    let activeAssistantMessageId: string | undefined;
    // Master list of all tool calls across every iteration — merged into the one bubble.
    const accumulatedToolCalls: AccumulatedToolCall[] = [];

    while (iterationCount < this.maxIterations) {
      // Exit cleanly if mark_task_complete was called in previous iteration
      if (taskComplete) break;
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
        // ── Check: did the agent explicitly signal completion last iteration? ──
        // If mark_task_complete was processed in a previous iteration, taskComplete
        // would have broken the while-loop already. If we reach here WITHOUT that flag,
        // the agent stopped calling tools without finishing — inject a corrective prompt.
        const refusal = this._handleModelRefusal(response);
        if (refusal) continue;

        // Guard: only inject corrective if we haven't hit the absolute cap
        if (!taskComplete && this.totalIterations < this.ABSOLUTE_MAX_ITERATIONS) {
          console.warn(`[AgentRuntime] Agent returned no tool calls without calling mark_task_complete. Injecting corrective prompt.`);
          // WHY push directly instead of addMessage():
          // This is an internal LLM-steering injection — it must go into the LLM context
          // for the next API call but must NEVER appear as a visible bubble in the chat UI.
          // addMessage() calls onMessage(), which would display this message to the user.
          const correctiveMsg = {
            role: "user" as const,
            content: `[AUTO-CORRECT] You stopped working without calling mark_task_complete. This is not allowed.\n\n` +
              `If the task is DONE: call mark_task_complete({ summary: "...", success: true }).\n` +
              `If you are BLOCKED: call mark_task_complete({ summary: "blocked: <reason>", success: false }).\n` +
              `If you need to keep working: call the next tool immediately.\n\n` +
              `Do NOT respond in prose. Call a tool.`,
          };
          this.messages.push(correctiveMsg);
          this._estimatedContextBytes += correctiveMsg.content.length + 50;
          continue;
        }

        const assistantMsg: LLMMessage = { role: "assistant", content: response.content };
        this._appendCheckpointReport(assistantMsg);

        if (activeAssistantMessageId && this.options.onMessageUpdate) {
          // ── Final response: update the live bubble in-place (no new bubble created) ──
          // Push to internal history without firing onMessage (which would add a new bubble).
          this.messages.push(assistantMsg);
          const finalUpdates: Record<string, unknown> = { content: assistantMsg.content };
          if (accumulatedToolCalls.length > 0) {
            finalUpdates.toolCalls = accumulatedToolCalls;
          }
          this.options.onMessageUpdate(activeAssistantMessageId, finalUpdates);
        } else {
          // No live bubble yet (agent answered immediately without tools) — create one normally.
          this.addMessage(assistantMsg);
        }

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
        })),
      };

      // Build tool call entries for this iteration (no result yet — pending)
      const iterationToolCalls: AccumulatedToolCall[] = response.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        startedAt: Date.now(),
      }));

      if (!activeAssistantMessageId) {
        // ── First tool-calling iteration: create the single live UI bubble ──
        // assistantMsg carries this iteration's tool_calls so the LLM history is correct.
        // We also attach the store-format toolCalls so onMessage can persist them.
        (assistantMsg as any).toolCalls = iterationToolCalls;
        const messageIdResult = this.addMessage(assistantMsg);
        if (typeof messageIdResult === "string") {
          activeAssistantMessageId = messageIdResult;
        }
        // Seed the accumulator with this iteration's calls
        accumulatedToolCalls.push(...iterationToolCalls);
      } else {
        // ── Subsequent iterations: do NOT create a new bubble ──
        // Push to internal LLM history silently (no onMessage callback).
        this.messages.push(assistantMsg);
        // Merge new tool calls into the accumulator
        accumulatedToolCalls.push(...iterationToolCalls);
        // Immediately update the live bubble to show the new pending tool calls
        if (this.options.onMessageUpdate) {
          this.options.onMessageUpdate(activeAssistantMessageId, {
            toolCalls: [...accumulatedToolCalls]
          } as any);
        }
      }

      // Keep local assistantMsg.toolCalls in sync for the tool execution block below
      (assistantMsg as any).toolCalls = iterationToolCalls;

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

        if (call.name === "mark_task_complete") {
          // ── Explicit task completion signal ──────────────────────────────────
          // This is the ONLY valid exit for the agent loop (besides abort + hard cap).
          // Set the flag here; the while-loop checks it at the top of the next iteration.
          const completion = this.specialHandlers.handleMarkTaskComplete(call.arguments);
          resultStr = completion.result;
          taskComplete = completion.isComplete;
          taskSuccess = completion.success;
          taskSummary = (call.arguments.summary as string) || "";
        } else if (call.name === "create_execution_plan") {
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
            // ── Adaptive recovery: inject corrective message, DON'T hard-stop ──
            // WHY: Bailing out immediately means the agent gives up on the whole task.
            // Instead, reset the counter and let the LLM pivot to a new approach.
            // The ABSOLUTE_MAX_ITERATIONS cap is the true hard ceiling.
            console.warn(`[AgentRuntime] ${consecutiveErrors} consecutive errors. Injecting recovery prompt instead of bailing.`);
            consecutiveErrors = 0;
            resultStr += `\n\n[RECOVERY] The last ${this.maxConsecutiveErrors} tool calls all failed consecutively.\n` +
              `STOP using those tools. You MUST try a completely different approach:\n` +
              `- If browser tools fail → try filesystem tools, API calls, or convert_to_markdown\n` +
              `- If a selector fails → use get_interactive_elements() or screenshot() to rediscover\n` +
              `- If an API call fails → check for an alternative endpoint or library\n` +
              `- If you are genuinely blocked → call mark_task_complete({ summary: "blocked: <reason>", success: false })\n` +
              `Do NOT retry the same tools with the same arguments.`;
          }
        }

        const truncated = truncateToolOutput(call.name, resultStr);
        this.addMessage({ role: "tool", content: truncated, tool_call_id: call.id });

        // ── Update UI with tool result ─────────────────────────────────────
        if (activeAssistantMessageId && this.options.onMessageUpdate) {
          // Update the result on the matching tool call in the master accumulator
          const tcIndex = accumulatedToolCalls.findIndex(t => t.id === call.id);
          if (tcIndex !== -1) {
            accumulatedToolCalls[tcIndex] = { ...accumulatedToolCalls[tcIndex], result: truncated, completedAt: Date.now() };
          }
          // Also update the local assistantMsg for finding reporting below
          const currentToolCalls = (assistantMsg as any).toolCalls as AccumulatedToolCall[] || [];
          const updatedLocal = currentToolCalls.map(t =>
            t.id === call.id ? { ...t, result: truncated } : t
          );
          (assistantMsg as any).toolCalls = updatedLocal;
          this.options.onMessageUpdate(activeAssistantMessageId, {
            toolCalls: [...accumulatedToolCalls]
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
            // Mark the tool call as presentable in the master accumulator
            const tcIdx = accumulatedToolCalls.findIndex(t => t.id === call.id);
            if (tcIdx !== -1) {
              accumulatedToolCalls[tcIdx] = { ...accumulatedToolCalls[tcIdx], isPresentable: true, finding: findingSummary.summary };
            }
            // Also keep local assistantMsg in sync for any downstream use
            const currentToolCalls = (assistantMsg as any).toolCalls as AccumulatedToolCall[] || [];
            const updatedLocal = currentToolCalls.map(t =>
              t.id === call.id ? { ...t, isPresentable: true, finding: findingSummary.summary } : t
            );
            (assistantMsg as any).toolCalls = updatedLocal;
            this.options.onMessageUpdate(activeAssistantMessageId, {
              toolCalls: [...accumulatedToolCalls]
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

    // ── Loop exited: determine reason ────────────────────────────────────────
    if (taskComplete) {
      // Clean exit via mark_task_complete
      const completionMsg: LLMMessage = {
        role: "assistant",
        content: taskSuccess
          ? `✅ Task complete.\n\n${taskSummary}`
          : `⚠️ Task could not be fully completed.\n\n${taskSummary}`,
      };
      if (activeAssistantMessageId && this.options.onMessageUpdate) {
        this.messages.push(completionMsg);
        this.options.onMessageUpdate(activeAssistantMessageId, {
          content: completionMsg.content,
          toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        } as Record<string, unknown>);
      } else {
        this.addMessage(completionMsg);
      }
      await cleanupState(this.agentInstanceId);
      return completionMsg;
    }

    return await this._handleMaxIterations(finalPrompt);
  }

  /**
   * Emits a progress update to the UI via onProgressUpdate.
   * Stores `lastPct` on itself so orchestration path callbacks can increment ticks.
   * Passing 100 clears the progress bar (sends undefined — the store's reset signal).
   * No-op for sub-agents or when onProgressUpdate is not wired.
   */
  private _emitProgress(pct: number, etaSeconds?: number): void {
    if (this.options.isSubAgent || !this.options.onProgressUpdate) return;
    const clamped = Math.max(0, Math.min(100, pct));
    this._lastProgressPct = clamped;
    let eta = etaSeconds;
    if (eta === undefined && clamped > 0 && clamped < 100) {
      const elapsedMs = Math.max(1, Date.now() - this.taskStartTimeMs);
      const rate = clamped / elapsedMs;
      if (rate > 0 && Number.isFinite(rate)) {
        const remainingMs = Math.max(0, (100 - clamped) / rate);
        eta = Math.round(remainingMs / 1000);
      } else {
        eta = 0;
      }
    }
    // Sending undefined for progress clears the bar (matches useAgent.ts finally-block behaviour)
    this.options.onProgressUpdate(clamped === 100 ? undefined : clamped, clamped === 100 ? undefined : eta, this.executionPlan ?? undefined);
  }

  // ── Private: Helpers ───────────────────────────────────────────────────────

  private async _handleContextLimits() {
    this._contextResyncCounter++;

    // Full resync every 10 iterations as a safety net
    if (this._contextResyncCounter % 10 === 0) {
      const contextText = JSON.stringify(this.messages);
      this._estimatedContextBytes = contextText.length;
    }

    const estimatedTokens = Math.ceil(this._estimatedContextBytes / 4);
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
      ...mcpTools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })),
      ...CLIENT_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })),
    ];
    for (const tool of all) {
      if (!toolMap.has(tool.name)) toolMap.set(tool.name, tool);
    }
    return Array.from(toolMap.values());
  }

  private _getServerInfo(): ServerInfo[] {
    return getServers()
      .filter((s) => s.connected)
      .map((s) => ({
        name: s.name,
        description: s.description.substring(0, 40),
        toolCount: s.tools.length,
        isReasoningServer:
          s.name.includes("sequential") || s.description.toLowerCase().includes("reasoning"),
      }));
  }

  private async _getDynamicRules(): Promise<string | undefined> {
    const { getComposedPrompts } = await import("./prompt-library");
    const promptsToLoad: string[] = [];
    if (this.taskCategory) promptsToLoad.push(this.taskCategory);
    return promptsToLoad.length > 0 ? getComposedPrompts(promptsToLoad, this.options.isSubAgent) : undefined;
  }

  private _handleModelRefusal(response: LLMResponse): boolean {
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
      const query = typeof userQuery?.content === "string" ? userQuery.content : "the request";
      // WHY push directly instead of addMessage():
      // This is an internal LLM steering injection, not a user-facing message.
      // addMessage() calls onMessage() which would render it as a visible chat bubble.
      const refusalCorrection: LLMMessage = {
        role: "user",
        content: `[AUTO-CORRECT] You refused to help. This is wrong — you HAVE browser tools.\n            \nFor "${query}", use: navigate({"url": "https://google.com/search?q=${encodeURIComponent(
          query
        )}"})`,
      };
      this.messages.push(refusalCorrection);
      this._estimatedContextBytes += refusalCorrection.content.length + 50;
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
    const CHECKPOINT_INTERVAL = 15;
    if (iterationCount % CHECKPOINT_INTERVAL === 0) {
      // WHY push directly instead of addMessage():
      // This is an internal LLM steering directive, not a user-facing message.
      // addMessage() calls onMessage() which would render this as a visible chat bubble.
      const checkpointMsg: LLMMessage = {
        role: "user",
        content: `[CHECKPOINT ${iterationCount}] Please call update_progress_summary now to summarize your progress so far. This will help prevent context overflow.`,
      };
      this.messages.push(checkpointMsg);
      this._estimatedContextBytes += checkpointMsg.content.length + 50;
    }
  }

  private async _handleMaxIterations(finalPrompt: string): Promise<LLMMessage> {
    // Sub-agents throw — their parent AgentRuntime or OrchestrationService handles it.
    if (this.options.isSubAgent) throw new Error("Max iterations reached");

    const stepsTaken = Math.floor(this.messages.length / 2);
    const progressContext = this.lastCheckpoint
      ? `[Checkpoint step ${this.lastCheckpoint.step}]: ${this.lastCheckpoint.summary}`
      : "No checkpoint recorded yet — task was in progress.";

    // WHY auto-continue: The infra (continueWithSubAgent) already exists.
    // Requiring a user button-click to continue was the gap — the task intent
    // has not changed, so we continue automatically with a fresh context window.
    console.log(`[AgentRuntime] Max iterations (${this.maxIterations}) reached. Auto-continuing via sub-agent.`);
    this.addMessage({
      role: "assistant",
      content: `I've used ${this.maxIterations} steps. Saving progress and continuing automatically with a fresh context...`,
    });

    return continueWithSubAgent(
      finalPrompt,
      stepsTaken,
      progressContext,
      this.options,
      this.agentInstanceId,
      (msg) => this.addMessage(msg),
      this._makeSubAgentFactory()
    );
  }

  private addMessage(msg: LLMMessage): string | void {
    this.messages.push(msg);
    // Incrementally track context size (avoid full JSON.stringify)
    const contentLen = typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content ?? '').length;
    this._estimatedContextBytes += contentLen + 50; // +50 for role, metadata overhead
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
        onMessageUpdate: undefined,
      };
      return new AgentRuntime(subAgentOptions);
    };
  }
}
