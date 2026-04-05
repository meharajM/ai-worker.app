# AI Worker Identified Issues

This log contains the issues tracked during end-to-end testing of the AI Worker execution flow.

## Status Snapshot (Apr 4, 2026)

### Latest Validation Update (Apr 5, 2026, critical-6 stabilization pass)
- Completed checks:
  - `npm run -s test:regression:critical` ✅
  - `npm run -s build` ✅
  - `node tests/real_e2e_test.cjs --critical-only --only-critical=6 --extended-criticals --rate-safe` ✅
  - `node tests/real_e2e_test.cjs --critical-only --only-critical=5 --rate-safe` ✅
- Failing checks in this pass:
  - `npm run -s test:e2e` ❌ (Electron launch fails before first window)
  - `npm run -s test:e2e:issues` ❌ (same launch failure)
  - `node tests/e2e_ui_mocked.cjs` ❌ (same launch failure)
  - `node tests/speech_e2e.cjs` ❌ (same launch failure)
- Critical-6 specific note:
  - Real flow now confirms deterministic recall signal and persisted preference recall.
  - UI text capture still reports `ui=false` for recall in the test summary, even when deterministic recall and persisted values are present.

### New Issue Added in This Pass
## 29. Playwright Electron Launch Instability in Non-Real E2E Suites
**Observed Behavior:**
- `integration_test`, `e2e_ui_mocked`, `issues_repro_e2e`, and `speech_e2e` abort at launch with:
  - `Error: Process failed to launch!` (Playwright Electron launcher)
- Failure occurs before `firstWindow()` and before scenario assertions run.

**If Not Fixed (User Experience Impact):**
- CI/local regression coverage for mocked, integration, and speech paths is effectively blind.
- Real-only suites may pass while non-real regressions ship undetected.
- Team confidence in release readiness drops because full validation cannot be completed.

## 30. Deterministic Preference Recall Not Reliably Visible in UI Bubble
**Observed Behavior:**
- Runtime logs show `Using deterministic local preference recall answer.`
- Persisted local preference keys confirm recall data exists.
- But UI response text scraping for the recall prompt still frequently misses explicit `sam/pnpm` text (`ui=false`), indicating the deterministic answer is not consistently surfaced as a visible assistant bubble in this flow.

**If Not Fixed (User Experience Impact):**
- Users may see ongoing “thinking”/tool chatter without a clear final recall answer.
- Memory appears unreliable even when backend/runtime recall succeeds.
- Creates confusion and repeat prompts, increasing latency and token usage.

## 31. Real E2E Harness Can Hard-Fail on Closed Window During Screenshot Capture
**Observed Behavior:**
- In live `real_e2e_test` runs under heavy 429/retry pressure, the harness can detect window closure mid-wait and then still attempt `page.screenshot`, causing a hard failure:
  - `Target page, context or browser has been closed`
  - Failure occurs in `screenshot()` after timeout/closure path.

**If Not Fixed (User Experience Impact):**
- Live validation can fail for harness reasons even when product logic is otherwise functioning.
- Re-run noise increases and obscures true regressions.
- Release confidence drops when flaky harness failures look like product failures.

### Latest Validation Update (Apr 5, 2026, pre-push revalidation)
- Completed checks:
  - `npm run -s typecheck` ✅
  - `npm run -s test:regression:critical` ✅
  - `npm run -s test:e2e` ✅ (exit 0)
  - `npm run -s test:e2e:issues` ✅ (exit 0, report regenerated)
  - `npm run -s test:e2e:real:focus` ✅ (exit 0)
  - `npm run -s test:playwright` ✅
  - `npm run -s build` ✅
- Issue repro summary from `tests/issues_repro_report.json`:
  - `reproduced: 0`
  - `not_reproduced: 7`
  - `inconclusive: 2` (`#16`, `#20`)
- Non-rate-limit note:
  - Mocked bundle still prints `❌ Parallel Response missing` in `test:e2e` logs while the suite exits green.
- Fixes validated in this pass:
  - `#19` no longer reproduces after XML tool-call recovery support (`<tools>...</tools>`) was added to LLM fallback parsing.
  - `#25` no longer reproduces in the issue repro harness after tightening warning-marker checks.

