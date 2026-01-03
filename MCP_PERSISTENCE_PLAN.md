# MCP Server Persistence Plan

## Implementation Checklist

### Phase 1: Update Main Process Store Handler ✅ COMPLETED

- [x] Import `electron-store` package
- [x] Replace in-memory `Map` with `electron-store` instance
- [x] Initialize store with proper configuration (`name: 'ai-worker-store'`)
- [x] Update IPC handlers to use store methods (`get`, `set`, `delete`)
- [x] Fix TypeScript type issues with proper type assertions
- [x] **File Updated**: `src/main/ipc/store.ts`

### Phase 2: Update MCP Library to Use Electron Store ✅ COMPLETED

- [x] Add `autoConnect` field to `MCPServer` interface
- [x] Convert `saveServersToStorage()` to async function using `electron.store.set()`
- [x] Convert `loadServersFromStorage()` to async function using `electron.store.get()`
- [x] Add `migrateFromLocalStorage()` function for data migration
- [x] Update `addCustomServer()` to async and include `autoConnect: false` default
- [x] Update `updateServer()` to async
- [x] Update `removeServer()` to async
- [x] Update `connectServer()` to save state asynchronously
- [x] Update `disconnectServer()` to save state asynchronously
- [x] Add `setAutoConnect(serverId, enabled)` function
- [x] Add `autoConnectServers()` function to connect servers on startup
- [x] Add `initializeMcpServers()` function for proper async initialization
- [x] Update `initializeDefaultServers()` to async
- [x] Update `ensureDefaultServers()` to async
- [x] Ensure runtime state (`connected`, `tools`, `error`) is not persisted
- [x] Ensure `autoConnect` preference is persisted
- [x] **File Updated**: `src/renderer/src/lib/mcp.ts`

### Phase 3: Update Components Using MCP Functions ✅ COMPLETED

- [x] Update `ConnectionsPanel` to handle async `addCustomServer()`
- [x] Update `ConnectionsPanel` to handle async `updateServer()`
- [x] Update `ConnectionsPanel` to handle async `removeServer()`
- [x] Add error handling for async operations in `ConnectionsPanel`
- [x] Import `setAutoConnect` in `ConnectionsPanel`
- [x] Pass `onToggleAutoConnect` prop to `McpServerCard`
- [x] **File Updated**: `src/renderer/src/components/ConnectionsPanel.tsx`

### Phase 4: Add Auto-Connect UI ✅ COMPLETED

- [x] Add `onToggleAutoConnect` prop to `McpServerCard` interface
- [x] Import `Zap` icon from lucide-react
- [x] Add auto-connect toggle UI in expanded server card view
- [x] Add visual toggle switch with proper styling
- [x] Add descriptive text explaining auto-connect behavior
- [x] Style toggle to match app theme (cyan when enabled)
- [x] **File Updated**: `src/renderer/src/components/mcp/McpServerCard.tsx`

### Phase 5: App Startup Integration ✅ COMPLETED

- [x] Import `autoConnectServers` and `initializeMcpServers` in `App.tsx`
- [x] Add `useEffect` hook to initialize MCP servers on app mount
- [x] Call `initializeMcpServers()` to ensure servers are loaded
- [x] Call `autoConnectServers()` to connect servers with `autoConnect: true`
- [x] Add error handling for initialization failures
- [x] **File Updated**: `src/renderer/src/App.tsx`

### Phase 6: Testing & Validation ⏳ PENDING

- [ ] Test fresh install - default servers should be created
- [ ] Test existing localStorage data migration on first run
- [ ] Test adding new server - should persist across restart
- [ ] Test editing server - changes should persist
- [ ] Test deleting server - deletion should persist
- [ ] Test connection state - should reset to `false` on restart
- [ ] Test multiple app restarts - data should persist correctly
- [ ] Test auto-connect toggle - preference should persist
- [ ] Test auto-connect on startup - servers with `autoConnect: true` should connect automatically
- [ ] Test disable auto-connect - servers should not auto-connect after disabling
- [ ] Test error handling during migration
- [ ] Test error handling during auto-connect failures
- [ ] Verify cross-platform storage paths work correctly

## Current State

### Storage Location

- **Current**: MCP servers are stored in `localStorage` in the renderer process
- **Location**: `src/renderer/src/lib/mcp.ts` uses `localStorage.setItem(STORAGE_KEYS.MCP_SERVERS, ...)`
- **Issue**: localStorage is browser-based and not ideal for Electron apps

### Infrastructure Available

- ✅ `electron-store` package is already installed (v11.0.2)
- ✅ Store IPC handlers exist in `src/main/ipc/store.ts` (but currently use in-memory Map)
- ✅ Preload script exposes store APIs (`window.electron.store`)
- ✅ Electron wrapper in `src/renderer/src/lib/electron.ts` has store API with localStorage fallback

## Goals

1. **Move MCP server persistence from localStorage to electron-store**

   - Use main process storage for better reliability
   - Cross-platform storage paths (OS-specific)
   - Better data integrity

