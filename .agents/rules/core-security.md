---
trigger: always_on
description: Electron security rules that apply to every task, regardless of what you are working on.
---

# Core Security Rules (Always Active)

These rules apply to **every change** in this project. Breaking any of them creates a real security vulnerability in the shipped application.

## BrowserWindow Security Defaults

Always use these `webPreferences` on every `BrowserWindow` you create or modify:

```ts
webPreferences: {
  contextIsolation: true,   // REQUIRED — isolates renderer JS context
  nodeIntegration: false,   // REQUIRED — renderer must never have Node access
  sandbox: true,            // PREFERRED — further restricts the renderer process
}
```

- **`contextIsolation: true`** prevents the renderer's `window` object from sharing scope with the preload or Node.js world. Without it, any script on a page can overwrite Node globals.
- **`nodeIntegration: false`** ensures no page (including third-party content) can call `require()` or access `fs`, `path`, `child_process`, etc.
- **`sandbox: true`** is the default in Electron 20+. Only disable it if a native module specifically requires it — then document why in a comment.

## `webSecurity: false` — Last Resort Only

Disabling `webSecurity` bypasses CORS, the same-origin policy, and mixed-content checks. **Never add it without:**
1. A block comment above the `BrowserWindow` config explaining _why_ it is needed.
2. A note on what specific mitigation exists (e.g., "only local `file://` URLs are loaded here").

## Never Use `@electron/remote`

`@electron/remote` is deprecated and officially unsafe. It merges the main and renderer execution contexts via a hidden IPC channel, bypassing every security boundary. Do not install it, do not import it.

## The Preload is the Only Gate

The preload script is the **sole** mechanism for exposing any capability to the renderer. All cross-process surface area must be declared explicitly via `contextBridge.exposeInMainWorld()`.

- Keep the exposed API minimal — only expose what the renderer genuinely needs.
- Every method on the exposed API maps to exactly one `ipcRenderer.invoke()` or `ipcRenderer.on()` call. No logic, no conditionals in the preload.

## IPC Input Validation

The main process **must treat all IPC payloads as untrusted**. Before using any renderer-supplied value:
- Validate its type and shape.
- Sanitize file paths (guard against path traversal: `../../etc/passwd`).
- Reject unexpected or malformed inputs early — throw a typed error, never silently proceed.

Never pass raw IPC arguments directly to `exec`, `spawn`, `fs.readFile`, or any other OS API.

## `shell.openExternal` — URL Allow-listing

Only call `shell.openExternal` with trusted URLs. Always validate the URL before passing it:

```ts
// GOOD — validate scheme before opening
const ALLOWED_SCHEMES = ['https:', 'mailto:'];
if (ALLOWED_SCHEMES.includes(new URL(url).protocol)) {
  shell.openExternal(url);
}

// BAD — arbitrary user-supplied URL passed directly
shell.openExternal(userInput); // could be file://, javascript:, etc.
```
