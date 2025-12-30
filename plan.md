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
- **Environment:** fix-path (for GUI-launched PATH resolution)
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
│   │   ├── ipc/
│   │   │   ├── index.ts
│   │   │   ├── app.ts
│   │   │   ├── mcp.ts
│   │   │   ├── llm.ts
│   │   │   └── store.ts
│   │   └── utils/
│   │       └── env.ts
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
│           │   ├── Header.tsx
│           │   ├── Sidebar.tsx
│           │   └── mcp/
│           │       ├── McpServerCard.tsx
│           │       └── McpServerForm.tsx
│           ├── hooks/
│           │   ├── useSpeechRecognition.ts
│           │   └── useSpeechSynthesis.ts
│           ├── lib/
│           │   ├── constants.ts
│           │   ├── electron.ts
│           │   ├── firebase.ts
│           │   ├── llm.ts
│           │   └── mcp.ts
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

### ✅ Phase 4: LLM Integration [COMPLETED]

**Goal:** Get AI responses from available LLM providers

**Implementation:**
- [x] Create `src/renderer/src/lib/llm.ts` (LLM orchestrator)
- [x] Implement Ollama client (qwen2.5:3b default)
- [x] Implement OpenAI-compatible client
- [x] Create provider auto-selection logic
- [x] LLM status indicator in header
- [x] Settings panel with API key input

**Validation:** ✅
- [x] Provider status shows in UI header
- [x] Settings shows LLM configuration options
- [x] API key can be saved for OpenAI

---

### ✅ Phase 5: MCP Client [COMPLETED]

**Goal:** Connect to MCP servers, execute tools

**Implementation:**
- [x] Create `src/renderer/src/lib/mcp.ts` (MCP client manager)
- [x] Create `src/renderer/src/components/ConnectionsPanel.tsx`
- [x] Pre-configured templates (File System, GitHub, Drive, etc.)
- [x] Custom server connection UI
- [x] Server connect/disconnect functionality
- [x] Server list with status indicators

**Validation:** ✅
- [x] Add Server dropdown shows templates
- [x] Add File System → appears in list
- [x] Connection status indicators work

---

### ✅ Phase 6: Settings Panel [COMPLETED]

**Goal:** User can configure app settings

**Implementation:**
- [x] Create `src/renderer/src/stores/settingsStore.ts`
- [x] Create `src/renderer/src/components/SettingsPanel.tsx`
- [x] LLM provider selection UI
- [x] Voice settings (TTS toggle, voice selection)
- [x] Theme switching (dark/light)
- [x] Persist settings to electron-store

**Validation:** ✅
- [x] Change LLM provider → new provider used
- [x] Toggle TTS → voice enabled/disabled
- [x] Switch theme → UI updates
- [x] Restart app → settings preserved

---

### ✅ Phase 7: Auth & Rate Limiting (Feature-Flagged) [COMPLETED]

**Goal:** Optional sign-in, rate limiting for anonymous users

**Implementation:**
- [x] Create `src/renderer/src/lib/firebase.ts` (placeholder config)
- [x] Create `src/renderer/src/stores/authStore.ts`
- [x] Create `src/renderer/src/components/AuthModal.tsx`
- [x] Implement rate limiting logic (checks feature flag)
- [x] Usage tracking (local storage)
- [x] Auth status in Settings panel

**Validation:** ✅
- [x] AUTH_ENABLED=false → no sign-in UI shown
- [x] AUTH_ENABLED=true → sign-in button appears
- [x] RATE_LIMITING_ENABLED=true → limits enforced
- [x] Authenticated user → no limits

---

### ✅ Phase 8: Polish & Cross-Platform [COMPLETED]

**Goal:** Production-ready app

**Implementation:**
- [x] Error handling & loading states
- [x] Keyboard shortcuts
- [x] Cross-platform testing (Mac, Windows, Linux)
- [x] Build & packaging setup
- [x] Auto-update setup
- [x] Fix Content Security Policy (CSP) for Electron
- [x] Implement IPC handlers for system operations

**Validation:** ✅
- [x] All features work on Mac (DMG built)
- [x] All features work on Windows (EXE built)
- [x] All features work on Linux (AppImage/Deb built)

