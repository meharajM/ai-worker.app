# AI-Worker: Detailed Development & Handoff Plan

AI-Worker is a voice-first desktop workspace that uses the Model Context Protocol (MCP) to bridge LLMs with local tools and files.

## 🎯 Architecture & Tech Stack

- **Framework:** Electron (Main process for system/MCP integration, Renderer for UI)
- **Build Tool:** electron-vite
- **Frontend:** React + TypeScript + Tailwind CSS
- **Icons:** Lucide-React
- **MCP Client:** @modelcontextprotocol/sdk
- **Voice:** Web Speech API (STT), SpeechSynthesis API (TTS)
- **Storage:** electron-store (cross-platform)
- **Auth:** Firebase Auth with Google Sign-in (feature-flagged)
- **Zero Trust:** Privacy-focused, no central data collection

---

## 🚩 Feature Flags (constants.ts)

```typescript
export const FEATURE_FLAGS = {
  AUTH_ENABLED: false,          // Flip to true when Firebase is configured
  RATE_LIMITING_ENABLED: false, // Flip to true when auth is ready
  TTS_ENABLED: true,            // Text-to-speech readout
  BROWSER_LLM_ENABLED: true,    // Try Gemini Nano / Phi first
  OLLAMA_ENABLED: true,         // Local Ollama models
  CLOUD_LLM_ENABLED: true,      // OpenAI-compatible APIs
}

export const RATE_LIMITS = {
  ANONYMOUS: {
    CHATS_PER_DAY: 10,
    MCP_OPERATIONS_PER_HOUR: 20,
  },
  AUTHENTICATED: {
    CHATS_PER_DAY: Infinity,
    MCP_OPERATIONS_PER_HOUR: Infinity,
  }
}
```

---

## 📁 Project Structure

```text
ai-worker-app/
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── mcp-client.ts
│   │   ├── llm-orchestrator.ts
│   │   ├── storage.ts
│   │   └── ipc-handlers.ts
│   ├── preload/
│   │   └── index.ts
│   └── renderer/
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── ChatView.tsx
│           │   ├── VoiceInput.tsx
│           │   ├── ConnectionsPanel.tsx
│           │   ├── SettingsPanel.tsx
│           │   └── AuthModal.tsx
│           ├── hooks/
│           │   ├── useSpeechRecognition.ts
│           │   └── useSpeechSynthesis.ts
│           ├── lib/
│           │   ├── constants.ts
│           │   └── firebase.ts
│           └── stores/
│               ├── chatStore.ts
│               ├── authStore.ts
│               └── settingsStore.ts
```

---

## 🗺️ Implementation Phases (with Validation)

### ✅ Phase 1: Project Setup [COMPLETED]
- [x] Electron + React + TypeScript + Tailwind scaffold
- [x] Base UI with sidebar navigation
- [x] electron-vite build system
- **Validation:** `npm run dev` shows UI ✅

---

### ✅ Phase 2: Voice & Text Input [COMPLETED]

**Goal:** User can speak or type messages, app displays them

**Implementation:**
- [x] Create `src/renderer/src/lib/constants.ts` (feature flags, rate limits)
- [x] Create `src/renderer/src/hooks/useSpeechRecognition.ts`
- [x] Create `src/renderer/src/hooks/useSpeechSynthesis.ts`
- [x] Create `src/renderer/src/components/VoiceInput.tsx` (mic + text input)
- [x] Update `App.tsx` to use VoiceInput component
- [x] Add mute toggle for TTS

**Validation:** ✅
- [x] Click mic → speak → see transcript appear
- [x] Type in text field → press Enter → see message
- [x] Mute toggle disables voice readout

---

### ✅ Phase 3: Chat Messages & State [COMPLETED]

**Goal:** Display chat history, persist messages

**Implementation:**
- [x] Create `src/renderer/src/stores/chatStore.ts` (zustand)
- [x] Create `src/renderer/src/components/ChatView.tsx`
- [x] Create `src/renderer/src/components/MessageBubble.tsx`
- [x] Integrate chat store with VoiceInput
- [x] Persist chat history to localStorage (zustand persist)

**Validation:** ✅
- [x] Send message → appears in chat
- [x] Restart app → chat history preserved
- [x] Clear chat button works

