# Root Causes by Issue (Apr 4, 2026)

This file tracks technical root cause, current status, and latest verification signal for each issue in `new-issues.md`.

## #1 Memory create parse errors (`memory_create_entity`)
- Root cause: memory adapter consumed mixed payload text and assumed strict single-JSON body.
- Status: Likely fixed.
- Finding: no recent `Failed to parse create_entities response` in latest focused/critical checks.

## #2 Browser protocol error on specific retail sites
- Root cause: target site anti-bot/protocol-level failures (`ERR_HTTP2_PROTOCOL_ERROR`) outside app-level control path.
- Status: Open.
- Finding: still intermittently observed in live browser runs.

## #3 Fallback quality degradation after navigation failure
- Root cause: fallback to `web_search`/non-interactive extraction loses structured DOM fidelity vs successful direct navigation.
- Status: Open.
- Finding: still a quality gap on dynamic commerce pages.

## #4 LLM analysis / orchestration timeouts
- Root cause: long tool/LLM chains under decomposition paths and dynamic pages exceed scenario timeout budgets.
- Status: Mitigated, needs re-test.
- Finding: decomposer now maps common site aliases (e.g., `amazon`, `ebay`, `bestbuy`) to explicit contexts to avoid unnecessary LLM decomposition calls; runtime now bypasses decomposition for direct-answer prompts (`skipping_decomposition_for_direct_answer`); geolocation context fetch now has timeout/backoff to avoid repeated prompt-build stalls under network failure. Full-suite decomposition stress still needs confirmation.

## #5 MarkItDown sidecar startup noise (`uvx` missing)
- Root cause: eager sidecar init without validating runtime dependency availability.
- Status: Mitigated.
- Finding: startup no longer hard-fails app flow; noise reduced but dependency remains optional.

## #6 Startup memory search parse failure
- Root cause: same multi-part payload parsing fragility as #1 in early cache load/search path.
- Status: Likely fixed.
- Finding: no blocking startup crash in latest validation.

## #7 `wait_for_navigation` strict timeout
- Root cause: fixed short waits on slow/dynamic pages.
- Status: Mitigated / needs clean re-test.
- Finding: tool now uses per-state timeout budget and heuristic completion (readyState/interactive-elements) instead of hard-failing all timeout paths. Full live confirmation still pending under lower 429 pressure.

## #8 Browser launch thrash / stale profile socket churn
- Root cause: browser lifecycle reuse/concurrency guard gaps.
- Status: Needs re-test.
- Finding: no fresh deterministic repro in latest focused run.

## #9 `navigate` hard timeout on heavy pages
- Root cause: static timeout + heavy script/anti-bot pages without adaptive fallback.
- Status: Mitigated / needs clean re-test.
- Finding: `navigate` now returns soft-success when timeout occurs but DOM is interactive (`readyState`/interactive count), reducing false hard failures on heavy pages.

## #10 `get_state` race during navigation
- Root cause: state extraction called before page lifecycle stabilizes.
- Status: Mitigated / needs clean re-test.
- Finding: `get_state` now applies broader navigation-race recovery across evaluate paths (including highlight cleanup) and retries up to 3 attempts; latest runtime stability signal reported `Execution-context-destroyed: 0`.

## #11 `fs_write_file` loop under staged approval
- Root cause: agent loop lacked terminal pause state for staged/approval-required writes.
- Status: Fixed.
- Finding: runtime guard (`isWriteAwaitingApproval`) plus pause message; critical regression passes.

## #12 Compact mode final-result visibility mismatch
- Root cause: final-result semantics and checklist status rendering diverged in non-detailed mode.
- Status: Fixed.
- Finding: final-output visibility critical now passes.

## #13 Parallel delegation regression
- Root cause: non-parallel delegate execution path collapsed same-turn delegated tasks.
- Status: Fixed.
- Finding: runtime keeps all-same-turn `delegate_sub_task` batch in `Promise.all`; critical passes.

## #14 Conditional decomposition over-serialization
- Root cause: decomposition heuristic still too conservative for conditional multi-site phrasing.
- Status: Mitigated / needs full-suite re-test.
- Finding: `Critical 2` passed in latest critical-only live validation; full-suite `S02` path still needs confirmation.

## #15 OpenRouter free-tier rate-limit instability
- Root cause: provider minute limits and retry windows dominate long live runs.
- Status: Open (intentionally not prioritized now).
- Finding: repeated 429/backoff patterns in real runs (also observed as transient retry in latest focused run startup).

