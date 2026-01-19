# Role: Expert AI Architect & Systems Engineer
**Objective:** Refactor the existing "AI-Worker" Electron application from a linear execution model into a **Recursive Multi-Agent System** using a **Bun-based Sidecar**.

**Core Philosophy:** 
Implement a "Dual-Rail" strategy. Build the new "Agentic Mode" alongside the "Legacy Mode" without deleting existing code (`executor.ts`), ensuring the app remains functional at all times.

---

## 1. Architecture Overview: The "Local-First Brain"
We are separating concerns:
*   **Electron Main (The Body):** Handles native OS permissions, hosts MCP servers, and manages the generic IPC.
*   **Bun Sidecar (The Brain):** A separate child process running Hono + Bun. It handles the LLM orchestration, Recursive ReAct loops, and specific Agent logic.
*   **React Renderer (The Senses):** Streams real-time agent "thoughts" via WebSockets and handles user approvals.

## 2. Technical Specification & Implementation Plan

### Phase 1: The Sidecar Infrastructure (Hono + Bun)
**File:** `sidecar/index.ts`, `sidecar/server.ts`
1.  **Setup:** Create a `sidecar/` directory. Initialize a Hono server that listens on a local port (e.g., 3001).
2.  **WebSocket Gateway:** Implement a `/v1/chat` endpoint using Hono's Bun adapter for real-time bi-directional communication with the Electron App.
3.  **State Management:** Create a `SessionManager` that holds a `Map<sessionId, AgentInstance>`. This allows multiple concurrent agent trees.
4.  **Startup Handshake:** Create a `/sync-tools` endpoint where Electron sends the list of available MCP tools to the Sidecar upon launch.

### Phase 2: React Native "Sidecar Launcher" (Electron Main)
**File:** `src/main/sidecar-manager.ts`
1.  **Spawn Logic:** In `main/index.ts`, use `child_process.spawn` to launch the Bun binary (`bun run sidecar/index.ts`).
2.  **Environment Sync:** You **must** pipe `process.env` (containing API keys from `electron-store`) to the Bun child process.
3.  **Path Resolution:** Use `fix-path` to ensure the Bun process inherits the correct user `$PATH` (critical for `npx`/CLI tools).
4.  **Zombie Prevention:** Implement a `before-quit` listener in Electron to send `SIGTERM` to the Bun process.

### Phase 3: The Recursive "ReAct" Core
**File:** `sidecar/agent/BaseAgent.ts`
Implement a `BaseAgent` class with the following logic:
1.  **The Loop:** `While (task != done): Reason -> Select Tool -> Execute -> Observe -> Repeat`.
2.  **Recursion (The `delegate` tool):**
    *   Register a system tool: `delegate_task(task: string, specialist_type: string)`.
    *   When called, the Sidecar spawns a *new* `AgentInstance` (Sub-agent) with a specific persona and a subset of tools.
    *   The Sub-agent runs its own loop. Its final result becomes the "Tool Output" for the Parent Agent.
    *   **Constraint:** Hard limit recursion depth to 3 to prevent infinite loops.
3.  **Dynamic Context Pruning (DCP):**
    *   Monitor tool outputs (e.g., `fs_read`).
    *   If output > 1000 tokens/characters, **truncate** it and store a summary (e.g., *"File too large: 5000 lines. Read locally or use grep."*) unless the agent specifically requests "full raw output".
    *   **Context Rotation:** Summarize tool outputs older than 3 turns to keep the context window fresh.

### Phase 4: Unified Tool Protocol & MCP Bridge
**File:** `sidecar/tools/ToolDispatcher.ts` & `src/main/ipc/mcp-bridge.ts`
1.  **JSON-RPC Bridge:**
    *   The Sidecar does not have direct access to all system resources. It must request tool execution from Electron.
    *   Protocol: `{ type: 'CALL_TOOL', name: 'git_commit', args: {...}, requestId: '...' }`.
2.  **Permission Layer (The Approval Loop):**
    *   **Safe Tools:** (`read_file`, `search`) -> Executed immediately by Electron.
    *   **Sensitive Tools:** (`write_file`, `bash`) -> Electron emits `PENDING_APPROVAL` to React UI.
    *   **UI Logic:** User clicks "Approve" -> Electron executes -> Result sent to Bun.
3.  **Git Snapshots:** Before any `fs_write` or `bash` execution, automatically trigger `git add . && git commit -m "Snapshot"` in the background for safety.

### Phase 5: The Event-Driven UI
**File:** `src/renderer/src/stores/chatStore.ts`
1.  **Zustand Refactor:** Update the store to listen to the WebSocket instead of `fetch`.
2.  **Event Handling:**
    *   `AGENT_THOUGHT`: Append streaming text to the UI bubble.
    *   `TOOL_START`: Show a "Running [ToolName]..." indicator.
    *   `AGENT_DELEGATE`: Render a nested "Sub-Agent" dropdown in the message list.
3.  **Feature Flag:** Add a toggle in Settings: "Use Bun Orchestrator". If false, use the existing `legacyExecutor.ts`.

---

## 3. Implementation Order (Step-by-Step)
1.  **Analysis:** Audit `ipcMain` handlers and `Message` types to ensure backward compatibility.
2.  **Scaffolding:** Create `sidecar/` and basic Hono server verifying it logs "Hello from Bun".
3.  **Bridge:** Connect Electron to Bun via `spawn` and verify WebSocket connection in the console.
4.  **Logic:** Implement `BaseAgent.ts` with the ReAct loop and DCP (Pruning).
5.  **Tools:** Build the MCP Proxy/Bridge between Bun and Electron.
6.  **UI:** Connect the Zustand store to the WebSocket stream.

## 4. Constraint Checklist
*   [ ] Do not delete `executor.ts` (Rename to `legacyExecutor.ts`).
*   [ ] Ensure API keys are passed to Bun.
*   [ ] Handle port conflicts (check if 3001 is free).
*   [ ] Verify "Stop" button kills the specific agent session in Bun.

**Primary Goal:** Create a system where I can ask a complex coding task, and see the logs show a Primary Agent delegated tasks to Sub-Agents, all managed by the high-performance Bun sidecar.