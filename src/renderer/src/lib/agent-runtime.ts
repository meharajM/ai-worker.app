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
  isWritePendingApprovalSignal,
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

function isWriteAwaitingApproval(callName: string, resultStr: string): boolean {
  return isWritePendingApprovalSignal(callName, resultStr);
}

const LOCAL_PREFERENCE_MEMORY_KEY = "ai_worker_local_preferences_v1";

function hasMemoryRecallIntent(prompt: string): boolean {
  const p = prompt.trim().toLowerCase();
  if (!p) return false;
  return /\b(remember|my name|call me|what should you call me|what's my name|what is my name|my preference|preferences|prefer|for my project|which package manager|use pnpm|use npm|use yarn|budget(?:\s+is|\s*[:=]))\b/.test(
    p
  );
}

function extractMemoryEntityLines(searchResult: unknown): string[] {
  const payload =
    searchResult &&
    typeof searchResult === "object" &&
    "result" in (searchResult as Record<string, unknown>)
      ? (searchResult as Record<string, unknown>).result
      : searchResult;

  if (!payload) return [];

  const pickEntityArray = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.entities)) return obj.entities;
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.items)) return obj.items;
    if (obj.data && typeof obj.data === "object") {
      const nested = obj.data as Record<string, unknown>;
      if (Array.isArray(nested.entities)) return nested.entities;
      if (Array.isArray(nested.results)) return nested.results;
      if (Array.isArray(nested.items)) return nested.items;
    }
    return [];
  };

  const entities = pickEntityArray(payload);
  if (!entities.length) return [];

  const lines: string[] = [];
  for (const rawEntity of entities) {
    if (!rawEntity || typeof rawEntity !== "object") continue;
    const entity = rawEntity as Record<string, unknown>;
    const nameRaw =
      (typeof entity.name === "string" && entity.name) ||
      (typeof entity.Name === "string" && entity.Name) ||
      (typeof entity.id === "string" && entity.id) ||
      "";
    const descriptionRaw =
      (typeof entity.description === "string" && entity.description) ||
      (typeof entity.Description === "string" && entity.Description) ||
      (typeof entity.summary === "string" && entity.summary) ||
      (typeof entity.observation === "string" && entity.observation) ||
      (Array.isArray(entity.observations) && typeof entity.observations[0] === "string" ? String(entity.observations[0]) : "") ||
      (typeof entity.content === "string" && entity.content) ||
      "";
    const name = nameRaw.replace(/\s+/g, " ").trim().slice(0, 80);
    const description = descriptionRaw.replace(/\s+/g, " ").trim().slice(0, 180);
    if (!name && !description) continue;
    lines.push(description ? `${name || "memory"}: ${description}` : name);
  }
  return lines;
}

function getLocalPreferenceMemoryLines(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(LOCAL_PREFERENCE_MEMORY_KEY);
    if (!raw || !raw.trim()) return [];
    const parsed = JSON.parse(raw) as {
      preferredName?: string;
      packageManager?: string;
      budget?: string;
    };
    const lines: string[] = [];
    if (typeof parsed.preferredName === "string" && parsed.preferredName.trim()) {
      lines.push(`Preferred name: ${parsed.preferredName.trim()}`);
    }
    if (typeof parsed.packageManager === "string" && parsed.packageManager.trim()) {
      lines.push(`Preferred package manager: ${parsed.packageManager.trim()}`);
    }
    if (typeof parsed.budget === "string" && parsed.budget.trim()) {
      lines.push(`Budget constraint: ${parsed.budget.trim()}`);
    }
    return lines;
  } catch {
    return [];
  }
}

function getLocalPreferenceMemory(): { preferredName?: string; packageManager?: string; budget?: string } {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(LOCAL_PREFERENCE_MEMORY_KEY);
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw) as {
      preferredName?: string;
      packageManager?: string;
      budget?: string;
    };
    return {
      preferredName: typeof parsed.preferredName === "string" ? parsed.preferredName.trim() : undefined,
      packageManager: typeof parsed.packageManager === "string" ? parsed.packageManager.trim() : undefined,
      budget: typeof parsed.budget === "string" ? parsed.budget.trim() : undefined,
    };
  } catch {
    return {};
  }
}

