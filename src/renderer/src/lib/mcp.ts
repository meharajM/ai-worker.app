import { useMcpStore, MCPServer, MCPTool } from "../stores/mcpStore";
import electron from "./electron";

/// <reference path="../env.d.ts" />

// Add a custom server
export async function addCustomServer(
  config: Omit<MCPServer, "id" | "connected" | "tools" | "autoConnect">
): Promise<void> {
  return useMcpStore.getState().addServer(config);
}

// Update an existing server - Delegated to store
export async function updateServer(
  serverId: string,
  config: Partial<Omit<MCPServer, "id" | "connected" | "tools">>
): Promise<void> {
  return useMcpStore.getState().updateServer(serverId, config);
}

// Remove a server - Delegated to store
export async function removeServer(serverId: string): Promise<void> {
  return useMcpStore.getState().removeServer(serverId);
}

// Get all servers - FROM STORE
export function getServers(): MCPServer[] {
  return useMcpStore.getState().servers;
}

// Connect to a server - Delegated to store
export async function connectServer(serverId: string): Promise<void> {
  return useMcpStore.getState().connectServer(serverId);
}

// Disconnect from a server - Delegated to store
export async function disconnectServer(serverId: string): Promise<void> {
  return useMcpStore.getState().disconnectServer(serverId);
}

// Get all available tools - FROM STORE
export function getAllTools(): MCPTool[] {
  return useMcpStore.getState().getAllTools();
}

// Find which server a tool belongs to - FROM STORE
export function findServerForTool(toolName: string): MCPServer | null {
  return useMcpStore.getState().findServerForTool(toolName);
}

// Logging utility for renderer process
function logMcpRenderer(
  level: "info" | "warn" | "error",
  message: string,
  context: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();

  const logMessage = `[MCP Renderer ${level.toUpperCase()}] ${timestamp} - ${message}`;

  switch (level) {
    case "error":
      console.error(logMessage, context);
      break;
    case "warn":
      console.warn(logMessage, context);
      break;
    default:
      console.log(logMessage, context);
  }
}

// Sanitize arguments for logging (remove sensitive data)
function sanitizeArgsForLogging(
  args: Record<string, unknown>
): Record<string, unknown> {
  const sanitized = { ...args };
  const sensitiveKeys = [
    "password",
    "apiKey",
    "token",
    "secret",
    "key",
    "auth",
  ];

  for (const key in sanitized) {
    if (
      sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))
    ) {
      sanitized[key] = "***REDACTED***";
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeArgsForLogging(
        sanitized[key] as Record<string, unknown>
      );
    }
  }

  return sanitized;
}

// Helper to ensure args is a record
function ensureRecord(args: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return args || {};
}

