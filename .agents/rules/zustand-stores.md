---
trigger: model_decision
description: Load when creating or editing Zustand stores in src/renderer/src/stores/. Covers store design, persistence, reading state safely in callbacks, and anti-patterns.
---

# Zustand Store Rules

## One Store Per Domain

Never merge unrelated state into a single store. Each store owns exactly one domain:

| Store | Owns |
|-------|------|
| `chatStore` | Chat sessions, messages, abort controller, processing state |
| `settingsStore` | LLM provider config, API keys, UI preferences |
| `authStore` | Firebase user identity, auth tokens |
| `mcpStore` | MCP server connections, tool lists |

Cross-domain coupling (e.g., `chatStore` reading from `settingsStore`) is OK in hooks and components — not in the store itself. Stores must not import each other.

## Store Structure — Actions Co-Located

All state and all actions that mutate that state must be defined in a single `create()` call. Do not create separate "action files" or "reducer objects".

```ts
export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      // ── State ───────────────────
      sessions: [],
      activeSessionId: null,
      isProcessing: false,
      abortController: null,

      // ── Actions (co-located) ────
      createSession: (workspacePath?: string) => {
        const newSession: ChatSession = { id: `chat_${Date.now()}`, /* ... */ };
        set(state => ({ sessions: [newSession, ...state.sessions], activeSessionId: newSession.id }));
        return newSession.id;
      },

      addMessage: (message) => {
        const newMessage = { ...message, id: `msg_${Date.now()}`, timestamp: Date.now() };
        set(state => ({ /* ... */ }));
        return newMessage;
      },
    }),
    { name: 'ai-worker-chat-v2', /* ... */ }
  )
);
```

## Persistence — `partialize` Whitelist

Use `partialize` to **explicitly list** which fields are persisted. Never persist ephemeral runtime state.

```ts
persist(
  (set, get) => ({ /* ... */ }),
  {
    name: 'ai-worker-chat-v2',
    storage: createJSONStorage(() => localStorage),
    // ONLY whitelist fields that should survive page reload
    partialize: (state) => ({
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      sidebarOpen: state.sidebarOpen,
    }),
    // ← isProcessing, abortController, abortSignal are NOT included
  }
)
```

**Never persist:**
- `isProcessing` — always starts as `false` on load.
- `abortController` / `AbortSignal` — not serializable.
- Class instances (e.g., a `WebSocket`, `AudioContext`).
- `Map`, `Set`, `Date` objects — these lose their prototype on JSON round-trip.
- Error objects.

## Version Your Storage Key

When you make a **breaking schema change** (rename a field, change its type, restructure sessions):

```ts
// Before schema change:
name: 'ai-worker-chat-v1',

// After adding workspacePath to ChatSession, bumping version:
name: 'ai-worker-chat-v2',
```

Without a version bump, users loading the app after an upgrade will hydrate the old incompatible schema and may see crashes, missing data, or incorrect behaviour. With a version bump, they get a clean initial state.

For non-breaking additions (adding a new optional field), a version bump is not required.

## Reading State Safely in Async Callbacks

Inside any `useCallback`, `useEffect`, or async function, use `store.getState()` — NOT the reactive hook selector. The reactive hook captures the store state at render time, which is stale by the time an async callback executes.

```ts
// ❌ WRONG — stale closure; messages may be outdated by the time this runs
const handleSubmit = useCallback(async (content: string) => {
  const messages = useChatStore(s => s.messages); // captured at hook call time
  await agent.chat(content, messages);
}, []);

// ✅ CORRECT — always reads the live value at the moment of execution
const handleSubmit = useCallback(async (content: string) => {
  const messages = useChatStore.getState().sessions.find(s => s.id === activeId)?.messages ?? [];
  await agent.chat(content, messages);
}, []);
```

**Safe** (reactive hook in synchronous render path):
```tsx
// In a component — this is fine; React re-renders when the store updates
function ChatHeader() {
  const sessionTitle = useChatStore(s => s.getActiveSession()?.title ?? 'New Chat');
  return <h1>{sessionTitle}</h1>;
}
```

## Selector Stability — Avoid Inline Object Selectors

Selectors that return new objects or arrays on every call cause unnecessary re-renders because referential equality fails.

```ts
// ❌ BAD — new object reference on every render, causes infinite re-render if in a dep array
const { sessions, activeSessionId } = useChatStore(s => ({
  sessions: s.sessions,
  activeSessionId: s.activeSessionId,
}));

// ✅ GOOD — select primitives separately or use `useShallow` for objects
const sessions = useChatStore(s => s.sessions); // array ref is stable until sessions changes
const activeSessionId = useChatStore(s => s.activeSessionId);

// ✅ ALTERNATIVE — use Zustand's useShallow for object selectors
import { useShallow } from 'zustand/react/shallow';
const { sessions, activeSessionId } = useChatStore(
  useShallow(s => ({ sessions: s.sessions, activeSessionId: s.activeSessionId }))
);
```

## `set` Updater Function — Always Use for Dependent Updates

When the new state depends on the old state, use the updater function form of `set`:

```ts
// ❌ WRONG — race condition if multiple calls happen in rapid succession
set({ sessions: [...state.sessions, newSession] }); // "state" may be stale

// ✅ CORRECT — updater receives the guaranteed-current state
set(state => ({ sessions: [...state.sessions, newSession] }));
```