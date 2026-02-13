# Self-Healing & Robustness Issues

This document tracks all identified issues in the agent self-healing and execution robustness systems. Each issue is independently fixable and prioritized by severity.

**Last Updated:** 2026-02-12  
**Status:** 16 Total Issues (3 Critical, 3 High, 10 Medium/Low)

---

## 🔥 CRITICAL PRIORITY

### ISSUE #1: No Timeout on Lane Execution

**Severity:** CRITICAL  
**Impact:** Hung operation blocks entire queue indefinitely  
**File:** `src/renderer/src/lib/execution-lanes.ts:23-43`

#### Problem Description
The `LaneQueue.run()` method has no timeout protection. If a single task hangs (e.g., browser navigation to unresponsive site, frozen page), it blocks all subsequent operations in that lane forever.

#### Failure Scenario
1. Agent calls navigate("https://slow-site.com") → enters BROWSER_SERIAL lane
2. Navigation hangs indefinitely (network issue, infinite redirect, frozen page)
3. Lane activeCount = 1, concurrency = 1 → blocks all subsequent browser tools
4. Agent tries screenshot() → queued forever
5. Agent tries click() → queued forever
6. Entire agent frozen, waiting for hung navigation

#### Expected Behavior
- Default timeout: 60 seconds per operation
- Configurable timeout per tool type (navigation: 120s, click: 30s, etc.)
- Timeout error bubbles up to self-healing wrapper
- Queue processes next task after timeout

#### Implementation Approach
Use Promise.race pattern with timeout promise. Add timeout parameter to `run()` method, race the task against a timeout promise, and clean up timeout on completion.

#### Implementation Steps
1. Add `timeout` parameter to `LaneQueue.run()` method
2. Implement Promise.race pattern with timeout
3. Update `LaneManager.getLane()` to pass tool-specific timeouts
4. Add timeout configuration constants (BROWSER_TIMEOUT, FILE_TIMEOUT, etc.)
5. Test with deliberately slow operations

#### Test Cases
- [ ] Navigate to slow site → times out after 60s
- [ ] Click on frozen page → times out after 30s
- [ ] File read of large file → completes within timeout
- [ ] Subsequent operations in queue execute after timeout

---

### ISSUE #2: Abort Signal Not Propagated to Async Operations

**Severity:** CRITICAL  
**Impact:** User "Stop" doesn't cancel in-flight operations, causing delays  
**Files:** `src/renderer/src/lib/agent-runtime.ts` (multiple locations)

#### Problem Description
The abort signal is checked at specific points in the agent loop but not passed to underlying async operations (LLM calls, tool calls, lane execution). When a user clicks "Stop", operations already in progress continue to completion before the abort is detected.

#### Failure Scenario
- 0s: User requests task
- 1s: Agent starts LLM call
- 5s: User clicks "Stop" → abort signal set
- 6s: Agent checks signal (Line 415) → not aborted yet, continues
- 7s: LLM call started (Line 533) → takes 30 seconds
- 37s: LLM returns
- 38s: Agent checks signal (Line 527) → NOW detects abort
- Result: 33 seconds delay after user clicked "Stop"

#### Expected Behavior
- Abort signal passed to all async operations
- LLM provider cancels request when signal aborted
- Tool execution checks signal before/during execution
- Lane operations cancel when signal aborted
- Max 1-2 second delay from user click to full stop

#### Implementation Approach
Add `signal?: AbortSignal` parameter to LaneQueue.run(), add abort event listener in lane execution, pass signal from agent-runtime to lane.run(), add signal checks in all retry loops.

#### Implementation Steps
1. Add `signal?: AbortSignal` parameter to `LaneQueue.run()`
2. Add abort event listener in lane execution
3. Pass signal from agent-runtime to lane.run()
4. Add signal checks in all retry loops (before and after waits)
5. Add signal checks before expensive operations

#### Test Cases
- [ ] User clicks "Stop" during LLM call → cancels within 2s
- [ ] User clicks "Stop" during navigation → cancels within 2s
- [ ] User clicks "Stop" during retry wait → cancels immediately
- [ ] Queued operations are skipped when aborted

---

### ISSUE #3: Cumulative Retry Timeout Not Enforced

