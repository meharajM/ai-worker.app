# Architecture and Agent Logic Fixes

This document chronologically details the problems identified in the AI-Worker application's core agent logic and progress tracking systems, the solutions implemented, and comprehensive testing instructions.

## 1. Lingering Progress Bars (UI Sync Issue)

### Problem
The global UI progress bar would often stay visible on the screen long after an agent had finished resolving a task, encountered an error, or the user pressed the abort button. The system was relying on optimistic cleanup within success paths but lacked a universal tear-down mechanism for the `useChatStore`.

### Solution
Modified the core `handleSubmit` execution path in `useAgent.ts`. Enforced a strict `finally` block that unconditionally clears the session's `progress`, `eta`, and execution `plan` states (setting them to `undefined`) the moment an agent execution cycle concludes, regardless of success, failure, or user cancellation.

### How to Test
**Prompt 1 (Success):** "What is the capital of France?"
*Observation:* The progress bar should appear briefly while responding and disappear instantly when the final "Paris" message is rendered.
**Prompt 2 (Abort):** "Search the web for the entire history of the Roman empire."
*Observation:* Wait 5 seconds, then click the "Stop/Abort" button. The progress bar MUST disappear instantly. 

---

## 2. Frozen Progress on Silent Actions

### Problem
The progress bar was programmed to only advance when a tool call produced explicitly "presentable data" (a `findingSummary`). This meant if an agent was busy performing background operations (e.g., navigating a deeply nested website, reading internal files, scrolling to find buttons), the progress UI would remain completely frozen, giving the false impression that the application had locked up.

### Solution
Relocated the `onProgressUpdate` broadcast in `AgentRuntime.ts` (`_runLoop`) outside the `findingSummary` guard block. The progress update is now forcibly emitted for **every single tool execution attempt**, including retries. This ensures the UI accurately reflects all background processing activity.

### How to Test
**Prompt:** "Open wikipedia.org in the browser, scroll down twice, and then search for 'Quantum Mechanics'."
*Observation:* Watch the progress bar as the agent works. It should smoothly advance and update its status string during the hidden "scroll" and "navigate" tool executions, rather than jumping abruptly from 0% to 100% only at the end.

---

## 3. UI Progress Bar Cross-Contamination by Sub-Agents

### Problem
When the master agent spawned `delegate_sub_agents` or Orchestrated Parallel/Sequential sub-agents, those sub-agents would inherit the `onProgressUpdate` UI hook. Because sub-agents run simultaneously or loop independently, they would asynchronously fire progress updates, wildly overwriting the parent's progress bar values and causing UI flickering or illogical progress jumps.

### Solution
Secured the `AgentRuntimeOptions` inheritance boundary. In `_makeSubAgentFactory()`, explicitly hardcoded the stripping of `onProgressUpdate: undefined` before assigning options to any new sub-agent. This mechanically guarantees that sub-agents can never communicate directly with the root UI; progress remains strictly managed by the parent orchestrator.

### How to Test
**Prompt (Parallel):** "Analyze these three websites in parallel: apple.com, google.com, and microsoft.com. Tell me the main headline of each."
*Observation:* Open the UI and watch the root progress tracking. It should cleanly show the parent's generic progress ("Working on 3 sources"). You should NOT see the progress jumping sporadically back and forth as the hidden sub-agents execute their internal web-scraping tool loops.

---

## 4. Aggressive Zero-Tolerance Loop Detection

### Problem
The `ToolExecutionService` circuit breaker (`checkForLoop`) was built with a fatal `sameToolRepeated` flaw. If the agent called the *same tool name* 3 times consecutively, even with *completely different arguments*, it would instantly kill the agent for being in an "infinite loop." 

This broke completely valid, highly parallel workflows. Example: An agent trying to read 3 different files (`fs_read(A)`, `fs_read(B)`, `fs_read(C)`) would trigger a hard crash on the 3rd file.

### Solution
Relaxed the mathematical logic inside `checkForLoop`. Erased the `sameToolRepeated` check entirely. The system now exclusively relies on the `allSame` signature evaluation. An agent is only flagged as trapped in a loop if it executes the **exact same tool AND exact same arguments** 3 times consecutively (indicating a true failure-to-adapt hallucination).

### How to Test
**Prompt (File reads):** "Use the fs_list_dir tool to look at the root directory, then use the fs_read_file tool to read package.json, tsconfig.json, and tailwind.config.js."
*Observation:* The agent MUST successfully read all three distinct files sequentially without firing the "⚠️ I noticed I'm repeating the same action" error.
**Prompt (Force loop hallucination):** "Repeatedly click on a button labeled 'DOES_NOT_EXIST' 5 times without doing anything else."
*Observation:* After 3 identical failing attempts, the agent MUST intercept itself and output the bailout template: "I noticed I'm repeating the same action... with identical arguments."

---

## 5. Sub-Agent Data Vaporization on Crash (Partial Execution Salvage)

### Problem
If a sub-agent was executing a complex multi-step sequence (via Parallel, Sequential, or Delegation orchestration) and encountered a fatal error mid-way (e.g., maximum iteration timeout, unhandled network exception), it would crash and return a generic `Error: Failed`. 

Crucially, **any valuable data it had successfully gathered in steps 1, 2, or 3 prior to crashing was vaporized** from its isolated RAM context. The parent agent would receive zero actionable intelligence, forcing a total restart of that sub-agent's mandate.

### Solution
Engineered a memory-salvage protocol (`extractPartialFindings`) directly into `OrchestrationService.ts` and `_handleDelegateSubTask`. 
When a sub-agent hits a fatal error block or emits a consecutive errors bailout string:
1. The orchestrator intercepts the crash before destruction.
2. It reverse-scans the failing sub-agent's isolated `.getHistory()` array.
3. It extracts any raw tool outputs that succeeded prior to the crash.
4. It parses them through `analyzeToolOutput()`.
5. It compiles a "Salvaged Findings" string and appends it to the final error message delivered to the parent LLM and UI.

### How to Test
**Prompt:** "Open a new browser tab to news.ycombinator.com, read the top 3 headlines, and then try to click an element with the exact selector `button#intentionally_broken_selector_that_does_not_exist`."
*Observation:* The agent will successfully scrape the Hacker News DOM, then get stuck infinitely trying to click the broken selector. After exhausting retries, it will throw an orchestration error.
*Expected Salvage Result:* Look at the final crashed output. Instead of a blank error screen, you must see: 
`⚠️ Analysis Failed/Partial`
`Sub-agent bailed out. Partial data collected:`
`(1) [Hacker News headlines...]`
The LLM will then logically acknowledge the partial success in its final response.

---

## Outstanding Issues / To-Do

* **Parallel Status Card Updates:** Currently, parallel execution progress is tracked in a single aggregated "status" card that updates in place. While this works, it does not utilize the standard global progress bar at the very top of the UI. Syncing parallel orchestrations to the global progress bar requires inter-process context mapping which was deemed too intrusive for this refactor path.
* **E2E Test Timeouts:** The E2E tests in `tests/e2e_ui_mocked.cjs` specifically dealing with timeouts might need assertions adjusted, as the progress bar and abort mechanisms now react instantaneously to tool completion rather than waiting for discrete summaries.
