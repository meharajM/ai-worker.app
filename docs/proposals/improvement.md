# AI-Worker Improvement Plan

Comprehensive improvement roadmap for enterprise users targeting US/EU markets (GDPR compliance).

## User Review Required

> [!IMPORTANT]
> **Scope Decision**: This plan covers ~30 improvements across 6 phases. Should we:
> - A) Execute all sequentially (comprehensive but longer)
> - B) Focus on top priority items first (Phases 1-2 only)
> - C) Cherry-pick specific items you want addressed first

> [!CAUTION]
> **Breaking Changes**: Phase 3 refactoring (splitting `llm.ts`) will require reviewing all imports. This is safe but needs careful testing.

---

## Phase 1: Critical Security & Foundation

Foundation layer that must be completed before other work.

---

### 1.1 Fix `webSecurity: false` Vulnerability

#### [MODIFY] [index.ts](file:///home/mhrj/Desktop/ai-worker/src/main/index.ts)

**Problem**: `webSecurity: false` disables CORS and allows XSS attacks.

**Solution**: Create a custom protocol for serving local Vosk models:

```diff
+ import { protocol } from 'electron'

// In app.whenReady():
+ protocol.registerFileProtocol('aiworker', (request, callback) => {
+   const url = request.url.replace('aiworker://', '')
+   callback({ path: path.join(app.getPath('userData'), url) })
+ })

// In BrowserWindow:
- webSecurity: false,
+ webSecurity: true,
```

Update Vosk model loading to use `aiworker://models/vosk/...` URLs.

---

### 1.2 Add Content Security Policy

#### [MODIFY] [index.ts](file:///home/mhrj/Desktop/ai-worker/src/main/index.ts)

Add CSP headers to protect against injection attacks:

```typescript
mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self' aiworker:;",
        "script-src 'self';",
        "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:*;",
        "img-src 'self' data: https:;",
        "style-src 'self' 'unsafe-inline';",
        "media-src 'self' blob:;"
      ].join(' ')
    }
  })
})
```

---

### 1.3 Add Error Tracking (Sentry)

#### [NEW] [sentry.ts](file:///home/mhrj/Desktop/ai-worker/src/main/utils/sentry.ts)

Minimal Sentry integration for production error visibility:

- Install: `npm install @sentry/electron`
- Initialize in main process with opt-in (GDPR)
- Add privacy filter for PII
- Renderer bridge via preload

---

### 1.4 Unit Test Infrastructure

#### [NEW] [vitest.config.ts](file:///home/mhrj/Desktop/ai-worker/vitest.config.ts)

Set up Vitest for unit testing:

- Configure for TypeScript + React
- Add test scripts to `package.json`
- Create example test for `dcp.ts` (already has `dcp_test.ts`)

---

## Phase 2: Performance Optimization

---

### 2.1 Firebase Modular SDK

#### [MODIFY] [firebase/index.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/firebase)

Replace full Firebase import with modular:

```diff
- import firebase from 'firebase/app'
+ import { initializeApp } from 'firebase/app'
+ import { getAuth, signInWithPopup } from 'firebase/auth'
```

**Impact**: ~200KB bundle reduction.

---

### 2.2 Lazy-load WebLLM

#### [MODIFY] [webllm.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/webllm.ts)

Wrap WebLLM in dynamic import:

```typescript
let webllmModule: typeof import('@mlc-ai/web-llm') | null = null

export async function getWebLLM() {
  if (!webllmModule) {
    webllmModule = await import('@mlc-ai/web-llm')
  }
  return webllmModule
}
```

---

### 2.3 Optimize Zustand Selectors

#### [MODIFY] [ChatView.tsx](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/components/ChatView.tsx)

Add memoized selectors to prevent unnecessary re-renders:

```typescript
import { shallow } from 'zustand/shallow'

const useActiveMessages = () => useChatStore(
  (state) => {
    const session = state.sessions.find(s => s.id === state.activeSessionId)
    return session?.messages || []
  },
  shallow
)
```

