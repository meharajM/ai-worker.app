/**
 * agent/AgentStateService.ts — Manages agent lifecycle state in long-term memory.
 *
 * Responsibilities:
 *   1. Initialize a new agent execution state entity in memory (or restore an existing one)
 *   2. Load parent agent context for sub-agents (checkpoint summaries + observations)
 *   3. Detect and resume from pending handoff entities (created when context limit is hit)
 *   4. Clean up state entities in production after task completion
 *
 * Architecture: This service is STATELESS — it takes all inputs as parameters and
 *   returns results. It does not hold references to AgentRuntime or any UI layer.
 *   This makes it easy to test in isolation and reuse across agent implementations.
 *
 * Phase 3 note: In Phase 3, these memory operations will be performed by the backend
 *   server. This service will be replaced by API calls to the backend's state endpoint.
 *
 * Consumed by: AgentRuntime (agent-runtime.ts)
 */

import { executeToolCall } from "../mcp";
import { type LLMMessage } from "../types";
import { type AgentCheckpoint } from "./types";

const MEMORY_CREATE_COOLDOWN_MS = 5 * 60 * 1000;
const memoryCreateDisabledUntilByContext = new Map<string, number>();

function getRemainingCooldownMs(context: string): number {
    const until = memoryCreateDisabledUntilByContext.get(context) ?? 0;
    return Math.max(0, until - Date.now());
}

function canCreateStateEntity(context: string): boolean {
    return getRemainingCooldownMs(context) === 0;
}

function clearMemoryCreateFailure(context: string): void {
    memoryCreateDisabledUntilByContext.delete(context);
}

function markMemoryCreateFailure(context: string, err: unknown): void {
    memoryCreateDisabledUntilByContext.set(context, Date.now() + MEMORY_CREATE_COOLDOWN_MS);
    console.warn(
        `[AgentStateService] Disabled memory_create_entity for ${MEMORY_CREATE_COOLDOWN_MS / 1000}s in ${context} after failure: ${err}`
    );
}

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Result of `initializeSessionState()`.
 * Contains the restored checkpoint (if any) so the caller can resume from it.
 */
export interface InitStateResult {
    /** Restored checkpoint from a previous run, or null if this is a fresh start. */
    restoredCheckpoint: AgentCheckpoint | null;
}

/**
 * Result of `detectHandoff()`.
 * Contains the handoff context to inject into the agent's message history.
 */
export interface HandoffResult {
    /** True if a pending handoff was found and consumed. */
    found: boolean;
    /** The checkpoint from the handoff entity (for resuming progress). */
    checkpoint: AgentCheckpoint | null;
    /** The original goal from the handoff entity. */
    originalGoal: string | null;
}

// ── Service ────────────────────────────────────────────────────────────────────

/**
 * Initializes or restores agent execution state in long-term memory.
 *
 * Called once at the start of each `chat()` invocation. Idempotent — safe to
 * call multiple times (will restore existing state instead of overwriting).
 *
 * @param agentInstanceId - Unique ID for this agent instance.
 * @param sessionId - The active chat session ID (for scoping memory entities).
 * @param parentAgentId - If set, this is a sub-agent — load parent context.
 * @returns The restored checkpoint, or null if this is a fresh start.
 */
export async function initializeSessionState(
    agentInstanceId: string,
    sessionId: string | undefined,
    parentAgentId: string | undefined
): Promise<InitStateResult> {
    const entityName = `AgentState_${agentInstanceId}`;
    let restoredCheckpoint: AgentCheckpoint | null = null;

    try {
        // Try to read existing state (idempotent — won't fail if missing)
        const result = await executeToolCall("memory_read_entity", { name: entityName });

        if (result && result.result) {
            const entity = result.result as any;
            if (entity.Metadata?.lastCheckpoint) {
                restoredCheckpoint = entity.Metadata.lastCheckpoint as AgentCheckpoint;
                console.log(
                    `[AgentStateService] Restored checkpoint from memory: Step ${restoredCheckpoint?.step}`
                );
            }
        } else {
            // Create new state entity
            const createContext = "initializeSessionState";
            if (canCreateStateEntity(createContext)) {
                try {
                    const createResult = await executeToolCall("memory_create_entity", {
                        name: entityName,
                        type: "agent_execution_state",
                        description: `Agent initialized at ${new Date().toISOString()}`,
                        metadata: {
                            agentInstanceId,
                            sessionId: sessionId || "unknown",
                            status: "active",
                            iterationCount: 0,
                            isInternal: true,
                            parentAgentId,
                        },
                    });
                    if (createResult?.error) {
                        throw new Error(createResult.error);
                    }
                    clearMemoryCreateFailure(createContext);
                    console.log(`[AgentStateService] Created new ExecutionState: ${entityName}`);
                } catch (createErr) {
                    markMemoryCreateFailure(createContext, createErr);
                }
            } else {
                const remainingMs = getRemainingCooldownMs(createContext);
                console.warn(
                    `[AgentStateService] Skipping memory_create_entity in ${createContext} (${Math.ceil(remainingMs / 1000)}s cooldown remaining).`
                );
            }
        }
    } catch (err) {
        console.warn(`[AgentStateService] Failed to initialize session state: ${err}`);
    }

    return { restoredCheckpoint };
}