### Latest Validation Update (Apr 4, 2026, night handoff)
- Completed checks:
  - `npm run test:e2e` ✅ (exit 0)
  - `npm run test:e2e:issues` ✅ (exit 0, report generated)
  - `npm run test:e2e:real:focus` ✅ (exit 0)
  - `node tests/real_e2e_test.cjs` ⚠️ partial reruns only (long-running + provider throttling dominated)
- Non-rate-limit findings from this pass:
  - `test:e2e` still logs `❌ Parallel Response missing` in mocked scenario even though suite exits green.
  - `test:e2e:issues` report (`tests/issues_repro_report.json`) reproduced:
    - `#19` recovery visibility (`jsonVisible=false`, `xmlVisible=false`)
    - `#25` warning leakage in repro flow.
  - Focus real run (`S05`) passed but repeatedly hit 30s lane retries and selector failures before recovery (`.inline-flex` click timeout, escaped-selector syntax failure), leading to ~180s response time.

### New Issue Added in This Pass
## 28. Selector Normalization + Recovery Gaps Cause Extreme Latency in Delegated Live Flows
**Observed Behavior:**
- Delegated browsing can spend multiple 30s retry windows on brittle selectors (e.g., `.inline-flex`) before recovering.
- Escaped selector payloads (for example `a[href*=\\"...\\" ]`) can hit selector parsing failures before fallback logic recovers.
- Focus scenario still passed, but required ~180s and multiple expensive retries.

**If Not Fixed (User Experience Impact):**
- Users see long "stuck" behavior during delegated tasks even when the task eventually succeeds.
- Response times become unpredictable and can cross timeout budgets in live workflows.
- Apparent reliability drops: users interpret slow/looping retries as agent failure.

### Latest Validation Update (Apr 4, 2026, late-night rerun)
- Full real suite rerun:
  - `node tests/real_e2e_test.cjs` ❌ (`18/20 passed`)
  - Failed scenarios:
    - `S02: Sequential Orchestration` (timed out, `Plan created: false`)
    - `Critical 2: Conditional Multi-Site Decomposition` (timed out, `Completed: false`)
- Full e2e bundle rerun:
  - `npm run -s test:e2e` ✅ (exit 0)
  - But mocked phase still emitted regression signals:
    - `⚠️ Handoff test failed`
    - `❌ Plan Response missing`
    - while final line remained `ALL SCENARIOS PASSED (with handled warnings)`.
  - Speech phase passed but still printed repeated `Recognizer ... not ready, ignoring`.

### Latest Validation Update (Apr 4, 2026, evening)
- Local gates after Phase A/B/C runtime updates:
  - `npm run -s typecheck` ✅
  - `npm run -s test:regression:critical` ✅
  - `npm run -s test:playwright` ✅
  - `npm run -s test:mock` ✅
  - `npm run -s test:build` ✅
- Live focus rerun:
  - `npm run -s test:e2e:real:focus` => `S21G` ✅, `S05` ❌ timeout (`181.4s`) with provider throttling/429 pressure in logs.
- Targeted live critical rerun:
  - `node tests/real_e2e_test.cjs --critical-only --only-critical=3` ✅
  - `Critical 3` passed with `Checklist failed badge visible: false`
  - Runtime stability signal remained clean (`Execution-context-destroyed: 0`, `Stale-socket-cleanups: 0`).

### Latest Runtime + Harness Validation Update (Apr 4, 2026)
- Real-E2E harness now enforces run-idle before scenario handoff (`Stop Generation` clear + idle gate), preventing early keyword-hit exits from contaminating the next scenario.
- Partial live re-run evidence after this change:
  - `Critical 1: delegate_sub_task Parallelism` ✅ passed in `93.5s` with `Delegate signals: 3` and no max-iteration failure.
  - Harness emitted `Keyword matched but run still active; continuing to wait.` confirming premature-completion protection is active.
- Earlier full-suite failures (`S11`, `S08`, `S06`) were captured before the idle-gate fix and now require clean revalidation.

### Latest Critical-Only Real-E2E Validation (Apr 4, 2026)
- Command: `node tests/real_e2e_test.cjs --critical-only`
- Result: `5/5 passed` (Critical 1-5 all green).
- Notable: `Critical 4` now passes without false failure when no `fs_write` call is attempted and no loop signal is observed.

