---
trigger: model_decision
description: Load when working on the AI agent subsystem — AgentRuntime,IAgentClient,AgentStateService,ToolExecutionService,OrchestrationService,MemoryReflector, or lib/agent/. Covers the interface seam, service decomposition, and circular dependency strategies.
---

# AI Agent Architecture Rules

## The Interface Seam — `IAgentClient`

The most important architectural rule in the agent subsystem: **the UI hook must only hold a reference typed as `IAgentClient`**, never as `AgentRuntime` or any concrete class.

```ts
// lib/agent/IAgentClient.ts — the contract
export interface IAgentClient {
  chat(content: string, attachments?: Attachment[]): Promise<LLMMessage>;
  getHistory(): LLMMessage[];
  abort(): void;
}
```

```ts
// hooks/useAgent.ts — references only the interface
import type { IAgentClient } from '../lib/agent/IAgentClient';

let agent: IAgentClient | null = null;

// Phase 2 (local):
const { AgentRuntime } = await import('../lib/agent-runtime');
agent = new AgentRuntime(options, history);

// Phase 3 (remote) — only this line changes:
// agent = new RemoteAgentClient({ serverUrl: '...', ...options });
```

**Why this matters:** When the backend server is introduced, swapping implementations requires changing **one line** in `useAgent.ts`. Everything else in the app is unaffected.

## Agent Options Must Be Plain and Serializable

The `AgentRuntimeOptions` object passed to any agent implementation must contain only:
- Primitive values: `string`, `number`, `boolean`
- Plain callbacks: `(msg: LLMMessage) => void`
- `AbortSignal`

```ts
// GOOD — serializable, transport-agnostic, testable
const options: AgentRuntimeOptions = {
  activeSessionId: 'session_123',
  settings: { preferredProvider: 'gemini', geminiModel: 'gemini-pro' },
  signal: abortController.signal,
  onMessage: (msg) => store.addMessage(msg),
};

// BAD — stores Zustand store reference; breaks future remote transport
const options = {
  store: useChatStore, // ← non-serializable, couples to the store shape
  chatState: chatState, // ← will be stale by the time the agent reads it
};
```

## The Facade Pattern — `AgentRuntime`

`AgentRuntime` is a **facade** — it is the only public entry point for running an agent, and it delegates to focused service modules:

```
useAgent.ts
    └── AgentRuntime (facade — owns message loop, wires services)
              ├── AgentStateService   (memory: init, checkpoint, handoff, cleanup)
              ├── ToolExecutionService (dispatch: retries, loop detection, formatting)
              └── OrchestrationService (sub-agents: parallel & sequential)
```

`AgentRuntime` may hold instance state (`messages[]`, iteration count, last checkpoint). The service modules it calls **must be stateless functions** — they take all inputs as parameters and return outputs. This makes each service unit-testable in isolation without instantiating a full runtime.

## Service Module Rules

```ts
// GOOD — stateless function in AgentStateService.ts
// Takes everything it needs as parameters, returns a clean result
export async function initializeSessionState(
  agentInstanceId: string,
  sessionId: string | undefined,
  parentAgentId: string | undefined
): Promise<InitStateResult> {
  // ...
}

// BAD — method that reads from `this`, creates hidden coupling
class AgentStateService {
  private runtime: AgentRuntime; // ← now you can't test without the full runtime
  async initializeSessionState() {
    const id = this.runtime.agentInstanceId; // ← hidden dependency
  }
}
```

**Accepted exceptions to stateless:** Singletons that must coordinate global resources across invocations (e.g., `MemoryReflector`, `LaneManager`). These use the `getInstance()` pattern with a private constructor.

## Types File — Single Source of Truth

All types shared across agent services must live in `lib/agent/types.ts`. Any type defined in `agent-runtime.ts` and re-imported by a service creates coupling. Services must import from `types.ts`, not from each other.

```ts
// GOOD — services import shared types from the types file
import type { AgentRuntimeOptions, AgentCheckpoint } from './types';

// BAD — circular: OrchestrationService imports a type from agent-runtime
import type { AgentRuntimeOptions } from '../agent-runtime'; // creates circular dep
```

## Circular Dependency Strategies

Circular imports (`A → B → A`) cause subtle runtime issues (undefined values, load-order bugs). Use these strategies to break them:

### 1. Factory Injection
If `AgentRuntime` needs to call `OrchestrationService`, and `OrchestrationService` needs to spawn new `AgentRuntime` instances, pass a `spawnSubAgent` **factory function** as a parameter instead of importing `AgentRuntime` inside `OrchestrationService`.

```ts
// OrchestrationService.ts — receives the factory, doesn't import AgentRuntime
export type SubAgentFactory = (overrides: Partial<AgentRuntimeOptions>) => IAgentClient;

export async function executeParallelSubAgents(
  // ...
  spawnSubAgent: SubAgentFactory  // ← injected by AgentRuntime at call time
): Promise<LLMMessage> { ... }
```

### 2. Dynamic Import
When a module would form a circular import at the top level, use a dynamic `import()` inside the function body. The import resolves at runtime, after all modules have finished loading.

```ts
// MemoryReflector.ts needs AgentRuntime, but AgentRuntime uses MemoryReflector
async analyze(history: LLMMessage[], settings: any) {
  // Dynamic import breaks the load-time circular dependency
  const { AgentRuntime } = await import('./agent-runtime');
  const agent: IAgentClient = new AgentRuntime({ ... });
}
```

### 3. Shared Types File
When two modules both need a type but that type causes a circular import, move the type to `lib/agent/types.ts`. Neither module exports logic from there — it's data only.

## MemoryReflector — Background Singleton

`MemoryReflector` is a fire-and-forget background service. Rules:
- It must never block the main agent's response.
- Start it concurrently with (not after) the main agent call.
- It must guard against concurrent runs: if an analysis is already in progress, skip the new request.
- It uses a sub-agent internally: `isSubAgent: true`, `requireConfirmation: false`.
- Log but never throw on failure — it is non-critical.

```ts
// In useAgent.ts — fire and forget, don't await
import('../lib/memory-reflector').then(({ MemoryReflector }) => {
  MemoryReflector.getInstance().analyze(currentHistory, settings);
});
```