---

### Phase 4: LLM Integration

**Goal:** Get AI responses from available LLM providers

**Implementation:**
- [ ] Create `src/main/llm-orchestrator.ts`
- [ ] Implement browser LLM detection (Gemini Nano check)
- [ ] Implement Ollama client (qwen2.5:3b default)
- [ ] Implement OpenAI-compatible client
- [ ] Create provider auto-selection logic
- [ ] IPC handlers for LLM requests
- [ ] Update preload for LLM IPC

**Validation:**
- [ ] Send message → get AI response (from any provider)
- [ ] Provider status shows in UI
- [ ] Function calling works with test tool

---

### Phase 5: MCP Client

**Goal:** Connect to MCP servers, execute tools

**Implementation:**
- [ ] Create `src/main/mcp-client.ts`
- [ ] Create `src/renderer/src/components/ConnectionsPanel.tsx`
- [ ] Pre-configured templates (File System, etc.)
- [ ] Custom server connection UI
- [ ] IPC handlers for MCP operations
- [ ] Tool execution flow integration with LLM

**Validation:**
- [ ] Add File System MCP → list files works
- [ ] LLM can call MCP tools autonomously
- [ ] Connection status indicators work

---

### Phase 6: Settings Panel

**Goal:** User can configure app settings

**Implementation:**
- [ ] Create `src/renderer/src/stores/settingsStore.ts`
- [ ] Create `src/renderer/src/components/SettingsPanel.tsx`
- [ ] LLM provider selection UI
- [ ] Voice settings (TTS toggle, voice selection)
- [ ] Theme switching (dark/light)
- [ ] Persist settings to electron-store

**Validation:**
- [ ] Change LLM provider → new provider used
- [ ] Toggle TTS → voice enabled/disabled
- [ ] Switch theme → UI updates
- [ ] Restart app → settings preserved

---

### Phase 7: Auth & Rate Limiting (Feature-Flagged)

**Goal:** Optional sign-in, rate limiting for anonymous users

**Implementation:**
- [ ] Create `src/renderer/src/lib/firebase.ts` (placeholder config)
- [ ] Create `src/renderer/src/stores/authStore.ts`
- [ ] Create `src/renderer/src/components/AuthModal.tsx`
- [ ] Implement rate limiting logic (checks feature flag)
- [ ] Usage tracking (local storage)
- [ ] Auth status in Settings panel

**Validation:**
- [ ] AUTH_ENABLED=false → no sign-in UI shown
- [ ] AUTH_ENABLED=true → sign-in button appears
- [ ] RATE_LIMITING_ENABLED=true → limits enforced
- [ ] Authenticated user → no limits

---

### Phase 8: Polish & Cross-Platform

**Goal:** Production-ready app

**Implementation:**
- [ ] Error handling & loading states
- [ ] Keyboard shortcuts
- [ ] Cross-platform testing (Mac, Windows, Linux)
- [ ] Build & packaging setup
- [ ] Auto-update setup

**Validation:**
- [ ] All features work on Mac
- [ ] All features work on Windows
- [ ] All features work on Linux
- [ ] Auto-update works

---

## 🎙️ Voice UX Specification

- **Primary Input:** Push-to-talk (click to start/stop)
- **Secondary Input:** Text field (always visible)
- **Output:** Text display + TTS readout (with mute toggle)

---

## 🧠 LLM Provider Priority

1. Browser LLMs (Gemini Nano, Phi) - detect & use if available
2. Ollama (qwen2.5:3b) - local, fast, tool-capable
3. OpenAI-compatible API - user provides key

---

## 🔗 MCP Client

- Connects to external MCP servers
- Pre-configured templates for productivity & automation tools
- Custom server connection via URL/path

---

## 👤 Authentication (Feature-Flagged)

- Firebase Auth + Google Sign-in
- Works without login (anonymous mode)
- Rate limiting for anonymous users (configurable)
- Sign-in unlocks unlimited usage

---

## 📍 Storage Locations

- **macOS:** `~/Library/Application Support/ai-worker/`
- **Windows:** `%APPDATA%/ai-worker/`
- **Linux:** `~/.config/ai-worker/`

---

**Current Status:** Phase 1 complete. Starting Phase 2 (Voice & Text Input).