### Latest Follow-Up Runtime Validation (Apr 4, 2026)
- After additional browser stability patches (`navigate`, `wait_for_navigation`, `get_state`) and `click_text` hardening, targeted live rerun showed:
  - `S00B: Runtime Stability Signals` reported `Execution-context-destroyed: 0` and `Stale-socket-cleanups: 0`.
  - `Critical 3` can still fail under heavy live jitter when Reuters headline `click_text` retries consume scenario budget (observed `Lane timeout for click_text` loops before timeout).
- Implemented mitigation:
  - `click_text` now has bounded timeout (default `8000`, capped `15000`) and compact/keyword fallback matching to avoid repeated long exact-text stalls.
  - Requires clean revalidation when OpenRouter 429 pressure is lower.

### Latest Targeted Validation (Apr 4, 2026)
- Command: `node tests/real_e2e_test.cjs --critical-only --only-critical=3`
- Result: `Critical 3` ✅ passed in `51.3s` (`Assistant bubbles: 6`, `Checklist failed badge visible: false`).
- Added harness support for targeted critical execution:
  - `--only-critical=<id[,id...]>` and env `E2E_ONLY_CRITICALS`
  - allows direct validation of a specific critical path without running all critical scenarios.

### Latest Focused Real-E2E Validation (Apr 4, 2026)
- `S05: Manual Delegation` ✅ passed (`Timed out: false`, sub-agent detected, ~84.8s in latest run).
- `S21G: Immediate Reply (no tools)` ✅ passed (`no tools: true`, ~11.6s in latest run) after hard-resetting chat state to guarantee first-turn behavior.
- New runtime signals:
  - direct-answer prompts now skip decomposition (`skipping_decomposition_for_direct_answer`), reducing first-turn request payload for `S21G` to direct-chat payload (~331 chars request body).
  - low-signal direct prompts now skip post-response memory reflection (`skipping MemoryReflector for low-signal direct prompt`), reducing residual background activity.
- Validation command: `npm run -s test:e2e:real:focus`.

### Marked Fixed in Current Validation
- **#11** `fs_write_file` infinite loop under staged/approval flow  
  Evidence: `Critical 4: File Write Loop Safety` passed (`Infinite fs loop: false`).
- **#12** Detailed visibility OFF final-output mismatch  
  Evidence: `Critical 3: Detailed Visibility OFF Final Output` passed (`Checklist failed badge visible: false`).
- **#13** Parallel delegation regression (single-worker behavior)  
  Evidence: `Critical 1: delegate_sub_task Parallelism` passed (`Delegate signals: 2`, no max-iteration failure).

### Still Open / Blocking
- **#14, #26** Open in latest full real rerun (`S02` and `Critical 2` failed with timeouts).
- **#15** Live rate-limit instability (429/backoff) still observed in real runs.
- **#27** Broader signal-quality gate still needs full-suite re-validation (action cards/progress/checkpoints).
- **#25** Reopened in latest `test:e2e` run (`Handoff test failed`, `Plan Response missing` under warning-only behavior).

### Full Issue Status Matrix
- **#1** Likely fixed / no recent repro (memory create parse crash not seen in latest runs).
- **#2** Open (site/protocol navigation instability still possible on retail targets).
- **#3** Open (fallback quality still weaker than stable direct navigation).
- **#4** Mitigated/Needs re-test (manual delegation timeout no longer reproduced in focused real run; broader decomposition timeout risk still possible).
- **#5** Mitigated (MarkItDown auto-connect loop/noise reduced when runtime tool missing).
- **#6** Likely fixed / no recent repro (startup memory parse failure not observed in latest suite runs).
- **#7** Mitigated / needs clean re-test (adaptive `navigate` + `wait_for_navigation` heuristic fallback now in place; live verification still affected by provider jitter).
- **#8** Needs re-test (no strong fresh evidence of launch thrash in current run).
- **#9** Mitigated / needs clean re-test (timeout soft-success path added when page is interactive).
- **#10** Mitigated / needs clean re-test (`get_state` navigation-race retries expanded; latest stability signal showed `Execution-context-destroyed: 0`).
- **#11** Fixed (validated).
- **#12** Fixed (validated).
- **#13** Fixed (validated).
- **#14** Open (failed in latest full real rerun; conditional decomposition still timing out).
- **#15** Open (validated by repeated 429/backoff in live runs; still observed transiently in focused run startup).
- **#16** Mitigated (real E2E blocks scenario handoff until active run is idle, and low-signal direct prompts now skip memory reflection).
- **#17** Fixed (cache API guard added; no startup crash signal in recent runs).
- **#18** Likely fixed (CSP duplication signal not seen in latest startup logs).
- **#19** Fixed in latest revalidation (`test:e2e:issues` now reports not_reproduced after XML recovery fallback patch).
- **#20** Open (speech passes functionally, but repeated `Recognizer ... not ready, ignoring` logs are still present).
- **#21** Fixed (bundle-integrity + `test:build` now pass).
- **#22** Mitigated (mac scripts moved to ZIP-first policy; DMG no longer default path).
- **#23** Open/By design (Windows native rebuild cross-compile unsupported on current host).
- **#24** Fixed as originally filed (wine hard-gate replaced by host-aware checks + actionable preflight).
- **#25** Not reproduced in latest issue repro run (warning-marker checks clean); keep monitoring mocked `test:e2e` log noise.
- **#26** Open (failed again in latest full real rerun).
- **#27** Open (partially mitigated; `Critical 3` now passes in targeted run, full-suite action-card/progress/checkpoint quality still pending complete re-validation).
- **#28** Open (new): selector normalization/recovery still allows high-latency retry loops in delegated live runs.