function buildDeterministicPreferenceRecallAnswer(prompt: string): string | null {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return null;
  const isQuestion = /\?\s*$/.test(normalized) || /^(what|which|who|how|can|should|do|does|did|will|would)\b/.test(normalized);
  if (!isQuestion) return null;
  const memory = getLocalPreferenceMemory();
  if (!memory.preferredName && !memory.packageManager && !memory.budget) return null;

  const asksName = /\b(name|call me|call you|address)\b/.test(normalized);
  const asksPackageManager = /\b(package manager|pnpm|npm|yarn|bun)\b/.test(normalized);
  const asksBudget = /\b(budget|price range|spend|limit)\b/.test(normalized);

  const parts: string[] = [];
  if (asksName && memory.preferredName) parts.push(`your preferred name is **${memory.preferredName}**`);
  if (asksPackageManager && memory.packageManager) parts.push(`your preferred package manager is **${memory.packageManager}**`);
  if (asksBudget && memory.budget) parts.push(`your budget is **${memory.budget}**`);

  if (parts.length === 0) {
    if (memory.preferredName) parts.push(`your preferred name is **${memory.preferredName}**`);
    if (memory.packageManager) parts.push(`your preferred package manager is **${memory.packageManager}**`);
    if (memory.budget) parts.push(`your budget is **${memory.budget}**`);
  }

  if (parts.length === 0) return null;
  const sentence = parts.join(" and ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function isWeakFinalNarration(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  if (!normalized) return true;
  if (/^mock issue repro response[.!]*$/.test(normalized)) return true;
  if (/^(ok|done|completed|task complete|all done|finished|working\.\.\.|analyzing\.\.\.)[.!]*$/.test(normalized)) {
    return true;
  }
  return normalized.length < 20 && !/[0-9$₹€£]/.test(normalized);
}

function stripMarkdownForSummary(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDelegateFallbackSummary(calls: AccumulatedToolCall[]): string | null {
  const delegateCalls = calls.filter(
    (c) => c.name === "delegate_sub_task" && typeof c.result === "string" && c.result.trim().length > 0
  );
  if (delegateCalls.length === 0) return null;

  const lines = delegateCalls.map((call, index) => {
    const clean = stripMarkdownForSummary(call.result || "");
    const clipped = clean.length > 220 ? `${clean.slice(0, 220)}...` : clean;
    return `${index + 1}. ${clipped || "Completed."}`;
  });

  return `Sub-task execution complete.\n\n${lines.join("\n")}`;
}

function shouldPreferDirectAnswer(prompt: string): boolean {
  const p = prompt.trim().toLowerCase();
  if (!p) return false;
  if (p.length > 220) return false;
  if (/(https?:\/\/|www\.)/.test(p)) return false;
  if (hasMemoryRecallIntent(p)) return false;

  const actionOrEnvironmentIntent =
    /\b(open|go to|navigate|search|find on|click|fill|press|upload|download|scrape|extract|compare .* on|delegate|sub-?agent|tool|run|execute|build|publish|deploy|install|test|debug|fix|edit|write|create|delete|file|folder|directory|repo|repository|codebase|workspace|terminal|command|log)\b/.test(
      p
    );
  if (actionOrEnvironmentIntent) return false;

  const contextBoundIntent =
    /\b(page|screen|document|attachment|image|screenshot|pr|pull request|diff|commit|branch|code snippet)\b/.test(
      p
    );
  if (contextBoundIntent) return false;

  // Current/live data should remain tool-grounded.
  const realtimeIntent =
    /\b(today|latest|current|now|weather|temperature|stock|price|news|score|live|exchange rate|market)\b/.test(
      p
    );
  if (realtimeIntent) return false;

  const knowledgeQuestion =
    /^(what|why|how|when|where|who|which|explain|difference between|define)\b/.test(p) ||
    p.endsWith("?");
  return knowledgeQuestion;
}

export class AgentRuntime implements IAgentClient {
  private messages: LLMMessage[] = [];
  private options: AgentRuntimeOptions;
  private maxIterations: number;
  private maxConsecutiveErrors = 5;
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
          this._persistExecutionPlanToInternalFile();
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
      const shouldDirectAnswer = shouldPreferDirectAnswer(finalPrompt);

      const decomposition = (isTrivialPrompt || shouldDirectAnswer)
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
          this._makeSubAgentFactory(),
          // onPlanUpdate: Bridge orchestration plan → session.plan → SubTaskChecklist
          (plan) => {
            this.executionPlan = plan;
            this._persistExecutionPlanToInternalFile();
            this._emitProgress(this._lastProgressPct);
          }
        );
        this._emitProgress(100);
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
          this._makeSubAgentFactory(),
          // onPlanUpdate: Bridge orchestration plan → session.plan → SubTaskChecklist
          // WHY: Without this, this.executionPlan stays null, so _emitProgress sends
          // plan=undefined to onProgressUpdate, and the checklist never renders.
          (plan) => {
            this.executionPlan = plan;
            this._persistExecutionPlanToInternalFile();
            this._emitProgress(this._lastProgressPct);
          }
        );
        this._emitProgress(100);
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

    if (!this.options.isSubAgent) {
      const deterministicRecall = buildDeterministicPreferenceRecallAnswer(finalPrompt);
      if (deterministicRecall) {
        console.log('[AgentRuntime] Using deterministic local preference recall answer.');
        const assistantMsg: LLMMessage = {
          role: "assistant",
          content: deterministicRecall,
          isFinalResult: true,
        };
        this.addMessage(assistantMsg);
        return assistantMsg;
      }
    }

    const loopResult = await this._runLoop(finalPrompt);

    return loopResult;
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
    // Tracks the single live UI bubble created for ALL tool-calling iterations.
    // Only one bubble is ever created per agent run; all tool calls accumulate into it.
    let activeAssistantMessageId: string | undefined;
    // Master list of all tool calls across every iteration — merged into the one bubble.
    const accumulatedToolCalls: AccumulatedToolCall[] = [];
    const directAnswerFirstTurn = !this.options.isSubAgent && shouldPreferDirectAnswer(finalPrompt);
    if (!this.options.isSubAgent && hasMemoryRecallIntent(finalPrompt)) {
      console.log('[AgentRuntime] Memory-recall cue detected; keeping tools enabled on first turn.');
      await this._primeMemoryContext(finalPrompt);
    }

    while (iterationCount < this.maxIterations) {
      this.totalIterations++;
      if (this.options.signal?.aborted) throw new Error("Aborted by user");

      await this._handleContextLimits();
      this.messages = pruneContext(this.messages);

      const disableToolsThisIteration = directAnswerFirstTurn && iterationCount === 0;
      const allTools = disableToolsThisIteration ? [] : this._getAvailableTools();
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
          this.options.workspacePath,
          !disableToolsThisIteration
        );


      } catch (error) {

        console.error("[AgentRuntime] LLM Error:", error);
        throw error;
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        const refusal = this._handleModelRefusal(response);
        if (refusal) continue;

        const rawAssistantContent =
          typeof response.content === "string" ? response.content : String(response.content ?? "");
        const delegateFallback = buildDelegateFallbackSummary(accumulatedToolCalls);
        const finalContent =
          delegateFallback && isWeakFinalNarration(rawAssistantContent)
            ? delegateFallback
            : rawAssistantContent;
        if (delegateFallback && finalContent === delegateFallback) {
          console.log("[AgentRuntime] Replaced weak terminal narration with delegate summary fallback.");
        }

        const assistantMsg: LLMMessage = { role: "assistant", content: finalContent };
        this._appendCheckpointReport(assistantMsg);

        if (activeAssistantMessageId && this.options.onMessageUpdate) {
          // ── Final response: update the live bubble in-place (no new bubble created) ──
          // Push to internal history without firing onMessage (which would add a new bubble).
          this.messages.push(assistantMsg);
          // NOTE: onMessageUpdate casts to Partial<Message> (chatStore) — use that shape here.
          // toolCalls here is the camelCase store shape (AccumulatedToolCall[]), not LLMMessage tool_calls.
          const finalUpdates: { content: string; isFinalResult: boolean; toolCalls?: AccumulatedToolCall[] } = {
            content: assistantMsg.content as string,
            isFinalResult: true, // Always show in prod/clean view — this is the user-facing answer
          };
          if (accumulatedToolCalls.length > 0) {
            finalUpdates.toolCalls = accumulatedToolCalls;
          }
          this.options.onMessageUpdate(activeAssistantMessageId, finalUpdates as Parameters<typeof this.options.onMessageUpdate>[1]);
        } else {
          // No live bubble yet (agent answered immediately without tools) — create one.
          // Mark it final so it renders in prod view.
          (assistantMsg as LLMMessage & { isFinalResult?: boolean }).isFinalResult = true;
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
        assistantMsg.toolCalls = iterationToolCalls;
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
          });
        }
      }

      // Keep local assistantMsg.toolCalls in sync for the tool execution block below
      assistantMsg.toolCalls = iterationToolCalls;

      const executeToolCall = async (call: (typeof response.toolCalls)[number]) => {
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
          this._persistExecutionPlanToInternalFile();
          resultStr = result;
        } else if (call.name === "scan_page_accessibility") {
          resultStr = await this.specialHandlers.handleScanPageAccessibility();
        } else if (call.name === "update_progress_summary") {
          const { result, checkpoint } = await this.specialHandlers.handleUpdateProgressSummary(call.arguments, iterationCount);
          this.lastCheckpoint = checkpoint;
          resultStr = result;
        } else if (call.name === "delegate_sub_task") {
          if (this.options.isSubAgent) {
            resultStr = "Nested delegation is disabled inside sub-agents. Complete the current sub-task directly.";
          } else {
            const { result, planUpdate } = await this.specialHandlers.handleDelegateSubTask(call.arguments, this.executionPlan);
            if (planUpdate) {
              this.executionPlan = planUpdate;
              this._persistExecutionPlanToInternalFile();
            }
            resultStr = result;
          }
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
          } catch (err: unknown) {
            resultStr = JSON.stringify({ error: (err instanceof Error ? err.message : String(err)) || "Unknown error" });
            consecutiveErrors++;
          }

          if (consecutiveErrors >= this.maxConsecutiveErrors) {
            let cleanError = resultStr;
            try {
              const parsed = JSON.parse(resultStr);
              if (parsed.error) cleanError = parsed.error;
            } catch {
              // Not JSON, use raw
            }
            
            // Strip out ASCII art boxes (often from Playwright) which look terrible on WhatsApp
            cleanError = cleanError.replace(/[╔║╚═╗╝]/g, '').trim();

            const bailoutMsg: LLMMessage = {
              role: "assistant",
              content: `Bailing out after ${consecutiveErrors} consecutive errors. Last error: ${cleanError}`,
            };
            this.addMessage(bailoutMsg);
            return bailoutMsg;
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
          const currentToolCalls = assistantMsg.toolCalls || [];
          const updatedLocal = currentToolCalls.map(t =>
            t.id === call.id ? { ...t, result: truncated } : t
          );
          assistantMsg.toolCalls = updatedLocal;
          this.options.onMessageUpdate(activeAssistantMessageId, {
            toolCalls: [...accumulatedToolCalls]
          });
        }

        // Terminal guard for staged filesystem writes. Once a write is staged or
        // blocked by workspace selection, stop issuing new write attempts and
        // explicitly hand control back to the user.
        if (isWriteAwaitingApproval(call.name, truncated)) {
          const pauseMsg: LLMMessage = {
            role: "assistant",
            content:
              "## File Write Paused\n\n" +
              "The write operation is staged/pending approval.\n" +
              "Please approve the staged change or select a workspace folder, then ask me to continue.",
          };
          this.addMessage(pauseMsg);
          return pauseMsg;
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
            const currentToolCalls = assistantMsg.toolCalls || [];
            const updatedLocal = currentToolCalls.map(t =>
              t.id === call.id ? { ...t, isPresentable: true, finding: findingSummary.summary } : t
            );
            assistantMsg.toolCalls = updatedLocal;
            this.options.onMessageUpdate(activeAssistantMessageId, {
              toolCalls: [...accumulatedToolCalls]
            });
          }
        }
        return undefined;
      };

      const parallelDelegateBatch =
        response.toolCalls.length > 1 &&
        response.toolCalls.every((call) => call.name === "delegate_sub_task");

      if (parallelDelegateBatch) {
        // Keep same-turn delegate_sub_task calls parallel for multi-site workflows.
        // This restores expected behavior while preserving sequential execution for
        // all other tool categories.
        const results = await Promise.all(response.toolCalls.map((call) => executeToolCall(call)));
        const bailout = results.find((r) => r && r.role === "assistant");
        if (bailout) return bailout as LLMMessage;
      } else {
        // Execute non-delegation calls sequentially in emission order.
        for (const call of response.toolCalls) {
          const maybeBailout = await executeToolCall(call);
          if (maybeBailout && maybeBailout.role === "assistant") {
            return maybeBailout as LLMMessage;
          }
        }
      }

      iterationCount++;
      await this._handleCheckpoints(iterationCount);
    }

    return this._handleMaxIterations(finalPrompt);
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

  /**
   * Persists the current execution plan to `.ai-worker/tasks.json` via the
   * internal IPC writer (bypasses staged fs_write approvals).
   */
  private _persistExecutionPlanToInternalFile(): void {
    if (this.options.isSubAgent) return;
    if (!this.options.workspacePath || !this.executionPlan) return;

    import("./task-manager")
      .then((m) => m.syncPlanToFile(this.options.workspacePath, this.executionPlan))
      .catch((error) => {
        console.warn("[AgentRuntime] Failed to persist execution plan:", error);
      });
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

  private async _primeMemoryContext(prompt: string): Promise<void> {
    const queries = [
      prompt,
      "user preference name package manager budget",
    ];
    const deduped = new Set<string>();
    const lines: string[] = [];

    for (const query of queries) {
      const raw = await executeWithSelfHealing(
        "memory_search",
        { query, limit: 8 },
        undefined,
        undefined,
        this.options.signal,
        this.options.isHeadless
      );
      if (raw.error) continue;
      const found = extractMemoryEntityLines(raw);
      if (found.length === 0) {
        const rawShape =
          raw && typeof raw === "object" && "result" in (raw as Record<string, unknown>)
            ? (raw as Record<string, unknown>).result
            : raw;
        const rawSnippet = JSON.stringify(rawShape ?? null).slice(0, 300);
        console.log(`[AgentRuntime] Memory primer query "${query}" returned no parseable entities. Raw: ${rawSnippet}`);
      }
      for (const line of found) {
        if (deduped.has(line)) continue;
        deduped.add(line);
        lines.push(line);
        if (lines.length >= 6) break;
      }
      if (lines.length >= 6) break;
    }

    if (lines.length < 6) {
      const localLines = getLocalPreferenceMemoryLines();
      for (const line of localLines) {
        if (deduped.has(line)) continue;
        deduped.add(line);
        lines.push(line);
        if (lines.length >= 6) break;
      }
      if (localLines.length > 0) {
        console.log(`[AgentRuntime] Added ${localLines.length} local preference hints to memory primer.`);
      }
    }

    if (lines.length === 0) {
      console.log("[AgentRuntime] Memory primer found no matching entities.");
      return;
    }

    const primer = [
      "[Memory Primer]",
      "Relevant stored preferences/facts for this prompt:",
      ...lines.map((line) => `- ${line}`),
      "Use these if they answer the user question. If user provides new contradictory info, latest user input wins.",
    ].join("\n");

    this.messages.push({ role: "system", content: primer });
    this._estimatedContextBytes += primer.length + 50;
    console.log(`[AgentRuntime] Memory primer injected with ${lines.length} entries.`);
  }

  private _getAvailableTools(): LLMTool[] {
    const mcpTools = getAllTools();
    const toolMap = new Map<string, LLMTool>();
    const clientTools = this.options.isSubAgent
      ? CLIENT_TOOLS.filter((tool) => tool.name !== "delegate_sub_task")
      : CLIENT_TOOLS;
    const all = [
      ...mcpTools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })),
      ...clientTools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })),
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
      this.addMessage({
        role: "user",
        content: `[AUTO-CORRECT] You refused to help. This is wrong — you HAVE browser tools.\n            \nFor "${query}", use: navigate({"url": "https://google.com/search?q=${encodeURIComponent(
          query
        )}"})`,
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
    const CHECKPOINT_INTERVAL = 15;
    if (iterationCount % CHECKPOINT_INTERVAL === 0) {
      this.addMessage({
        role: "user",
        content: `[CHECKPOINT ${iterationCount}] Please call update_progress_summary now to summarize your progress so far. This will help prevent context overflow.`,
      });
    }
  }

  private _handleMaxIterations(finalPrompt: string): LLMMessage {
    if (this.options.isSubAgent) throw new Error("Max iterations reached");
    const handoffMsg: LLMMessage = {
      role: "assistant",
      content: `I've reached the maximum number of steps (${this.maxIterations}) for this context. To ensure accuracy and prevent context issues, I've saved a checkpoint of my progress. Should I continue with a fresh context or stop here?`,
      actions: [
        {
          type: "continue",
          label: "▶️ Continue Task",
          payload: { goal: finalPrompt },
        },
        {
          type: "cancel",
          label: "⏹️ Stop Here",
          payload: {},
        },
      ],
    };
    this.addMessage(handoffMsg);
    return handoffMsg;
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
