import { STORAGE_KEYS, APP_INFO } from './constants'
import electron from './electron'

/// <reference path="../env.d.ts" />

// MCP Client Manager - Connects to external MCP servers
// Uses @modelcontextprotocol/sdk to communicate with MCP servers

export interface MCPServer {
    id: string
    name: string
    description: string
    type: 'stdio' | 'sse' | 'http'
    command?: string  // For stdio servers
    args?: string[]
    url?: string      // For sse/http servers
    connected: boolean
    tools: MCPTool[]
    error?: string
}

export interface MCPTool {
    name: string
    description: string
    inputSchema: Record<string, unknown>
}

// Pre-configured MCP server templates
// Use addCustomServer to add any server

// Store for connected servers
let connectedServers: Map<string, MCPServer> = new Map()

// Generate unique ID
function generateId(): string {
    return `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Add a custom server
export function addCustomServer(config: Omit<MCPServer, 'id' | 'connected' | 'tools'>): MCPServer {
    const server: MCPServer = {
        ...config,
        id: generateId(),
        connected: false,
        tools: [],
    }

    connectedServers.set(server.id, server)
    saveServersToStorage()
    return server
}

// Update an existing server
export function updateServer(serverId: string, config: Partial<Omit<MCPServer, 'id' | 'connected' | 'tools'>>): void {
    const server = connectedServers.get(serverId)
    if (!server) throw new Error('Server not found')

    const updatedServer: MCPServer = {
        ...server,
        ...config,
        // Reset connected state and tools if critical config changes
        connected: false,
        tools: [],
        error: undefined
    }

    connectedServers.set(serverId, updatedServer)
    saveServersToStorage()
}

// Remove a server
export function removeServer(serverId: string): void {
    connectedServers.delete(serverId)
    saveServersToStorage()
}

// Get all servers
export function getServers(): MCPServer[] {
    return Array.from(connectedServers.values())
}

// Connect to a server
// Uses Electron IPC when available, otherwise mock implementation
export async function connectServer(serverId: string): Promise<void> {
    const server = connectedServers.get(serverId)
    if (!server) {
        throw new Error('Server not found')
    }

    try {
        // Use the electron wrapper which handles browser fallback internally
        const result = await electron.mcp.connect({
            id: server.id,
            type: server.type,
            command: server.command,
            args: server.args,
            url: server.url,
        })

        if (result.success) {
            // Get tools from the connected server
            const toolsResult = await electron.mcp.listTools(serverId)
            server.tools = toolsResult.tools.map((t: { name: string; description: string }) => ({
                name: t.name,
                description: t.description,
                inputSchema: { type: 'object', properties: {} },
            }))
            server.connected = true
            server.error = undefined
        } else {
            throw new Error(result.error || 'Connection failed')
        }

        connectedServers.set(serverId, server)
        saveServersToStorage()
    } catch (error) {
        server.connected = false
        server.error = error instanceof Error ? error.message : 'Connection failed'
        connectedServers.set(serverId, server)
        throw error
    }
}

// Disconnect from a server
export async function disconnectServer(serverId: string): Promise<void> {
    const server = connectedServers.get(serverId)
    if (!server) {
        throw new Error('Server not found')
    }

    server.connected = false
    server.tools = []
    connectedServers.set(serverId, server)
    saveServersToStorage()
}

// Get all available tools from connected servers
export function getAllTools(): MCPTool[] {
    const tools: MCPTool[] = []
    connectedServers.forEach((server) => {
        if (server.connected) {
            tools.push(...server.tools)
        }
    })
    return tools
}

// Storage helpers
function saveServersToStorage(): void {
    const serversArray = Array.from(connectedServers.values())
    localStorage.setItem(STORAGE_KEYS.MCP_SERVERS, JSON.stringify(serversArray))
}

function loadServersFromStorage(): void {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.MCP_SERVERS)
        if (stored) {
            const servers: MCPServer[] = JSON.parse(stored)
            connectedServers = new Map(servers.map((s) => [s.id, { ...s, connected: false, tools: [] }]))
        }
    } catch (error) {
        console.error('Error loading MCP servers:', error)
    }
}

// Initialize on load
loadServersFromStorage()