**Severity:** HIGH  
**Impact:** Retries can run far longer than intended  
**File:** `src/renderer/src/lib/agent-runtime.ts:992-1084`

#### Problem Description
The self-healing wrapper retries operations up to 2 times with delays, but there's no cumulative timeout. A single tool call with lane timeout of 60s can actually take 180s+ with retries (60s + 2s + 60s + 2s + 60s = 184s).

#### Failure Scenario
- 0s: Attempt 1 starts
- 60s: Attempt 1 times out (lane timeout)
- 62s: Wait 2 seconds
- 64s: Attempt 2 starts
- 124s: Attempt 2 times out
- 126s: Wait 2 seconds
- 128s: Attempt 3 starts
- 188s: Attempt 3 times out
- Total: 188 seconds (3 minutes!) for a single tool call

#### Expected Behavior
- Max total time: 120 seconds across all retry attempts
- If cumulative time exceeded, fail immediately
- Adjust individual timeouts to fit within cumulative limit

#### Implementation Approach
Add `startTime` parameter to track when first attempt started, calculate elapsed time before each retry, adjust timeout based on remaining time, fail fast if insufficient time remaining.

#### Implementation Steps
1. Add `startTime` parameter to `executeCallWithSelfHealing`
2. Calculate elapsed time at start of each attempt
3. Check cumulative timeout before retry
4. Adjust lane timeout based on remaining time
5. Log cumulative timeout warnings
6. Update all retry strategy calls to pass `startTime`

#### Test Cases
- [ ] Operation fails 3 times → total time ≤ 120s
- [ ] Remaining time < 5s → fails without retry
- [ ] Successful retry within time limit → completes
- [ ] Cumulative timeout logged correctly

---

## ⚠️ HIGH PRIORITY

### ISSUE #4: No Per-Iteration Timeout in Agent Loop

**Severity:** HIGH  
**Impact:** Single iteration can hang indefinitely  
**File:** `src/renderer/src/lib/agent-runtime.ts:363-642`

#### Problem Description
The main agent loop has no timeout on individual iterations. If an LLM call or tool execution hangs (despite lane timeouts), the entire iteration freezes.

#### Failure Scenario
1. Agent iteration 5 starts
2. Calls chat() to LLM provider
3. LLM provider connection hangs (no response, no timeout from provider)
4. chat() promise never resolves or rejects
5. Agent frozen indefinitely
6. User sees no feedback, must force-quit

#### Expected Behavior
- Max iteration time: 120 seconds (2 minutes)
- Timeout error triggers bailout or recovery
- User notified of timeout
- Option to retry or stop

#### Implementation Approach
Create `runIterationWithTimeout()` helper method, extract iteration logic into async function, wrap with Promise.race timeout, handle timeout errors gracefully with user-facing message.

#### Implementation Steps
1. Create `runIterationWithTimeout()` helper method
2. Extract iteration logic into async function
3. Wrap with Promise.race timeout
4. Handle timeout errors gracefully
5. Add user-facing timeout message
6. Allow retry after timeout

#### Test Cases
- [ ] LLM hangs → times out after 2 minutes
- [ ] Tool execution hangs → times out after 2 minutes
- [ ] Normal iteration completes → no timeout
- [ ] User can retry after timeout

---

### ISSUE #5: Consecutive Error Counter Counts Parallel Tool Failures Incorrectly

**Severity:** MEDIUM  
**Impact:** Can trigger false bailouts when multiple parallel tools fail  
**File:** `src/renderer/src/lib/agent-runtime.ts:1110-1131`

#### Problem Description
The consecutive error counter increments per tool call, not per iteration. When the agent calls multiple tools in parallel and they all fail, it can incorrectly trigger the bailout threshold (3 consecutive errors).

#### Failure Scenario
Iteration 5:
- Agent calls 3 parallel tools: [navigate, extract, screenshot]
- All 3 encounter transient network error
- consecutiveErrors = 3 → BAILOUT triggered
- But this is a single iteration failure, not 3 consecutive iteration failures!

#### Expected Behavior
- Track consecutive **iterations** with errors, not individual tool failures
- Reset counter when iteration has at least one successful tool call
- Only bailout after 3 consecutive iterations where all tools failed

