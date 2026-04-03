# Implementation Plan: Remote LLM Model Config

## Goal
On app start, fetch a remote JSON file defining the recommended default model per provider. Non-technical users never have to pick a model. App owners can change defaults without shipping an update. Designed to later swap the hardcoded JSON constant for a live URL (GitHub raw, CDN, etc).

---

## Gap Analysis (Found During Audit)

These gaps in the original plan would have caused bugs or broken existing behaviour:

> [!WARNING]
> **GAP 1 — Zustand `persist` overwrite collision**
> The settings store persists model fields to `electron.store`. On rehydration, the persisted user value (e.g. `geminiModel: "gemini-1.5-pro"`) is restored *after* our remote config init. If we set remote defaults first, they will be overwritten by `onRehydrateStorage`. We must apply remote defaults *after* rehydration completes.

> [!WARNING]
> **GAP 2 — Firebase sync overwrites remote defaults**
> `useSettingsSync` syncs `geminiModel`, `openaiModel`, `openrouterModel`, `ollamaModel` to Firestore and rehydrates them on login. A user's cloud-saved model will overwrite the remote default. Strategy: remote config is a **first-boot/migration** default only — it never overwrites a user's explicit choice.

> [!CAUTION]
> **GAP 3 — Hardcoded fallbacks in 3 files will be bypassed**
> `llm.ts` lines 78, 98, 116 and `gemini-provider.ts` line 64 fall back to `LLM_CONFIG.*_MODEL` if `settings.Xmodel` is falsy. `SettingsPanel.tsx` lines 414/549/693/791 have the same hardcoded string fallbacks in the UI. If we update the store default, these raw-string fallbacks (`'gemini-1.5-flash'`, `'gpt-4o-mini'` etc.) will still show stale old values in edge cases (e.g. model field cleared). These must also be updated.

> [!IMPORTANT]
> **GAP 4 — No migration for existing installs**
> Users who already have a model saved locally from before this feature won't be affected. That's **intentional** — we never overwrite a user's explicit choice. But we need a clear rule: *only apply remote defaults if the stored model is empty/missing*.

> [!NOTE]
> **GAP 5 — Antigravity/Gateway model list**
> `SUPPORTED_GATEWAY_MODELS` in `antigravity-gateway.ts` is a separate hardcoded set. It should also be driven by the remote config in a future phase, but is out of scope for now.

---

## Proposed Changes

### Step 1 — Config file (single source of truth)
#### [NEW] `src/renderer/src/lib/model-config.json`
A plain JSON file (later swapped for a fetch from a Git raw URL):
```json
{
  "version": 1,
  "providers": {
    "gemini":     { "default": "gemini-2.0-flash-lite",              "label": "Gemini 2.0 Flash Lite" },
    "openai":     { "default": "gpt-4o-mini",                        "label": "GPT-4o Mini" },
    "openrouter": { "default": "anthropic/claude-3-haiku",           "label": "Claude 3 Haiku" },
    "ollama":     { "default": "qwen2.5:3b",                         "label": "Qwen 2.5 3B" }
  }
}
```

#### [NEW] `src/renderer/src/lib/remote-config.ts`
A thin service that:
- Imports the local JSON **for now** (one line change later to `fetch(REMOTE_URL)`).
- Caches the result in memory.
- Exports `getRemoteConfig()` and `getDefaultModel(provider)`.
- Degrades gracefully: if fetch fails, falls back to `LLM_CONFIG` constants.

---

### Step 2 — Apply defaults on first run only
#### [MODIFY] `src/renderer/src/stores/settingsStore.ts`
- Add `applyRemoteDefaults()` action (called from the app once, after rehydration).
- Rule: **only write to store if the current stored value is empty/falsy** — never overwrites user's choice.
- Timing: call it inside `onRehydrateStorage` callback, or expose it for the app shell to call once Zustand hydration is confirmed complete.

---

### Step 3 — Replace hardcoded fallback strings
#### [MODIFY] `src/renderer/src/lib/llm.ts`
- Replace literal fallback strings (`LLM_CONFIG.OLLAMA.DEFAULT_MODEL` etc.) with `getDefaultModel(provider)` from `remote-config.ts`.
#### [MODIFY] `src/renderer/src/lib/gemini-provider.ts`
- Same: replace `LLM_CONFIG.GEMINI.DEFAULT_MODEL` with `getDefaultModel('gemini')`.
#### [MODIFY] `src/renderer/src/components/SettingsPanel.tsx`
- Replace hardcoded placeholder strings in `ModelSelect` calls with the remote config value.

---

### Step 4 — UI badge (optional, low priority)
#### [NO CHANGE] `src/renderer/src/components/ModelSelect.tsx`
The `ModelSelect` component already shows the selected model cleanly. We can add a small `"Recommended"` chip to the dropdown item matching the remote default. This is cosmetic and not required for the feature to work — can be a follow-up.

---

## Verification Plan

### Automated Tests
```bash
npx tsc --noEmit   # must pass with 0 errors
npm run dev:clean  # dev server must start without errors
```

### Manual Scenarios
1. **Fresh install** — open Settings > LLM, all providers should show the recommended model pre-selected.
2. **Existing user** — open Settings > LLM, existing model choice is preserved (not overwritten).
3. **User changes model** — manually pick a different model, restart app, change must persist.
4. **Remote config simulated failure** — temporarily break the import/fetch, verify app still boots and falls back to `LLM_CONFIG` constants.
