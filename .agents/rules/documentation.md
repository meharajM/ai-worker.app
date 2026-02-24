---
trigger: model_decision
description: Load when writing JSDoc comments, file-level module documentation, or creating new modules that need usage documentation. Covers what to document, how to write comments, and the WHY-not-WHAT principle.
---

# Documentation Standards

## The Core Principle — WHY, Not WHAT

Code already shows **what** it does. Comments exist to explain **why** a decision was made, what constraints exist, what trade-offs were accepted, or what the non-obvious consequences of a change are.

```ts
// ❌ BAD — restates the code
// Get the state
const state = useChatStore.getState();

// ❌ BAD — describes mechanism, not intent
// Call ipcRenderer.invoke with 'memory:get-stats'
const stats = await window.electron.memory.getStats();

// ✅ GOOD — explains the non-obvious rationale
// We use getState() here instead of the reactive hook because this function
// runs inside a useCallback closure. The reactive hook would capture a stale
// snapshot of the store at render time; getState() always reads the live value.
const state = useChatStore.getState();
```

## File-Level JSDoc — Required for All Service Files

Every file in `src/main/services/`, `src/renderer/src/lib/agent/`, and `src/renderer/src/lib/` must start with a JSDoc block containing:

1. **The module's name and purpose** (one sentence).
2. **Responsibilities** — a numbered list of what this module specifically owns. Be precise. If two modules have overlapping responsibilities, one of them is in the wrong place.
3. **Key design decisions** — the WHY behind architectural choices that aren't obvious from the code.
4. **What consumes this module** (Consumed by: ...) — so a new reader knows the full chain.

```ts
/**
 * agent/OrchestrationService.ts — Spawns and coordinates sub-agents.
 *
 * Responsibilities:
 *   1. Parallel orchestration: execute N sub-agents simultaneously, one per context,
 *      and aggregate their results into a single summary.
 *   2. Sequential orchestration: generate a multi-step plan via LLM, then execute
 *      each step with a dedicated sub-agent, passing progress forward.
 *   3. Continuation handoff: spawn a sub-agent to continue a task that hit the
 *      max iteration limit.
 *
 * Design decision: This service receives a `spawnSubAgent` factory function as a
 *   parameter rather than importing AgentRuntime directly. This breaks the circular
 *   dependency (AgentRuntime → OrchestrationService → AgentRuntime) and makes the
 *   service independently testable with mock agents.
 *
 * Phase 3: In Phase 3, `spawnSubAgent` will create RemoteAgentClient instances
 *   pointing to backend workers. This service's logic is unchanged.
 *
 * Consumed by: AgentRuntime (agent-runtime.ts)
 */
```

## Function-Level JSDoc — Required for All Exported Functions

Every exported function, method, or class must have a JSDoc block with:

| Tag | Required? | Notes |
|-----|-----------|-------|
| `@param` | Yes | One per parameter; include type and description. |
| `@returns` | Yes | What the return value represents, not just its type. |
| `@throws` | If applicable | What error types and when. |
| `@example` | For non-obvious calls | Show a realistic usage; avoid trivial examples. |

```ts
/**
 * Initializes or restores agent execution state in long-term memory.
 *
 * Called once at the start of each `chat()` invocation. Idempotent — safe to
 * call multiple times (will restore existing state instead of overwriting).
 *
 * @param agentInstanceId - Unique ID for this agent instance (UUID).
 * @param sessionId - The active chat session ID for scoping memory entities.
 *   Pass `undefined` if there is no active session.
 * @param parentAgentId - If this is a sub-agent, the parent's instance ID.
 *   Used to load parent context from memory. Pass `undefined` for main agents.
 * @returns `{ restoredCheckpoint }` — the restored checkpoint if a previous run
 *   was saved to memory, or `null` if this is a fresh start.
 * @throws Does not throw — errors are caught and logged internally. Always returns
 *   a result, even if memory operations fail.
 *
 * @example
 * const { restoredCheckpoint } = await initializeSessionState(
 *   agentInstanceId,
 *   options.activeSessionId,
 *   options.parentAgentId
 * );
 * if (restoredCheckpoint) this.lastCheckpoint = restoredCheckpoint;
 */
export async function initializeSessionState(...): Promise<InitStateResult> { ... }
```

## Phase Migration Markers

Any code that will change when migrating to a backend server (Phase 3) must be marked with a comment identifying the swap point. This makes the migration surface immediately visible to any engineer reading the code.

```ts
// Phase 3 swap point: replace AgentRuntime with RemoteAgentClient here.
// Both implement IAgentClient — the swap will be type-safe and one line.
const { AgentRuntime } = await import('./agent-runtime');
const agent: IAgentClient = new AgentRuntime(options, history);
```

## Inline Comments — When to Write Them

Write an inline comment when:
- **The code violates an obvious pattern** and there is a specific reason (e.g., using `getState()` instead of the reactive hook).
- **A side effect is non-obvious** (e.g., calling `new AbortController()` inside `setProcessing(true)` creates a new signal for each processing cycle).
- **A specific number or string has business meaning** (`// 80% of context limit — act before the API rejects the request`).
- **A workaround for a known bug** exists (reference the issue number or describe the bug).

Do **not** write an inline comment when:
- The function name and types already make the intent clear.
- The comment restates the code in plain English without adding any new information.

## `TODO` and `FIXME` Format

Use a consistent format so they can be found with a project-wide search:

```ts
// TODO(username): Implement pagination for large result sets. Issue #142.
// FIXME(username): This assumes the tab always exists. Handle the race condition where
//   the tab is closed between the tool call and the result being read.
// HACK: We cast through `any` here because the MCP SDK types are incomplete.
//   Remove once https://github.com/modelcontextprotocol/typescript-sdk/issues/XX lands.
```

## What NOT to Document

- **Obvious getters and setters** — `// Returns the session title` above `get title() { return this._title; }` is noise.
- **Re-exports** — `// Re-export for convenience` is not useful.
- **Commented-out code** — delete it. Git history is the undo mechanism. Commented-out code rots and misleads.