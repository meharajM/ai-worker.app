import { ensureRecord } from "./llm";
import { useMcpStore, MCPServer, MCPTool } from "../stores/mcpStore";
import electron from "./electron";
import { STORAGE_KEYS } from "./constants";

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

  // SECURITY: Require workspace for ALL filesystem operations
  if (toolName.startsWith('fs_')) {
    // CRITICAL: Block filesystem access entirely if no workspace is selected
    if (!args || !args.workspacePath) {
      return {
        result: null,
        error: 'WORKSPACE REQUIRED: Please select a workspace folder using the folder icon in the UI before performing filesystem operations.'
      };
    }

    const wsPath = args.workspacePath as string;
    const targetPath = args.path as string;

    if (targetPath) {
      // Normalize and resolve paths
      // Note: In renderer we might use path-browserify or string manipulation
      // Ideally this check should happen in main process but validating here adds layer 1
      const normalizedWs = wsPath.replace(/\\/g, '/').replace(/\/$/, '');
      const normalizedTarget = targetPath.replace(/\\/g, '/');

      // Check if target is inside workspace
      if (!normalizedTarget.startsWith(normalizedWs)) {
        return {
          result: null,
          error: `SECURITY VIOLATION: Access denied. Path '${targetPath}' is outside the active workspace '${wsPath}'.`
        };
      }
    }
    // Remove workspacePath from args before sending to tool (it doesn't expect it)
    delete (args as any).workspacePath;
  }

  const server = findServerForTool(toolName);
  if (!server) {
    // FALLBACK: Check if it's an internal memory tool
    if (toolName.startsWith('memory_')) {
      logMcpRenderer("info", "Executing memory tool via direct IPC fallback", { tool: toolName });
      try {
        const result = await electron.memory.callTool(toolName, safeArgs) as { result: any; error?: string };
        return result;
      } catch (err: any) {
        return { result: null, error: `Direct memory tool call failed: ${err.message}` };
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
            } catch (e) { }
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
        } catch (e) { }
        continue;
      }
    }
  }

  return {
    result: null,
    error: lastError || "Tool execution failed after retries",
  };
}



export async function setAutoConnect(serverId: string, enabled: boolean): Promise<void> {
  return useMcpStore.getState().setAutoConnect(serverId, enabled);
}



export async function initializeMcpServers(): Promise<void> {
  return useMcpStore.getState().initialize();
}
