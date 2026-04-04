# Issue Fix Plan (Open Issues)

Last Updated: 2026-04-04
Owner Branch: `codex/issues-fixes`

## Scope

This plan covers currently pending issues:

- `#2` Browser protocol errors on retail domains
- `#3` Fallback quality degradation after navigation failure
- `#4` Decomposition/orchestration timeout risk
- `#7` `wait_for_navigation` timeout behavior
- `#8` Browser relaunch thrash / stale socket churn
- `#9` `navigate` timeout behavior on heavy pages
- `#10` `get_state` navigation race
- `#14` Conditional multi-site decomposition over-serialization
- `#23` Windows cross-compile limitation (release workflow)
- `#26` Sequential/conditional orchestration reliability
- `#27` UX quality gate gaps (action/progress/checkpoint fidelity)

Out of scope (explicitly deferred): `#15` provider rate limiting / 429 behavior.

## Priority (Most user-visible first)

1. `#2`
2. `#9`
3. `#7`
4. `#10`
5. `#3`
6. `#4`
7. `#14`
8. `#26`
9. `#8`
10. `#27`
11. `#23`

## Phase Plan

### Phase A: Browser Runtime Correctness (`#2 #7 #9 #10 #3`)

Goal: make navigation + state extraction deterministic on slow/dynamic/anti-bot pages.

Implementation targets:

- `src/main/services/playwright/tools/NavigateTool.ts`
- `src/main/services/playwright/tools/MiscTools.ts`
- `src/main/services/playwright/tools/GetStateTool.ts`
- `src/renderer/src/lib/agent/ToolExecutionService.ts`
- `src/renderer/src/lib/result-reporter.ts`

Detailed fixes:

1. Navigation outcome contract (`#2 #9 #3`)
- Add explicit outcome classes in tool result payload:
  - `success`
  - `interactive_timeout`
  - `protocol_blocked`
  - `hard_failure`
- Replace blind Google fallback with staged recovery:
  - retry `waitUntil=commit`
  - readiness probe snapshot
  - compact state extraction
  - scoped web search fallback as last resort

2. Unified readiness probe (`#7 #10`)
- Create a shared helper (`readyState`, interactive elements count, optional heartbeat check).
- Use the same probe in `wait_for_navigation` and `get_state` retry paths.
- Keep bounded retries and reason-tagged logs for each retry branch.

3. Error/retry policy tightening (`#2 #7 #9 #10`)
- Keep cumulative timeout guard in `ToolExecutionService`.
- Distinguish retriable vs non-retriable protocol failures.
- Prevent silent downgrade to generic errors when a typed outcome exists.

Validation:

- `npm run -s test:playwright`
- `npm run -s test:regression:critical`
- `node tests/real_e2e_test.cjs --critical-only --only-critical=3`
- Focused manual run with retail targets from existing real E2E scenarios

Done criteria:

- No uncontrolled `Execution context was destroyed` loops in targeted runs.
- `navigate` emits typed outcome metadata on all timeout/protocol failure branches.
- `wait_for_navigation` and `get_state` share one readiness decision model.

---

### Phase B: Decomposition and Orchestration Reliability (`#4 #14 #26`)

Goal: keep multi-site intent correct and avoid unnecessary serialization/timeouts.

Implementation targets:

- `src/renderer/src/lib/task-decomposer.ts`
- `src/renderer/src/lib/agent-runtime.ts`
- `src/renderer/src/lib/agent/OrchestrationService.ts`
- `src/renderer/src/lib/llm/prompts.ts`

Detailed fixes:

1. Decomposition decision contract (`#4 #14`)
- Extend decomposition result with:
  - `confidence`
  - `decisionSource` (`heuristic` / `llm`)
  - `fallbackReason`
- Add deterministic guard:
  - explicit multi-site + optional conditional wording should remain multi-context unless dependency chain is explicit.

2. Timeout-aware decomposition path (`#4`)
- Add deadline-aware decomposition mode for complex prompts.
- If LLM decomposition nears timeout budget, force deterministic heuristic path instead of broad fallback.

3. Orchestration invariants (`#26 #14`)
- Ensure exactly one terminal summary for each orchestration run.
- Keep step status transitions monotonic and run-scoped.
- Prevent mixed/duplicate final states from overlapping sub-agent completions.

Validation:

- `node tests/real_e2e_test.cjs --critical-only --only-critical=1,2,3`
- Full `S02` scenario in `tests/real_e2e_test.cjs`
- `npm run -s test:mock`

Done criteria:

- Critical 2 passes consistently across reruns.
- `S02` passes without false sequential collapse.
- No duplicate terminal summary for a single orchestration run.

---

### Phase C: Lifecycle and UX Signal Quality (`#8 #27`)

Goal: eliminate launch churn and make UI quality gates strict.

Implementation targets:

- `src/main/services/playwright/BrowserManager.ts`
- `src/renderer/src/hooks/useAgent.ts`
- `src/renderer/src/components/chat/MessageBubble.tsx`
- `src/renderer/src/components/chat/SubTaskChecklist.tsx`
- `tests/real_e2e_test.cjs`
- `tests/regression_critical_checks.cjs`

Detailed fixes:

1. Browser relaunch suppression (`#8`)
- Add launch cooldown/rate-limiter in `BrowserManager.ensureBrowser`.
- Track close reason (`idle_close`, `manual_close`, `context_crash`) for diagnostics.
- Add soft guard against rapid stale-socket cleanup cycles.

2. UX signal hardening (`#27`)
- Tighten final-result expectations in compact mode:
  - do not surface failure badge unless terminal state is failed.
- Harden progress/checkpoint/action-card assertions in real E2E:
  - require terminal-state signal
  - detect duplicate terminal updates
  - detect stale active run after completion

Validation:

- `npm run -s test:regression:critical`
- `npm run -s test:mock`
- `npm run -s test:e2e:real:focus`
- `node tests/real_e2e_test.cjs --critical-only`

Done criteria:

- No repeated browser launch thrash pattern in focused runs.
- Quality gates fail on degraded UX signaling, not just hard timeout.

---

### Phase D: Release Workflow Policy (`#23`)

Goal: keep Windows build behavior explicit and stable.

Implementation targets:

- `scripts/check-win-build-prereqs.sh`
- `package.json` Windows build/publish scripts
- `tests/prebuild_checks.cjs`
- `architecture.md`

Detailed fixes:

1. Keep policy explicit (`#23`)
- Preserve Windows-host-first packaging requirement.
- Preserve override gate via `ALLOW_UNSUPPORTED_WIN_CROSS_BUILD=1`.

2. Add guardrail tests (`#23`)
- Assert preflight script messaging and failure semantics.
- Assert Windows build scripts always call preflight before builder invocation.

Validation:

- `npm run check:prebuild`
- `npm run test:build`

Done criteria:

- Non-Windows host failure path is deterministic and actionable.
- Script behavior and architecture documentation remain aligned.

## Issue-by-Issue Acceptance Criteria

### `#2` Protocol errors
- Protocol-blocked outcomes no longer terminate as opaque fatal errors.
- Recovery path is deterministic and logged with outcome class.

### `#3` Fallback quality
- Fallback includes structured extraction path before generic search.
- Result quality checks pass in retail comparison scenarios.

### `#4` Timeout risk
- Decomposition avoids long LLM stalls through deadline-aware fallback.
- No frequent decomposition timeout fallback regressions in real E2E.

### `#7` wait_for_navigation
- Uses shared readiness logic and bounded retries.
- Fewer false hard-failures on dynamic pages.

### `#8` Browser thrash
- Launch/cooldown counters stay below threshold in focused runs.
- No repeated rapid `SingletonSocket` cleanup bursts in normal workflow.

### `#9` navigate timeout
- Timeout branches emit typed `interactive_timeout` when page is usable.
- Fewer navigation hard failures on heavy commerce pages.

### `#10` get_state race
- Navigation race retries resolve without noisy repeated context-destroyed failures.
- get_state does not fail early while page is still stabilizing.

### `#14` Conditional decomposition
- Optional conditional phrasing does not incorrectly serialize independent contexts.

### `#23` Windows cross-compile policy
- Preflight behavior remains explicit and tested.

### `#26` Sequential/conditional reliability
- `S02` and conditional criticals pass consistently across clean reruns.

### `#27` UX quality gates
- Final result visibility, progress, and checklist semantics are validated by strict gates.

## Execution and Commit Plan

1. Implement Phase A and commit.
2. Implement Phase B and commit.
3. Implement Phase C and commit.
4. Implement Phase D and commit.
5. Run full validation matrix and update:
   - `new-issues.md`
   - `root-causes.md`
   - `architecture.md` (if behavior/policy changed)

## Validation Matrix (Final Gate)

- `npm run -s test:regression:critical`
- `npm run build`
- `npm run -s test:mock`
- `npm run -s test:e2e:real:focus`
- `node tests/real_e2e_test.cjs --critical-only`

