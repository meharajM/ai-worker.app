# Security Policy & Architecture Guidelines

AI-Worker takes security and privacy seriously. As a desktop application built on Electron, we enforce strict boundary separation and safety standards to protect our users.

## Secure-by-Default Architecture

To protect against cross-site scripting (XSS), remote code execution (RCE), and host-level vulnerabilities, AI-Worker adheres to the following secure architecture rules:

### 1. BrowserWindow Context Boundaries
Every `BrowserWindow` created or modified must use these `webPreferences` configuration options:
- **`contextIsolation: true`**: Isolates renderer JS execution contexts. This prevents renderer scripts from accessing the preload or Node.js scopes directly.
- **`nodeIntegration: false`**: Ensures renderer-side scripts (including third-party dependencies) do not have direct access to Node.js APIs like `fs`, `child_process`, or `path`.
- **`sandbox: true`**: Runs renderer processes in a restricted operating system sandbox.

### 2. The Preload Script Gate
The preload script acts as the **sole** secure bridge between the Renderer process and the Main process. 
- Capabilities are only exposed to the renderer using `contextBridge.exposeInMainWorld()`.
- Exposed APIs are kept minimal, with no complex logic or conditional statements inside the preload scripts.
- APIs map to strict, defined IPC channels via `ipcRenderer.invoke()` or `ipcRenderer.on()`.

### 3. Strict Input Validation at the IPC Boundary
The Main process treats all payloads received from the Renderer process as completely untrusted:
- Data types, formats, and structural shapes are validated upon receipt.
- File paths are thoroughly checked for path traversal exploits (e.g., preventing access outside allowed user data directories).
- Raw IPC arguments are never passed directly to shell commands, child processes (`exec`/`spawn`), database queries, or file system writes.

### 4. URL Validation for External Shell Access
Any calls to `shell.openExternal` must validate the URI scheme before opening:
```ts
const ALLOWED_SCHEMES = ['https:', 'mailto:'];
if (ALLOWED_SCHEMES.includes(new URL(url).protocol)) {
  shell.openExternal(url);
}
```

### 5. Deprecation of Unsafe APIs
- The use of `@electron/remote` is strictly forbidden.

---

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please report it immediately. Do not open a public GitHub issue for security bugs.

### Reporting Process
1. Send an email to **security@aiworker.app** or **team@aiworker.app** with details of the vulnerability.
2. Include a detailed description of the issue, steps to reproduce, and a proof of concept (PoC) if available.
3. We will acknowledge receipt of your report within 48 hours and work with you to coordinate a security patch.

### Responsible Disclosure Guidelines
We ask that you follow these guidelines:
- Give us reasonable time to investigate and mitigate the issue before public disclosure.
- Avoid violating privacy, destroying data, or disrupting the system during research.
