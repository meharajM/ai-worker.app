# Role: Expert AI Architect & Systems Engineer
**Objective:** Refactor the existing "AI-Worker" Electron application from a linear execution model into a **Recursive Multi-Agent System** using **Electron Utility Process**.

**Core Philosophy:** 
Implement a "Dual-Rail" strategy. Build the new "Agentic Mode" alongside the "Legacy Mode" without deleting existing code (`executor.ts`), ensuring the app remains functional at all times.

---

## 1. Architecture Overview: The "Local-First Brain"

We are separating concerns using Electron's native multi-process model:

*   **Electron Main (The Coordinator):** Handles native OS permissions, hosts MCP servers, manages IPC, and spawns the Agent utility process.
*   **Utility Process (The Brain):** A Node.js subprocess using `utilityProcess` API. Handles Recursive ReAct loops and Agent logic with full IPC access to Main.
*   **React Renderer (The Senses):** Keeps WebLLM for privacy-first planning, streams real-time agent "thoughts" via MessagePort, and handles user approvals.

```
┌──────────────────────────────────────────────────────────────┐
│                     Electron Main Process                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │
│  │ IPC Router  │  │ MCP Handler │  │ Utility Spawner      │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬───────────┘  │
└─────────┼────────────────┼────────────────────┼──────────────┘
          │                │      MessagePort   │
          │                │    ┌───────────────┘
          ▼                ▼    ▼
┌─────────────────┐  ┌─────────────────────────────────────────┐
│ React Renderer  │  │          Utility Process (Agent)        │
│  ┌───────────┐  │  │  ┌─────────────┐  ┌──────────────────┐  │
│  │ WebLLM    │  │  │  │ ReAct Loop  │  │ Session Manager  │  │
│  │ (Planning)│  │  │  └──────┬──────┘  └────────┬─────────┘  │
│  └───────────┘  │  │         │                   │            │
│  ┌───────────┐  │  │  ┌──────▼───────────────────▼─────────┐ │
│  │ Zustand   │◄─┼──┼──│        AgentCore (ReAct)           │ │
│  │ Store     │  │  │  └────────────────────────────────────┘ │
│  └───────────┘  │  └─────────────────────────────────────────┘
└─────────────────┘
```

---

## 2. Technical Specification & Implementation Plan

### Phase 1: Utility Process Infrastructure

**Files:** `src/main/agent/index.ts`, `src/main/agent/spawner.ts`

1. **Setup:** Create `src/main/agent/` directory for utility process code.
2. **Spawner Module:** Use Electron's `utilityProcess.fork()` to launch the agent.
   ```typescript
   import { utilityProcess, MessageChannelMain } from 'electron';
   
   const agent = utilityProcess.fork(path.join(__dirname, 'agent/index.js'));
   const { port1, port2 } = new MessageChannelMain();
   agent.postMessage({ type: 'INIT', port: port1 }, [port1]);
   ```
3. **State Management:** Create a `SessionManager` that holds a `Map<sessionId, AgentInstance>`. This allows multiple concurrent agent trees.
4. **Tool Sync:** On startup, Main process sends available MCP tools to the agent via MessagePort.

### Phase 2: Agent-to-Main MCP Bridge

**Files:** `src/main/ipc/mcp-bridge.ts`

1. **MessagePort Protocol:** Agent requests tool execution via structured messages:
   ```typescript
   { type: 'CALL_TOOL', serverId: string, toolName: string, args: object, requestId: string }
   ```
2. **Permission Layer (Approval Loop):**
   - **Safe Tools:** (`read_file`, `search`) → Executed immediately by Main.
   - **Sensitive Tools:** (`write_file`, `bash`) → Main emits `PENDING_APPROVAL` to Renderer.
   - **UI Logic:** User clicks "Approve" → Main executes → Result sent to Agent.
3. **Backup Strategy:** Before any `fs_write` or `bash` execution, create a `.backup` file (not git commit to avoid polluting history).

### Phase 3: The Recursive "ReAct" Core

**File:** `src/main/agent/AgentCore.ts`

Implement an `AgentCore` class with the following logic:

1. **The Loop:** `While (task != done): Reason → Select Tool → Execute → Observe → Repeat`.
2. **Recursion (The `delegate` tool):**
   - Register a system tool: `delegate_task(task: string, specialist_type: string)`.
   - When called, spawn a new `AgentInstance` (Sub-agent) with a specific persona and subset of tools.
   - Sub-agent runs its own loop. Its final result becomes the "Tool Output" for the Parent Agent.
   - **Constraint:** Hard limit recursion depth to 3 to prevent infinite loops.
