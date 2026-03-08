/**
 * agent/IAgentClient.ts — The abstraction interface for running an AI agent.
 *
 * Architecture: This is the KEY SEAM between the UI and the agent implementation.
 *   - Today: `AgentRuntime` implements this interface (local, in-process).
 *   - Phase 3: `RemoteAgentClient` will implement this interface (over WebSocket/HTTP).
 *
 *   The `useAgent` hook types its agent reference as `IAgentClient`, so swapping
 *   implementations in Phase 3 requires changing ONE LINE in useAgent.ts.
 *
 * Usage:
 *   import type { IAgentClient } from '../lib/agent/IAgentClient';
 *
 *   // In useAgent.ts (Phase 2 — local):
 *   const agent: IAgentClient = new AgentRuntime(options, history);
 *
 *   // In useAgent.ts (Phase 3 — remote):
 *   const agent: IAgentClient = new RemoteAgentClient(options);
 */

import { type LLMMessage } from "../types";

/**
 * The contract that any agent implementation must fulfill.
 *
 * Implementations:
 *   - `AgentRuntime` (src/renderer/src/lib/agent-runtime.ts) — local, in-process
 *   - `RemoteAgentClient` (Phase 3, TBD) — calls a backend server over WebSocket/SSE
 *
 * @example
 * // Type-safe usage in useAgent.ts:
 * let agentRef: IAgentClient | null = null;
 *
 * // Phase 2 (local):
 * agentRef = new AgentRuntime(options, history);
 *
 * // Phase 3 (remote) — same interface, different implementation:
 * agentRef = new RemoteAgentClient({ serverUrl: 'wss://api.example.com', ...options });
 *
 * // Both work identically from the hook's perspective:
 * const result = await agentRef.chat("Search for laptops under $500");
 */
export interface IAgentClient {
    /**
     * Run the agent with the given user message and optional file attachments.
     *
     * The agent will:
     * 1. Decompose the task (if complex enough for sub-agent orchestration)
     * 2. Execute an LLM + tool call loop until done or max iterations reached
     * 3. Call `onMessage` for every message produced during execution
     *
     * @param content - The user's text message.
     * @param attachments - Optional file attachments. Each has `name`, `path`, `type`.
     *   Electron exposes the local file path; the agent injects it as a system note.
     * @returns The final assistant message when the agent finishes.
     * @throws If the agent is aborted (`signal.aborted`) or hits an unrecoverable error.
     *
     * @example
     * const result = await agent.chat("Find the best laptop under $500 on Amazon");
     * console.log(result.content); // "I found 3 options: ..."
     */
    chat(
        content: string,
        attachments?: { name: string; path: string; type: string }[]
    ): Promise<LLMMessage>;

    /**
     * Returns the full message history accumulated during this agent's lifetime.
     *
     * WHY this exists: The `useAgent` hook may need to pass history to a new agent
     * instance (e.g., after a handoff). In Phase 3, this would be fetched from the
     * backend session store instead.
     *
     * @returns Array of all messages (user, assistant, tool results, system).
     *
     * @example
     * const history = agent.getHistory();
     * // Pass to a new agent for continuation:
     * const nextAgent = new AgentRuntime(options, history);
     */
    getHistory(): LLMMessage[];

    /**
     * Aborts the currently running agent loop.
     *
     * In the local implementation (`AgentRuntime`), this is handled by the
     * `AbortSignal` passed in `options.signal`. This method provides a
     * programmatic way to abort without needing direct access to the controller.
     *
     * In Phase 3 (`RemoteAgentClient`), this sends an abort message to the backend.
     *
     * @example
     * const agent = new AgentRuntime(options, history);
     * agent.chat("Long running task..."); // Don't await
     * // Later:
     * agent.abort(); // Stops the agent
     */
    abort(): void;
}
