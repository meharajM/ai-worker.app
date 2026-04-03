# AI Worker Identified Issues

This log contains the issues tracked during end-to-end testing of the AI Worker execution flow.

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
Timeout limits may need to be increased or the `TaskDecomposer` prompt may need optimization for the updated `nvidia/nemotron-3-super-120b-a12b:free` model.

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
- Runtime log shows: `[OrchestrationService] Throttling parallel sub-agents to 1/2 workers for model "nvidia/nemotron-3-super-120b-a12b:free".`

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
Runtime appears to recover structured tool intent internally, but expected UI-facing recovery markers are not consistently visible in mocked E2E. This is now non-blocking for suite pass, but indicates a visibility/assertion gap for recovery behavior.

## 20. Speech Runtime Log Flood: `Recognizer ... not ready, ignoring`
**Log Evidence:**
Repeated renderer errors during speech model switching and restart cycles:
`Recognizer (id: ...) not ready, ignoring`

**Issue:**
Speech flow now passes end-to-end, but recognizer readiness churn generates high-volume error logs that can hide real failures and suggests missing debounce/state gating around recognizer lifecycle transitions.

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
