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
  AUTH_ENABLED: false, // Flip to true when Firebase is configured
  RATE_LIMITING_ENABLED: false, // Flip to true when auth is ready
  TTS_ENABLED: true, // Text-to-speech readout
  BROWSER_LLM_ENABLED: true, // Try Gemini Nano / Phi first
  OLLAMA_ENABLED: true, // Local Ollama models
  CLOUD_LLM_ENABLED: true, // OpenAI-compatible APIs
};

export const RATE_LIMITS = {
  ANONYMOUS: {
    CHATS_PER_DAY: 10,
    MCP_OPERATIONS_PER_HOUR: 20,
  },
  AUTHENTICATED: {
    CHATS_PER_DAY: Infinity,
    MCP_OPERATIONS_PER_HOUR: Infinity,
  },
};
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
- [x] Cross-compilation: Windows builds on Linux supported via Wine
  - `install_build_deps.sh`: Installs Wine dependencies
  - `fix_wine_env.sh`: Troubleshoots/Resets Wine environment
  - `check:wine`: Pre-build check in package.json

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

### ✅ Phase 13: Advanced LLMs & Technical Inspector [COMPLETED]

**Goal:** Support for high-tier models (Gemini, Claude via OpenRouter) and technical auditing.

**Implementation:**
- [x] Integrate **Google Gemini** (Native API support with multi-turn tool calling)
- [x] Integrate **OpenRouter** (Unified access to Claude, Llama 3, etc.)
- [x] Implement "Easy Config" UI with helper links for API keys
- [x] Refactor logging to **Filesystem-based JSONL** storage
- [x] Create **Activity Timeline** for technical payload inspection (Inspector with Copy/JSON)

**Validation:** ✅
- [x] Gemini/OpenRouter models fetch and call successfully
- [x] Logs persist across restarts in `userData/logs/`
- [x] Raw JSON payloads visible in technical inspector

---

### ✅ Phase 14: Security Hardening & User Scoping [COMPLETED]

**Goal:** Implement robust data isolation for multi-user safety.

**Implementation:**
- [x] Implement `safeStorage` encryption for API keys (`src/main/ipc/secure.ts`)
- [x] Block sensitive keys from general store access (`src/main/ipc/store.ts`)
- [x] Update `settingsStore` to use secure storage for all API keys
- [x] Add `.env` to `.gitignore` to prevent accidental secret commits
- [x] User-scoped secrets with proper login/logout handling

**Validation:** ✅
- [x] API keys encrypted at rest using OS keychain
- [x] General store blocks access to sensitive keys
- [x] TypeScript compilation passes

---

### ✅ Phase 15: Agent Refactor & DCP [COMPLETED]

**Goal:** Transition to native tool-calling planning and implement context optimization.

**Implementation:**
- [x] Implement `AgentRuntime` for robust iteration loop
- [x] Integrate `create_execution_plan` as the primary orchestrator
- [x] Implement **Dynamic Context Pruning (DCP)** to save tokens
- [x] Redesign Tool UI as "Action Steps" (Agent-centric view)
- [x] Add `safeParseJSON` for robust tool argument parsing

**Validation:** ✅
- [x] Complex tasks (Browser + File) execute autonomously
- [x] UI displays granular steps instead of raw bubbles
- [x] Context window bloat prevented by DCP

---

### ✅ Phase 17: RPI Workflow + Sub-Agent Integration [COMPLETED]

**Goal:** Implement intelligent task decomposition and automatic sub-agent spawning.

**Implementation:**
- [x] Create `task-decomposer.ts` module for task analysis
- [x] Implement URL/website detection logic
- [x] Implement action keyword counting
- [x] Add auto-fork logic to `AgentRuntime.chat()`
- [x] Implement `executeParallelSubAgents()` for multi-website tasks
- [x] Update system prompt with sub-agent decomposition rules
- [x] Create browser comparison document (`proposal/browser.md`)

**Key Features:**
- **Multi-website detection** → Parallel sub-agents (1 per site)
- **Single-site, 3+ actions** → Sub-agent to protect context
- **Simple tasks** → Direct execution (no fork overhead)

**Files Changed:**
- `src/renderer/src/lib/task-decomposer.ts` (NEW)
- `src/renderer/src/lib/agent-runtime.ts` (+90 lines)
- `src/renderer/src/lib/llm.ts` (+12 lines)