#### Implementation Approach
Track `iterationHadSuccess` and `iterationHadError` flags per iteration, update counter after all tools complete, reset if ANY tool succeeded, increment only if ALL tools failed.

#### Implementation Steps
1. Add `consecutiveIterationErrors` counter (replace `consecutiveErrors`)
2. Add `iterationHadSuccess` and `iterationHadError` flags per iteration
3. Update flags in tool execution loop
4. Move counter update to after all tools complete
5. Update bailout message to reference iterations, not individual errors

#### Test Cases
- [ ] 3 parallel tools fail → counter increments by 1 (not 3)
- [ ] 2 tools fail, 1 succeeds → counter resets to 0
- [ ] 3 consecutive iterations with all failures → bailout triggers
- [ ] Bailout message mentions iterations, not individual tools

---

### ISSUE #6: Abort Signal Not Propagated to Sub-Agents

**Severity:** MEDIUM  
**Impact:** Sub-agents continue running after user clicks "Stop"  
**Files:** 
- `src/renderer/src/lib/agent-runtime.ts:1452` (parallel)
- `src/renderer/src/lib/agent-runtime.ts:1712` (sequential)

#### Problem Description
When creating sub-agents (both parallel and sequential), the abort signal from the main agent is not propagated. When a user clicks "Stop", the main agent stops but sub-agents continue executing in the background.

#### Failure Scenario
- 0s: User starts "Compare prices on Amazon, eBay, Walmart"
- 1s: Main agent spawns 3 parallel sub-agents
- 2s: Sub-agents start navigating to each site
- 5s: User clicks "Stop" → abort signal set
- 6s: Main agent detects abort → stops immediately
- 7-30s: Sub-agents still running in background (unwanted work)

#### Expected Behavior
- Abort signal propagated to all sub-agents
- When main agent aborts, sub-agents abort within 1-2 seconds
- Browser tabs closed
- Resources cleaned up

#### Implementation Approach
Add `signal: this.options.signal` to sub-agent creation options for both parallel and sequential sub-agents. Add abort checks before and after sub-agent execution.

#### Implementation Steps
1. Add `signal: this.options.signal` to parallel sub-agent creation (Line 1452)
2. Add `signal: this.options.signal` to sequential sub-agent creation (Line 1712)
3. Add abort check before sub-agent execution
4. Add abort check after sub-agent completion
5. Update error messages to distinguish abort from failure
6. Ensure browser tabs are closed on abort

#### Test Cases
- [ ] User aborts during parallel sub-agent execution → all stop within 2s
- [ ] User aborts during sequential sub-agent execution → current step stops
- [ ] Sub-agent browser tabs are closed on abort
- [ ] Memory entities cleaned up on abort

---

## 🟢 MEDIUM PRIORITY

### ISSUE #7: Tab Lanes Never Cleaned Up (Memory Leak)

**Severity:** LOW  
**Impact:** Memory leak for long-running sessions with many sub-agents  
**File:** `src/renderer/src/lib/execution-lanes.ts:97-105`

#### Problem Description
When sub-agents create dedicated tab lanes, these lanes are never deleted from the `LaneManager`. Over time, with many sub-agents, this causes a small memory leak.

#### Failure Scenario
- User runs: "Compare prices on 50 e-commerce sites"
- 50 parallel sub-agents created → 50 tab lanes created (TAB_1, TAB_2, ..., TAB_50)
- Sub-agents complete, tabs closed
- Tab lanes still in memory (50 LaneQueue objects)
- After 10 such tasks: 500 lanes in memory (small but grows)

#### Expected Behavior
- Tab lanes deleted when tab closes
- Memory released
- No accumulation over time

#### Implementation Approach
Add `cleanupTabLane()` method to LaneManager, call cleanup after sub-agent execution completes, check that lane is empty before deletion.

#### Implementation Steps
1. Add `cleanupTabLane()` method to `LaneManager`
2. Call cleanup after parallel sub-agent execution
3. Call cleanup after sequential sub-agent execution
4. Add periodic cleanup (optional: every 10 minutes)
5. Log cleanup operations for monitoring

