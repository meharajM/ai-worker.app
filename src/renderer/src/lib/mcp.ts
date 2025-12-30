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
  connected: boolean;
  tools: MCPTool[];
  error?: string;
  installStatus?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Default MCP server configurations
// These are automatically added on first run if no servers exist
const DEFAULT_MCP_SERVERS: Omit<MCPServer, "id" | "connected" | "tools">[] = [
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
const serverListeners: Set<() => void> = new Set();

export function subscribeToServers(callback: () => void): () => void {
  serverListeners.add(callback);
  return () => serverListeners.delete(callback);
}

function notifyServersChange(): void {
  serverListeners.forEach((l) => l());
}

// Generate unique ID
function generateId(): string {
  return `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Add a custom server
export function addCustomServer(
  config: Omit<MCPServer, "id" | "connected" | "tools">
): MCPServer {
  const server: MCPServer = {
    ...config,
    id: generateId(),
    connected: false,
    tools: [],
  };

  connectedServers.set(server.id, server);
  saveServersToStorage();
  return server;
}

// Update an existing server
export function updateServer(
  serverId: string,
  config: Partial<Omit<MCPServer, "id" | "connected" | "tools">>
): void {
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
  saveServersToStorage();
}

// Remove a server
export function removeServer(serverId: string): void {
  connectedServers.delete(serverId);
  saveServersToStorage();
}

// Get all servers
export function getServers(): MCPServer[] {
  return Array.from(connectedServers.values());
}

// Connect to a server
// Uses Electron IPC when available, otherwise mock implementation
export async function connectServer(serverId: string): Promise<void> {
  const server = connectedServers.get(serverId);
  if (!server) {
    throw new Error("Server not found");
  }

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
      // Get tools from the connected server
      const toolsResult = await electron.mcp.listTools(serverId);
      server.tools = toolsResult.tools.map(
        (t: { name: string; description: string }) => ({
          name: t.name,
          description: t.description,
          inputSchema: { type: "object", properties: {} },
        })
      );
      server.connected = true;
      server.error = undefined;
      server.installStatus = undefined;
    } else {
      throw new Error(result.error || "Connection failed");
    }

    connectedServers.set(serverId, server);
    saveServersToStorage();
  } catch (error) {
    server.connected = false;
    server.installStatus = undefined;
    server.error = error instanceof Error ? error.message : "Connection failed";
    connectedServers.set(serverId, server);
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
  saveServersToStorage();
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

// Execute a tool call
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ result: unknown; error?: string }> {
  const server = findServerForTool(toolName);
  if (!server) {
    return {
      result: null,
      error: `Tool ${toolName} not found in any connected server`,
    };
  }

  try {
    const result = await electron.mcp.callTool(server.id, toolName, args);
    return result;
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error.message : "Tool execution failed",
    };
  }
}

// Storage helpers
function saveServersToStorage(): void {
  const serversArray = Array.from(connectedServers.values());
  localStorage.setItem(STORAGE_KEYS.MCP_SERVERS, JSON.stringify(serversArray));
  notifyServersChange();
}

function loadServersFromStorage(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.MCP_SERVERS);
    if (stored) {
      const servers: MCPServer[] = JSON.parse(stored);
      // Check if we have any servers, or if it's an empty array
      if (servers && servers.length > 0) {
        connectedServers = new Map(
          servers.map((s) => [s.id, { ...s, connected: false, tools: [] }])
        );
        // Ensure default servers exist (add missing ones)
        ensureDefaultServers();
      } else {
        // Empty array or null - initialize with default servers
        initializeDefaultServers();
      }
    } else {
      // First run: Initialize with default servers
      initializeDefaultServers();
    }
  } catch (error) {
    console.error("Error loading MCP servers:", error);
    // If there's an error parsing, initialize with defaults
    initializeDefaultServers();
  }
}

// Initialize default servers on first run
function initializeDefaultServers(): void {
  DEFAULT_MCP_SERVERS.forEach((serverConfig) => {
    const server: MCPServer = {
      ...serverConfig,
      id: generateId(),
      connected: false,
      tools: [],
    };
    connectedServers.set(server.id, server);
  });
  saveServersToStorage();
}

// Ensure default servers exist (add any missing ones)
function ensureDefaultServers(): void {
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
      };
      connectedServers.set(server.id, server);
      hasChanges = true;
    }
  });

  if (hasChanges) {
    saveServersToStorage();
  }
}

// Initialize on load
loadServersFromStorage();

// Listen for status updates from main process
if (electron.mcp.onStatusUpdate) {
  electron.mcp.onStatusUpdate((_event: any, data: { serverId: string, status: string }) => {
    const server = connectedServers.get(data.serverId);
    if (server) {
      server.installStatus = data.status;
      notifyServersChange();
    }
  });
}
