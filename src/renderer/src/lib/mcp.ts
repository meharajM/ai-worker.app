import { STORAGE_KEYS, APP_INFO } from "./constants";
import electron from "./electron";

/// <reference path="../env.d.ts" />

// MCP Client Manager - Connects to external MCP servers
// Uses @modelcontextprotocol/sdk to communicate with MCP servers

export interface MCPServer {
  id: string;
  name: string;
  description: string;
  type: "stdio" | "sse" | "http";
  command?: string; // For stdio servers
  args?: string[];
  url?: string; // For sse/http servers
  connected: boolean; // Runtime state - not persisted
  tools: MCPTool[]; // Runtime state - not persisted
  error?: string; // Runtime state - not persisted
  autoConnect: boolean; // Persisted preference - auto-connect on startup
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Default MCP server configurations
// These are automatically added on first run if no servers exist
const DEFAULT_MCP_SERVERS: Omit<
  MCPServer,
  "id" | "connected" | "tools" | "autoConnect"
>[] = [
  {
    name: "playwright",
    description:
      "Playwright MCP Server - Browser automation and web interaction tools",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-playwright"],
  },
  {
    name: "sequential-thinking",
    description:
      "Sequential Thinking MCP Server - Enables step-by-step reasoning for complex tasks",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
];

// Store for connected servers
let connectedServers: Map<string, MCPServer> = new Map();

// Generate unique ID
function generateId(): string {
  return `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Add a custom server
export async function addCustomServer(
  config: Omit<MCPServer, "id" | "connected" | "tools" | "autoConnect">
): Promise<MCPServer> {
  const server: MCPServer = {
    ...config,
    id: generateId(),
    connected: false,
    tools: [],
    autoConnect: true, // Default to true - servers auto-connect unless user disables
  };

  connectedServers.set(server.id, server);
  await saveServersToStorage();
  return server;
}

// Update an existing server
export async function updateServer(
  serverId: string,
  config: Partial<Omit<MCPServer, "id" | "connected" | "tools">>
): Promise<void> {
  const server = connectedServers.get(serverId);
  if (!server) throw new Error("Server not found");

  const updatedServer: MCPServer = {
    ...server,
    ...config,
    // Reset connected state and tools if critical config changes
    connected: false,
    tools: [],
    error: undefined,
  };

  connectedServers.set(serverId, updatedServer);
  await saveServersToStorage();
}

// Remove a server
export async function removeServer(serverId: string): Promise<void> {
  connectedServers.delete(serverId);
  await saveServersToStorage();
}

// Get all servers
export function getServers(): MCPServer[] {
  return Array.from(connectedServers.values());
}

// Connect to a server
// Uses Electron IPC when available, otherwise mock implementation
export async function connectServer(serverId: string): Promise<void> {
  const startTime = Date.now();
  const server = connectedServers.get(serverId);

  if (!server) {
    logMcpRenderer("error", "Server not found for connection", {
      operation: "connectServer",
      serverId,
    });
    throw new Error("Server not found");
  }

  logMcpRenderer("info", "Connecting to MCP server", {
    operation: "connectServer",
    serverId: server.id,
    serverName: server.name,
    serverType: server.type,
    command: server.command,
    args: server.args?.join(" "),
    url: server.url,
  });

  try {
    // Use the electron wrapper which handles browser fallback internally
    const result = await electron.mcp.connect({
      id: server.id,
      type: server.type,
      command: server.command,
      args: server.args,
      url: server.url,
    });

    if (result.success) {
      logMcpRenderer("info", "MCP server connected, fetching tools", {
        operation: "connectServer",
        serverId: server.id,
        serverName: server.name,
      });

      // Get tools from the connected server
      const toolsResult = (await electron.mcp.listTools(serverId)) as {
        tools: { name: string; description: string }[];
        error?: string;
      };

      // Check if connection was closed during tool listing
      if (toolsResult.error) {
        const isConnectionClosed =
          toolsResult.error.includes("-32000") ||
          toolsResult.error.includes("Connection closed") ||
          toolsResult.error.includes("connection closed") ||
          toolsResult.error.includes("ECONNRESET") ||
          toolsResult.error.includes("EPIPE");

        if (isConnectionClosed) {
          server.connected = false;
          server.tools = [];
          server.error = "Connection closed unexpectedly";
          connectedServers.set(serverId, server);
          await saveServersToStorage();
          throw new Error("Connection closed unexpectedly");
        } else {
          // Other errors during tool listing - log but don't fail connection
          logMcpRenderer(
            "warn",
            "Error listing tools (but connection is still active)",
            {
              operation: "connectServer",
              serverId: server.id,
              serverName: server.name,
              error: toolsResult.error,
              note: "Server is connected but tool listing failed - this may be normal for some server types",
            }
          );
        }
      }

      // Handle servers that might not expose tools (like sequential-thinking)
      if (toolsResult.tools && toolsResult.tools.length > 0) {
        server.tools = toolsResult.tools.map(
          (t: { name: string; description: string }) => ({
            name: t.name,
            description: t.description,
            inputSchema: { type: "object", properties: {} },
          })
        );
        logMcpRenderer("info", "MCP server tools loaded", {
          operation: "connectServer",
          serverId: server.id,
          serverName: server.name,
          toolCount: server.tools.length,
        });
      } else {
        // Some servers (like sequential-thinking) might not expose traditional tools
        // but still work as reasoning/prompting servers - this is NORMAL and EXPECTED
        server.tools = [];
        const isReasoningServer =
          server.name.includes("sequential-thinking") ||
          server.name.includes("sequential") ||
          server.description.toLowerCase().includes("reasoning");

        logMcpRenderer("info", "MCP server connected but has no tools", {
          operation: "connectServer",
          serverId: server.id,
          serverName: server.name,
          isReasoningServer,
          note: isReasoningServer
            ? "This is a reasoning server - it works differently and doesn't expose traditional tools. This is normal."
            : "Server connected but no tools available - may be a reasoning/prompting server",
        });
      }

      server.connected = true;
      server.error = undefined;

      const duration = Date.now() - startTime;
      logMcpRenderer("info", "MCP server connection completed", {
        operation: "connectServer",
        serverId: server.id,
        serverName: server.name,
        toolCount: server.tools.length,
        toolNames: server.tools.map((t) => t.name),
        hasTools: server.tools.length > 0,
        duration,
      });
    } else {
      throw new Error(result.error || "Connection failed");
    }

    connectedServers.set(serverId, server);
    await saveServersToStorage();
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Connection failed";

    logMcpRenderer("error", "MCP server connection failed", {
      operation: "connectServer",
      serverId: server.id,
      serverName: server.name,
      error: errorMessage,
      duration,
    });

    server.connected = false;
    server.error = errorMessage;
    connectedServers.set(serverId, server);
    await saveServersToStorage();
    throw error;
  }
}

// Disconnect from a server
export async function disconnectServer(serverId: string): Promise<void> {
  const server = connectedServers.get(serverId);
  if (!server) {
    throw new Error("Server not found");
  }

  server.connected = false;
  server.tools = [];
  connectedServers.set(serverId, server);
  await saveServersToStorage();
}

// Get all available tools from connected servers
export function getAllTools(): MCPTool[] {
  const tools: MCPTool[] = [];
  connectedServers.forEach((server) => {
    if (server.connected) {
      tools.push(...server.tools);
    }
  });
  return tools;
}

// Find which server a tool belongs to
export function findServerForTool(toolName: string): MCPServer | null {
  for (const server of connectedServers.values()) {
    if (server.connected && server.tools.some((t) => t.name === toolName)) {
      return server;
    }
  }
  return null;
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

// Execute a tool call
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ result: unknown; error?: string }> {
  const startTime = Date.now();
  const sanitizedArgs = sanitizeArgsForLogging(args);

  logMcpRenderer("info", "Tool call initiated", {
    operation: "executeToolCall",
    toolName,
    args: sanitizedArgs,
    argsSize: JSON.stringify(args).length,
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

  logMcpRenderer("info", "Tool found, executing via server", {
    operation: "executeToolCall",
    toolName,
    serverId: server.id,
    serverName: server.name,
    serverType: server.type,
  });

  try {
    const result = (await electron.mcp.callTool(server.id, toolName, args)) as {
      result: unknown;
      error?: string;
    };
    const duration = Date.now() - startTime;

    if (result.error) {
      // Check if connection was closed
      const isConnectionClosed =
        result.error.includes("-32000") ||
        result.error.includes("Connection closed") ||
        result.error.includes("connection closed") ||
        result.error.includes("ECONNRESET") ||
        result.error.includes("EPIPE");

      if (isConnectionClosed) {
        // Update server state to reflect disconnected status
        server.connected = false;
        server.tools = [];
        server.error = "Connection closed unexpectedly";
        connectedServers.set(server.id, server);
        await saveServersToStorage();

        logMcpRenderer("warn", "Tool call failed due to connection closed", {
          operation: "executeToolCall",
          toolName,
          serverId: server.id,
          serverName: server.name,
          error: result.error,
          duration,
          connectionClosed: true,
        });
      } else {
        logMcpRenderer("error", "Tool call returned error", {
          operation: "executeToolCall",
          toolName,
          serverId: server.id,
          serverName: server.name,
          error: result.error,
          duration,
        });
      }
    } else {
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
        resultSize,
        resultPreview: resultPreview + (resultSize > 200 ? "..." : ""),
      });
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Tool execution failed";

    logMcpRenderer("error", "Tool call threw exception", {
      operation: "executeToolCall",
      toolName,
      serverId: server.id,
      serverName: server.name,
      error: errorMessage,
      duration,
    });

    return {
      result: null,
      error: errorMessage,
    };
  }
}

// Set auto-connect preference for a server
export async function setAutoConnect(
  serverId: string,
  enabled: boolean
): Promise<void> {
  const server = connectedServers.get(serverId);
  if (!server) throw new Error("Server not found");

  server.autoConnect = enabled;
  connectedServers.set(serverId, server);
  await saveServersToStorage();
}

// Auto-connect servers that have autoConnect enabled
export async function autoConnectServers(): Promise<void> {
  const startTime = Date.now();
  const serversToConnect = Array.from(connectedServers.values()).filter(
    (server) => server.autoConnect && !server.connected
  );

  logMcpRenderer("info", "Auto-connect process started", {
    operation: "autoConnectServers",
    serverCount: serversToConnect.length,
    serverNames: serversToConnect.map((s) => s.name),
  });

  // Connect servers sequentially with delays to avoid overwhelming the system
  // This also helps prevent connection issues
  for (const server of serversToConnect) {
    const serverStartTime = Date.now();
    try {
      await connectServer(server.id);
      const duration = Date.now() - serverStartTime;
      logMcpRenderer("info", "Auto-connected to MCP server", {
        operation: "autoConnectServers",
        serverId: server.id,
        serverName: server.name,
        duration,
      });

      // Small delay between connections to avoid race conditions
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      const duration = Date.now() - serverStartTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logMcpRenderer("error", "Failed to auto-connect to MCP server", {
        operation: "autoConnectServers",
        serverId: server.id,
        serverName: server.name,
        error: errorMessage,
        duration,
      });
      // Error is already stored in server.error, so we can continue

      // Delay even on failure to avoid rapid retries
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const duration = Date.now() - startTime;
  const successCount = serversToConnect.filter((s) => s.connected).length;
  const failureCount = serversToConnect.length - successCount;

  logMcpRenderer("info", "Auto-connect process completed", {
    operation: "autoConnectServers",
    totalServers: serversToConnect.length,
    successCount,
    failureCount,
    duration,
  });
}

// Storage helpers
async function saveServersToStorage(): Promise<void> {
  const serversArray = Array.from(connectedServers.values()).map((server) => ({
    id: server.id,
    name: server.name,
    description: server.description,
    type: server.type,
    command: server.command,
    args: server.args,
    url: server.url,
    autoConnect: server.autoConnect,
    // Don't persist runtime state: connected, tools, error
  }));

  await electron.store.set(STORAGE_KEYS.MCP_SERVERS, serversArray);
}

async function loadServersFromStorage(): Promise<void> {
  try {
    // First, try to migrate from localStorage if electron-store is empty
    await migrateFromLocalStorage();

    // Load from electron-store
    const stored = await electron.store.get<MCPServer[]>(
      STORAGE_KEYS.MCP_SERVERS
    );

    if (stored && Array.isArray(stored) && stored.length > 0) {
      // Restore servers, resetting runtime state
      connectedServers = new Map(
        stored.map((s) => [
          s.id,
          {
            ...s,
            connected: false, // Runtime state - always false on load
            tools: [], // Runtime state - always empty on load
            error: undefined, // Runtime state - always undefined on load
            autoConnect: s.autoConnect ?? true, // Default to true if missing (opt-out behavior)
          },
        ])
      );
      // Ensure default servers exist (add missing ones)
      await ensureDefaultServers();
    } else {
      // Empty array or null - initialize with default servers
      await initializeDefaultServers();
    }
  } catch (error) {
    console.error("Error loading MCP servers:", error);
    // If there's an error, try to initialize with defaults
    try {
      await initializeDefaultServers();
    } catch (initError) {
      console.error("Failed to initialize default servers:", initError);
    }
  }
}

// Migrate data from localStorage to electron-store
async function migrateFromLocalStorage(): Promise<void> {
  // Check if electron-store has data
  const storeData = await electron.store.get<MCPServer[]>(
    STORAGE_KEYS.MCP_SERVERS
  );

  if (storeData && Array.isArray(storeData) && storeData.length > 0) {
    // Already migrated or fresh install
    return;
  }

  // Check localStorage
  const localData = localStorage.getItem(STORAGE_KEYS.MCP_SERVERS);

  if (localData) {
    try {
      const servers: MCPServer[] = JSON.parse(localData);
      // Reset connection state and add autoConnect field if missing
      const migratedServers = servers.map((s: MCPServer) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        type: s.type,
        command: s.command,
        args: s.args,
        url: s.url,
        autoConnect: s.autoConnect ?? false, // Default to false if not present
        // Don't migrate runtime state
      }));

      // Save to electron-store
      await electron.store.set(STORAGE_KEYS.MCP_SERVERS, migratedServers);

      // Clear localStorage after successful migration
      localStorage.removeItem(STORAGE_KEYS.MCP_SERVERS);

      console.log("Migrated MCP servers from localStorage to electron-store");
    } catch (error) {
      console.error("Migration failed:", error);
      // Continue with default servers
    }
  }
}

// Initialize default servers on first run
async function initializeDefaultServers(): Promise<void> {
  DEFAULT_MCP_SERVERS.forEach((serverConfig) => {
    const server: MCPServer = {
      ...serverConfig,
      id: generateId(),
      connected: false,
      tools: [],
      autoConnect: true, // Default servers auto-connect by default
    };
    connectedServers.set(server.id, server);
  });
  await saveServersToStorage();
}

// Ensure default servers exist (add any missing ones)
async function ensureDefaultServers(): Promise<void> {
  let hasChanges = false;
  const existingServerNames = new Set(
    Array.from(connectedServers.values()).map((s) => s.name)
  );

  DEFAULT_MCP_SERVERS.forEach((serverConfig) => {
    // Only add if this default server doesn't exist by name
    if (!existingServerNames.has(serverConfig.name)) {
      const server: MCPServer = {
        ...serverConfig,
        id: generateId(),
        connected: false,
        tools: [],
        autoConnect: true, // Default servers auto-connect by default
      };
      connectedServers.set(server.id, server);
      hasChanges = true;
    }
  });

  if (hasChanges) {
    await saveServersToStorage();
  }
}

// Initialize on load (async)
let initializationPromise: Promise<void> | null = null;

export async function initializeMcpServers(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = loadServersFromStorage();
  await initializationPromise;
}

// Initialize on load (for backward compatibility, but prefer initializeMcpServers)
loadServersFromStorage().catch((error) => {
  console.error("Failed to load MCP servers on module load:", error);
});