#### Test Cases
- [ ] After parallel sub-agents complete → tab lanes deleted
- [ ] After sequential sub-agents complete → tab lane deleted
- [ ] Memory usage stable after 100 sub-agent runs
- [ ] Lane deletion logged correctly

---

### ISSUE #8: No Circuit Breaker for External Services

**Severity:** MEDIUM  
**Impact:** Cascade failures when external service (MCP server) goes down  
**New File:** `src/renderer/src/lib/circuit-breaker.ts`

#### Problem Description
When an external service (e.g., MCP server) fails, every agent and sub-agent retries independently. This can lead to hundreds of failed requests in a short time, wasting resources and time.

#### Failure Scenario
MCP server crashes:
1. Main agent calls MCP tool → fails → retries 2x
2. Sub-agent 1 calls same MCP tool → fails → retries 2x
3-50. Sub-agents 2-49 all do the same
Total: 150 failed requests to a server that's down, 750 seconds wasted

#### Expected Behavior
- After 3-5 failures to a service → "open circuit"
- Subsequent calls fail-fast with "Circuit breaker open"
- After 30s "half-open" → allow 1 test request
- If test succeeds → "close circuit" (service recovered)
- If test fails → "open circuit" again

#### Implementation Approach
Create CircuitBreaker class with states (CLOSED, OPEN, HALF_OPEN), track failure/success counts, implement timeout for retry attempts, integrate with MCP tool execution and LLM providers.

#### Implementation Steps
1. Create `circuit-breaker.ts` with CircuitBreaker class
2. Create CircuitBreakerManager singleton
3. Integrate with MCP tool execution
4. Add circuit breaker for LLM providers
5. Add UI indicator for circuit breaker state
6. Add manual reset option in settings

#### Test Cases
- [ ] 5 failures to MCP server → circuit opens
- [ ] Subsequent calls fail-fast (no retry)
- [ ] After 30s → circuit half-opens
- [ ] Successful test → circuit closes
- [ ] Multiple services have independent circuits

---

### ISSUE #9: No Exponential Backoff for Network Retries

**Severity:** MEDIUM  
**Impact:** Fixed delays don't adapt to transient vs persistent issues  
**File:** `src/renderer/src/lib/agent-runtime.ts:1026-1072`

#### Problem Description
All retry strategies use fixed delays (1-2 seconds). Exponential backoff is an industry standard that increases delay with each retry, giving transient issues time to resolve.

#### Expected Behavior
- Attempt 1: 1 second delay
- Attempt 2: 2 seconds delay
- Attempt 3: 4 seconds delay
- Max: 10 seconds
- Add jitter to prevent thundering herd

#### Implementation Approach
Create `getBackoffDelay()` helper function with exponential calculation and jitter, update all retry strategies to use it instead of fixed delays.

#### Implementation Steps
1. Create `getBackoffDelay()` helper function
2. Update all retry strategies to use exponential backoff
3. Add jitter to prevent thundering herd problem
4. Log actual delay times for monitoring
5. Make base delay and max delay configurable

#### Test Cases
- [ ] Attempt 1 → ~1s delay
- [ ] Attempt 2 → ~2s delay
- [ ] Attempt 3 → ~4s delay
- [ ] Jitter applied (delays vary slightly)

---

### ISSUE #10: No Lane Health Monitoring

**Severity:** LOW  
**Impact:** Difficult to diagnose lane bottlenecks  
**File:** `src/renderer/src/lib/execution-lanes.ts`

#### Problem Description
The `getDebugStats()` method exists but is never called. No visibility into lane queue depths, wait times, or bottlenecks.

#### Expected Behavior
- Periodic logging of lane stats (every 10s if active)
- Warnings when queues grow large (>5 items)
- Metrics on average wait time
- Expose stats in UI for debugging

#### Implementation Approach
Add wait time tracking to LaneQueue, track total wait time and completed tasks, add periodic monitoring to LaneManager, expose stats via window object for debugging.

#### Implementation Steps
1. Add wait time tracking to LaneQueue
2. Add queue depth warnings
3. Add periodic monitoring to LaneManager
4. Expose stats via window object for debugging
5. Add UI panel to display lane stats (optional)

#### Test Cases
- [ ] Long wait times logged
- [ ] Queue depth warnings triggered
- [ ] Stats logged every 10s when active
- [ ] window.laneStats() returns current stats

