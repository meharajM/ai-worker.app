# MCP Performance & UX Optimization Plan (Local First)

## Master Implementation Plan

### Goal Description
Build a robust, **user-friendly**, and local-first AI agent environment by:
1.  **Optimization**: Replacing `npx` Playwright with a native **In-Process Playwright Service** that "just works".
2.  **Safety**: Implementing a **Filesystem Shadow Write Layer** that protects user data by default, with a friendly "Review Changes" UI.
3.  **Intelligence**: Implementing a fast, local **SQLite Memory Brain** for instant context recall.
4.  **Control**: Adding a simplified **MCP Preferences Tab** to manage these powerful features without overwhelming the user.

### Proposed Changes

#### Phase 1: High-Performance Browser (Playwright)
- **[DONE]** `src/main/services/PlaywrightService.ts`: Singleton managing persistent `BrowserContext` with stealth and engine choice.
- **[DONE]** **System Browser Integration**: 
    - Added support for launching system Chrome/Edge directly.
    - Implemented **Smart Fallback**: If bundled Chromium is missing, automatically falls back to system Chrome.
    - No need for manual `npx playwright install` for users with Chrome installed.
- **[DONE]** **Auto-Connect Interception**:
    - Modified `src/main/ipc/mcp.ts` to intercept `mcp:connect` for "playwright".
    - Automatically routes to the internal service without spawning `npx`.
    - Fallback logic: If internal fails, falls back to external process with warning.

#### Phase 2: High-Performance Filesystem (In-Process & Safe)
- **[TODO]** `src/main/services/FileSystemService.ts`:
    - Direct use of `fs.promises`.
    - **Shadow Write Layer**: Intercept writes to protected paths (default: all except temp).
    - Writes go to `userData/fs-staging/{session_id}/`.
- **[TODO]** **Review UI**:
    - Build `FileChangeReview.tsx` component.
    - Features: List pending files, "Before vs After" visual diff, "Approve All" / "Reject" buttons.
    - IPC handlers to apply committed changes.

#### Phase 3: High-Performance Memory (In-Process SQLite)
- **[TODO]** Dependencies: Add `better-sqlite3`.
- **[TODO]** `src/main/services/MemoryService.ts`:
    - Implement SQLite schema (Entities, Relations, FTS5).
    - **Tools**: `create_entity`, `create_relation`, `search_memory` (FTS + Graph traversal).
    - **Performance**: Prepared statements for <1ms lookups.

#### Phase 4: UI & Preferences (User Facing)
- **[DONE]** Browser Automation Settings UI:
    - Added `playwrightBrowser` and `playwrightHeadless` to settings store
    - Created "Browser Automation" section in Settings panel
    - Browser dropdown: Auto/Chrome/Edge/Firefox/Safari/Chromium
    - "Show Browser Window" toggle
- **[TODO]** `src/renderer/src/components/settings/McpPreferencesPanel.tsx`:
    - **Safety**: "Safe Mode" toggle (on/off for Shadow Writes).
    - **Memory**: "View Knowledge Graph" simple explorer (list of entities).
- **[TODO]** `settingsStore.ts`: Add filesystem/memory configuration slices.

---

## Current Progress Status

- [x] Phase 1: High-Performance Browser Automation (Playwright)
    - [x] Create `PlaywrightService` (Singleton, In-Process)
    - [x] **Task**: Implement `mcp:connect` interception in `src/main/ipc/mcp.ts`
    - [x] **Task**: Verify tool execution (navigate, screenshot, etc.) works via IPC
- [ ] Phase 2: High-Performance Filesystem (In-Process)
    - [ ] **Task**: Create `FileSystemService` with `better-sqlite3` (if needed for tracking) or just FS
    - [ ] **Task**: Implement Shadow Write redirection logic
    - [ ] **Task**: Create "Review Changes" UI in Renderer
- [ ] Phase 3: High-Performance Memory (In-Process)
    - [ ] **Task**: Install `better-sqlite3`
    - [ ] **Task**: Create `MemoryService` with Schema (Entities + Relations + FTS)
    - [ ] **Task**: Implement "Smart Search" tool
- [ ] Phase 4: UI & Preferences
    - [ ] **Task**: Create `McpPreferencesPanel` (React)
    - [ ] **Task**: Connect UI to Settings Store