## 1. MCP Tool Parsing Errors (`memory_create_entity`)
**Log Error:**
`[MCP Renderer ERROR] Tool call failed {operation: executeToolCall, toolName: memory_create_entity, serverId: <id>, error: Failed to parse create_entities response: Unexpected letter after JSON at position 216...}`

**Issue:** 
The application frequently fails when attempting to use the `memory_create_entity` tool. The MCP server handling this tool call is returning malformed JSON (there appears to be trailing text or unexpected characters after the valid JSON payload), which causes the JSON parser to crash. This completely blocks reliable state management.

## 2. Browser Navigation Protocol Errors (`ERR_HTTP2_PROTOCOL_ERROR`)
**Log Error:**
`[MCP Renderer ERROR] Tool call failed {operation: executeToolCall, toolName: navigate, serverId: <id>, error: page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://www.bestbuy.com...}`

**Issue:** 
When the `navigate` tool attempts to open BestBuy, Playwright encounters a `net::ERR_HTTP2_PROTOCOL_ERROR`. This suggests either bot protection/blocking by BestBuy or underlying protocol issues with the Playwright browser context. 

## 3. Sub-Agent Execution Flow Fallbacks
**Diagnostic details:**
Following the `ERR_HTTP2_PROTOCOL_ERROR`, the sub-agent correctly detects the failure and decides to fallback by executing:
`web_search` with the query `"sony wh-1000xm5 wireless noise canceling headphones bestbuy"`.

**Issue:**
While the fallback logic is functional, replying on `web_search` for scraping might not retrieve exact element details reliably on dynamic e-commerce sites compared to a successful direct `navigate` call.

## 4. LLM Analysis Timeouts
**Diagnostic details:**
The `TaskDecomposer` occasionally times out on complex tasks. 

**Issue:**
Timeout limits may need to be increased or the `TaskDecomposer` prompt may need optimization for the updated `qwen/qwen3.6-plus:free` model.

## 5. MCP Sidecar Launch Failure (`uvx` missing)
**Log Error:**
`[MCP ERROR] ... "command": "uvx", "args": "markitdown-mcp[all]" ... "error": "spawn uvx ENOENT"`

**Issue:**
On dev startup, the MarkItDown MCP sidecar fails to start because `uvx` is not installed or not on `PATH`. This leaves conversion/file-processing capability partially unavailable and repeatedly logs connection failures during initialization.

## 6. Server Memory Search Parsing Failure During Startup
**Log Error:**
`[ServerMemoryAdapter] Failed to parse search response: Unexpected non-whitespace character after JSON at position 216 (line 1 column 217)`

**Issue:**
`ServerMemoryAdapter` consistently fails to parse search responses even during initialization (`loadCache` / early memory reads). This indicates malformed or multi-part memory server payload parsing and causes degraded memory availability from app start.

## 7. Playwright Navigation Wait Timeout (`wait_for_navigation`)
**Log Error:**
`[PlaywrightService] Error calling tool wait_for_navigation: page.waitForLoadState: Timeout 10000ms exceeded.`

