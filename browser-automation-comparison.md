# Optimization Plan: Browser Automations

## Goal Description
The user experiences slow performance with the current MCP-based browser automation. This is likely due to the latency of multiple LLM roundtrips required for simple tasks and the IPC overhead of the MCP protocol. The goal is to implement strategies to significantly speed up browser interactions.

## User Review Required
> [!IMPORTANT]
> **Trade-off Decision**: We need to decide between keeping the strict MCP architectural purity vs. moving closer to "Direct Execution" for performance.

## Proposed Changes

### Strategy 1: "Turbo" Tools (Compound Actions)
Instead of granular tools like `check_element` -> `click_element`, we will implement compound tools that perform multiple actions in one go.
#### [MODIFY] src/renderer/src/lib/client-tools.ts
- Add `browser_action_sequence` tool: Accepts a list of actions (click, type, wait) to execute in a single roundtrip.

### Strategy 2: Optimistic Execution
Allow the agent to "queue" actions without waiting for intermediate confirmation if the confidence is high.
#### [MODIFY] src/renderer/src/lib/agent-runtime.ts
- Implement an "Action Queue" where the agent can emit multiple tool calls in one turn (already supported by OpenAI/Claude, needing verification for our runtime).

## Strategy Comparison

### Strategy 1: "Turbo" Tools (Compound Actions)
**Concept**: A single tool (`browser_action_sequence`) that accepts an array of steps (e.g., `[{ action: "type", selector: "#search", value: "Nike" }, { action: "click", selector: "#btn" }]`).

**Pros:**
- **Drastic Latency Reduction**: Eliminates N-1 network roundtrips between the Agent and LLM.
- **Atomic Execution**: If step 2 fails, the sequence halts immediately, preventing cascading errors.
- **Lower Token Cost**: Reduced context repetition compared to N separate messages.

**Cons:**
- **Planning Complexity**: Requires the LLM to perfect ly predict the UI state 3-4 steps ahead, which increases hallucination risk.
- **Less Reactive**: Cannot adapt to unexpected popups or state changes that happen *between* steps 1 and 2.

### Strategy 2: Optimistic Execution (Parallel Tool Calls)
**Concept**: The LLM emits multiple standard tool calls in a single response (e.g., `call_tool(type)`, `call_tool(click)`), and the runtime executes them mostly in order.

**Pros:**
- **Native Support**: Modern models (GPT-4, Claude 3.5) are already trained to emit parallel tool calls.
- **Simpler Schema**: No need to define complex custom schemas; uses existing atomic tools.

**Cons:**
- **Error Handling**: If the first tool fails, handling the subsequent "optimistically" generated calls is complex (need to cancel/rollback).
- **Runtime Complexity**: Requires significant changes to `AgentRuntime` to manage the execution queue and intermediate state updates.

### Recommendation
**Adopt Strategy 1 (Compound Tools)** for high-confidence, standard interactions (e.g., filling a form). It offers the best balance of speed and reliability without over-complicating the runtime architecture.

### Strategy 3: Direct Playwright Integration (Optional)
If MCP remains too slow, we can effectively "inline" the Playwright server into the main Electron process for zero-latency communication.
- *This is a larger architectural change and will be reserved as a fallback.*

## Verification Plan
### Automated Benchmarks
- Create a benchmark script that performs 10 clicks on a test page.
- Measure time taken via standard MCP vs Compound Tools.

### Manual Verification
- Ask user to run a standard "Google Search" task and qualitatively assess the speed.
