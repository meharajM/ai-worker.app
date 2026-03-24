---
trigger: model_decision
description: Load when working on MCP integration, executeToolCall, tool schema definitions, tool result handling, or self-healing retry logic for tool calls.
---

# MCP & Tool Integration Rules

## Single Execution Abstraction

**All tool calls must go through `executeToolCall(name, args)`** — the single choke point for all MCP interactions.

This function is the only place that:
- Routes the call to the correct MCP server.
- Applies execution lanes and concurrency limits (`LaneManager`).
- Handles timeouts (`LaneTimeoutError`).
- Formats the raw result for the agent.

Never bypass it by calling MCP transport methods directly from agent or service code:

```ts
// ✅ CORRECT — goes through the abstraction
const result = await executeToolCall('navigate', { url: 'https://example.com' });

// ❌ BAD — bypasses lanes, timeouts, retries, and formatting
const result = await mcpServer.callTool('navigate', { url: '...' });
```

## Tool Result Truncation — Mandatory

Raw tool outputs can be enormous (full page HTML, directory listings, file contents). LLM context windows are finite. Before appending any tool result to the message history:

1. Truncate to a safe character limit.
2. Append a marker so the agent knows content was cut.

```ts
// Recommended limits (adjust based on model context window)
const TRUNCATION_LIMITS: Record<string, number> = {
  browser:     15_000, // page snapshots, HTML
  file:         8_000, // file reads
  search:       5_000, // search result summaries
  default:     10_000,
};

function truncateToolOutput(toolName: string, output: string): string {
  const limit = getLimit(toolName);
  if (output.length <= limit) return output;
  return output.slice(0, limit) + `\n\n[...output truncated at ${limit} chars. Use a more specific query to get targeted results.]`;
}
```

Always apply truncation before `messages.push({ role: 'tool', content: truncated, tool_call_id })`.

## Self-Healing Retry Pattern

When a tool call fails with a recognizable, correctable error, inject a corrective message and allow the LLM **one retry** before surfacing the error.

```ts
async function executeWithSelfHealing(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResult> {
  try {
    return await executeToolCall(name, args);
  } catch (err: any) {
    const corrective = buildCorrectiveHint(name, args, err);
    if (!corrective) throw err; // unrecognized error — propagate immediately

    // Inject hint: the agent will see this as tool feedback and may retry differently
    throw new SelfHealingError(corrective, err);
  }
}
```

Self-healing is appropriate for:
- Wrong argument types (e.g., `tabId` passed as a string instead of a number).
- Missing required fields (e.g., `url` missing from a navigate call).
- Deprecated tool names (hint the new name).

Self-healing is **not** appropriate for:
- Network errors (retry at the transport layer is separate).
- Authentication errors (surface immediately — retrying won't help).
- Tool not found (surface immediately).

**Never loop self-healing.** One attempt, then propagate.

## Tool Schemas — Single Source in `shared/`

Tool input schemas (used both by MCP server registration in the main process and by the LLM `tools` parameter in the renderer) must be defined **once** in `src/shared/`.

```
src/shared/
└── tool-schemas.ts   ← canonical schema definitions

src/main/services/PlaywrightService.ts  → imports from shared/tool-schemas.ts
src/renderer/src/lib/client-tools.ts   → imports from shared/tool-schemas.ts
```

Duplicating schemas means they will diverge. A schema mismatch between what the MCP server registers and what the LLM is told it can call produces silent tool call failures.

## Parallel Tool Execution

When the LLM returns multiple tool calls in a single response, execute them **in parallel** with `Promise.all()`. Sequential execution unnecessarily serializes work that can happen concurrently (e.g., reading two different files, or calling two different APIs).

```ts
// ✅ CORRECT — parallel execution
const toolResults = await Promise.all(
  response.toolCalls.map(async (call) => {
    if (signal?.aborted) return null;
    const result = await executeWithSelfHealing(call.name, call.arguments, signal);
    return { call_id: call.id, result };
  })
);

// ❌ BAD — sequential execution unnecessarily serializes independent calls
for (const call of response.toolCalls) {
  const result = await executeWithSelfHealing(call.name, call.arguments);
  results.push(result);
}
```

**Exception:** Tool calls that have a declared data dependency must be sequential. The LLM should ideally not produce such calls in a single response, but if it does, check for dependencies before parallelizing.

## Execution Lanes — Browser Tools Require Serialization

Browser tools (`navigate`, `click`, `type`, `screenshot`, etc.) must be serialized through a lane queue to prevent race conditions on the active page. File tools and stateless API tools may run in parallel.

```ts
// Use the LaneManager to route to the correct lane and apply the correct timeout
const lane = laneManager.getLane(toolName, { tabId });
const timeout = laneManager.getTimeoutForTool(toolName);

const result = await lane.run(
  () => executeToolCall(toolName, args),
  timeout,
  signal
);
```

Never call browser tools outside of a lane. Without serialization, two concurrent agents (or two tool calls in the same batch) will interfere with each other's DOM state.

## `tabId` — Scope Browser Tool Calls

When a browser tool call is being dispatched for a specific agent instance (especially a sub-agent), always pass the `tabId` as part of the args or context. This ensures the tool operates on the correct tab, not the globally active one.

```ts
// If this agent has a dedicated tab, inject it into every browser tool call
if (options.tabId !== undefined && isBrowserTool(call.name)) {
  (call.arguments as any).tabId = options.tabId;
}
```