/**
 * Loads parent agent context for a sub-agent.
 *
 * Sub-agents start with empty context (for token efficiency), but they need to
 * understand the broader goal. This function loads the parent's last checkpoint
 * summary and recent observations from memory and returns them as a system message
 * to inject into the sub-agent's history.
 *
 * @param parentAgentId - The parent agent's instance ID.
 * @returns A system message to inject, or null if no parent context was found.
 */
export async function loadParentContext(
    parentAgentId: string
): Promise<LLMMessage | null> {
    try {
        const parentState = await executeToolCall("memory_read_entity", {
            name: `AgentState_${parentAgentId}`,
        });

        if (!parentState.result) return null;

        const parent = parentState.result as any;
        let contextContent = "";

        // Load checkpoint summary
        if (parent.Metadata?.lastCheckpoint) {
            const checkpoint = parent.Metadata.lastCheckpoint;
            contextContent += `[Parent Context - Step ${checkpoint.step}]\n${checkpoint.summary}\n\n`;
        }

        // Load last 3 observations
        if (parent.observations && Array.isArray(parent.observations)) {
            const lastObservations = parent.observations.slice(-3);
            if (lastObservations.length > 0) {
                contextContent += `Recent Context:\n`;
                lastObservations.forEach((obs: string, idx: number) => {
                    contextContent += `${idx + 1}. ${obs}\n`;
                });
            }
        }

        if (!contextContent) return null;

        console.log(`[AgentStateService] Loaded parent context from ${parentAgentId}`);
        return {
            role: "system",
            content: `${contextContent}\nYou are a sub-agent. Use this parent context to understand the broader goal.`,
        };
    } catch (err) {
        console.warn(`[AgentStateService] Failed to load parent context: ${err}`);
        return null;
    }
}

/**
 * Detects and consumes a pending handoff entity for the given session.
 *
 * Handoffs are created when an agent hits its context limit mid-task. The next
 * agent invocation picks up the handoff and resumes from the saved checkpoint.
 *
 * @param sessionId - The active chat session ID to search for handoffs.
 * @returns HandoffResult with found=true if a handoff was consumed.
 */
export async function detectHandoff(sessionId: string | undefined): Promise<HandoffResult> {
    if (!sessionId) return { found: false, checkpoint: null, originalGoal: null };

    try {
        const handoffCheck = await executeToolCall("memory_search", {
            query: `handoff ${sessionId}`,
        });

        if (!handoffCheck.result || typeof handoffCheck.result !== "object") {
            return { found: false, checkpoint: null, originalGoal: null };
        }

        const resultData = handoffCheck.result as { entities?: any[] };
        if (!resultData.entities || !Array.isArray(resultData.entities)) {
            return { found: false, checkpoint: null, originalGoal: null };
        }

        const pendingHandoffs = resultData.entities.filter(
            (e: any) => e.Metadata?.sessionId === sessionId
        );

        if (pendingHandoffs.length === 0) {
            return { found: false, checkpoint: null, originalGoal: null };
        }

        const handoff = pendingHandoffs[0];
        console.log(`[AgentStateService] Resuming from handoff: ${handoff.name}`);

        // Delete the handoff entity (it's been consumed)
        try {
            await executeToolCall("memory_delete_entity", { name: handoff.name });
            console.log(`[AgentStateService] Deleted consumed handoff: ${handoff.name}`);
        } catch (e) {
            console.warn(`[AgentStateService] Failed to delete handoff: ${e}`);
        }

        return {
            found: true,
            checkpoint: handoff.Metadata?.lastCheckpoint || null,
            originalGoal: handoff.Metadata?.originalGoal || null,
        };
    } catch (err) {
        console.warn(`[AgentStateService] Failed to check for handoffs: ${err}`);
        return { found: false, checkpoint: null, originalGoal: null };
    }
}

