---
trigger: model_decision
description: Load when creating or editing React component files (.tsx) in src/renderer/src/components/. Covers component structure, props typing, rendering patterns, and composition rules.
---

# React Component Rules

## The Single Responsibility of a Component

A component's job is to **render UI from props/state and fire callbacks**. It must not:
- Directly call IPC (`window.electron.*`) — that belongs in a custom hook.
- Instantiate agents, services, or classes — that belongs in `hooks/`.
- Contain multi-branch business logic — extract to a `lib/` helper or hook.

If you find yourself writing a complex `if/else` tree inside a component body that doesn't directly control what is rendered, it belongs elsewhere.

## File Structure

One component per file. The file name matches the component name in `PascalCase`.

```ts
// src/renderer/src/components/ChatSidebar.tsx

// 1. Imports
import { useState } from 'react';
import type { ChatSession } from '../stores/chatStore';

// 2. Explicit props interface — always, even for simple components
interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
}

// 3. Named export — never default export
export function ChatSidebar({ sessions, activeSessionId, onSelectSession, onCreateSession }: ChatSidebarProps) {
  // 4. Local state and refs
  const [isHovered, setIsHovered] = useState(false);

  // 5. Derived values or render helpers
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  // 6. JSX return
  return ( /* ... */ );
}
```

## Props Interface Rules

- **Always define an explicit `interface ComponentNameProps {}`** before the component. No inline prop types, no `any`, no type widening.
- **Never use `any` as a prop type.** If a prop is a complex external type, import it from its source.
- **Callbacks must be typed precisely.** `onClick: () => void`, not `onClick: Function`. `onMessage: (msg: LLMMessage) => void`, not `onMessage: any`.
- **Mark optional props with `?`.** Note the difference between `label?: string` (may be undefined) and `label: string | null` (must be explicitly passed as null). Prefer the former for truly optional visual props.

## ErrorBoundary Placement

**Every major UI section must be wrapped in an `<ErrorBoundary>`.**

A crash in the settings panel must not kill the sidebar. A crash rendering a message bubble must not kill the input area.

```tsx
// In App.tsx
<ErrorBoundary fallback={<p>Settings failed to load.</p>}>
  <SettingsPanel />
</ErrorBoundary>
<ErrorBoundary fallback={<p>Chat view encountered an error.</p>}>
  <ChatView />
</ErrorBoundary>
```

Create `ErrorBoundary` as a class component (the only valid use of class components in this project). It receives an optional `fallback` prop.

## List Rendering — Stable Keys

**Never use the array index as a `key`.** React uses keys to identify which elements changed, were added, or were removed. An index key causes wrong elements to be updated when items are inserted or reordered.

```tsx
// BAD — index key causes wrong elements to be updated when list changes
{messages.map((msg, i) => <MessageBubble key={i} message={msg} />)}

// GOOD — stable ID derived from the data
{messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
```

## Conditional Rendering — Depth Limit

- **Maximum 2 levels of nested ternaries in JSX.** Beyond that, extract a named render helper or subcomponent.
- **Use early returns** for loading/empty/error states before the main render.

```tsx
// GOOD — early returns keep the main render clean
function MessageList({ messages, isLoading }: MessageListProps) {
  if (isLoading) return <Spinner />;
  if (messages.length === 0) return <EmptyState />;

  return (
    <ul>
      {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
    </ul>
  );
}

// BAD — deeply nested ternaries
return isLoading ? <Spinner /> : messages.length === 0 ? <EmptyState /> : (
  someOtherCondition ? <AlternateView /> : <ListView />
);
```

## Component Composition Rules

- **Prefer shallow composition over prop-drilling beyond 2 levels.** If a prop needs to travel through 3+ components to reach its consumer, use a Zustand store or a context instead.
- **Never access `window.electron` directly in a component.** Always delegate to a custom hook in `hooks/`. This keeps the component testable without mocking Electron.
- **Avoid `useEffect` in components for data fetching.** Use a hook (e.g., `useLLMStatus`) that encapsulates the IPC call and returns the data. The component only receives the result.

## Named Exports — Always

```ts
// GOOD
export function SettingsPanel() { ... }

// BAD — default exports make auto-importing inconsistent and refactoring harder
export default function SettingsPanel() { ... }
```