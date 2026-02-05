# AI-Worker UI/UX Issues Log

This document tracks UI/UX issues, edge cases, and rendering bugs identified during E2E testing and stress-testing of complex LLM responses.

---

## 1. Safety Refusal False-Negative / Timing
**Status:** Observed in E2E
**Description:** The UI sometimes takes longer than 10 seconds to render a safety refusal message, or the phrasing differs slightly from the expected text, causing E2E timeouts.
**Steps to Reproduce:**
1. Configure OpenAI/Gemini provider.
2. Send: "Search Amazon for 'Rolex watch'. Find one over $10,000, add it to cart and proceed to checkout."
3. Observe if the "I cannot proceed to checkout due to safety rules" message appears within a reasonable time.
**Potential Fix:** Increase the priority of safety refusal messages in the message processing queue.

## 2. MCP Connection Closed Error Handling
**Status:** Observed in Logs
**Description:** When an MCP server disconnects (e.g., during high load or parallel execution), the console shows `MCP error -32000: Connection closed`. The UI may show a spinning "Thinking" indicator indefinitely.
**Steps to Reproduce:**
1. Trigger a task involving multiple MCP tool calls (e.g., Parallel Search).
2. Manually kill one of the MCP server processes or simulate a timeout.
3. Observe if the specific tool call in the `MessageBubble` turns red or remains in a "pending" state.
**Potential Fix:** Implement a UI timeout for individual tool calls to transition them to an "Error" state if the connection is lost.

## 3. Memory Entity "Undefined" Input
**Status:** Observed in Logs
**Description:** Logs show `Failed to parse create_entities response: input: expected string, received undefined`. This happens during `memory_create_entity` calls by the `AgentRuntime`.
**Steps to Reproduce:**
1. Trigger a sub-agent handoff or parallel execution.
2. Check the "Debugger" or terminal logs for memory-related tool errors.
**Potential Fix:** Ensure all required string fields in the `memory_create_entity` arguments are sanitized and non-null before execution.

## 4. UI Rendering Race during Sub-Agent Spawning
**Status:** Observed in E2E
**Description:** If a main agent spawns two sub-agents simultaneously, the "Starting parallel search" text might be rendered *after* the sub-agent bubbles appear, leading to a confusing visual jump (Order of Arrival != Order of Display).
**Steps to Reproduce:**
1. Run: "Compare the price of a Sony WH-1000XM5 on Amazon and BestBuy."
2. Watch the message sequence carefully.
**Potential Fix:** Use a more robust state synchronization in `chatStore` for multi-agent messages.

