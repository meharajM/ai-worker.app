---
trigger: model_decision
description: Load when writing or editing any TypeScript (.ts or .tsx) file. Covers strict mode, the no-any policy, interface vs type usage, naming conventions, and shared types.
---

# TypeScript Standards

## Strict Mode — Always On

`tsconfig.json` must have `compilerOptions.strict: true`. This single flag enables:
- `strictNullChecks` — `undefined` and `null` are not assignable to every type.
- `noImplicitAny` — every parameter and variable must have an explicit or inferrable type.
- `strictFunctionTypes` — function types are checked contravariantly.
- `strictPropertyInitialization` — class properties must be initialized in the constructor.

Do not disable individual strict settings to make a file compile. Fix the types instead.

## The `any` Policy

**Do not use `any` in new code.** `any` disables TypeScript's type checker entirely for that value — it is the same as writing untyped JavaScript.

**The `unknown` → cast pattern (when you must):**
When a third-party library returns an untyped value, or you receive raw data from IPC or a JSON parse, cast through `unknown` and document why:

```ts
// ✅ CORRECT — validated before use, explained in comment
const raw = await ipcRenderer.invoke('memory:get-stats') as unknown;
// IPC returns an untyped payload; shape validated against MemoryStats below.
const stats = raw as MemoryStats;

// ✅ CORRECT — casting JSON parse result
const config = JSON.parse(raw) as unknown as AppConfig;
```

```ts
// ❌ BAD — `any` bypasses all checks silently
const result: any = await ipcRenderer.invoke('memory:get-stats');
result.nonExistentField; // no error — bug hidden until runtime
```

**Acceptable uses of `any`:**
- Third-party library types that have no typedefs and cannot be reasonably typed locally (document with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` and a comment explaining why).
- Legacy code that would require a large refactor to type correctly — mark with a `// TODO: type this properly` comment.

## `interface` vs `type`

| Use `interface` for... | Use `type` for... |
|---|---|
| Object shapes (props, store state, API responses) | Union types: `type Role = 'user' \| 'assistant' \| 'system'` |
| Contracts that may be extended or merged | Intersection types: `type AdminUser = User & AdminPermissions` |
| Class contracts | Aliases: `type Callback = (msg: LLMMessage) => void` |
| JSDoc documentation (interfaces show property names in tooltips) | Mapped types, conditional types, template literals |

```ts
// GOOD — interface for object shape
interface AgentRuntimeOptions {
  activeSessionId?: string;
  settings: LLMSettings;
  signal?: AbortSignal;
  onMessage?: (msg: LLMMessage) => string | void;
}

// GOOD — type for union
type TaskComplexity = 'simple' | 'moderate' | 'complex';

// GOOD — type for callback alias
type AgentStatusCallback = (message: LLMMessage) => string | void;
```

## Named Exports — Always

Default exports obscure the exported identifier, make auto-importing inconsistent, and complicate tree-shaking analysis.

```ts
// ✅ CORRECT — named export
export function useAgent(): UseAgentReturn { ... }
export interface AgentRuntimeOptions { ... }
export class AgentRuntime implements IAgentClient { ... }

// ❌ BAD — default export
export default function useAgent() { ... }
export default AgentRuntime;
```

**Exception:** React component files may use a named export while the file is named in PascalCase — this is fine. Never use `export default` even for components.

## Constants — `as const` and Named Constants

Avoid magic strings and numbers scattered through code. Define them once as named constants:

```ts
// GOOD — named, typed, documented constant
/** Maximum agent iterations before surfacing a handoff prompt to the user. */
export const MAX_ITERATIONS = 50;
export const MAX_SUB_AGENT_ITERATIONS = 15;
export const CHECKPOINT_INTERVAL = 15;

// GOOD — as const for IPC channels or enum-like objects
export const IPC = {
  memory: { getStats: 'memory:get-stats' },
  app:    { selectFolder: 'app:select-folder' },
} as const;

// BAD — magic number embedded in logic
while (iteration < 50) { ... } // Why 50? What controls this?
```

## Shared Types Location

**Never define the same type in two places.** Types shared across processes (main ↔ preload ↔ renderer) or across modules belong in one of:
- `src/shared/` — for types crossing the process boundary (IPC payloads, tool schemas).
- `src/renderer/src/lib/agent/types.ts` — for agent-subsystem types used across agent services.
- `src/renderer/src/stores/<domain>Store.ts` — for types that are store-specific and stable.

Import the type from its canonical location everywhere else. When a type drifts between two copies, the bug is silent — both sides compile fine, but the data shapes no longer match.

## Generic Typing — Be Specific

```ts
// ❌ BAD — too wide; loses type information
function parseResult(raw: any): any { return JSON.parse(raw); }

// ✅ GOOD — generic preserves type intent; caller knows what they get
function parseResult<T>(raw: string): T { return JSON.parse(raw) as T; }

// ✅ CALL SITE — explicit type argument, no `any`
const stats = parseResult<MemoryStats>(rawJson);
```

## `private` Members and Encapsulation

Mark implementation details of a class as `private`. Use the `_` prefix convention for private methods to make them visually identifiable in stack traces and logs:

```ts
class AgentRuntime implements IAgentClient {
  private messages: LLMMessage[] = [];
  private maxIterations: number;

  // Public API — part of IAgentClient
  async chat(content: string): Promise<LLMMessage> { return this._runLoop(content); }

  // Private implementation — underscore signals "internal only"
  private async _runLoop(prompt: string): Promise<LLMMessage> { ... }
  private _handleCreateExecutionPlan(args: any, iteration: number): string { ... }
}
```

## Null Handling

With `strictNullChecks` on, always handle the nullable case explicitly. Prefer explicit null checks over the non-null assertion operator (`!`).

```ts
// ❌ RISKY — assertion silences the compiler but crashes if null
const session = sessions.find(s => s.id === activeId)!;

// ✅ SAFE — explicit guard
const session = sessions.find(s => s.id === activeId);
if (!session) throw new Error(`Session ${activeId} not found`);

// ✅ SAFE — nullish coalescing for defaults
const title = session?.title ?? 'New Chat';
```