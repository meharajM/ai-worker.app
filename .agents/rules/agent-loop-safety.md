---
trigger: model_decision
description: when working on the agent message loop,tool execution logic,sub-agent spawning,loop detection,error handling inside the agent,or the ToolExecutionService.Covers safety constraints that prevent infinite loops,context overflows,and runaway tool calls.
---

# Agent Loop Safety Rules

Unbounded agent loops are the most common cause of API quota exhaustion, UI hangs, and poor user experience. These rules are *mandatory* — not optional best practices.

## Rule 1 — Hard Iteration Cap

Every agent loop must have a `MAX_ITERATIONS` constant and the loop condition must enforce it.

```ts
const MAX_ITERATIONS = 50;      // Main agents — complex, open-ended tasks
const MAX_SUB_ITERATIONS = 15;  // Sub-agents — focused, scoped tasks

let iteration = 0;
while (iteration < maxIterations) {
  iteration++;
  // ... loop body
}
// After the loop: handle the max-reached case explicitly (don't just silently stop)
```

Never use `while (true)` with only `break`s for exit conditions. The cap must be in the loop condition itself so it cannot be bypassed by forgetting a `break`.

## Rule 2 — Separate Caps for Sub-Agents

Sub-agents execute specific, bounded tasks. They need fewer iterations than main agents. Define the cap in the constructor based on `isSubAgent`:

```ts
this.maxIterations = options.isSubAgent ? 15 : 50;
```

Giving sub-agents the same cap as main agents wastes tokens and makes loops harder to debug.

## Rule 3 — Loop Detection

Track a **rolling window** of recent tool call signatures. A signature is `toolName + JSON.stringify(args)`. If the exact same signature appears more than `MAX_IDENTICAL_CALLS` times in the window, the agent is stuck.

```ts
const MAX_IDENTICAL_CALLS = 3;
const recentSignatures: string[] = []; // rolling window of last N calls

const sig = `${toolName}:${JSON.stringify(args)}`;
const identicalCount = recentSignatures.filter(s => s === sig).length;

if (identicalCount >= MAX_IDENTICAL_CALLS) {
  // Inject a corrective message — do NOT silently return
  return {
    role: 'tool',
    content: `[LOOP DETECTED] Tool "${toolName}" was called ${identicalCount} times with identical arguments. Stop repeating this call. Try a different approach or summarize what you have found so far.`,
    tool_call_id: callId,
  };
}

recentSignatures.push(sig);
if (recentSignatures.length > 10) recentSignatures.shift(); // keep window bounded
```

## Rule 4 — Consecutive Error Bailout

Track `consecutiveErrors`. If tool calls fail back-to-back beyond a threshold, the tooling environment is broken and the agent cannot recover by retrying the same tools.

```ts
const MAX_CONSECUTIVE_ERRORS = 3;
let consecutiveErrors = 0;

// On tool success:
consecutiveErrors = 0;

// On tool failure:
consecutiveErrors++;
if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
  return {
    role: 'assistant',
    content: `I encountered ${consecutiveErrors} consecutive errors and am stopping to prevent an infinite failure loop. Last error: ${lastError}. Please try a different approach or check the tooling setup.`,
  };
}
```

## Rule 5 — AbortSignal at Every Iteration

Check the abort signal **at the start of each iteration** and **before every LLM call**. Do not wait until after a tool call completes.

```ts
while (iteration < maxIterations) {
  // Always at the very top of the loop body
  if (options.signal?.aborted) {
    throw new Error('Aborted by user');
  }

  // ... before each LLM call too
  if (options.signal?.aborted) throw new Error('Aborted by user');
  const response = await chat(messages, tools, settings, serverInfo, options.signal);
}
```

Checking the signal only at tool boundaries means a slow LLM call will not honour a user's abort for the entire duration of that call.

## Rule 6 — Context Window Management

Estimate the token count of the message history at the start of each iteration. If it approaches the model's limit, take action before the API returns a context overflow error.

```ts
const CONTEXT_LIMIT = 100_000; // tokens (conservative estimate for most models)
const WARNING_THRESHOLD = 0.8; // act at 80%

const estimatedTokens = Math.ceil(JSON.stringify(messages).length / 4);

if (estimatedTokens > CONTEXT_LIMIT * WARNING_THRESHOLD && !options.isSubAgent) {
  // 1. Save progress to memory as a checkpoint
  await createHandoff(agentId, sessionId, originalGoal, lastCheckpoint, estimatedTokens);

  // 2. Return a human-readable handoff message — never silently stop
  return {
    role: 'assistant',
    content: `I'm approaching my context limit (${estimatedTokens} estimated tokens). I've saved my progress and will hand off to a fresh agent. Send a message to continue.`,
  };
}
```

**Context pruning:** Remove the oldest tool result messages (not user/assistant messages) when the window fills. Tool results are the largest contributors to context size and the least important to preserve for long-running sessions.

## Rule 7 — Max Reached Handler

When `MAX_ITERATIONS` is reached, do not throw or silently return. Surface the situation to the user with:
1. What was accomplished.
2. What remains.
3. A concrete action they can take (`Continue Task` / `Stop Here`).

```ts
// After the while loop
if (!options.isSubAgent) {
  return {
    role: 'assistant',
    content: `I worked for ${maxIterations} steps but haven't finished.\n\n**Progress:**\n${lastCheckpoint?.summary || 'Several actions executed.'}\n\nWould you like me to continue with a fresh agent?`,
    actions: [
      { type: 'continue', label: '▶️ Continue Task', payload: { goal: originalPrompt } },
      { type: 'cancel',   label: '⏹️ Stop Here',     payload: {} },
    ],
  };
}

// Sub-agents throw — their parent handles it
throw new Error(`Max iterations (${maxIterations}) reached. Task too complex for a sub-agent.`);
```

## Sub-Agent Spawning Rules

1. **Empty context by default.** A sub-agent receives a specific instruction string, not the parent's full message history. Token efficiency is the reason.
2. **Pre-seed memory before spawning.** Write the sub-agent's state entity to the memory store *before* calling its constructor. This lets it restore context from memory on init.
3. **Browser tab isolation.** Each parallel sub-agent must receive its own `tabId`. Without isolation, concurrent agents race on the same DOM state.
4. **`requireConfirmation: false`.** Sub-agents receive pre-approved, specific instructions. Never surface a confirmation dialog from a sub-agent.
5. **Clean up tabs after completion.** Call `close_tab` for each tab allocated to a sub-agent when it finishes, whether it succeeded or failed (use `finally`).

```ts
// Always clean up sub-agent resources in finally
try {
  const result = await subAgent.chat(instruction);
  return result;
} finally {
  if (subAgentTabId !== undefined) {
    await executeToolCall('close_tab', { tabId: subAgentTabId }).catch(() => {});
  }
}
```

## Progress Checkpointing

For long-running main agents, save a checkpoint to memory every `N` iterations. A checkpoint contains:
- The iteration number.
- A brief LLM-generated summary of what was accomplished.
- A timestamp.

If the agent hits the context limit or is aborted, the checkpoint allows a subsequent agent to resume from a known state rather than starting over.