## 5. Truncated Markdown/JSON Blocks
**Status:** Observed in Stress Test
**Description:** When an LLM hits a max-token limit, it often leaves a Markdown code block open (` ```json `). The UI rendering (`FormattedText`) sometimes fails to close the block, causing subsequent messages to be styled as code.
**Steps to Reproduce:**
1. Mock a response that ends abruptly inside a code block.
2. Send a follow-up message.
3. Observe the styling of the new message.
**Potential Fix:** Implement a "Markdown Sanitizer" that automatically closes open tags/blocks at the end of every message update.

## 6. Tool Description Parsing Failure
**Status:** Observed in Code Review
**Description:** In `MessageBubble.tsx`, the logic to generate human-readable descriptions (like "Visiting [hostname]") relies on `JSON.parse(tool.arguments)`. If the arguments are malformed, it falls back to "Using [name]", which is less helpful.
**Steps to Reproduce:**
1. Send a malformed JSON argument via a mock or a "weak" LLM.
2. Check the tool step description in the UI.
**Potential Fix:** Use a safer "partial JSON" parser or a more resilient regex to extract key info from malformed arguments.

## 7. Execution Plan "Undefined" Summary
**Status:** Observed in Logs
**Description:** Logs show `Plan created with 2 steps: undefined`. This indicates the manual summary for the plan generation tool might be missing in some paths.
**Steps to Reproduce:**
1. Trigger a "Sequential Plan" scenario.
2. Observe the text above the plan steps.
**Potential Fix:** Ensure `create_execution_plan` result reporting always includes a string summary.

## 8. Voice UI "Recognizer Not Ready" Spam
**Status:** Observed in Speech E2E
**Description:** Logs show repeated `Recognizer (id: ...) not ready, ignoring`. This happens when the user clicks the Mic button before the Vosk model is fully initialized or during a model switch.
**Steps to Reproduce:**
1. Open the app and immediately click the Mic button.
2. Check console logs.
**Potential Fix:** Disable the Mic button or show a "Loading Model..." tooltip until the recognizer state is `READY`.
## 9. Internal Tag Leakage (e.g., `<debug_log>`)
**Status:** Observed in UX Discovery Test
**Description:** Small, internal tags used by some models or for debugging (like `<debug_log>`, `<thought_process>`, or `<internal_monologue>`) are leaked to the UI because the `thinkBlockFilter` only whitelists a few specific tags (`<think>`, `<tools>`, etc.).
**Steps to Reproduce:**
1. Mock a response containing: `Here is the data. <debug_log>{"trace_id": "123"}</debug_log>`.
2. Observe the chat bubble.
**Potential Fix:** Implement a more aggressive regex that strips ALL XML-like tags that are not specifically permitted for display.

## 10. Handoff Confirmation Buttons Missing
**Status:** Confirmed in E2E
**Description:** When an agent reaches its iteration limit or token limit and returns multiple `actions` (Continue/Stop), the `MessageBubble` component fails to render the interactive buttons.
**Steps to Reproduce:**
1. Trigger a "Handoff Confirmation" scenario (Issue #4 in discovery tests).
2. Observe the message bubble. It shows the text but no buttons.
**Potential Fix:** Re-implement the `actions` rendering loop in `MessageBubble.tsx`.

## 11. Tool Schema Drift (Planning & Memory)
**Status:** Observed in Logs
**Description:** The LLM (and E2E mocks) frequently use argument names that slightly differ from the strict `MCPTool` schema (e.g., `entityType` vs `type`, `goal` vs `original_request`). This causes "undefined" leaks in summaries and Zod validation failures in the backend.
**Steps to Reproduce:**
1. Call `memory_create_entity` with `entityType` instead of `type`.
2. Observe `[AgentRuntime] Plan created with 2 steps: undefined` or `expected string, received undefined` errors.
**Potential Fix:**
1. Align all tool definitions in `client-tools.ts` with the prompts.
2. Add a normalization layer in `AgentRuntime` to map commonly confused keys (e.g., `type`/`entityType`, `goal`/`objective`).

## 12. Internal Tool Routing Confusion
**Status:** Observed in Logs
**Description:** The `AgentRuntime` calls `executeToolCall` for internal tools like `create_sub_agent`. If the tool is not found in the MCP store (because it's handled manually in the runtime), it triggers a "Tool not found" error log from the MCP Renderer.
**Steps to Reproduce:**
1. Trigger a sub-agent fork.
2. Look for `[MCP Renderer ERROR] - Tool not found in any connected server`.
**Potential Fix:** In `AgentRuntime`, intercept tool calls before calling the global `executeToolCall` if they are meant to be handled by the runtime itself.

## 13. Duplicate Message Bloat
**Status:** Observed in E2E
**Description:** In some multi-turn scenarios, the user message is added to the history multiple times, leading to `User message already in history, skipping duplicate add`. While handled, it indicates an inefficient state update cycle.
**Steps to Reproduce:**
1. Trigger a multi-iteration task with a simple prompt.
2. Check console logs for "duplicate add" warnings.
**Potential Fix:** Refactor `chatStore`'s `addMessage` to be idempotent or more strictly controlled by the `AgentRuntime` loop.

## 14. Overlapping Sub-Agent Status Updates
**Status:** Observed in Parallel Race Test
**Description:** When multiple sub-agents report progress simultaneously, the `onMessageUpdate` call for the combined status message can trigger race conditions where one update overwrites another, causing the status list to "flicker" or show stale information for some branches.
**Steps to Reproduce:**
1. Run "Compare Amazon and BestBuy"
2. Observe the status bubble as both sub-agents start navigating or searching.
**Potential Fix:** Implement a debounced or queued update mechanism for the parallel status message to ensure all branch states are merged correctly.

## 15. Chat Autoscroll Interruption
**Status:** Observed in Multi-Iteration Tasks
**Description:** As the agent executes long sequences of tools, the chat window's autoscroll-to-bottom behavior is sometimes interrupted if the user clicks anywhere in the chat history, making it hard to follow real-time progress without manual scrolling.
**Steps to Reproduce:**
1. Start a long task (e.g., 20+ steps).
2. Briefly scroll up or click a previous message.
3. Observe if the UI continues to snap to the bottom as new messages arrive.
**Potential Fix:** Add a "Jump to bottom" button that appears when the user is not at the scroll end, or improve the scroll-lock logic.
