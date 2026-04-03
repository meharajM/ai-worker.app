/**
 * agent/types.ts — Shared type definitions for the agent subsystem.
 *
 * Architecture: This file is the single source of truth for types used across
 *   AgentRuntime, all extracted services (AgentStateService, ToolExecutionService,
 *   OrchestrationService), and the useAgent hook.
 *
 *   Import from here, NOT from agent-runtime.ts, to avoid circular dependencies
 *   when services need to reference each other's types.
 *
 * Phase 3 note: These types are transport-agnostic. They can be serialized to JSON
 *   and sent over WebSocket/HTTP without modification.
 */

import { type LLMMessage } from "../types";

// ── Callback Types ─────────────────────────────────────────────────────────────

/**
 * Called by AgentRuntime for every new message (user, assistant, tool result).
 * The return value is the new message's ID in the UI store (used for later updates).
 *
 * WHY return string | void: The main agent's callback returns an ID so the runtime
 * can call `onMessageUpdate` later to update the same message in-place (e.g., for
 * live parallel execution status). Sub-agents don't need this — they return void.
 */
export type AgentStatusCallback = (message: LLMMessage) => string | void;

// ── Configuration ──────────────────────────────────────────────────────────────

/**
 * Configuration passed to AgentRuntime (and in Phase 3, to RemoteAgentClient).
 *
 * This is the primary contract between the UI (useAgent hook) and the agent logic.
 * All fields should remain stable across Phase 1, 2, and 3.
 *
 * Implements: Used by AgentRuntime (local). In Phase 3, RemoteAgentClient will
 *   accept a subset of these (callbacks stay local, settings go to backend).
 */
export interface AgentRuntimeOptions {
    /** The active chat session ID. Used to scope memory entities to this session. */
    activeSessionId?: string;

    /**
     * Optional workspace folder path for filesystem operations.
     * Injected into `fs_*` tool calls as a security boundary.
     */
    workspacePath?: string;

    /**
     * LLM provider configuration (API keys, model names, base URLs).
     * Typed as `any` to avoid coupling to the settings store shape.
     * In Phase 3, this moves to the backend — the client sends only a session token.
     */
    settings: any;

    /**
     * Called for every new message the agent produces.
     * The UI uses this to write messages to the chat store in real-time.
     * @returns The new message's ID (for later updates via onMessageUpdate), or void.
     */
    onMessage?: AgentStatusCallback;

    /**
     * AbortSignal from the chat store's AbortController.
     * When the user clicks "Stop", this signal is aborted and the agent exits cleanly.
     */
    signal?: AbortSignal;

    /**
     * If true, this agent is a sub-agent spawned by a parent agent.
     * Sub-agents: start with empty context, get 15 iterations (not 50),
     * skip confirmation, skip task decomposition.
     */
    isSubAgent?: boolean;

    /**
     * Force a specific task category (e.g., 'BROWSER', 'RESEARCH').
     * Used by parent agents to pass their detected category to sub-agents,
     * ensuring sub-agents use the same safety protocols.
     */
    taskCategory?: string;

    /**
     * Called to update an existing message in-place (instead of adding a new one).
     * Used by parallel orchestration to update the live status card as sub-agents complete.
     * @param id - The message ID returned by `onMessage`.
     * @param updates - Partial message fields to merge into the existing message.
     */
    onMessageUpdate?: (id: string, updates: Partial<LLMMessage>) => void;

    /**
     * Called to update the global active session progress.
     */
    onProgressUpdate?: (progress?: number, eta?: number, plan?: ExecutionPlan) => void;

    /**
     * Dedicated browser tab ID for this agent instance.
     * Injected into all browser tool calls to ensure tab isolation between
     * parallel sub-agents (each gets its own tab, no cross-contamination).
     */
    tabId?: number;

    /**
     * The parent agent's instance ID. Used by sub-agents to load parent context
     * from memory (checkpoint summaries, recent observations).
     */
    parentAgentId?: string;

    /**
     * Force a specific agent instance ID instead of generating a random UUID.
     * Used when pre-seeding memory before spawning the agent.
     */
    agentInstanceId?: string;

    /**
     * If true, execute Playwright browser tools in a headless background context
     * instead of the visible UI context.
     */
    isHeadless?: boolean;
}

// ── Internal State Types ───────────────────────────────────────────────────────

/**
 * A progress checkpoint saved to memory at regular intervals (every 15 iterations).
 * Allows the agent to resume from a known state after a handoff or context limit.
 */
export interface AgentCheckpoint {
    /** The iteration number when this checkpoint was saved. */
    step: number;
    /** A brief LLM-generated summary of progress at this checkpoint. */
    summary: string;
    /** Unix timestamp (ms) when the checkpoint was saved. */
    timestamp: number;
}

/**
 * A structured execution plan created by the `create_execution_plan` tool.
 * Tracks which steps have been completed and their results.
 */
export interface ExecutionPlan {
    /** The high-level goal of the plan. */
    goal: string;
    /** Ordered list of steps to execute. */
    steps: Array<{
        id: number;
        description: string;
        /** 'pending' | 'completed' | 'failed' */
        status: 'pending' | 'active' | 'completed' | 'failed';
        /** Brief result summary (first 200 chars of the step's output). */
        result?: string;
        /** Which sub-agent is assigned to this step (for parallel plans). */
        assigned_agent?: string;
    }>;
}

/**
 * Configuration for spawning a sub-agent.
 * Passed to OrchestrationService to create isolated child agents.
 */
export interface SubAgentConfig {
    /** Unique ID pre-generated before spawning (for memory pre-seeding). */
    agentInstanceId: string;
    /** The parent agent's ID (for context inheritance). */
    parentAgentId: string;
    /** The specific instruction for this sub-agent. */
    instruction: string;
    /** Optional context string (from parent's checkpoint or previous steps). */
    context?: string;
    /** Dedicated browser tab ID for isolation. */
    tabId?: number;
}

export interface IAgentClient {
    getHistory?(): LLMMessage[];
    run(task: string): Promise<string>;
}
