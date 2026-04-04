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
- Finding: focused `S05` now passes (~55.7s); decomposer now maps common site aliases (e.g., `amazon`, `ebay`, `bestbuy`) to explicit contexts to avoid unnecessary LLM decomposition calls. Full-suite decomposition stress still needs confirmation.

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
- Status: Open.
- Finding: still appears in live scenarios.

## #8 Browser launch thrash / stale profile socket churn
- Root cause: browser lifecycle reuse/concurrency guard gaps.
- Status: Needs re-test.
- Finding: no fresh deterministic repro in latest focused run.

## #9 `navigate` hard timeout on heavy pages
- Root cause: static timeout + heavy script/anti-bot pages without adaptive fallback.
- Status: Open.
- Finding: still occurs in live retail navigation.

## #10 `get_state` race during navigation
- Root cause: state extraction called before page lifecycle stabilizes.
- Status: Needs re-test.
- Finding: no fresh deterministic repro in latest focused run.

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
- Finding: repeated 429/backoff patterns in real runs.

## #16 Residual sub-agent activity across prompt boundaries
- Root cause: asynchronous/background completion overlap and shared log stream visibility.
- Status: Mitigated in harness, runtime revalidation pending.
- Finding: nested delegation is blocked and a reflector cancel hook aborts active runs on prompt restart. Real-E2E now enforces run-idle before scenario handoff, reducing cross-scenario bleed from early keyword exits.

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
- Status: Open.
- Finding: mocked runs still warn on recovery visibility checks.

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
- Finding: immediate-reply and mocked-plan/handoff gates are tightened and passing; real-E2E now also blocks early keyword completion while run is active. Full-suite action-card/progress/checkpoint signal quality still needs complete re-validation.

## Recent Validation Notes
- Added focused live runner: `tests/real_e2e_focus.cjs` (`npm run -s test:e2e:real:focus`).
- Focused live result: `S05` pass, `S21G` pass (`S21G` now runs after deterministic chat-state reset for true first-turn behavior).
- Added regression guard for immediate no-tool direct-answer mode in `tests/regression_critical_checks.cjs`.
- Latest critical-only live run: `node tests/real_e2e_test.cjs --critical-only` passed all 5 critical checks after stabilizing Critical 4 completion criteria.
- Latest speech rerun: `npm run -s test:speech` passed with recognizer flood suppressed; placeholder check now classifies active voice controls as info-level timing instead of warning.