---

### ISSUE #11: Self-Healing Doesn't Auto-Screenshot on Error

**Severity:** LOW  
**Impact:** LLM lacks visual context for recovery  
**File:** `src/renderer/src/lib/agent-runtime.ts:1092-1109`  
**Reference:** `docs/self-healing-analysis.md:205-217`

#### Problem Description
When errors occur, the LLM receives text error messages but no visual context. Auto-capturing screenshots on errors would help the LLM understand the page state and make better recovery decisions.

#### Expected Behavior
- On browser-related errors → auto-capture screenshot
- Screenshot attached to error message
- LLM can see visual context
- Helps LLM make better recovery decisions

#### Implementation Approach
Detect browser-related errors (element not found, timeout, etc.), call browser_screenshot automatically, attach screenshot to error message, handle screenshot failures gracefully.

#### Implementation Steps
1. Detect browser-related errors
2. Call `browser_screenshot` automatically
3. Attach screenshot to error message
4. Update recovery hints to reference screenshot
5. Handle screenshot failures gracefully
6. Add configuration to enable/disable auto-screenshot

#### Test Cases
- [ ] Element not found → screenshot captured
- [ ] Timeout error → screenshot captured
- [ ] Non-browser error → no screenshot
- [ ] Screenshot failure → error message still returned

---

### ISSUE #12: Task Decomposer Has No Retry on LLM Analysis Failure

**Severity:** LOW  
**Impact:** Transient LLM failures cause fallback to sequential (inefficient)  
**File:** `src/renderer/src/lib/task-decomposer.ts:226-237`

#### Problem Description
The task decomposer uses LLM to analyze whether tasks can be parallelized. If the LLM call fails (network error, timeout), it immediately falls back to sequential execution without retrying.

#### Expected Behavior
- Retry LLM analysis 1-2 times on transient errors
- Only fall back to sequential if all retries fail
- Use exponential backoff between retries

#### Implementation Approach
Add attempt and maxAttempts parameters to analyzeTaskWithLLM, detect transient vs permanent errors, implement retry logic with exponential backoff.

#### Implementation Steps
1. Add `attempt` and `maxAttempts` parameters to `analyzeTaskWithLLM`
2. Detect transient vs permanent errors
3. Implement retry logic with exponential backoff
4. Update error messages to show retry count
5. Cache successful results to avoid re-analysis

#### Test Cases
- [ ] Network timeout → retries once → succeeds
- [ ] 2 failures → falls back to sequential
- [ ] Permanent error (invalid API key) → no retry
- [ ] Successful analysis → cached for 5 minutes

---

### ISSUE #13: Sequential Task Final Summary Doesn't Distinguish Success vs Failure

**Severity:** MEDIUM  
**Impact:** Users can't quickly identify which steps failed in sequential execution  
**File:** `src/renderer/src/lib/agent-runtime.ts:1757-1762`

#### Problem Description
The sequential sub-agent final summary treats all results the same way, whether they succeeded or failed. Errors are mixed with successful results without visual distinction, making it hard to understand task outcome.

#### Failure Scenario
Final summary shows:
- "Navigate to example.com" - Successfully navigated
- "Click login button" - Error: Element not found
- "Fill username field" - Successfully filled username
- Footer: "Sequential orchestration complete: 3 steps executed"

User can't tell at a glance that step 2 failed (no success/failure count, no visual indicators, errors blend with successes).

#### Expected Behavior
- Clear visual distinction between successful and failed steps
- Success/failure count in summary
- Failed steps highlighted with warning emoji
- Overall task status (success, partial success, or failure)

#### Implementation Approach
Detect error results (start with "Error:"), separate into successful and failed arrays, add visual indicators (✓ for success, ✗ for failure), show counts, update overall status message.

#### Implementation Steps
1. Add logic to detect error results (starts with "Error:")
2. Separate results into successful and failed arrays
3. Add visual indicators (✓ for success, ✗ for failure)
4. Show success/failure counts
5. Update overall status message
6. Consider adding error severity levels (warning vs critical)

#### Test Cases
- [ ] All steps succeed → shows "All steps completed successfully"
- [ ] All steps fail → shows "All steps failed" with failures section
- [ ] Mixed results → shows both sections with counts
- [ ] User can quickly identify failed steps visually

