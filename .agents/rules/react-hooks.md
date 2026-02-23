---
trigger: model_decision
description: Load when creating or editing custom React hooks in src/renderer/src/hooks/. Covers hook design, the stale closure rule, effect cleanup, and lazy loading patterns.
---

# React Hook Rules

## Custom Hook Responsibilities

Custom hooks own all **side effects and external interactions** in the renderer. If a component needs to:
- Call IPC (`window.electron.*`)
- Subscribe to a Zustand store and perform derived logic
- Manage a timer, interval, or event listener
- Instantiate an agent or service class

...then that behavior belongs in a custom hook in `hooks/`, not in the component body.

This separation makes components testable without mocking Electron or the agent system.

## Hook File Structure

```ts
// src/renderer/src/hooks/useSettingsSync.ts

// 1. Describe what the hook does and why it exists as a JSDoc comment
/**
 * Syncs settings from the Electron store to the Zustand settings store on mount.
 * Handles the case where settings were changed externally (e.g., by another window).
 */

// 2. Named function export — always
export function useSettingsSync(): UseSettingsSyncReturn {
  // ...
}

// 3. Explicit return type interface
interface UseSettingsSyncReturn {
  isLoaded: boolean;
  error: string | null;
}
```

## The Stale Closure Rule — Critical

When you access Zustand state inside an **async callback, `setTimeout`, or `useCallback`**, you must use `store.getState()`, NOT the reactive hook selector.

The reactive hook (`useSomeStore(s => s.value)`) captures the value at render time. By the time an async callback runs—after an `await`, a timeout, or a user interaction—that snapshot is stale.

```ts
// ❌ WRONG — stale closure captures messages at the time useCallback was created
const handleSubmit = useCallback(async (content: string) => {
  const { messages } = useChatStore(); // ← snapshot from last render, may be stale
  await processMessages(messages);
}, []);

// ✅ CORRECT — reads the live store value at the moment the callback executes
const handleSubmit = useCallback(async (content: string) => {
  const { messages } = useChatStore.getState(); // ← always fresh
  await processMessages(messages);
}, []);
```

**Rule of thumb:** Inside any function that runs asynchronously or after a delay, use `.getState()` for Zustand. Only use the reactive `useSomeStore()` hook in synchronous, render-time code paths.

## `useCallback` — When to Use

Use `useCallback` for any handler that is:
- Passed as a prop to a child component (prevents child from re-rendering on every parent render).
- Listed as a dependency in a `useEffect` (prevents the effect from re-running every render).
- An async handler that captures other `useCallback`-wrapped functions.

```ts
// GOOD — stable reference for child and effect deps
const handleSubmit = useCallback(async (content: string) => {
  // ...
}, [settings]); // ← only recreated when settings change

// NOT NEEDED — handlers used only inline in JSX of the same component
// (though it's never harmful to add useCallback)
```

## Effect Cleanup — Always Required

Every `useEffect` that subscribes to something external must return a cleanup function. No exceptions.

```ts
useEffect(() => {
  // Subscribe
  const unlisten = window.electron.speech.onResult((result) => {
    handleResult(result);
  });

  // REQUIRED cleanup — without this, the listener leaks after unmount
  return () => unlisten();
}, []); // ← empty deps = runs once on mount, cleanup on unmount


useEffect(() => {
  const interval = setInterval(() => checkStatus(), 5000);

  // REQUIRED cleanup
  return () => clearInterval(interval);
}, [checkStatus]);


useEffect(() => {
  window.addEventListener('agent-action', handleAgentAction as EventListener);

  // REQUIRED cleanup
  return () => window.removeEventListener('agent-action', handleAgentAction as EventListener);
}, [handleAgentAction]);
```

Forgetting cleanup causes: ghost listeners that fire after a component unmounts, memory leaks that grow over the app's lifetime, and subtle bugs where stale callbacks receive new events.

## Lazy Loading Heavy Dependencies

Heavy modules (agent runtimes, LLM clients, MCP connections) should be loaded on first use, not at module parse time. This keeps the app's initial startup time fast.

```ts
// GOOD — module only loads when the user first submits a message
const handleSubmit = useCallback(async (content: string) => {
  const { AgentRuntime } = await import('../lib/agent-runtime');
  const runtime = new AgentRuntime(options, history);
  await runtime.chat(content);
}, [options, history]);

// BAD — imports the entire 1000-line agent module at app startup
import { AgentRuntime } from '../lib/agent-runtime'; // ← at top of file
```

## Return Type Clarity

Every custom hook must have an explicit, named return type interface. Avoid returning bare tuples for anything beyond 2 values.

```ts
// GOOD — named return interface, destructurable with clear names
interface UseAgentReturn {
  handleSubmit: (content: string, attachments?: File[]) => Promise<void>;
  pendingConfirmation: PendingConfirmation | null;
  clearConfirmation: () => void;
}
export function useAgent(): UseAgentReturn { ... }

// ACCEPTABLE for simple cases
export function useToggle(initial: boolean): [boolean, () => void] { ... }

// BAD — caller has no idea what position 0, 1, 2 are without reading the source
export function useAgent() { return [handleSubmit, pendingConfirmation, clearConfirmation]; }
```

## `useAgent` is the Sole Agent Factory

The `useAgent` hook is the **only place in the entire renderer** that instantiates an `IAgentClient`. No component, no other hook, no `lib/` module should ever call `new AgentRuntime(...)` or `new RemoteAgentClient(...)` directly. This single-factory rule means that when we swap agent implementations in a future migration, we change exactly one file.