/**
 * Creates a handoff entity in memory when the agent is approaching its context limit.
 *
 * The next agent invocation will detect this entity via `detectHandoff()` and resume.
 *
 * @param agentInstanceId - The current agent's instance ID.
 * @param sessionId - The active chat session ID.
 * @param originalGoal - The original user goal (for the next agent to continue).
 * @param checkpoint - The last recorded progress checkpoint.
 * @param estimatedTokens - Current estimated token count (for logging).
 */
export async function createHandoff(
    agentInstanceId: string,
    sessionId: string | undefined,
    originalGoal: string,
    checkpoint: AgentCheckpoint | null,
    estimatedTokens: number
): Promise<void> {
    const handoffId = `Handoff_${sessionId}_${Date.now()}`;

    try {
        const createContext = "createHandoff";
        const createResult = await executeToolCall("memory_create_entity", {
            name: handoffId,
            type: "agent_handoff",
            description: [
                `Agent ${agentInstanceId} approaching context limit (${estimatedTokens} tokens)`,
                `Handing off at checkpoint: ${checkpoint?.summary || "No checkpoint"}`,
                `Original goal: ${originalGoal.substring(0, 200)}`,
            ].join("\n"),
            metadata: {
                fromAgentId: agentInstanceId,
                sessionId,
                reason: "context_limit",
                originalGoal,
                lastCheckpoint: checkpoint,
                timestamp: Date.now(),
                estimatedTokens,
                isInternal: true,
            },
        });
        if (createResult?.error) {
            throw new Error(createResult.error);
        }
        clearMemoryCreateFailure(createContext);
        console.log(`[AgentStateService] Created handoff entity: ${handoffId}`);
    } catch (err) {
        markMemoryCreateFailure("createHandoff", err);
    }
}

/**
 * Cleans up the agent state entity in production after task completion.
 *
 * WHY: In development, we keep state entities for debugging. In production,
 * we delete them to avoid accumulating stale entities in the memory store.
 *
 * @param agentInstanceId - The agent instance ID whose state to delete.
 */
export async function cleanupState(agentInstanceId: string): Promise<void> {
    if (process.env.NODE_ENV === "development") return;

    try {
        const entityName = `AgentState_${agentInstanceId}`;
        await executeToolCall("memory_delete_entity", { name: entityName });
        console.log(`[AgentStateService] Production cleanup: Deleted ${entityName}`);
    } catch (e) {
        console.warn(`[AgentStateService] Production cleanup failed: ${e}`);
    }
}

/**
 * Pre-seeds a memory entity for a sub-agent before it is spawned.
 *
 * WHY pre-seed: The sub-agent's `initializeSessionState()` call will find this
 * entity and restore context from it. Without pre-seeding, the sub-agent starts
 * completely blind to its role in the parent's plan.
 *
 * @param subAgentId - The pre-generated ID for the sub-agent.
 * @param parentAgentId - The parent agent's instance ID.
 * @param sessionId - The active chat session ID.
 * @param description - A human-readable description of this sub-agent's role.
 * @param extraMetadata - Additional metadata to store (e.g., stepId, context).
 */
export async function preSeedSubAgentMemory(
    subAgentId: string,
    parentAgentId: string,
    sessionId: string | undefined,
    description: string,
    extraMetadata: Record<string, unknown> = {}
): Promise<void> {
    try {
        const createContext = "preSeedSubAgentMemory";

        const createResult = await executeToolCall("memory_create_entity", {
            name: `AgentState_${subAgentId}`,
            type: "agent_execution_state",
            description,
            metadata: {
                agentInstanceId: subAgentId,
                sessionId: sessionId || "unknown",
                parentAgentId,
                status: "active",
                iterationCount: 0,
                isInternal: true,
                ...extraMetadata,
            },
        });
        if (createResult?.error) {
            throw new Error(createResult.error);
        }
        clearMemoryCreateFailure(createContext);
        console.log(`[AgentStateService] Pre-seeded memory for sub-agent ${subAgentId}`);
    } catch (err) {
        markMemoryCreateFailure("preSeedSubAgentMemory", err);
    }
}
