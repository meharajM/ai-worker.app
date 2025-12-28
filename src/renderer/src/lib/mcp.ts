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
export const MCP_TEMPLATES: Omit<MCPServer, 'id' | 'connected' | 'tools' | 'error'>[] = [
    {
        name: 'File System',
        description: 'Read, write, and manage local files',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/'],
    },
    {
        name: 'GitHub',
        description: 'Interact with GitHub repositories',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
    },
    {
        name: 'Google Drive',
        description: 'Access and manage Google Drive files',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-gdrive'],
    },
    {
        name: 'Brave Search',
        description: 'Search the web using Brave Search',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
    },
    {
        name: 'Memory',
        description: 'Persistent memory across conversations',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    {
        name: 'Puppeteer',
        description: 'Browser automation and web scraping',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
    {
        name: 'Slack',
        description: 'Send messages and interact with Slack',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-slack'],
    },
    {
        name: 'SQLite',
        description: 'Query and manage SQLite databases',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sqlite'],
    },
]

// Store for connected servers
let connectedServers: Map<string, MCPServer> = new Map()

// Generate unique ID
function generateId(): string {
    return `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Add a server from template
export function addServerFromTemplate(templateIndex: number): MCPServer {
    const template = MCP_TEMPLATES[templateIndex]
    if (!template) {
        throw new Error('Invalid template index')
    }

    const server: MCPServer = {
        ...template,
        id: generateId(),
        connected: false,
        tools: [],
    }

    connectedServers.set(server.id, server)
    saveServersToStorage()
    return server
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

// Remove a server
export function removeServer(serverId: string): void {
    connectedServers.delete(serverId)
    saveServersToStorage()
}

// Get all servers
export function getServers(): MCPServer[] {
    return Array.from(connectedServers.values())
}

// Connect to a server (mock implementation for now)
// In the real implementation, this would use the MCP SDK in the main process
export async function connectServer(serverId: string): Promise<void> {
    const server = connectedServers.get(serverId)
    if (!server) {
        throw new Error('Server not found')
    }

    try {
        // TODO: Implement actual MCP connection via IPC to main process
        // For now, simulate connection
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Mock tools for demonstration
        server.connected = true
        server.tools = [
            {
                name: `${server.name.toLowerCase().replace(/\s/g, '_')}_list`,
                description: `List items from ${server.name}`,
                inputSchema: { type: 'object', properties: {} },
            },
            {
                name: `${server.name.toLowerCase().replace(/\s/g, '_')}_read`,
                description: `Read data from ${server.name}`,
                inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
            },
        ]
        server.error = undefined

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
    localStorage.setItem('mcp_servers', JSON.stringify(serversArray))
}

function loadServersFromStorage(): void {
    try {
        const stored = localStorage.getItem('mcp_servers')
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