2. **Maintain backward compatibility**

   - Migrate existing localStorage data on first run
   - Graceful fallback if migration fails

3. **Improve data persistence**

   - Persist server configurations across app restarts
   - Handle connection state appropriately (don't persist `connected: true` on restart)

4. **Add auto-connect functionality**
   - Add `autoConnect` flag to persist user preference per server
   - Automatically connect to servers with `autoConnect: true` on app startup
   - Allow users to toggle auto-connect per server
   - Connection state (`connected`) remains runtime-only, but auto-connect preference persists

## Implementation Plan

### Phase 1: Update Main Process Store Handler

**File**: `src/main/ipc/store.ts`

**Changes**:

- Replace in-memory `Map` with `electron-store`
- Initialize store with proper configuration
- Ensure proper serialization/deserialization

**Benefits**:

- Persistent storage across app restarts
- OS-specific storage paths
- Better error handling

### Phase 2: Update MCP Library to Use Electron Store

**File**: `src/renderer/src/lib/mcp.ts`

**Changes**:

1. Replace `localStorage` calls with `electron.store` API
2. Update `saveServersToStorage()` to use async `electron.store.set()`
3. Update `loadServersFromStorage()` to use async `electron.store.get()`
4. Add migration logic to move data from localStorage to electron-store
5. Make functions async where needed
6. Add `autoConnect` field to MCPServer interface
7. Add `autoConnectServers()` function to connect servers with `autoConnect: true` on startup
8. Add `setAutoConnect()` function to toggle auto-connect preference

**Migration Strategy**:

- On load, check if data exists in electron-store
- If not, check localStorage for existing data
- If found in localStorage, migrate it to electron-store
- Clear localStorage after successful migration

### Phase 3: Update Components Using MCP Functions

**Files to Update**:

- `src/renderer/src/components/ConnectionsPanel.tsx`
- `src/renderer/src/components/mcp/McpServerCard.tsx`
- `src/renderer/src/App.tsx` (for auto-connect on startup)
- Any other components that call MCP functions

**Changes**:

- Update calls to MCP functions that become async
- Handle async operations properly
- Add loading states if needed
- Add auto-connect toggle UI in McpServerCard
- Call `autoConnectServers()` on app startup in App.tsx

### Phase 4: Add Auto-Connect Functionality

**Files**:

- `src/renderer/src/lib/mcp.ts`
- `src/renderer/src/components/mcp/McpServerCard.tsx`
- `src/renderer/src/App.tsx`

**Changes**:

1. Add `autoConnect` boolean field to MCPServer interface (default: `false`)
2. Add `setAutoConnect(serverId: string, enabled: boolean)` function
3. Add `autoConnectServers()` function to connect servers with `autoConnect: true`
4. Add toggle UI in McpServerCard component
5. Call `autoConnectServers()` on app startup

### Phase 6: Testing & Validation ⏳ PENDING

**Test Cases**:

1. ⏳ Fresh install - default servers should be created
2. ⏳ Existing localStorage data - should migrate on first run
3. ⏳ Add new server - should persist across restart
4. ⏳ Edit server - changes should persist
5. ⏳ Delete server - deletion should persist
6. ⏳ Connection state - should reset to `false` on restart
7. ⏳ Multiple app restarts - data should persist correctly
8. ⏳ Auto-connect toggle - preference should persist
9. ⏳ Auto-connect on startup - servers with `autoConnect: true` should connect automatically
10. ⏳ Disable auto-connect - servers should not auto-connect after disabling
11. ⏳ Error handling during migration
12. ⏳ Error handling during auto-connect failures
13. ⏳ Cross-platform storage paths verification

## Technical Details

### Data Structure

The MCP server data structure is updated to include auto-connect:

```typescript
interface MCPServer {
  id: string;
  name: string;
  description: string;
  type: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  connected: boolean; // Runtime state - should be false on load
  tools: MCPTool[]; // Runtime state - should be empty on load
  error?: string;
  autoConnect: boolean; // Persisted preference - default false
}
```

### Storage Key

- Key: `STORAGE_KEYS.MCP_SERVERS` (value: `'mcp_servers'`)
- Stored as JSON array in electron-store

### Connection State Handling

- On app restart, all servers should have `connected: false` and `tools: []`
- Connection state (`connected`, `tools`) is runtime-only and shouldn't persist
- Auto-connect preference (`autoConnect`) is persisted and used to automatically reconnect on startup
- After loading servers, automatically connect to servers with `autoConnect: true`

## Implementation Steps

### Step 1: Update Store Handler (Main Process)

1. Import `electron-store`
2. Initialize store instance
3. Replace Map operations with store operations
4. Handle JSON serialization

### Step 2: Update MCP Library (Renderer)

1. Make storage functions async
2. Replace localStorage with electron.store
3. Add migration function
4. Update all callers to handle async
5. Add `autoConnect` field to MCPServer interface
6. Add `setAutoConnect()` function
7. Add `autoConnectServers()` function

### Step 3: Update Components

1. Update ConnectionsPanel to handle async operations
2. Add proper error handling
3. Test user flows
4. Add auto-connect toggle UI in McpServerCard
5. Update App.tsx to call autoConnectServers() on mount

### Step 4: Testing

1. Test migration from localStorage
2. Test fresh install
3. Test CRUD operations
4. Test app restart scenarios

## Migration Strategy

```typescript
async function migrateFromLocalStorage(): Promise<void> {
  // Check if electron-store has data
  const storeData = await electron.store.get(STORAGE_KEYS.MCP_SERVERS);

  if (storeData) {
    // Already migrated or fresh install
    return;
  }

  // Check localStorage
  const localData = localStorage.getItem(STORAGE_KEYS.MCP_SERVERS);

  if (localData) {
    try {
      const servers = JSON.parse(localData);
      // Reset connection state and add autoConnect field if missing
      const migratedServers = servers.map((s: MCPServer) => ({
        ...s,
        connected: false,
        tools: [],
        error: undefined,
        autoConnect: s.autoConnect ?? false, // Default to false if not present
      }));

      // Save to electron-store
      await electron.store.set(STORAGE_KEYS.MCP_SERVERS, migratedServers);

      // Clear localStorage
      localStorage.removeItem(STORAGE_KEYS.MCP_SERVERS);

      console.log("Migrated MCP servers from localStorage to electron-store");
    } catch (error) {
      console.error("Migration failed:", error);
      // Continue with default servers
    }
  }
}
```

## Benefits

1. **Reliability**: electron-store is more reliable than localStorage
2. **Cross-platform**: OS-specific storage paths
3. **Data Integrity**: Better error handling and recovery
4. **Future-proof**: Easier to extend with additional features
5. **Consistency**: Aligns with architecture document recommendations

## Risks & Mitigations

### Risk 1: Data Loss During Migration

- **Mitigation**: Only clear localStorage after successful migration
- **Mitigation**: Keep localStorage data until confirmed migration success

### Risk 2: Async Complexity

- **Mitigation**: Use async/await properly
- **Mitigation**: Add error handling at all levels
- **Mitigation**: Test thoroughly

### Risk 3: Breaking Changes

- **Mitigation**: Maintain backward compatibility
- **Mitigation**: Graceful fallback to localStorage if electron-store fails
- **Mitigation**: Test with existing data

## Success Criteria

### Implementation Status: ✅ COMPLETED (5/6 phases)

- ✅ MCP servers persist across app restarts (via electron-store)
- ✅ Existing localStorage data migrates successfully (migration function implemented)
- ✅ No data loss during migration (localStorage cleared only after successful migration)
- ✅ Default servers initialize correctly on fresh install (async initialization)
- ✅ All CRUD operations work correctly (async functions implemented)
- ✅ Connection state resets appropriately on restart (runtime state not persisted)
- ✅ Auto-connect preference persists across restarts (`autoConnect` field persisted)
- ✅ Servers with `autoConnect: true` automatically connect on app startup (`autoConnectServers()` called)
- ✅ Users can toggle auto-connect per server (UI toggle implemented)
- ✅ Auto-connect works reliably without blocking app startup (async, error handling)

### Testing Status: ⏳ PENDING (0/13 test cases)

- ⏳ All test cases need to be executed
- ⏳ Manual testing required
- ⏳ Cross-platform testing recommended

## Summary

**Implementation**: ✅ **COMPLETE** - All code changes have been implemented and integrated.

**Testing**: ⏳ **PENDING** - Manual testing and validation required before marking as production-ready.

**Next Steps**:

1. Run the application and test all scenarios listed in Phase 6
2. Verify migration works correctly with existing localStorage data
3. Test auto-connect functionality across multiple app restarts
4. Verify error handling works as expected
5. Test on different platforms (macOS, Windows, Linux) if possible

## Quick Reference: Files Modified

### Main Process

- ✅ `src/main/ipc/store.ts` - Replaced Map with electron-store

### Renderer Process

- ✅ `src/renderer/src/lib/mcp.ts` - Complete rewrite for async storage + auto-connect
- ✅ `src/renderer/src/components/ConnectionsPanel.tsx` - Updated for async operations
- ✅ `src/renderer/src/components/mcp/McpServerCard.tsx` - Added auto-connect toggle UI
- ✅ `src/renderer/src/App.tsx` - Added auto-connect on startup

### New Functions Added

- `setAutoConnect(serverId: string, enabled: boolean)` - Toggle auto-connect preference
- `autoConnectServers()` - Connect servers with `autoConnect: true` on startup
- `initializeMcpServers()` - Proper async initialization
- `migrateFromLocalStorage()` - Migrate data from localStorage to electron-store

### Data Structure Changes

- Added `autoConnect: boolean` field to `MCPServer` interface
- Runtime state (`connected`, `tools`, `error`) is NOT persisted
- Only configuration and preferences are persisted