3. **Dynamic Context Pruning (DCP):**
   - Monitor tool outputs (e.g., `fs_read`).
   - If output > 4000 characters, **truncate** and provide summary: *"[Output truncated: 5000 chars. Use grep for specific content.]"*
   - **Context Rotation:** Summarize tool outputs older than 3 turns to keep context fresh.

### Phase 4: Renderer Integration

**File:** `src/renderer/src/lib/agentBridge.ts`, `src/renderer/src/stores/chatStore.ts`

1. **MessagePort Listener:** Create a bridge that receives agent events in renderer:
   ```typescript
   window.electron.agent.onMessage((event) => {
       switch(event.type) {
           case 'AGENT_THOUGHT': updateMessage(event.content); break;
           case 'TOOL_START': setToolStatus(event.tool); break;
           case 'AGENT_DELEGATE': addSubAgentUI(event.subAgent); break;
       }
   });
   ```
2. **Zustand Adapter:** Map MessagePort events to Zustand state updates (keeps existing UI components unchanged).
3. **Feature Flag:** Add toggle in Settings: "Use Agentic Mode". If false, use existing `legacyExecutor.ts`.

### Phase 5: Hybrid Planning Strategy

**File:** `src/renderer/src/lib/orchestrator.ts` (update existing)

1. **Keep WebLLM in Renderer:** Privacy-first planning stays browser-local.
2. **Delegate Execution:** After user approval, send plan to Agent utility process for execution.
3. **Fallback Chain:** WebLLM → Ollama → Cloud (maintains current priority).

---

## 3. Implementation Order (Step-by-Step)

1. **Preparation:** 
   - [ ] Rename `executor.ts` → `legacyExecutor.ts`
   - [ ] Add feature flag `AGENTIC_MODE_ENABLED` in constants.ts
   
2. **Scaffolding:**
   - [ ] Create `src/main/agent/` directory
   - [ ] Implement basic utility process spawn/kill lifecycle
   - [ ] Verify MessagePort communication in console
   
3. **MCP Bridge:**
   - [ ] Create `mcp-bridge.ts` to route tool calls from Agent to Main
   - [ ] Implement approval flow for sensitive tools
   
4. **ReAct Loop:**
   - [ ] Implement `AgentCore.ts` with basic loop (no delegation yet)
   - [ ] Add context pruning logic
   
5. **Delegation:**
   - [ ] Implement `SessionManager` with sub-agent spawning
   - [ ] Add recursion depth limiting
   
6. **UI Integration:**
   - [ ] Create `agentBridge.ts` in renderer
   - [ ] Update `chatStore.ts` with agent event handlers
   - [ ] Add sub-agent visualization in ChatView

---

## 4. Industry-Standard Agentic Features

### Phase 6: Parity with OpenAI Agents SDK / LangGraph

**Goal:** Ensure feature parity with leading multi-agent frameworks.

#### 6.1 Agent Handoff Protocol (OpenAI Agents SDK Pattern)

**File:** `src/main/agent/AgentCore.ts`

In addition to `delegate_task` (parallel sub-agent), implement `handoff_to` (transfer control):

```typescript
// Delegate: Parent waits for sub-agent result, then continues
type DelegateTask = {
    type: 'delegate';
    task: string;
    specialist: string;
    returnToParent: true;  // Result flows back
};

// Handoff: Parent terminates, control transfers entirely
type HandoffTo = {
    type: 'handoff';
    task: string;
    targetAgent: string;
    returnToParent: false;  // No return, target agent takes over
};
```

**Use Cases:**
- `delegate_task` → "Research this topic and give me a summary" (parent continues after)
- `handoff_to` → "This is a coding task, I'm transferring you to the Coder agent" (parent exits)

#### 6.2 Streaming Tool Outputs

**File:** `src/main/ipc/mcp-bridge.ts`

Add progress streaming for long-running tools:

```typescript
interface ToolCallWithStream {
    serverId: string;
    toolName: string;
    args: object;
    requestId: string;
    stream?: boolean;  // Enable streaming
}

// Main process sends incremental updates
parentPort.postMessage({
    type: 'TOOL_PROGRESS',
    requestId: '...',
    chunk: 'Downloading file... 50%',
});
```

**Benefits:**
- User sees real-time progress for `bash`, `download`, `git clone`
- Agent can react to partial results (early termination)

#### 6.3 Trace IDs for Observability

**File:** `src/main/agent/tracing.ts`

Implement distributed tracing for debugging nested agent chains:

```typescript
interface TraceContext {
    traceId: string;      // Unique per user request
    spanId: string;       // Unique per agent action
    parentSpanId: string | null;
    depth: number;
    startTime: number;
}

// Every agent action gets a trace context
function createSpan(parent: TraceContext, action: string): TraceContext {
    return {
        traceId: parent.traceId,
        spanId: `span_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        parentSpanId: parent.spanId,
        depth: parent.depth + 1,
        startTime: Date.now(),
    };
}
```

**Integration with existing logs:**
```typescript
// In logs.ts IPC handler, include trace context
{ timestamp, level, message, traceId, spanId, parentSpanId, duration }
```

#### 6.4 Guardrails & Output Validation

**File:** `src/main/agent/guardrails.ts`

Add safety layer before returning responses to user:

```typescript
interface GuardrailConfig {
    maxOutputLength: number;      // Prevent token explosion
    blockedPatterns: RegExp[];    // PII, secrets detection
    requireStructuredOutput: boolean;
    outputSchema?: object;        // JSON schema validation
}

async function validateOutput(output: string, config: GuardrailConfig): Promise<{
    valid: boolean;
    sanitized: string;
    warnings: string[];
}> {
    const warnings: string[] = [];
    let sanitized = output;
    
    // Length check
    if (output.length > config.maxOutputLength) {
        sanitized = output.slice(0, config.maxOutputLength) + '\n[Output truncated]';
        warnings.push('Output exceeded max length');
    }
    
    // Pattern blocking (PII, API keys, etc.)
    for (const pattern of config.blockedPatterns) {
        if (pattern.test(sanitized)) {
            sanitized = sanitized.replace(pattern, '[REDACTED]');
            warnings.push('Sensitive content redacted');
        }
    }
    
    return { valid: warnings.length === 0, sanitized, warnings };
}
```

#### 6.5 Structured Output Enforcement

Ensure agent responses follow defined schemas:

```typescript
const AGENT_RESPONSE_SCHEMA = {
    type: 'object',
    required: ['action'],
    properties: {
        action: { enum: ['tool_call', 'delegate', 'handoff', 'respond', 'done'] },
        tool: { type: 'string' },
        args: { type: 'object' },
        message: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
};
```

---

## 5. Industry Framework Comparison

| Feature | OpenAI Agents SDK | LangGraph | AutoGen | This Plan |
|---------|-------------------|-----------|---------|-----------|
| **ReAct Loop** | ✅ | ✅ | ✅ | ✅ |
| **Tool Calling** | ✅ function_call | ✅ Tool nodes | ✅ | ✅ MCP |
| **Delegation (parallel)** | ✅ | ✅ | ✅ GroupChat | ✅ `delegate_task` |
| **Handoff (transfer)** | ✅ Agent transfer | ✅ | ✅ | ✅ `handoff_to` |
| **Streaming Tools** | ✅ | ✅ | Partial | ✅ TOOL_PROGRESS |
| **Context Pruning** | ✅ Truncation | ✅ Reducers | ✅ | ✅ DCP |
| **Human Approval** | ✅ | ✅ Interrupt | ✅ | ✅ Sensitive tools |
| **Structured Output** | ✅ JSON mode | ✅ | ✅ | ✅ Schema validation |
| **Guardrails** | ✅ | ✅ | ✅ | ✅ Output filters |
| **Trace IDs** | ✅ | ✅ LangSmith | Partial | ✅ Distributed tracing |
| **Local-First Privacy** | ❌ Cloud only | ❌ | ❌ | ✅ WebLLM + Ollama |

---

## 6. Constraint Checklist

- [ ] Do not delete `executor.ts` (Rename to `legacyExecutor.ts`)
- [ ] Keep WebLLM in renderer for privacy-first planning
- [ ] API keys remain in Main process (electron-store) with secure IPC
- [ ] Verify "Stop" button kills the specific agent session
- [ ] Handle utility process crashes gracefully (restart or fallback)
- [ ] Ensure feature flag allows easy rollback to legacy mode

---

## 5. Advantages Over Bun Sidecar

| Aspect | Bun Sidecar | Electron Utility Process |
|--------|-------------|-------------------------|
| **Bundling** | Complex (bundle Bun per-platform) | Native (included with Electron) |
| **IPC Access** | Needs HTTP bridge | Native MessagePort |
| **MCP Integration** | Manual HTTP proxy | Direct IPC to Main handlers |
| **Cross-platform** | Bun binaries per arch | Works everywhere Electron does |
| **Memory** | Additional runtime | Shares Electron's V8 |
| **Debugging** | Separate process/logs | Electron DevTools integration |

---

**Primary Goal:** Create a system where complex coding tasks spawn a Primary Agent that can delegate to Sub-Agents, all managed by the high-performance Electron utility process, while preserving privacy-first local planning via WebLLM.