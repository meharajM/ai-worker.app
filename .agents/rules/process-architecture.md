---
trigger: model_decision
description: Load when working on src/main/, src/preload/, IPC handlers, or main-process services. Defines how the main process, preload, and IPC layer must be structured.
---

# Process Architecture Rules

## The Fundamental Principle

The Electron main process is an **OS broker**, not an application server. The renderer is a **display layer**, not a state machine.

```
Renderer (React UI)
    │   window.electron.domain.action()
    ▼
Preload Script  ← THE ONLY GATE
    │   ipcRenderer.invoke('domain:action', ...args)
    ▼
Main: ipc/ handlers  ← thin routers only
    │
    ▼
Main: services/  ← all business logic lives here
    │
    ▼
OS (fs, shell, sqlite, child_process, etc.)
```

## `main/index.ts` — What Belongs Here

`main/index.ts` must contain **only**:
1. `app.commandLine` switches needed before the app launches.
2. A call to `initEnv()` (or equivalent environment bootstrap).
3. The `createWindow()` function — window creation + `webPreferences` only.
4. `app.whenReady()` → `setupIpcHandlers()` → `createWindow()`.
5. `app.on('window-all-closed')` and `app.on('activate')` lifecycle handlers.

If you find yourself writing `if/else`, `try/catch`, or calling external libraries in `main/index.ts`, stop and move that code to a `services/` module.

## IPC Handlers — One-Liners Only

An IPC handler must be a one-liner: validate arguments → call a service method → return the result.

```ts
// GOOD — handler delegates entirely to a service
ipcMain.handle('memory:get-stats', async () => {
  return memoryService.getStats();
});

// GOOD — handler validates then delegates
ipcMain.handle('app:select-folder', async (_event, defaultPath: unknown) => {
  if (typeof defaultPath !== 'string') throw new Error('Invalid path argument');
  return appService.selectFolder(defaultPath);
});

// BAD — business logic inside a handler
ipcMain.handle('memory:get-stats', async () => {
  const db = await openDatabase(); // ← this belongs in MemoryService
  const rows = db.prepare('SELECT ...').all();
  return rows.map(r => ({ ... }));
});
```

## Services — Single-Responsibility Modules

Each `services/` module owns exactly one domain:

| Service | Owns |
|---------|------|
| `MemoryService.ts` | Database reads/writes for long-term memory |
| `FileSystemService.ts` | Sandboxed file I/O with change-tracking |
| `DependencyService.ts` | System dependency detection and validation |
| `PlaywrightService.ts` | Browser automation session management |

**Rules for services:**
- Services do not know about the UI, the store, IPC channels, or other services (unless injected).
- Services may hold state (e.g., a DB connection, a Playwright instance) as class instance properties.
- Expose services as class instances created once in `main/index.ts` (or lazily on first use) and passed to the IPC setup function.

## Preload — Mapping, Not Logic

The preload file is a pure translation layer. Each exposed method maps to exactly one IPC call:

```ts
// GOOD — pure mapping, no logic
contextBridge.exposeInMainWorld('electron', {
  memory: {
    getStats: () => ipcRenderer.invoke('memory:get-stats'),
    callTool: (name: string, args: unknown) =>
      ipcRenderer.invoke('memory:call-tool', { name, args }),
  },
});

// BAD — business logic in preload
contextBridge.exposeInMainWorld('electron', {
  clipboard: {
    readFilePaths: () => {
      const { clipboard } = require('electron'); // ← logic belongs in a service
      // ... 20 lines of URL parsing
    }
  }
});
```

## IPC Channel Names — Typed Constants

Never hardcode IPC channel strings. Define them as typed constants shared between the preload and main handlers:

```ts
// src/shared/ipc-channels.ts
export const IPC = {
  memory: {
    getStats:    'memory:get-stats',
    callTool:    'memory:call-tool',
    openFolder:  'memory:open-file-location',
  },
  app: {
    selectFolder:       'app:select-folder',
    getMissingDeps:     'app:get-missing-dependencies',
  },
} as const;
```

Both the preload and IPC handlers import from this file. A typo in a channel name becomes a compile error, not a silent runtime failure.

## Dependency Direction — One Way Only

```
renderer  →  preload  →  main  →  services  →  (OS / DB / network)
```

This must never be reversed. In particular:
- **Never import renderer or preload modules from main.**
- **Never import `fs`, `path`, or `child_process` in the renderer.**
- **Never import main-process modules from services** (no `BrowserWindow`, no `app`, unless the service explicitly manages windows and is named accordingly).