---

### ISSUE #14: Parallel Task Summary Missing Overall Status

**Severity:** MEDIUM  
**Impact:** No clear indication if partial failures are acceptable or problematic  
**File:** `src/renderer/src/lib/agent-runtime.ts:1543-1561`

#### Problem Description
The parallel sub-agent summary shows success/failure counts but doesn't indicate whether the overall task succeeded. For "Compare prices on 3 sites", if 1 fails it's still usable. But for "Gather data from 3 sources and merge", 1 failure might be critical.

#### Issues Found
1. No Overall Status: Is 2/3 success good enough? User doesn't know
2. Failed Results Truncated: Only shows error message, not full context
3. No Retry Suggestion: User doesn't know if they should retry failed sources
4. No Partial Success Handling: Some tasks need all sources, others don't

#### Expected Behavior
- Clear overall status: "Success", "Partial Success", or "Failed"
- For partial success, indicate if it's acceptable
- Suggest retry for failed sources
- Option to re-run only failed sources

#### Implementation Approach
Calculate success rate, determine overall status with emoji, improve failed source formatting, add retry suggestion for partial failures.

#### Implementation Steps
1. Calculate success rate and determine overall status
2. Add status emoji and header based on success rate
3. Improve failed source formatting (show full context)
4. Add retry suggestion for partial failures
5. Consider adding "Retry Failed" button in UI
6. Log partial success metrics for monitoring

#### Test Cases
- [ ] All sources succeed → "All sources completed successfully"
- [ ] 1/3 fails → "Partial success" with retry suggestion
- [ ] 2/3 fail → "Most sources failed" with prominent warning
- [ ] Failed sources show detailed error information

---

## 🟢 LOW PRIORITY

### ISSUE #15: Sequential Task Doesn't Report Progress to Parent Agent

**Severity:** LOW  
**Impact:** User loses context when sequential sub-agent is working  
**File:** `src/renderer/src/lib/agent-runtime.ts:1739-1745`

#### Problem Description
Sequential sub-agents show progress messages locally, but these messages aren't visible to the user if the sequential orchestration is called from the main agent. The user only sees "Analyzing..." and then the final result, missing all intermediate progress.

#### Failure Scenario
User's view:
1. User: "Book a flight to NYC, find hotel, and rent a car"
2. Agent: "📋 Auto-Orchestration: This task requires ~15 steps..."
3. Agent: "Analyzing..."
4. [30 seconds of silence]
5. Agent: "## Task Complete" [shows all results]

What user missed (all hidden):
- ✓ Step 1 completed: Navigated to flights.com
- ✓ Step 2 completed: Found flights for $299
- ⚠️ Step 3 failed: Hotel booking unavailable
- ✓ Step 4 completed: Found rental car for $45/day

#### Expected Behavior
- Progress messages bubble up to parent agent
- User sees real-time updates for each step
- Failed steps are immediately visible (not hidden until end)
- User can abort if they see something going wrong

#### Implementation Approach
Option 1: Bubble progress to parent (check if main agent, show step start/completion messages)
Option 2: Live status message (like parallel execution uses)

