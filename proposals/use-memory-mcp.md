# Proposal: Persistent Context with `server-memory` MCP

## 1. Problem Statement
Currently, the AI Worker agent operates with "ephemeral context." 
- **Session Amnesia**: If the user restarts the app, all context is lost.
- **Drift**: Keep-alive prompts (like `activeGoal`) help within a session, but complex relationship data (e.g., "User prefers TypeScript", "Project X uses Port 3000") is hard to maintain via simple text appending.

## 2. Proposed Solution
Integrate the official **`@modelcontextprotocol/server-memory`** (Memory Graph). 
This persistent knowledge graph allows the agent to store entities, relationships, and observations that survive session restarts.

### 2.1 Architecture
- **Server**: Run local instance of `memory` MCP server.
- **Storage**: JSON-based graph file stored in `app.getPath('userData')`.
- **Tools Exposed**:
  - `create_entities`: Save new breakdown of concepts.
  - `create_relations`: Link concepts (e.g., `User` -> `prefers` -> `Dark Mode`).
  - `add_observations`: Log timestamped events.
  - `read_graph`: Retrieve context.
  - `search_nodes`: Find specific persistent memories.

## 3. Implementation Steps

### Step 1: Add Server to `mcpStore.ts`
Modify the `DEFAULT_MCP_SERVERS` list to include the memory server.

```typescript
{
  name: 'memory',
  description: 'Knowledge Graph for persistent memory across sessions.',
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
  env: {
    // Optional: Define custom path if needed, default allows it to manage its own file
  },
  autoConnect: true
}
```

### Step 2: System Prompt Updates (`llm.ts` / `prompt-library.ts`)
We must instruct the LLM *when* to use memory. It shouldn't read the whole graph every turn (expensive).

**New Prompt Rules:**
> "Unsure about user preferences? Use `search_nodes` to check memory first."
> "User updates a major preference? Use `create_relations` to store it for later."

### Step 3: "Wake-Up" Context Injection
On app startup (or session start), we can programmatically call `read_graph` (filtered for high-level nodes) and inject a summary into the very first system message.

**Wake-Up Sequence:**
1. Agent starts.
2. System calls `memory.read_graph` (silent).
3. System injects: *"Recall: User is working on Project AI-Worker. User prefers concise code."*
4. Agent is ready.

## 4. Specific Use Case: Defeating "Task Drift"
This is the advanced version of the `activeGoal` text-maintenance we implemented in the codebase.

### The Problem
In long tasks (e.g., "Scrape 100 pages"), the message history gets pruned. The agent "forgets" the original instruction. We currently patch this by pinning a text string `[activeGoal]` to the system prompt.
*   **Limitation**: Text strings lack structure. If the user changes requirements 5 times, the string becomes a messy log: `"Scrape X... actually Y... waiting only Z... ignore A"`.
*   **Risk**: The agent might follow an obsolete instruction buried in that string.

### The Memory Solution: "Goal Nodes"
With `server-memory`, we treat the Task as a mutable Entity in the graph.

**Workflow:**
1.  **Start**: Agent creates a generic capability or task node.
    *   `create_entities([{ name: "CurrentTask", kind: "Goal", observation: "Scrape 100 pages from example.com" }])`
2.  **Refinement**: User says "Actually, only scrape PDF files."
    *   Agent *updates* the node instead of just appending text.
    *   `add_observations({ entityNames: ["CurrentTask"], observation: "Constraint added: Only PDF files" })`
    *   *Better yet*: It can create a relation `CurrentTask -> requires -> PDF_Only`.
3.  **Context Retrieval**:
    *   On every turn, the agent can call `read_graph({ entityNames: ["CurrentTask"] })`.
    *   It receives a **consolidated view** of the goal and all current constraints.
4.  **Completion**:
    *   Agent deletes the `CurrentTask` node or marks it `status: done`, keeping the graph clean for the next task.

**Why this is better**:
*   **Structured**: Constraints ("PDF only") are distinct from the Goal ("Scrape").
*   **Mutable**: Obsolete requirements can be relationships that are *removed*, keeping current context clean.
*   **Pruning-Proof**: The graph exists outside the context window. Even if the conversation history is wiped 100%, the `CurrentTask` node persists.

## 5. Benefits vs. Costs

| Feature | `activeGoal` (Current) | `server-memory` (Proposed) |
|:---|:---|:---|
| **Persistence** | Session-only | **Permanent** (File-based) |
| **Structure** | Unstructured Text Log | Structured Graph (Entities/Relations) |
| **Complexity** | Low | Medium (Requires tool calls) |
| **Latency** | Zero | Low (Tool call needed to read) |
| **Drift Prevention** | Good for linear tasks | **Superior** for complex, evolving tasks |

## 6. Migration Strategy
1. Add `memory` to default servers (opt-in).
2. Test if the agent naturally uses it (Models like Claude 3.5 Sonnet are good at this).
3. If successful, make it a core part of the "Recall" feature in `AgentRuntime`.

