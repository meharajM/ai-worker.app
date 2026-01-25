# Implementation Plan: MCP Bundling and Preferences Tab

## Summary

1. **Bundle MCP servers**: `playwright`, `memory`, `filesystem` already bundled via `package.json` and `mcp-bundled` launcher.
2. **Add MCP Preferences tab**: New Settings tab with Playwright, File System, and Memory sections.

---

## Proposed Changes

### 1. Bundling (Already Done)

Verified in `package.json`:
- `@modelcontextprotocol/server-filesystem`
- `@modelcontextprotocol/server-memory`
- `@playwright/mcp`

---

### 2. MCP Preferences Tab

#### [NEW] `McpPreferencesPanel.tsx`
> `src/renderer/src/components/settings/McpPreferencesPanel.tsx`

Three sections:

**i. Playwright Browser Preferences**
- Browser selector: auto/chromium/firefox/webkit
- Token input for `PLAYWRIGHT_MCP_EXTENSION_TOKEN` (bypasses connection approval dialog)
- Link: [Download Extension](https://github.com/microsoft/playwright-mcp/releases)
- Toggle: `--extension` mode on/off

**ii. File System Directory Access (Containerized Writes)**
- Directory list with access mode:
  - **Read-Only**: Normal reads, writes go to a *shadow copy* in a temp location
  - **Read-Write**: Direct access
- User confirmation dialog before syncing shadow writes back to original file
- Internal staging directory for shadow copies (e.g., `~/.config/ai-worker/fs-staging/`)

**iii. Memory Knowledge Management**
- List view of entities/relations from memory server
- Edit/Delete buttons per entry
- Uses `memory` server tools: `list_entities`, `delete_entity`, `update_entity`

---

#### [MODIFY] `SettingsPanel.tsx`
> `src/renderer/src/components/SettingsPanel.tsx`

- Add "MCP Servers" tab routing to `McpPreferencesPanel`

---

#### [MODIFY] `settingsStore.ts`
> `src/renderer/src/stores/settingsStore.ts`

New state:
```typescript
mcpPlaywright: {
  browser: 'auto' | 'chromium' | 'firefox' | 'webkit'
  extensionMode: boolean
  token: string
}
mcpFilesystem: {
  rules: Array<{ path: string; access: 'readonly' | 'readwrite' }>
}
```

---

#### [MODIFY] `mcp.ts` (renderer)
> `src/renderer/src/lib/mcp.ts`

- Inject `--extension` flag and env `PLAYWRIGHT_MCP_EXTENSION_TOKEN` for playwright
- Inject directory roots for filesystem
- Implement write interception layer for read-only directories

---

#### [NEW] File System Shadow Write Layer
> `src/main/ipc/fs-shadow.ts`

- Intercept `write_file` tool calls for read-only directories
- Write to staging folder instead
- Provide IPC to list pending writes and confirm/discard

---

## Verification Plan

| Test | Expected |
|------|----------|
| Build & install app | No `npx` calls, bundled servers launch |
| Add read-only directory, attempt write | File saved to staging, confirmation dialog appears |
| Confirm write | Original file updated |
| Set Playwright token, reconnect | No approval dialog in browser |
| Delete memory entity | Entity removed from knowledge graph |
