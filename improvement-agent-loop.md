# Memory-Driven Agent Loop & Sub-agent Architecture (Detailed)

This plan details the technical implementation for upgrading the Agent Runtime to a memory-persistent, lane-controlled architecture.

## 1. Core Architecture: Memory-Driven State

Instead of relying on LLM context window for state, we use the MCP Memory Graph.

### 1.1 Memory Schemas & Namespace Separation
To prevent polluting the user's visible knowledge graph, we will use strict `type` separation.

**Types**:
*   `user_fact`, `user_project`, `user_file` -> **VISIBLE** to User.
*   `agent_execution_state`, `agent_plan`, `agent_handoff` -> **HIDDEN** (Internal).

#### **Entity: `ExecutionState` (Internal)**
*   **Name**: `AgentState_{agentInstanceId}` (Unique per Runtime Instance)
*   **Type**: `agent_execution_state` (Internal)
*   **Description**: "Tracks the active state of Agent Instance {agentInstanceId} in Session {sessionId}"
*   **Metadata Schema**:
    ```typescript
    interface ExecutionStateMetadata {
      agentInstanceId: string; // UUID v4, generated on runtime start
      sessionId: string; // The parent Chat Session ID (shared by all agents in this chat)
      sourceTabId?: number; // The browser tab this agent is controlling (for multi-tab isolation)
      status: 'active' | 'paused' | 'completed' | 'failed';
      currentPlanId?: string; 
      iterationCount: number;
      maxIterations: number;
      capabilities: string[]; 
      parentAgentId?: string; // If this is a sub-agent, points to parent's Instance ID
      contextPointer?: string;
      lastCheckpoint: {
        step: number;
        summary: string;
        timestamp: number;
      };
      // Namespace flag
      isInternal: true 
    }
    ```

### 1.2 Session Isolation Strategy
To handle **multiple chat sessions** and **multiple tabs** simultaneously:
1.  **Chat Session Isolation**: Data is partitioned by `sessionId`. The UI only queries memory where `metadata.sessionId === activeSessionId`.
2.  **Agent Instance Isolation**: Each `AgentRuntime` generates a unique `agentInstanceId`. This prevents a Sub-agent from overwriting the Main Agent's state entity.
3.  **Tab Isolation**: `ExecutionState` tracks `sourceTabId`. The `LaneManager` uses this ID to route browser commands to the correct serial lane, preventing cross-talk.

#### **Entity: `AgentPlan` (Internal)**
*   **Name**: `Plan_{planId}`
*   **Type**: `agent_plan` (Internal)
*   **Metadata Schema**:
    ```typescript
    interface AgentPlanMetadata {
      goal: string;
      steps: Array<{
        id: number;
        description: string;
        status: 'pending' | 'in_progress' | 'completed' | 'failed';
        assignedAgentType: 'main' | 'sub_research' | 'sub_coding';
        resultEntityId?: string; // Link to a Finding entity
      }>;
      isInternal: true
    }
    ```

### 3. Memory-Driven Loop (Ralph Style)
#### [MODIFY] [agent-runtime.ts](file:///Users/meharaj/Downloads/ai-worker%20app/src/renderer/src/lib/agent-runtime.ts)

1.  **Start-up Logic**:
    *   Generate `this.agentInstanceId = crypto.randomUUID()`.
    *   Check `options.parentAgentId` (if sub-agent).
    *   **CRITICAL**: If Sub-agent, DO NOT carry over `this.messages`. Start with a "Context Summary" message loaded from `ExecutionState` of parent.

2.  **Refactor `executeCallWithSelfHealing`**:
    *   **Keep**: The `try/catch` retry logic for Stale Element / Timeout.
    *   **Replace**: `await import('./resource-lock')` -> `const { laneManager } = await import('./execution-lanes')`.
    *   **Logic**: `await laneManager.getLane(name, { tabId }).run(task)`.

3.  **Refactor Handoff**:
    *   **Remove**: The `isConfirmingHandoff` logic in `chat()` (lines ~100-120).
    *   **Add**: When `totalIterations > MAX`, create a `HandoffEntity` in memory and return a natural language message: "I am handing off to a fresh agent to continue...".
    *   The *next* `chat()` call (triggered by UI or loop) will detect the Handoff Entity and spawn a fresh `AgentRuntime` with a clean context.

4.  **Loop Execution**:
    1.  **Load State**: Fetch `ExecutionState` by `sessionId`.
        *   *If Sub-agent*: Fetch `parentSessionId` state to understand context (lightweight).
    2.  **Determine Tools**: Call `getToolsForCategory(state.category)`.
    3.  **Execute Step**:
        *   **Observer**: Check `lastCheckpoint`.
        *   **Think**: LLM decides action.
        *   **Act**: Execute tools (via Execution Lanes).
    4.  **Checkpoint**:
        *   Count tokens/steps.
        *   If `step % 5 === 0` OR `Tool === update_plan`: Update `ExecutionState` entity in Memory.