#### Implementation Steps
1. Add step start messages for parent agents
2. Show progress messages after each step completion
3. Show failures immediately (don't wait for end)
4. Consider live status message (like parallel execution)
5. Add abort checks between steps
6. Update final summary to reference shown progress

#### Test Cases
- [ ] User sees step start message before execution
- [ ] User sees step completion message after each step
- [ ] User sees failures immediately (not at end)
- [ ] Progress messages appear in real-time (not batched)

---

### ISSUE #16: No Rollback or Compensation for Failed Sequential Steps

**Severity:** LOW  
**Impact:** Failed steps can leave system in inconsistent state  
**File:** `src/renderer/src/lib/agent-runtime.ts:1747-1754`

#### Problem Description
When a sequential step fails (e.g., "Book flight" succeeds, "Book hotel" fails), there's no rollback mechanism. This can leave the user with a booked flight but no hotel, wasting money.

#### Failure Scenario
Task: "Book flight to NYC, book hotel, and rent car"

Execution:
1. Step 1: Book flight → Success ($500 charged)
2. Step 2: Book hotel → FAILS (sold out)
3. Step 3: Rent car → Success ($200 charged)

Result: User has flight and car, but no hotel! Can't use flight without hotel, wasted $700, needs to manually cancel.

#### Expected Behavior
**Option 1: Stop on First Failure**
- Ask user if they want to continue after failure
- Don't proceed with dependent steps
- Warn about inconsistent state

**Option 2: Rollback on Failure**
- Define compensation actions for each step
- If step fails, undo previous steps
- Requires reversible operations

**Option 3: Transaction-like Behavior**
- Mark all steps as "pending" initially
- Only commit if all steps succeed
- Rollback all if any step fails

#### Implementation Approach
Implement "Stop on First Failure" approach: add `failed` flag to results, detect critical failures (not last step), stop execution on critical failures, ask user for continue/stop/retry.

#### Implementation Steps
1. Add `failed` flag to step results
2. Detect critical failures (not last step)
3. Stop execution on critical failures
4. Add user prompt for continue/stop/retry
5. Update final summary to show skipped steps
6. Consider adding compensation/rollback support (advanced)

#### Test Cases
- [ ] Step 2 of 5 fails → execution stops, steps 3-5 skipped
- [ ] Last step fails → no stops (already at end)
- [ ] Final summary shows skipped steps
- [ ] User can choose to continue anyway (future enhancement)

---

## Summary Table

| Issue # | Title | Severity | Impact | Estimated Effort | Priority |
|---------|-------|----------|--------|------------------|----------|
| #1 | No Timeout on Lane Execution | CRITICAL | Indefinite hangs | Low (20 lines) | 🔥 Immediate |
| #2 | Abort Signal Not Propagated | CRITICAL | Stop doesn't work | Medium (50 lines) | 🔥 Immediate |
| #3 | Cumulative Retry Timeout | HIGH | Retries too long | Low (30 lines) | 🔥 Immediate |
| #4 | No Per-Iteration Timeout | HIGH | Iteration hangs | Medium (40 lines) | ⚠️ High |
| #5 | Consecutive Error Counter Bug | MEDIUM | False bailouts | Low (10 lines) | ⚠️ High |
| #6 | Sub-Agent Abort Propagation | MEDIUM | Zombie sub-agents | Low (5 lines) | ⚠️ High |
| #7 | Tab Lane Memory Leak | LOW | Memory accumulation | Low (15 lines) | 🟢 Medium |
| #8 | No Circuit Breaker | MEDIUM | Cascade failures | High (150 lines) | 🟢 Medium |
| #9 | No Exponential Backoff | MEDIUM | Poor retry strategy | Low (20 lines) | 🟢 Medium |
| #10 | No Lane Health Monitoring | LOW | Poor visibility | Medium (40 lines) | 🟢 Medium |
| #11 | No Auto-Screenshot on Error | LOW | Poor LLM context | Low (25 lines) | 🟢 Low |
| #12 | No Decomposer Retry | LOW | Inefficient fallback | Low (30 lines) | 🟢 Low |
| #13 | Sequential Summary No Success/Fail | MEDIUM | User confusion | Low (20 lines) | 🟢 Medium |
| #14 | Parallel Summary Missing Status | MEDIUM | Unclear outcome | Low (25 lines) | 🟢 Medium |
| #15 | Sequential No Progress Reporting | LOW | Poor UX | Medium (30 lines) | 🟢 Low |
| #16 | No Rollback for Failed Steps | LOW | Inconsistent state | High (80 lines) | 🟢 Low |

**Total Issues:** 16  
**Total Estimated Effort:** ~590 lines of code  
**Recommended Implementation Order:** #1 → #2 → #3 → #6 → #5 → #13 → #14 → #4 → #9 → #15 → #8 → #7 → #10 → #11 → #12 → #16

---

## Next Steps

1. **Review this document** and confirm priorities
2. **Select issues to fix** (recommend starting with #1, #2, #3)
3. **Create feature branch** for fixes
4. **Implement fixes** one issue at a time
5. **Test each fix** with provided test cases
6. **Submit PR** with references to issue numbers

**Ready to start implementation! Recommend beginning with the 3 critical issues.**
