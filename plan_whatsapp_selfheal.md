# WhatsApp Priority + Partial Reporting + Live LLM Tests (Safe, Small-LLM Ready)

## Goals
- Enforce WhatsApp-first approvals without altering existing safe-mode semantics when WA is disconnected.
- Ensure abrupt/aborted runs return a useful partial-work summary instead of generic failure text.
- Add deterministic and live regression tests; keep scope additive and backward compatible.

## Non-Breaking Guardrails
- No default behavior changes when WhatsApp is disconnected or safe mode is off.
- Preserve existing tab/lane cleanup; no new global state; all new fields are optional/nullable.
- Keep public IPC signatures backward compatible (only additive fields/keys).

## Phase A — WhatsApp-first approvals (Main process, renderer UI)
1) Data model (non-breaking, additive)
   - File: `src/main/services/FileSystemService.ts`
   - Add fields to FileChange: `approvalChannel ('desktop'|'whatsapp')`, `approvalToken`, `status ('pending'|'approved'|'rejected'|'expired')`, `createdAt`, `resolvedAt`, `resolvedBy`.
   - Default channel = 'desktop'; status = 'pending'; tokens only required when channel is 'whatsapp'.

2) Tokenized WA prompts
   - Trigger only when `whatsappEnabled && connectionState.status==='connected'`.
   - Message format: `APPROVE <token>` / `REJECT <token>`; include filename and session hint.
   - Ignore plain yes/no for file approval to avoid accidental approvals.

3) Approval routing rules
   - If channel='whatsapp', desktop modal becomes read-only for that change (show info + link to retry via WA); allow fallback after timeout/disconnect.
   - Timeout policy: default 5 minutes; on timeout, set status='expired' and requeue to desktop channel with new token.
   - Disconnect handling: if WA disconnects while pending, auto-fallback to desktop channel without losing staged file.

4) IPC and types (additive)
   - Update handlers: `src/main/ipc/fs.ts` to surface new fields and accept token-based approve/reject.
   - Preload/typing: `src/preload/index.ts`, `src/renderer/src/env.d.ts` to expose new IPC shapes.

5) Renderer UI
   - File: `src/renderer/src/components/FileChangeReview.tsx`
   - Show channel badge + token; disable approve/reject buttons when channel='whatsapp' and pending; show fallback CTA when expired/disconnected.

Acceptance (Phase A)
- WA connected: approval requests send tokenized prompts; desktop cannot override until timeout/disconnect.
- WA disconnected: behavior identical to current (desktop-only modal).
- Timeout/disconnect: staged change reappears in desktop modal and can be approved there.

## Phase B — Partial result on abrupt end (Main loop + orchestration)
1) Work ledger (new file)
   - Add `RunWorkLedger` under `src/renderer/src/lib/agent/` to record per-run artifacts: tool outputs (presentable + last error), sub-agent summaries/salvage, execution-plan step results, progress checkpoints.

2) Integration points
   - `src/renderer/src/lib/agent-runtime.ts`: record successes/errors per tool call; on catch/finally assemble ledger summary (Completed/Partial/Failed) before returning; keep existing tab cleanup.
   - `src/renderer/src/lib/agent/OrchestrationService.ts` and `src/renderer/src/lib/agent/SpecialToolHandlers.ts`: push sub-agent results and salvage text into ledger.

3) Final message on failure/abort
   - `src/renderer/src/hooks/useAgent.ts`: on exception/abort, render ledger summary instead of generic error; include last error string and partial data.

Acceptance (Phase B)
- User abort, LLM error, or consecutive-error bailout yields a message containing at least: completed items, partial findings, last error.
- No regression in progress clearing or tab/lane cleanup.

## Phase C — Tests (deterministic + live, small-model friendly)
1) Deterministic tests
   - Approval state-machine: token parsing, WA priority, timeout fallback; target `FileSystemService` via IPC harness.
   - Partial-report path: mocked e2e to force abort and assert summary presence (extend `tests/e2e_ui_mocked.cjs` or add a lean e2e).

2) Live OpenRouter suite (manual/CI opt-in)
   - Add `tests/live/openrouter.env.template`; ignore `tests/live/.env.local` containing `AIW_OPENROUTER_API_KEY` and `AIW_OPENROUTER_MODEL`.
   - Tests: `tests/live/live_llm_smoke.cjs`, `tests/live/live_agent_partial_report.cjs` (no mocks; short prompts to fit small models).
   - Scripts (additive, no defaults change): `test:live:openrouter`, `test:approval`, `test:abrupt-summary`, `test:regression:critical`, `test:regression:live`.

### Test Cases (explicit)
- Deterministic (no external keys)
  - WA token happy path: stage write, WA connected, approve via `APPROVE <token>`, assert commit + status cleared.
  - WA disconnected fallback: stage write with WA off, ensure desktop modal approve works and leaves status approved.
  - WA timeout: stage write with WA on, withhold reply, after timeout status=expired and desktop approve succeeds.
  - Partial summary on abort: trigger consecutive-error bailout; final message includes Completed/Partial/Failed sections.
  - Sub-agent crash salvage: force `delegate_sub_task` crash; summary contains salvaged findings.
- Live (OpenRouter; skip if no env)
  - Live smoke: single short prompt completes with 200 OK using `AIW_OPENROUTER_MODEL`.
  - Live partial-report: induce controlled tool error and verify partial summary is returned.
  - Live WA approval (optional): if WA connected, send tokenized approve and verify commit; otherwise auto-skip.

Acceptance (Phase C)
- Deterministic suite passes locally without external keys.
- Live suite skips gracefully when env keys are absent; when present, completes within configured timeout.

## Safeguards & Rollback
- Feature flags not required; all additions are opt-in via connection state or presence of env keys.
- No schema removals; existing clients continue to function.
- If WA path fails, desktop approval continues to work; if ledger fails, existing error path remains.

## Out of Scope (to keep plan focused)
- No UI redesign beyond minimal badges/disable states in FileChangeReview.
- No changes to Playwright tab provisioning or MCP server lifecycle.