**Issue:**
A prompt-triggered browser flow hit a hard 10s navigation wait timeout. The fixed timeout appears too strict for slower/dynamic pages and causes tool failure despite browser launch succeeding. This should be mitigated via adaptive timeout/retry logic or smarter post-action wait conditions.

## 8. Browser Launch Thrashing / Stale Profile Socket Reuse
**Log Pattern:**
- `[BrowserManager] Launching browser...`
- `[BrowserManager] 🔓 Cleared stale SingletonSocket at .../playwright_data/SingletonSocket`
- `[BrowserManager] ✅ Browser launched: chrome`
- Repeats multiple times in short intervals

**Issue:**
Browser startup is being triggered repeatedly instead of reusing a single active instance, causing repeated stale profile socket cleanup and relaunch. This suggests a concurrency/race issue around browser lifecycle management and can increase latency, instability, and resource usage.

## 9. Playwright `navigate` Timeout on Retail Site
**Log Error:**
`[PlaywrightService] Error calling tool navigate: page.goto: Timeout 30000ms exceeded ... navigating to "https://www.ajio.com/search/?text=casio+f19", waiting until "domcontentloaded"`

**Issue:**
`navigate` can hit hard 30s timeouts on certain commerce pages (likely heavy scripts, anti-bot, or slow region routing). Current behavior fails the tool outright with no adaptive retry/fallback strategy (e.g., alternate wait strategy, lower wait target, or retry with backoff).

## 10. `get_state` Race During Navigation (`Execution context was destroyed`)
**Log Error:**
`[PlaywrightService] Error calling tool get_state: page.evaluate: Execution context was destroyed, most likely because of a navigation`

**Issue:**
`get_state` is being executed while the page is still navigating/reloading, causing evaluation in an invalid execution context. This indicates a timing/race issue between navigation completion and state inspection, and needs guard logic (navigation stabilization or retry-on-context-destroyed).

## 11. `fs_write_file` Infinite Loop Under Safe-Mode / Sub-Agent Constraints
**Observed Behavior:**
File-write flows keep re-triggering instead of terminating after one staged write.

**Root Cause (Code-Level):**
- `fs_write_file` returns `status: "staged"` in Safe Mode and explicitly says user approval is required before apply ([`src/main/services/FileSystemService.ts:317`](/Users/meharaj/Downloads/ai-worker-whatsapp-integration/src/main/services/FileSystemService.ts:317)).
- Sub-agent prompt simultaneously enforces “don’t ask permission” while also instructing to ask user when workspace is missing, creating conflicting control flow for write tasks ([`src/renderer/src/lib/llm/prompts.ts:82`](/Users/meharaj/Downloads/ai-worker-whatsapp-integration/src/renderer/src/lib/llm/prompts.ts:82), [`src/renderer/src/lib/llm/prompts.ts:93`](/Users/meharaj/Downloads/ai-worker-whatsapp-integration/src/renderer/src/lib/llm/prompts.ts:93)).
- Loop detection only trips on identical tool signature repeats; write retries with slightly changed payloads/paths bypass this guard ([`src/renderer/src/lib/agent/ToolExecutionService.ts:79`](/Users/meharaj/Downloads/ai-worker-whatsapp-integration/src/renderer/src/lib/agent/ToolExecutionService.ts:79)).

**Issue:**
The write flow has no explicit terminal/handshake state for “staged-awaiting-approval” in agent logic, so the agent keeps attempting additional writes and appears stuck in an infinite loop.

## 12. Detailed Visibility OFF Hides Final “Scan Multiple Sites” Results and Over-Emphasizes Failed Subtasks
**Observed Behavior:**
Task completes, but compact view shows many failed subtasks and no clear final result payload.

**Root Cause (Code-Level):**
- Prod/compact rendering suppresses orchestration summaries unless `message.isFinalResult === true` ([`src/renderer/src/components/chat/MessageBubble.tsx:59`](/Users/meharaj/Downloads/ai-worker-whatsapp-integration/src/renderer/src/components/chat/MessageBubble.tsx:59)).
- `useAgent` drops `isFinalResult` when mapping runtime messages into store messages on `onMessage`, so sequential final summaries lose the “always-show” flag ([`src/renderer/src/hooks/useAgent.ts:236`](/Users/meharaj/Downloads/ai-worker-whatsapp-integration/src/renderer/src/hooks/useAgent.ts:236)).
- Checklist header is binary (`hasFailure => "Execution failed"`) and does not show per-step `result`, so partial-success runs look like hard failures ([`src/renderer/src/components/chat/SubTaskChecklist.tsx:100`](/Users/meharaj/Downloads/ai-worker-whatsapp-integration/src/renderer/src/components/chat/SubTaskChecklist.tsx:100), [`src/renderer/src/components/chat/SubTaskChecklist.tsx:153`](/Users/meharaj/Downloads/ai-worker-whatsapp-integration/src/renderer/src/components/chat/SubTaskChecklist.tsx:153)).