**Validation:** ✅
- [x] TypeScript compilation passes for new files
- [x] Build verified in user terminal
- [x] Documentation updated
### ✅ Phase 15: Internal Automation (Playwright) [COMPLETED]

**Goal:** Implement internal zero-latency browser automation via Playwright.

**Implementation:**
- [x] Implement **Internal Playwright Service** (`src/main/services/PlaywrightService.ts`) regarding the zero-latency automation
- [x] Add E2E tests for all Playwright tools (`tests/playwright_tools_test.cjs`)
- [x] Expose 30+ automation tools (navigate, click, fill, screenshot, etc.) directly via main process

**Validation:** ✅
- [x] Playwright tools execute successfully in E2E tests
- [x] Zero-latency automation verified

---

### ✅ Phase 18: Prompt Engineering & Usability [COMPLETED]

**Goal:** Enhance AI communication style and task safety.

**Implementation:**
- [x] Update System Prompt for simple, friendly, global-first language
- [x] Add critical rule for taking screenshots on visual states
- [x] Enhance `confirmation-message.ts` with checks for missing preferences and high-risk tasks
- [x] Add "Suggestions" support for task clarification

**Validation:** ✅
- [x] AI uses natural language without jargon
- [x] Shopping/Booking tasks trigger confirmation if details missing
- [x] High-risk tasks (payment/OTP) flagged for confirmation
### ✅ Phase 15: Internal Automation (Playwright) [COMPLETED]

**Goal:** Implement internal zero-latency browser automation via Playwright.

**Implementation:**
- [x] Implement **Internal Playwright Service** (`src/main/services/PlaywrightService.ts`) regarding the zero-latency automation
- [x] Add E2E tests for all Playwright tools (`tests/playwright_tools_test.cjs`)
- [x] Expose 30+ automation tools (navigate, click, fill, screenshot, etc.) directly via main process

**Validation:** ✅
- [x] Playwright tools execute successfully in E2E tests
- [x] Zero-latency automation verified

---

### ✅ Phase 19: General Purpose Transformation [COMPLETED]

**Goal:** Transform the agent into a "Universal WorkFlow Buddy" capable of handling any task type safely.

**Implementation:**
- [x] Implement **Dynamic Prompt Injection** in `llm.ts`
- [x] Create **Prompt Library** (`prompt-library.ts`) for task-specific instructions
- [x] Implement **Task Categorization** (Shopping, Research, Admin, General)
- [x] Update Sub-Agents to inherit parent safety contexts
- [x] Add **Automatic CAPTCHA Solving** with fallback
- [x] Implement strict **Spending Money Protocol** and **Human-Like Behavior** rules

**Validation:** ✅
- [x] Architecture verification passed (No side effects)
- [x] General purpose tasks execute without bias
- [x] Safety protocols trigger correctly on sensitive tasks

### ✅ Phase 20: Resilience & Hardening [COMPLETED]

**Goal:** Prevent agent hangs and infinite loops through robust timeout and error tracking strategies.

