/**
 * agent/index.ts — Public API for the agent subsystem.
 *
 * Import from here to get the interface and types without coupling to
 * the specific implementation (AgentRuntime).
 *
 * @example
 * import type { IAgentClient } from '../lib/agent';
 * import type { AgentRuntimeOptions } from '../lib/agent';
 */

export type { IAgentClient } from "./IAgentClient";
export type {
    AgentRuntimeOptions,
    AgentStatusCallback,
    AgentCheckpoint,
    ExecutionPlan,
    SubAgentConfig,
} from "./types";