**Issue:**
Final answer visibility and checklist semantics diverge: completed runs can appear as “failed subtasks only” in detailed-visibility-off mode.

## 13. Parallel Delegation Regression: Multi-Site Tasks Execute as Single-Worker
**Log Evidence:**
- `Critical 1: delegate_sub_task Parallelism` failed with `Delegate signals: 1`
- Runtime log shows: `[OrchestrationService] Throttling parallel sub-agents to 1/2 workers for model "qwen/qwen3.6-plus:free".`

**Issue:**
Tasks that should fork/delegate across multiple sites are effectively serialized for this model path. This breaks expected parallel behavior and increases latency for comparison prompts.

## 14. Conditional Multi-Site Decomposition Regression (`if possible` prompts)
**Log Evidence:**
- `Critical 2: Conditional Multi-Site Decomposition` failed with `Parallel hints: false. Delegate signals: 1`

**Issue:**
Conditional wording still degrades into single-path execution instead of maintaining multi-site decomposition/delegation. This indicates the decomposition/orchestration heuristics are too conservative for conditional instructions.

## 15. Live E2E Instability Under OpenRouter Free-Tier Rate Limits
**Log Evidence:**
- Repeated `429` responses with long waits: `Retrying ...` and `Waiting 59005ms for OpenRouter free-tier reset window`.

**Issue:**
Critical-path runs become non-deterministic and very slow because retries/backoff dominate execution time. This obscures genuine app regressions and frequently aborts long critical scenarios before completion.

## 16. Residual Sub-Agent Activity Bleeds Across Sequential Prompts
**Observed Behavior:**
While the next critical prompt is already running, logs from prior sub-agents/tabs continue to emit tool calls and completions.

**Issue:**
Prompt boundaries are not cleanly isolated in runtime activity, making per-prompt diagnostics noisy and increasing false positives/negatives in critical assertions that depend on log matching.

## 17. WebLLM Startup Error in Renderer (`caches is not defined`)
**Log Evidence:**
`[WebLLM] Failed to check downloaded models: ReferenceError: caches is not defined`

**Issue:**
On renderer startup, WebLLM model-cache checks reference `caches` in a context where it is unavailable. This is currently non-fatal but pollutes logs and may disable expected local model cache detection.

## 18. CSP Config Has Duplicate Directives + Blocked Analytics Script
**Log Evidence:**
- `Ignoring duplicate Content-Security-Policy directive 'script-src'/'style-src'/'connect-src'`
- `Loading the script 'https://www.googletagmanager.com/gtag/js...' violates CSP ... blocked`

**Issue:**
The CSP meta policy currently duplicates directives and still blocks the configured analytics script path. This creates noisy startup logs and indicates policy configuration drift.

## 19. Mocked E2E Still Emits Recovery Warnings (JSON/XML Tool Recovery Visibility)
**Log Evidence:**
- `⚠️ JSON recovery test failed (may need useJsonFallback fix)`
- `⚠️ XML recovery test failed`

**Issue:**
Previously, runtime recovered structured tool intent internally but mocked assertions relied on UI text and emitted non-blocking warnings.

**Status Update (Apr 4, 2026):**
- Fixed in current branch:
  - Added explicit recovery logs in LLM layer: `[LLM][Issue #19] recovery_json_success` and `[LLM][Issue #19] recovery_xml_success`.
  - Updated mocked E2E to assert recovery via deterministic log signals and removed prior non-blocking warning paths.
  - Added dedicated XML fallback mock scenario (`<agent_plan>...`) to exercise XML recovery path directly.
- Validation: `npm run -s test:mock` passes with `🎉 ALL SCENARIOS PASSED`.

## 20. Speech Runtime Log Flood: `Recognizer ... not ready, ignoring`
**Log Evidence:**
Repeated renderer errors during speech model switching and restart cycles:
`Recognizer (id: ...) not ready, ignoring`