---

### 2.4 Chat History Auto-Pruning

#### [MODIFY] [chatStore.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/stores/chatStore.ts)

Add automatic cleanup of old sessions:

```typescript
const MAX_SESSIONS = 50
const MAX_SESSION_AGE_DAYS = 30

pruneOldSessions: () => {
  const cutoff = Date.now() - (MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000)
  set(state => ({
    sessions: state.sessions
      .filter(s => s.updatedAt > cutoff)
      .slice(-MAX_SESSIONS)
  }))
}
```

---

### 2.5 LLM Response Streaming

#### [MODIFY] [llm.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/llm.ts)

Add streaming support for Ollama (already supports it natively):

```typescript
export async function* streamChat(
  messages: LLMMessage[],
  settings?: LLMSettings
): AsyncGenerator<string> {
  // Ollama native streaming with stream: true
  // Yield chunks as they arrive
}
```

---

## Phase 3: Code Quality & Refactoring

---

### 3.1 Split `llm.ts` into Provider Modules

Current: 1,489 lines in single file

#### [NEW] Provider directory structure:

```
src/renderer/src/lib/llm/
├── index.ts          # Re-exports and main chat()
├── types.ts          # Shared types
├── ollama.ts         # Ollama provider
├── openai.ts         # OpenAI provider
├── gemini.ts         # Gemini provider
├── openrouter.ts     # OpenRouter provider
├── webllm.ts         # WebLLM provider
└── utils.ts          # Shared utilities
```

---

### 3.2 Refactor SettingsPanel

Current: 1,339 lines, overwhelming for enterprise users

#### [NEW] Tabbed settings structure:

```
src/renderer/src/components/settings/
├── SettingsPanel.tsx        # Tab container (reduced to ~100 lines)
├── AccountSection.tsx       # User account, sync
├── VoiceSection.tsx         # TTS, STT settings
├── LLMSection.tsx           # Provider config
├── BrowserSection.tsx       # Playwright settings
└── AdvancedSection.tsx      # Developer options
```

---

### 3.3 Standardize Error Handling

#### [NEW] [result.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/result.ts)

```typescript
export type Result<T, E = string> = 
  | { ok: true; value: T }
  | { ok: false; error: E }

export const Ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error })
```

Migrate critical functions to use Result pattern.

---

## Phase 4: UX Improvements for Enterprise

---

### 4.1 First-Run Onboarding

#### [NEW] [Onboarding.tsx](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/components/Onboarding.tsx)

Multi-step wizard:
1. Welcome screen with AI-Worker branding
2. LLM provider selection (with "I don't know" option → defaults)
3. Voice preferences (enable/disable, test mic)
4. Quick tour overlay highlighting key UI areas

Store completion in `settingsStore.hasCompletedOnboarding`.

---

### 4.2 Settings Search

#### [MODIFY] [SettingsPanel.tsx](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/components/SettingsPanel.tsx)

Add search functionality to find settings quickly:

```tsx
<input 
  placeholder="Search settings..."
  onChange={e => setSearchQuery(e.target.value)}
/>
// Filter visible sections based on query
```

---

### 4.3 Chat Export

#### [NEW] [ChatExport.tsx](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/components/ChatExport.tsx)

Export current session or all history:
- Markdown format (human-readable)
- JSON format (machine-readable)
- Add export button to ChatView header

---

### 4.4 Message Search

#### [MODIFY] [ChatSidebar.tsx](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/components/ChatSidebar.tsx)

Add full-text search across all sessions:

```typescript
const searchMessages = (query: string) => {
  return sessions.flatMap(s => 
    s.messages.filter(m => 
      m.content.toLowerCase().includes(query.toLowerCase())
    ).map(m => ({ ...m, sessionId: s.id }))
  )
}
```

---

### 4.5 Improved Voice Feedback

#### [MODIFY] [VoiceVisualizer.tsx](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/components/VoiceVisualizer.tsx)

The component exists but isn't used. Integrate it into VoiceInput:

- Show waveform during recording
- Add visual feedback for speech detection confidence
- Show interim transcript with typing animation

---

## Phase 5: Accessibility & GDPR Compliance

---

### 5.1 Accessibility Audit

- Add `aria-label` to all icon-only buttons
- Ensure proper heading hierarchy
- Add skip-to-main-content link
- Test with keyboard-only navigation
- Add focus rings to all interactive elements

---

### 5.2 GDPR Compliance

#### [NEW] [PrivacySection.tsx](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/components/settings/PrivacySection.tsx)

Add privacy controls:
- **Data Export**: Download all user data (JSON)
- **Data Deletion**: Clear all local data
- **Error Reporting Opt-in**: Explicit consent for Sentry
- **Link to Privacy Policy**

#### [NEW] [privacy-policy.md](file:///home/mhrj/Desktop/ai-worker/public/privacy-policy.md)

Simple privacy policy for enterprise users.

---

## Phase 6: Developer Experience

---

### 6.1 Pre-commit Hooks

```bash
npm install -D husky lint-staged
npx husky install
npx husky add .husky/pre-commit "npx lint-staged"
```

Add to `package.json`:
```json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"]
}
```

---

### 6.2 Configure Prettier & ESLint

#### [NEW] [.prettierrc](file:///home/mhrj/Desktop/ai-worker/.prettierrc)
#### [NEW] [.eslintrc.js](file:///home/mhrj/Desktop/ai-worker/.eslintrc.js)

Standardize code formatting across team.

---

### 6.3 Update Documentation

- Fix hardcoded paths in `architecture.md`
- Update version references
- Add troubleshooting section

---

## Verification Plan

### Automated Tests

| Phase | Test Type | Command | Coverage |
|-------|-----------|---------|----------|
| 1.4 | Unit Tests | `npm run test:unit` | New Vitest setup |
| All | E2E Mocked | `npm run test:mock` | Existing test |
| All | Playwright | `npm run test:playwright` | Existing test |
| All | TypeCheck | `npm run typecheck` | Type safety |

### Manual Verification

For each phase, perform:

1. **Fresh Install Test**: Delete `~/.config/ai-worker/`, launch app, verify onboarding works
2. **Cross-Platform**: Test on Linux (primary) + verify Windows/Mac builds
3. **Regression Test**: Ensure existing chat, MCP, voice features still work

### Specific Manual Tests

| Phase | Test | Steps |
|-------|------|-------|
| 1.1 | Security | 1. Build app 2. Open DevTools console 3. Try `fetch('http://evil.com')` - should be blocked |
| 2.5 | Streaming | 1. Configure Ollama 2. Send message 3. Verify response appears word-by-word |
| 4.1 | Onboarding | 1. Clear app data 2. Launch 3. Verify wizard appears 4. Complete all steps |
| 5.2 | GDPR | 1. Go to Settings > Privacy 2. Click Export Data 3. Verify JSON downloads 4. Click Delete Data 5. Verify all cleared |

---

## Estimated Effort

| Phase | Complexity | Estimated Time |
|-------|------------|----------------|
| Phase 1 | 🔴 High | 4-6 hours |
| Phase 2 | 🟡 Medium | 3-4 hours |
| Phase 3 | 🔴 High | 6-8 hours |
| Phase 4 | 🟡 Medium | 4-5 hours |
| Phase 5 | 🟡 Medium | 3-4 hours |
| Phase 6 | 🟢 Low | 2-3 hours |

**Total**: ~22-30 hours of implementation

---

## Recommended Execution Order

Given your 2-person team with coding agents, I recommend:

1. **Phase 1** (Security) → Must do first, protects users
2. **Phase 4.1** (Onboarding) → Immediate UX win for enterprise users
3. **Phase 2** (Performance) → General quality improvement
4. **Phase 5** (GDPR) → Required for EU market
5. **Phase 3** (Refactoring) → Long-term maintainability
6. **Phase 6** (DX) → Helps future development

**Start with Phase 1?**