// Execute a tool call with retry logic for connection errors
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown> | null | undefined
): Promise<{ result: unknown; error?: string }> {
  const startTime = Date.now();
  const safeArgs = ensureRecord(args);
  const sanitizedArgs = sanitizeArgsForLogging(safeArgs);
  const MAX_RETRIES = 1;

  logMcpRenderer("info", `Tool call initiated: ${toolName}`, {
    operation: "executeToolCall",
    toolName,
    args: sanitizedArgs,
    argsSize: JSON.stringify(safeArgs).length,
  });

  console.log(`[MCP Renderer] Invoking Tool: ${toolName}`, sanitizedArgs);

  // VALIDATION: convert_to_markdown requires an absolute URI or path.
  // Accepts: file:///absolute/path, /absolute/path, C:\absolute\path
  // Rejects: file://relative, bare-filename.ext (no leading slash or drive letter)
  if (toolName === 'convert_to_markdown') {
    const uri = (args?.uri || args?.path) as string | undefined;

    // Guard against completely empty URI (file.path was "" on the attachment)
    if (!uri || uri.trim() === '' || uri === 'file://' || uri === 'file:') {
      return {
        result: null,
        error: `PATH ERROR: URI is empty. The attached file did not expose a native filesystem path. ` +
          `Check the [ATTACHED FILES] block in this conversation for the exact uri= argument to use.`
      };
    }

    if (typeof uri === 'string') {
      // Accept: file:///absolute, file:// immediately followed by '/' (Unix), bare /absolute, C:\...
      // uri[7] must be '/' — catches file://filename (relative, no leading slash after //)
      // and file:// (empty path, caught above but doubled here for safety).
      const isAbsolute =
        uri.startsWith('file:///') ||
        uri.startsWith('file:////') ||
        (uri.startsWith('file://') && uri[7] === '/') ||
        uri.startsWith('/') ||
        !!uri.match(/^[a-zA-Z]:[\\/]/);

      const isRelativeFileUri =
        uri.startsWith('file:') &&
        !uri.startsWith('file:///') &&
        !uri.startsWith('file:////') &&
        !(uri.startsWith('file://') && uri[7] === '/');

      if (!isAbsolute || isRelativeFileUri) {
        return {
          result: null,
          error:
            `PATH ERROR: '${uri}' is not an absolute file URI. ` +
            `You must copy the uri= value CHARACTER-FOR-CHARACTER from the ` +
            `[ATTACHED FILES] block — do NOT reconstruct it from the filename alone. ` +
            `The correct format is: file:///Users/username/path/to/file.ext`
        };
      }
    }
  }


  if (toolName.startsWith('fs_')) {
    // Block filesystem access when BOTH conditions are true:
    //   (a) no workspace path has been set for this session, AND
    //   (b) the target path itself is not already absolute.
    // This allows: auto-set workspaces (from file attachment), absolute paths under
    //   safe user-home prefixes (see SAFE_ABSOLUTE_PREFIXES below).
    // This blocks: relative paths with no workspace context AND absolute paths
    //   targeting system directories (/etc, /usr, /var, /bin, /sbin, /dev, /proc).
    const wsPath = args?.workspacePath as string | undefined;
    const targetPath = args?.path as string | undefined;

    const targetIsAbsolute =
      !!targetPath &&
      (targetPath.startsWith('/') || !!targetPath.match(/^[a-zA-Z]:[\\/]/));

    if (!wsPath && !targetIsAbsolute) {
      return {
        result: null,
        error: 'WORKSPACE REQUIRED: Please select a workspace folder using the folder icon in the UI before performing filesystem operations.'
      };
    }

    // When there is no workspace boundary, we still must restrict absolute paths
    // to safe user-home prefixes. Without this, a rogue agent could read system
    // files (/etc/passwd, /usr/bin/, etc.) by constructing an absolute path.
    //
    // Allowed when wsPath is absent:
    //   macOS: /Users/<name>/...
    //   Linux: /home/<name>/...
    //   Windows: C:\Users\<name>\... (or any drive:\Users\...)
    const SAFE_ABSOLUTE_PREFIXES = ['/Users/', '/home/', '\\Users\\'];
    const isSafeAbsolute = (p: string): boolean =>
      SAFE_ABSOLUTE_PREFIXES.some(prefix => p.startsWith(prefix)) ||
      !!p.match(/^[a-zA-Z]:[/\\]Users[/\\]/);

    if (!wsPath && targetIsAbsolute && targetPath && !isSafeAbsolute(targetPath)) {
      return {
        result: null,
        error:
          `SECURITY VIOLATION: Access denied. The path '${targetPath}' targets a system directory. ` +
          `Only user home directory paths (/Users/…, /home/…) are permitted without a workspace. ` +
          `Select a workspace folder in the UI to work with files in other locations.`
      };
    }

    // Path traversal guard — only runs when a workspace boundary is defined.
    if (wsPath && targetPath) {
      const normalizedWs = wsPath.replace(/\\/g, '/').replace(/\/$/, '');
      const normalizedTarget = targetPath.replace(/\\/g, '/');
      if (!normalizedTarget.startsWith(normalizedWs)) {
        return {
          result: null,
          error: `SECURITY VIOLATION: Access denied. Path '${targetPath}' is outside the active workspace '${wsPath}'.`
        };
      }
    }

    // Remove workspacePath from args before forwarding — tools don't expect it.
    if (args && 'workspacePath' in args) {
      delete (args as Record<string, unknown>).workspacePath;
    }
  }


  const server = findServerForTool(toolName);
  if (!server) {
    // FALLBACK: Check if it's an internal memory tool
    if (toolName.startsWith('memory_')) {
      logMcpRenderer("info", "Executing memory tool via direct IPC fallback", { tool: toolName });
      try {
        const result = await electron.memory.callTool(toolName, safeArgs) as { result: unknown; error?: string };
        return result;
      } catch (err) {
        return { result: null, error: `Direct memory tool call failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    const duration = Date.now() - startTime;
    logMcpRenderer("error", "Tool not found in any connected server", {
      operation: "executeToolCall",
      toolName,
      duration,
    });

    return {
      result: null,
      error: `Tool ${toolName} not found in any connected server`,
    };
  }

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = (await electron.mcp.callTool(server.id, toolName, safeArgs)) as {
        result: unknown;
        error?: string;
      };

      if (result.error) {
        const isConnectionClosed =
          result.error.includes("-32000") ||
          result.error.includes("Connection closed") ||
          result.error.includes("connection closed") ||
          result.error.includes("ECONNRESET") ||
          result.error.includes("EPIPE");

        if (isConnectionClosed) {
          lastError = result.error;
          useMcpStore.getState().updateServerState(server.id, {
            connected: false,
            tools: [],
            error: "Connection closed unexpectedly"
          });

          if (attempt < MAX_RETRIES) {
            try {
              await connectServer(server.id);
            } catch {
              // Ignore reconnection errors, we'll return the last error
            }
            continue; // Retry
          }
        }

        const duration = Date.now() - startTime;
        logMcpRenderer("error", "Tool call failed", {
          operation: "executeToolCall",
          toolName,
          serverId: server.id,
          error: result.error,
          duration,
        });
        return result;
      }

      // Success!
      const duration = Date.now() - startTime;
      const resultSize = JSON.stringify(result.result).length;

      logMcpRenderer("info", "Tool call completed successfully", {
        operation: "executeToolCall",
        toolName,
        serverId: server.id,
        duration,
        attempts: attempt + 1,
        resultSize,
      });
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Tool execution failed";
      lastError = errorMessage;

      if (attempt < MAX_RETRIES) {
        try {
          await connectServer(server.id);
        } catch {
          // Ignore reconnection errors
        }
        continue;
      }
    }
  }

  return {
    result: null,
    error: lastError || "Tool execution failed after retries",
  };
}

/**
 * Parses a tabId from a `new_tab` tool result.
 *
 * The MCP IPC layer wraps all in-process tool results in the standard MCP
 * content envelope: `{ result: { content: [{ type: 'text', text: '{"tabId":1}' }] } }`
 * This utility handles that format plus a raw-object fallback for robustness.
 *
 * @param toolResult - The raw result returned by `executeToolCall('new_tab', ...)`
 * @returns The numeric tabId, or undefined if it cannot be parsed.
 */
export function parseTabIdFromResult(toolResult: { result: unknown }): number | undefined {
  const resAny = toolResult.result as Record<string, unknown> | null | undefined;

  // Primary path: standard MCP content envelope
  if (resAny?.content && Array.isArray(resAny.content) && (resAny.content[0] as Record<string, unknown>)?.text) {
    try {
      const parsed = JSON.parse((resAny.content[0] as Record<string, unknown>).text as string);
      if (typeof parsed.tabId === 'number') return parsed.tabId;
    } catch {
      console.warn('[MCP] parseTabIdFromResult: failed to JSON-parse content[0].text:', (resAny.content[0] as Record<string, unknown>).text);
    }
  }

  // Fallback: tool returned raw object (e.g. in tests or non-wrapped contexts)
  if (typeof resAny?.tabId === 'number') return resAny.tabId;

  return undefined;
}

export async function setAutoConnect(serverId: string, enabled: boolean): Promise<void> {
  return useMcpStore.getState().setAutoConnect(serverId, enabled);
}

export async function initializeMcpServers(): Promise<void> {
  return useMcpStore.getState().initialize();
}