**Issue:**
Speech flow now passes end-to-end, but recognizer readiness churn generates high-volume error logs that can hide real failures and suggests missing debounce/state gating around recognizer lifecycle transitions.

**Status Update (Apr 4, 2026):**
- Mitigated in current branch: repeated recognizer-not-ready errors are now rate-limited in the audio processing loop.
- Validation: `npm run -s test:speech` completed without the prior log flood pattern.

## 21. Build Gate Fails: `electron-store` Not Bundled in Main Bundle
**Log Evidence:**
`npm run test:build` fails in `check:bundle` with:
`FAIL: electron-store is NOT left as an external require (it is bundled)`
and bundle scan shows:
`const StoreRaw = require("electron-store");`

**Issue:**
Post-build integrity verification currently fails because the emitted `out/main/index.js` still contains external `require("electron-store")`, while checks require `electron-store` to be bundled/inlined for CJS runtime safety.

## 22. macOS Packaging Regression: DMG Generation Fails in `build:mac:arm`
**Log Evidence:**
`hdiutil: create failed - Device not configured`
followed by:
`plistlib.InvalidFileException` from `dmg-builder` Python wrapper.

**Issue:**
mac build completes JS bundle, app packaging, signing, and ZIP creation, but fails at DMG creation. This blocks `publish:mac`/`publish:all` flows because they invoke mac packaging with DMG target enabled.

## 23. Windows Packaging Fails on Native Rebuild Cross-Compile (`better-sqlite3`)
**Log Evidence:**
Direct packaging test:
`npx electron-builder --win --x64 --config.directories.output=dist/win-release-smoke`
fails with:
`node-gyp does not support cross-compiling native modules from source.`

**Issue:**
Windows packaging on current host fails during `@electron/rebuild` of `better-sqlite3` for x64 target. This blocks Windows publish paths (`publish:win`, `publish:all --win`) in this environment.

## 24. Windows Build Entrypoints Enforce `check:wine` and Fail Fast in Current Environment
**Log Evidence:**
`npm run check:wine` returns:
`Error: Wine is required for Windows builds on Linux. Please run ./install_build_deps.sh to install it.`

**Issue:**
`build:win*` and `rebuild:win*` npm scripts are hard-gated by `check:wine`, causing immediate failures in environments without `wine`, before any packaging fallback/path-specific handling can occur.

## 25. Mocked E2E Contains Hidden Assertion Failures While Suite Exits Green
**Log Evidence (from `npm run -s test:mock`):**
- `⚠️ Handoff test failed`
- `❌ Plan Response missing`
- Final line still reports success: `🎉 ALL SCENARIOS PASSED (with handled warnings)`

**Issue:**
Mocked E2E currently downgrades some scenario failures to warnings and still returns exit code 0. This can mask orchestration regressions in CI unless these specific checks are promoted back to hard assertions or split into explicit non-blocking diagnostics.

**Status Update (Apr 4, 2026):**
- Fixed in current branch: handoff and sequential-plan checks are hard assertions again, and `npm run -s test:mock` now fails on regressions and passes when signals are present.

## 26. Real E2E Still Fails Sequential and Conditional-Orchestration Criticals (2026-04-04 run)
**Log Evidence (from `node tests/real_e2e_test.cjs` on Apr 4, 2026):**
- `❌ S02: Sequential Orchestration — Plan created: false ... Timed out after 180.5s`
- `❌ Critical 2: Conditional Multi-Site Decomposition — Completed: false ... Timed out after 195.2s`
- Final summary: `Total: 20 | Passed: 18 | Failed: 2`

**Issue:**
Core orchestration behavior is still unstable in live flow: sequential planning can fail to materialize and conditional multi-site decomposition still misses expected branching/delegation. This remains a release blocker for production-like real runs.

## 27. Multiple "Pass" Scenarios Are Reporting Degraded Signals (False-Positive Risk)
**Log Evidence (same Apr 4, 2026 real suite):**
- `✅ S21A ... Action cards: 0 (expected 1)`
- `✅ S21C ... Progress signals: false`
- `✅ S15 ... Checkpoints fired: 0`

**Issue:**
Several scenarios are marked passed while key acceptance signals are missing. This weakens regression detection and can allow UX-level breakages (progress/action-card/checkpoint visibility) to ship unnoticed unless pass criteria are tightened.
