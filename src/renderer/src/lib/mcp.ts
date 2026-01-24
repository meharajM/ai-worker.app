import { ensureRecord } from "./llm";
import { useMcpStore, MCPServer, MCPTool } from "../stores/mcpStore";
import electron from "./electron";

/// <reference path="../env.d.ts" />

export { type MCPServer, type MCPTool };

// Redundant state removed - we now use useMcpStore

// Add a custom server - Delegated to store
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

// Redundant state removed - we now use useMcpStore

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
  const logEntry = {
    timestamp,
    level,
    message,
    process: "renderer",
    ...context,
  };

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

  logMcpRenderer("info", "Tool call initiated", {
    operation: "executeToolCall",
    toolName,
    args: sanitizedArgs,
    argsSize: JSON.stringify(safeArgs).length,
  });

  const server = findServerForTool(toolName);
  if (!server) {
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
    const attemptStartTime = Date.now();

    try {
      if (attempt > 0) {
        logMcpRenderer("info", "Retrying tool call after potential reconnection", {
          operation: "executeToolCall",
          toolName,
          serverId: server.id,
          attempt,
        });
      }

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

          // Update server state to reflect disconnected status via store
          useMcpStore.getState().updateServerState(server.id, {
            connected: false,
            tools: [],
            error: "Connection closed unexpectedly"
          });

          logMcpRenderer("warn", `Tool call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1})`, {
            operation: "executeToolCall",
            toolName,
            serverId: server.id,
            error: result.error,
            connectionClosed: true,
          });

          // If we have retries left, try to reconnect before next attempt
          if (attempt < MAX_RETRIES) {
            try {
              logMcpRenderer("info", "Attempting automatic reconnection for retry", {
                operation: "executeToolCall",
                serverId: server.id,
                serverName: server.name
              });
              await connectServer(server.id);
            } catch (connErr) {
              logMcpRenderer("error", "Automatic reconnection failed during retry", {
                operation: "executeToolCall",
                serverId: server.id,
                error: connErr instanceof Error ? connErr.message : String(connErr)
              });
              // If reconnection fails, we still continue to the next loop iteration 
              // which will likely fail or hit the attempt limit
            }
            continue; // Try next attempt
          }
        }

        // Not a connection error or no retries left
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
      const resultPreview =
        typeof result.result === "string"
          ? result.result.substring(0, 200)
          : JSON.stringify(result.result).substring(0, 200);

      logMcpRenderer("info", "Tool call completed successfully", {
        operation: "executeToolCall",
        toolName,
        serverId: server.id,
        serverName: server.name,
        duration,
        attempts: attempt + 1,
        resultSize,
        resultPreview: resultPreview + (resultSize > 200 ? "..." : ""),
      });
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Tool execution failed";
      lastError = errorMessage;

      logMcpRenderer("error", `Exception during tool call (attempt ${attempt + 1})`, {
        operation: "executeToolCall",
        toolName,
        serverId: server.id,
        error: errorMessage,
      });

      if (attempt < MAX_RETRIES) {
        // Try to reconnect before next attempt for exceptions too
        try {
          await connectServer(server.id);
        } catch (e) { }
        continue;
      }
    }
  }

  const totalDuration = Date.now() - startTime;
  return {
    result: null,
    error: lastError || "Tool execution failed after retries",
  };
}

// Redundant state management removed - we now use useMcpStore
export async function autoConnectServers(): Promise<void> {
  // Already handled by mcpStore.initialize()
}

export async function setAutoConnect(serverId: string, enabled: boolean): Promise<void> {
  return useMcpStore.getState().setAutoConnect(serverId, enabled);
}

export async function initializeMcpServers(): Promise<void> {
  return useMcpStore.getState().initialize();
}
