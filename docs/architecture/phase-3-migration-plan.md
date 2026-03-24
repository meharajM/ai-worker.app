# Phase 3: Client-Server Architecture Migration

**Status:** Planned  
**Target Date:** Q2 2026  
**Goal:** Decouple the Agent Runtime from the React UI process, enabling remote execution, easier scaling, and better stability.

---

## 1. Overview

Currently, the AI Agent runs inside the Electron Renderer process (the UI thread). This has several limitations:
1. **Performance:** Heavy agent processing (LLM inference, large context handling) can freeze the UI.
2. **Stability:** If the agent crashes (e.g., out of memory), the whole UI crashes.
3. **Scalability:** We cannot easily run multiple agents or heavy concurrent tasks.
4. **Security:** The agent has direct access to the UI DOM and memory space.

**Phase 3 Strategy:**
Move the `AgentRuntime` logic into a separate **Node.js/Backend process**. The React UI will communicate with this process via a standardized API (likely WebSocket or gRPC/tRPC).

---

## 2. Infrastructure Changes

### 2.1 The `IAgentClient` Seam (Completed in Phase 2)
We have already introduced the `IAgentClient` interface. The UI (`useAgent.ts`) now programs against this interface, not the concrete implementation.

```typescript
// Current (Phase 2)
import { AgentRuntime } from './agent-runtime';
const client: IAgentClient = new AgentRuntime(options);

// Future (Phase 3)
import { RemoteAgentClient } from './remote-agent-client';
const client: IAgentClient = new RemoteAgentClient({ url: 'ws://localhost:3000' });
```

### 2.2 New Backend Service (`server/`)
We will create a new directory `server/` or `backend/` that hosts the agent logic.
- **Technology:** Node.js (or potentially Python/Rust for performance).
- **Transport:** WebSocket (Socket.io) for real-time streaming of tokens and tool updates.
- **State Management:** The backend will hold the `AgentState` (memory, chat history).

### 2.3 RemoteAgentClient
This new class will implement `IAgentClient` but logic will simpler:
- **`chat(message)`**: Serializes the message and sends it over the socket.
- **`abort()`**: Sends an abort signal frame.
- **`on('message')`**: Deserializes incoming chunks/tool calls and updates the UI store.

---

## 3. Implementation Steps

### Step 1: Create the Backend Server
1.  Initialize a new Node.js project in `server/`.
2.  Set up a WebSocket server.
3.  Move `AgentRuntime`, `AgentStateService`, `ToolExecutionService`, and `OrchestrationService` files into `server/src/`.
4.  Update imports (LLM clients, MCP clients) to work in the Node environment (remove browser-specific dependencies).

### Step 2: Implement `RemoteAgentClient`
1.  Create `src/renderer/src/lib/remote-agent-client.ts`.
2.  Implement `IAgentClient`.
3.  Establish a persistent WebSocket connection to the local server.
4.  Handle reconnection and error states gracefully.

### Step 3: Switch `useAgent.ts`
1.  Update `useAgent.ts` to instantiate `RemoteAgentClient` instead of `AgentRuntime`.
2.  Add configuration in `Settings` to point to the backend URL (default: internal process).

### Step 4: Electron Integration
1.  Modify `src/main/index.ts` to spawn the backend server as a child process when the app starts.
2.  Ensure safe IPC or local network communication between Renderer and Backend.

---

## 4. Benefits

| Feature | Phase 2 (Current) | Phase 3 (Client-Server) |
| :--- | :--- | :--- |
| **Execution** | UI Thread (Renderer) | Background Process (Node.js) |
| **UI Responsiveness** | Can lag during heavy tasks | Always smooth |
| **Crash Safety** | Agent crash = App crash | Agent crash = Error toast |
| **Multiple Agents** | Difficult/Slow | Easy (spawn processes) |
| **Remote Access** | None (Local only) | Possible (Cloud-hosted brain) |

## 5. Risks & Mitigation

- **Latnecy:** Local WebSocket latency is negligible (<1ms).
- **Complexity:** Managing a separate process adds build/deploy complexity.
  - *Mitigation:* Use a monorepo structure and orchestrate startup via Electron's main process.
- **Authentication:** If exposed over network, we need auth.
  - *Mitigation:* Initially localhost-only with a generated secret token.