## #16 Residual sub-agent activity across prompt boundaries
- Root cause: asynchronous/background completion overlap and shared log stream visibility.
- Status: Mitigated.
- Finding: nested delegation is blocked, reflector cancellation aborts active runs on prompt restart, real-E2E enforces run-idle before scenario handoff, and low-signal direct prompts now skip memory reflection to reduce post-response background noise.

## #17 WebLLM `caches` startup error
- Root cause: cache API access without runtime capability guard.
- Status: Fixed.
- Finding: guard added; no startup crash signal in latest runs.

## #18 CSP duplicate directives + blocked analytics
- Root cause: duplicated CSP directives and analytics source mismatch.
- Status: Likely fixed / needs periodic re-check.
- Finding: duplicate CSP warnings not dominant in latest focused run.

## #19 Recovery visibility in mocked E2E
- Root cause: JSON/XML recovery can happen internally while UI-facing assertions miss/underreport markers.
- Status: Fixed.
- Finding: explicit recovery markers now emitted (`[LLM][Issue #19] recovery_json_success`, `[LLM][Issue #19] recovery_xml_success`) and mocked E2E asserts these signals directly; suite passes.

## #20 Speech recognizer readiness log flood
- Root cause: recognizer lifecycle transitions emit repeated non-actionable “not ready” logs.
- Status: Mitigated.
- Finding: added rate-limited suppression in audio processing catch path; latest `npm run -s test:speech` no longer showed repeated flood pattern.

## #21 Bundle-integrity check mismatch
- Root cause: check expectations drifted from emitted main bundle dependency shape.
- Status: Fixed.
- Finding: `test:build` + bundle checks now passing per current matrix.

## #22 macOS packaging DMG regression
- Root cause: DMG generation environment fragility (`hdiutil`/builder path), despite successful ZIP packaging.
- Status: Mitigated.
- Finding: policy shifted to ZIP-first, DMG optional.

## #23 Windows native rebuild cross-compile
- Root cause: native module rebuild (`better-sqlite3`) unsupported for host/target combination.
- Status: Open / by design in current host setup.
- Finding: explicit preflight path required.

## #24 Windows wine hard-gate behavior
- Root cause: scripts failed early with non-actionable gating semantics.
- Status: Fixed.
- Finding: host-aware preflight and actionable messaging added.

## #25 Mocked E2E warning-pass false green
- Root cause: warning downgrade allows suite exit 0 with scenario-level functional misses.
- Status: Fixed.
- Finding: plan/handoff checks are hard assertions again; `npm run -s test:mock` now exits non-zero on misses and currently passes clean.

## #26 Real E2E sequential + conditional critical failures
- Root cause: orchestration reliability gaps remain under full live workflow load.
- Status: Mitigated / needs full-suite re-test.
- Finding: latest critical-only run is green (`Critical 2` pass), but `S02` is not part of the critical-only subset.

## #27 Pass criteria too lax for degraded UX signals
- Root cause: scenario assertions focus on timeout/completion but underweight action-card/progress/checkpoint quality signals.
- Status: Open (partially mitigated).
- Finding: immediate-reply and mocked-plan/handoff gates are tightened and passing; real-E2E blocks early keyword completion while run is active. New mitigation landed in `click_text` (bounded timeout + compact/keyword fallback) and targeted validation (`--only-critical=3`) now passes Critical 3 in 51.3s. Full-suite action-card/progress/checkpoint signal quality still needs complete re-validation.

## Recent Validation Notes
- Added focused live runner: `tests/real_e2e_focus.cjs` (`npm run -s test:e2e:real:focus`).
- Focused live result (latest): `S05` pass (~84.8s), `S21G` pass (~11.6s, no tools) with deterministic chat-state reset for true first-turn behavior and direct-answer decomposition bypass active.
- Added regression guard for immediate no-tool direct-answer mode in `tests/regression_critical_checks.cjs`.
- Latest critical-only live run: `node tests/real_e2e_test.cjs --critical-only` passed all 5 critical checks after stabilizing Critical 4 completion criteria.
- Latest targeted critical validation: `node tests/real_e2e_test.cjs --critical-only --only-critical=3` passed (`Assistant bubbles: 6`, no execution-failed badge, runtime stability clean).
- Latest speech rerun: `npm run -s test:speech` passed with recognizer flood suppressed; placeholder check now classifies active voice controls as info-level timing instead of warning.