---

### ✅ Phase 9: Real MCP Client [COMPLETED]

**Goal:** Replace mock MCP with real SDK + Generic "Add Connection"

**Implementation:**
- [x] Install `@modelcontextprotocol/sdk`
- [x] Implement IPC handlers for MCP in `src/main/index.ts`
- [x] Verify `src/preload/index.ts` bridge
- [x] Update `src/renderer/src/lib/mcp.ts` to use IPC
- [x] Remove mock templates
- [x] Create generic "Add Connection" form (Stdio & SSE supported)

**Validation:** ✅
- [x] UI allows adding `stdio` server (command + args)
- [x] UI allows adding `sse` server (URL)
- [x] Connection state managed via Electron IPC

---

### ✅ Phase 10: Robustness & DX [COMPLETED]

**Goal:** Fix runtime environment issues and enhance server management

**Implementation:**
- [x] Fix ESM compatibility in main process (`__dirname` shim)
- [x] Integrate `fix-path` for GUI environmental variables
- [x] Implement actionable MCP error messages (installation instructions)
- [x] Add "Edit Configuration" capability for existing servers
- [x] Enhance Stdio transport with inherited stderr for easier debugging

**Validation:** ✅
- [x] App launches correctly in ESM mode
- [x] `npx` and `python3` found in PATH even when launched from GUI
- [x] Non-technical users see install commands for missing dependencies
- [x] Servers can be updated without re-creating them

---

### ✅ Phase 11: Code Refactoring & Architecture Improvement [COMPLETED]

**Goal:** Improve code maintainability, modularity, and developer experience

**Implementation:**
- [x] Modularize IPC handlers into separate files (`src/main/ipc/`)
  - [x] `app.ts` - App info and shell operations
  - [x] `mcp.ts` - MCP connection and tool management
  - [x] `llm.ts` - LLM operations (placeholder for future main-process LLM)
  - [x] `store.ts` - Storage operations
  - [x] `index.ts` - Central IPC handler registration
- [x] Extract UI components for better reusability
  - [x] `Header.tsx` - App header with LLM status indicator
  - [x] `Sidebar.tsx` - Navigation sidebar with view switching
  - [x] `McpServerCard.tsx` - Individual MCP server card with expand/collapse
  - [x] `McpServerForm.tsx` - Reusable form for adding/editing MCP servers
- [x] Centralize environment utilities
  - [x] `src/main/utils/env.ts` - ESM shims and PATH fixing initialization
- [x] Simplify `ConnectionsPanel.tsx` (reduced from 355+ lines to manageable size)
- [x] Refactor `App.tsx` to use new modular components
- [x] Add `fix-path` dependency for cross-platform PATH handling

**Validation:** ✅
- [x] All IPC handlers work correctly after modularization
- [x] UI components render and function properly
- [x] MCP server management UI is more intuitive and maintainable
- [x] Code is easier to navigate and extend
- [x] No functionality regressions

---

### ✅ Phase 12: Feature Flag Enhancements [COMPLETED]

**Goal:** Enhance feature flag system with dynamic controls and validation

**Implementation:**
- [x] Create `src/renderer/src/components/FeatureFlagsPanel.tsx` for dev-mode flag toggling
- [x] Implement dynamic flag system in `src/renderer/src/lib/flagSystem.ts`
- [x] Validate and fix TTS_ENABLED reactivity in `useSpeechSynthesis.ts`
- [x] Implement BROWSER_LLM_ENABLED in `llm.ts`
- [x] Ensure voice panel availability in prod mode
- [x] Link TTS controls (toggle, rate, pitch) to settingsStore

**Validation:** ✅
- [x] All 6 flags validated and functional
- [x] TTS controls work in prod mode
- [x] Typecheck and dev run pass with no errors
- [x] MCP testing confirms TTS functionality

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
- Generic "Add Connection" supports any Stdio or SSE server
- Integrated configuration editor for quick updates
- Built-in runtime dependency helper for Node/Python/UV

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

**Current Status:** Phases 1-12 complete. Codebase refactored for maintainability. Production-ready with modular architecture and enhanced feature flags.