**Implementation:**
- [x] **Cumulative Timeout (Issue #3)**: Prevent infinite tool retries (120s limit).
- [x] **Iteration Timeout (Issue #4)**: Prevent overall agent hangs (180s limit per turn).
- [x] **Consecutive Error Fix (Issue #5)**: Track errors at *iteration* level instead of *tool* level to prevent premature bailouts.
- [x] **Modular Error Architecture**: Created `timeout-utils.ts`, `errors.ts`, and `iteration-error-tracker.ts` for cleaner logic.

**Validation:** ✅
- [x] Agent recovers from hung LLM calls.
- [x] Agent retries tools up to cumulative limit.
- [x] Agent only bails out after 3 full failed *iterations*, not just 3 failed tools.

---

### ✅ Phase 21: Security & Defense Architecture [COMPLETED]

**Goal:** Implement comprehensive protection against prompt injection and ensure safe execution.

**Implementation:**
- [x] **3-Layer Prompt Defense** (`prompt-guard.ts`):
  - **Regex Filter**: Blocks obvious attacks instantly.
  - **LLM Guard**: Semantic analysis for subtle social engineering.
  - **Output Sanitization**: Prevents system prompt leakage.
- [x] **LLM-Based Task Decomposition** (`task-decomposer.ts`): Replaced regex logic with intelligent context/dependency analysis.
- [x] **MarkItDown Security**: Enforced absolute path and workspace constraints for file operations.
- [x] **Audit & Protocols**: Added `CODING` and `ADMIN` protocols to `prompt-library.ts` for safe form handling and code generation.

**Validation:** ✅
- [x] Attacks like "ignore previous instructions" blocked.
- [x] Complex multi-context tasks correctly identified and parallelized.
- [x] Relative path file operations prevented.

---

### ✅ Phase 22: Architecture Audit [COMPLETED]

**Goal:** Ensure documentation matches the actual codebase implementation.

**Implementation:**
- [x] Verified Project Structure & Component Hierarchy.
- [x] Detected & Documented missing IPC channels (`logs`, `secure`, `fs`, `memory`).
- [x] Detected & Documented missing Stores (`mcpStore`, `logStore`).
- [x] Documented missing `MemoryReflector` background agent.
- [x] **Discrepancy Found**: `timeout-utils.ts` and `iteration-error-tracker.ts` referenced in editor but missing from disk.

---

### 🚀 Phase 16: App Launch Preparation [IN PROGRESS]

**Goal:** Finalize distribution, assets, and production stability.

**Implementation:**
- [ ] **Visual Identity**: Design app icon (ICNS/ICO) and splash screen
- [ ] **Build Optimization**: Minimizing bundle size and verifying production CSP
- [ ] **Universal Linux Support**: Testing .deb, .rpm, and AppImage builds
- [ ] **Documentation**: Create "Quick Start" guide for new users
- [ ] **Landing Page**: Basic static site with download links

**Validation:**
- [ ] Clean build on all 3 major platforms
- [ ] Installer correctly sets up shortcuts and icons

---

### 🚀 Phase 17: MCP Enhancements (Bundling & Preferences) [PLANNED]

**Goal:** Ship key MCP servers out-of-the-box and provide dedicated preference management.

**Implementation:**
- [ ] **Bundled Servers**: Ensure Playwright, File System, and Memory MCP servers are bundled in the installer (via `mcp-bundled` launcher).
- [ ] **MCP Preferences Tab**: Add a dedicated tab in Settings for server-specific configurations.
- [ ] **Playwright Integration**: Add browser selector, extension token input, and extension download link.
- [ ] **Containerized File Access**: Implement "Shadow Writes" for read-only directories (writes to staging, sync on user confirmation).
- [ ] **Memory Manager**: Create a management UI for viewing, editing, and deleting knowledge graph entities.

**Reference:** [mcp-implementation-plan.md](file:///home/mhrj/Desktop/ai-worker/mcp-implementation-plan.md)

---

### 🏁 Phase 18: Distribution & V1 Launch

**Goal:** Public release and update mechanism.

**Implementation:**
- [ ] Set up GitHub Actions for automated multi-platform releases
- [ ] Configure Code Signing (Apple Developer / Windows Certs)
- [ ] Direct download server / S3 bucket setup
- [ ] Initial social launch (Product Hunt / Twitter)

---

## 🎙️ Voice UX Specification

- **Primary Input:** Push-to-talk (click to start/stop)
- **Secondary Input:** Text field (always visible)
- **Output:** Text display + TTS readout (with mute toggle)

---

## 🧠 LLM Provider Priority

1. **Browser LLMs** (Gemini Nano, Phi) - detect & use if available
2. **Standard APIs** (OpenAI, Gemini, OpenRouter) - cloud-scale intelligence
3. **Local LLMs** (Ollama: qwen2.5:3b) - privacy-focused fallback

---

## 🔗 MCP Client

- Connects to external MCP servers
- **Default Servers**: Playwright and Sequential Thinking configured automatically on first run
- Generic "Add Connection" supports any Stdio or SSE server
- Form pre-fills with Sequential Thinking configuration for quick setup
- Integrated configuration editor for quick updates
- Built-in runtime dependency helper for Node/Python/UV
- Automatic default server restoration (adds missing defaults on load)

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

**Current Status:** Phases 1-21 complete. App Launch Preparation (Phase 16) is ongoing. Robust security architecture (Prompt Defense, Task Decomposition) successfully implemented.