---

## 2. Concurrency: Execution Lanes (OpenClaw)

We replace `resource-lock.ts` with `execution-lanes.ts`.

### 2.1 Lane Logic
*   **Global Browser Lane (`BROWSER_SERIAL`)**:
    *   Constraint: `concurrency: 1`.
    *   Usage: All `navigate`, `click`, etc. in the *main* window.
*   **Isolated Tab Lane (`TAB_{id}`)**:
    *   Constraint: `concurrency: 1` (per tab).
    *   Usage: Sub-agents with `tabId` use this lane.
    *   Result: `SubAgent A` (Tab 1) and `SubAgent B` (Tab 2) run in **PARALLEL**.
*   **API/Compute Lane (`API_PARALLEL`)**:
    *   Constraint: `concurrency: 5` (or higher).
    *   Usage: `memory_*`, `search`, `weather`, `file_read`.

### 2.2 Implementation Details
```typescript
// execution-lanes.ts
export class LaneManager {
  private lanes = new Map<string, LaneQueue>();
  
  // Get the correct lane for a tool call
  getLane(toolName: string, context: { tabId?: number }): LaneQueue {
    if (isBrowserTool(toolName)) {
      if (context.tabId) return this.getOrCreateLane(`TAB_${context.tabId}`);
      return this.globalBrowserLane;
    }
    if (isFileSystemTool(toolName)) return this.fileSystemLane;
    return this.apiParallelLane;
  }
}
```

---

## 3. Implementation Steps

### Phase 1: Cleanup & Foundation
1.  **Fix Conflicts**: Resolve merge conflicts in `client-tools.ts` and `agent-runtime.ts`.
2.  **Restore Tools**: Ensure `MEMORY_` tools and `PROGRESS_SUMMARY` are available.

### Phase 2: Lane Infrastructure
3.  **Create `execution-lanes.ts`**: Implement `LaneQueue` and `LaneManager`.
4.  **Integrate**: Replace `browserLock.runExclusive` calls in `agent-runtime.ts` with `laneManager.run(task)`.

### Phase 3: Memory Integration
5.  **Refactor Runtime**:
    *   Add `memoryClient` to `AgentRuntime`.
    *   Implement `initializeSessionState()` method.
    *   Replace `progressSummary[]` array with `memory_update_entity` calls.
6.  **Sub-Agent Handoff**:
    *   Update `delegate_sub_task` to CREATE a `SubAgent` entity in memory.
    *   Spawned `AgentRuntime` reads this entity to boot up.

### Phase 4: Verification
7.  **Test**: `verify_memory_handoff.cjs`
    *   Scenario: Agent A starts, writes to memory "Plan: Buy shoes". Agent A passes context to Sub-agent B. Sub-agent B reads "Plan: Buy shoes" from memory.

---

## 4. Benchmarking Self-Healing

Our architecture synthesizes best practices from industry agents:

| Layer | Concept | Reference | Our Implementation |
| :--- | :--- | :--- | :--- |
| **Infrastructure** | **State Manifests** | **OpenCode** | `ExecutionState` entity in Memory (Persistent JSON-like state). |
| **Orchestration** | **Gateway / Lanes** | **OpenClaw** | `LaneManager` (Controls concurrency & tab isolation). |
| **Runtime** | **Feedback Loop** | **AutoGPT** | `RefusalInterceptor` & `MemoryReflector` (Criticize & Plan). |
| **Execution** | **Auto-Resume** | **OpenCode** | `executeCallWithSelfHealing` (Stale Element / Timeout retries). |

This ensures we cover both *Component-level* (DOM) and *Process-level* (Agent Loop) resilience.

## 5. Critical Analysis & Risk Mitigation

| Feature | Detailed Risk | Technical Mitigation |
| :--- | :--- | :--- |
| **Tab Isolation** | Electron might crash if too many tabs open. | Limit concurrent Tab Lanes to 3. Queue extra sub-agents. |
| **Memory Latency** | `memory_search` might be slow (1-2s). | Cache `ExecutionState` locally in `AgentRuntime` instance; only sync to specific MCP tools periodically. |
| **Tool Conflicts** | A sub-agent might try to use the *main* window tools. | Enforce `tabId` injection in `LaneManager`. If a sub-agent tries to call `take_screenshot` without arguments, FORCE inject its `tabId`. |

### Validation & Breaking Changes
*   **Locking**: `agent-runtime.ts` uses dynamic imports for locks (`await import('./resource-lock')`). This is efficient. We will keep this pattern but change the import to `await import('./execution-lanes')`.
*   **UI Regression**: The current agent appends `progressSummary` to the final message. **Requirement**: The new Memory-based approach MUST reconstruct a summary string from the `ExecutionState` entity and append it to the message, otherwise the user loses context in the chat UI.
*   **Backward Compatibility**: We will keep `resource-lock.ts` temporarily as a shim that redirects to `LaneManager` to prevent test breakages.
