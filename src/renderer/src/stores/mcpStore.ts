import { create } from 'zustand'
import electron from '../lib/electron'
import { STORAGE_KEYS } from '../lib/constants'

// Types
export interface MCPServer {
    id: string
    name: string
    description: string
    type: 'stdio' | 'sse' | 'http'
    command?: string
    args?: string[]
    url?: string
    env?: Record<string, string> // Local-only secrets
    connected: boolean
    tools: MCPTool[]
    error?: string
    autoConnect: boolean
}

export interface MCPTool {
    name: string
    description: string
    inputSchema: Record<string, unknown>
}

interface McpState {
    servers: MCPServer[]
    initialized: boolean
    activeUserId: string | null

    // Actions
    initialize: (uid?: string | null) => Promise<void>
    addServer: (config: Omit<MCPServer, 'id' | 'connected' | 'tools' | 'autoConnect'>) => Promise<void>
    updateServer: (id: string, config: Partial<Omit<MCPServer, 'id' | 'connected' | 'tools'>>) => Promise<void>
    removeServer: (id: string) => Promise<void>
    connectServer: (id: string) => Promise<void>
    disconnectServer: (id: string) => Promise<void>
    setAutoConnect: (id: string, enabled: boolean) => Promise<void>
    syncServers: (remoteServers: Partial<MCPServer>[]) => Promise<void>

    // Runtime State Actions
    updateServerState: (id: string, state: Partial<Pick<MCPServer, 'connected' | 'tools' | 'error'>>) => void

    // Auth Actions
    loadUserServers: (uid: string) => Promise<void>
    clearUserServers: () => Promise<void>

    // Getters
    getServer: (id: string) => MCPServer | undefined
    getAllTools: () => MCPTool[]
    findServerForTool: (toolName: string) => MCPServer | null
}

// Helpers
function generateId(): string {
    return `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function getPersistenceKey(uid: string | null) {
    return uid ? `user_${uid}_mcp_servers` : STORAGE_KEYS.MCP_SERVERS
}

const DEFAULT_MCP_SERVERS = [
    {
        name: 'playwright',
        description: 'Native Playwright Service - Browser automation (Internal)',
        type: 'stdio',
        command: 'internal',
        args: [],
        autoConnect: true
    },
    {
        name: 'memory',
        description: 'Core Memory Service - Knowledge Graph (Internal)',
        type: 'stdio',
        command: 'internal-memory',
        args: [],
        autoConnect: true
    },
    {
        name: 'filesystem',
        description: 'Safe Filesystem Service - Read/Write files with safety checks (Internal)',
        type: 'stdio',
        command: 'internal-filesystem',
        args: [],
        autoConnect: true
    },
    {
        name: 'markitdown',
        description: 'MarkItDown - Convert documents (PDF, Word, Excel, images, audio) to Markdown',
        type: 'stdio',
        command: 'uvx',
        args: ['markitdown-mcp'],
        autoConnect: true // Enable auto-connect (requires uv/python)
    },
    {
        name: 'whatsapp-mcp',
        description: 'WhatsApp MCP Server - Human-in-the-Loop for AI Agents via WhatsApp',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@mhrj/whatsapp-mcp'],
        // Do NOT auto-connect: user must configure a target phone number first
        // via the Command Palette or the EmptyState CTA.
        autoConnect: false
    }
]

export const useMcpStore = create<McpState>()((set, get) => ({
    servers: [],
    initialized: false,
    activeUserId: null,

    initialize: async (uid = null) => {
        // Force re-initialization if uid changes or if not initialized
        // const currentUid = get().activeUserId
        // if (get().initialized && currentUid === uid) return

        set({ activeUserId: uid })
        const storageKey = getPersistenceKey(uid)

        try {
            console.log(`[mcpStore] Initializing for user: ${uid || 'anonymous'} (Key: ${storageKey})`)

            // Load from electron-store
            const stored = await electron.store.get<MCPServer[]>(storageKey)

            let initialServers: MCPServer[] = []

            if (stored && Array.isArray(stored)) {
                initialServers = stored.map(s => {
                    const updated = { ...s };

                    // Migration: Fix servers that have "internal" command placeholder
                    if (updated.command === 'internal') {
                        const defaultMatch = DEFAULT_MCP_SERVERS.find(d => d.name === updated.name);
                        if (defaultMatch) {
                            updated.command = defaultMatch.command;
                            updated.args = defaultMatch.args;
                            console.log(`[mcpStore] Migrated server "${updated.name}" from internal to ${updated.command}`);
                        }
                    }

                    // Migration: Enable MarkItDown auto-connect
                    if (updated.name === 'markitdown') {
                        updated.autoConnect = true;
                    }

                    return {
                        ...updated,
                        // Reset runtime state
                        connected: false,
                        tools: [],
                        error: undefined
                    } as MCPServer;
                });

                // Also ensure all current defaults exist if they are missing
                let hasNewDefaults = false;
                DEFAULT_MCP_SERVERS.forEach(def => {
                    if (!initialServers.some(s => s.name === def.name)) {
                        initialServers.push({
                            ...def,
                            id: generateId(),
                            connected: false,
                            tools: [],
                            type: def.type as 'stdio' | 'sse' | 'http',
                        });
                        hasNewDefaults = true;
                    }
                });

                // Deduplicate by name — keep the entry with the most config (e.g. has env)
                const seen = new Map<string, MCPServer>();
                for (const s of initialServers) {
                    const existing = seen.get(s.name);
                    if (!existing) {
                        seen.set(s.name, s);
                    } else {
                        // Prefer the one that has env configured (e.g. WHATSAPP_TARGET_NUMBER)
                        const existingHasEnv = existing.env && Object.keys(existing.env).length > 0;
                        const sHasEnv = s.env && Object.keys(s.env).length > 0;
                        if (!existingHasEnv && sHasEnv) {
                            seen.set(s.name, s);
                        }
                    }
                }
                const beforeDedup = initialServers.length;
                initialServers = Array.from(seen.values());
                const deduplicated = initialServers.length !== beforeDedup;

                // Enforce: whatsapp-mcp must never autoConnect (requires explicit user action)
                let fixedAutoConnect = false;
                initialServers = initialServers.map(s => {
                    if (s.name === 'whatsapp-mcp' && s.autoConnect) {
                        fixedAutoConnect = true;
                        return { ...s, autoConnect: false };
                    }
                    return s;
                });

                if (hasNewDefaults || deduplicated || fixedAutoConnect) {
                    await electron.store.set(storageKey, initialServers);
                    console.log(`[mcpStore] Persisted ${hasNewDefaults ? '+defaults' : ''}${deduplicated ? ' +dedup' : ''}${fixedAutoConnect ? ' +wa-no-autoconnect' : ''}`);
                }
            } else {
                // Defaults (only for anonymous or empty user profile? Maybe always safe to default?)
                // If user has NO servers, maybe we should give them defaults?
                // Let's stick to defaults for now.
                initialServers = DEFAULT_MCP_SERVERS.map(s => ({
                    ...s,
                    id: generateId(),
                    connected: false,
                    tools: [],
                    type: s.type as 'stdio' | 'sse' | 'http',
                    activeUserId: uid // Not strictly needed on server obj but harmless
                }))
                await electron.store.set(storageKey, initialServers)
            }

            set({ servers: initialServers, initialized: true })

            // Auto-connect
            const autoConnectServers = initialServers.filter(s => s.autoConnect)
            for (const server of autoConnectServers) {
                // Connect sequentially to avoid overwhelming
                get().connectServer(server.id).catch(console.error)
            }

        } catch (error) {
            console.error('Failed to initialize MCP store:', error)
        }
    },

    loadUserServers: async (uid) => {
        // Disconnect existing servers first?
        const currentServers = get().servers
        for (const s of currentServers) {
            if (s.connected) await get().disconnectServer(s.id)
        }
        await get().initialize(uid)
    },

    clearUserServers: async () => {
        // Disconnect existing
        const currentServers = get().servers
        for (const s of currentServers) {
            if (s.connected) await get().disconnectServer(s.id)
        }
        // Re-initialize as anonymous
        await get().initialize(null)
    },

    addServer: async (config) => {
        const uid = get().activeUserId
        const storageKey = getPersistenceKey(uid)

        const server: MCPServer = {
            ...config,
            id: generateId(),
            connected: false,
            tools: [],
            autoConnect: true
        }

        const newServers = [...get().servers, server]
        set({ servers: newServers })
        await electron.store.set(storageKey, newServers)

        // Auto-connect new server
        get().connectServer(server.id)
    },

    updateServer: async (id, config) => {
        const uid = get().activeUserId
        const storageKey = getPersistenceKey(uid)

        const servers = get().servers
        const index = servers.findIndex(s => s.id === id)
        if (index === -1) return

        const updatedServer = {
            ...servers[index],
            ...config,
            // Reset connection if config changes
            connected: false,
            tools: [],
            error: undefined
        }

        const newServers = [...servers]
        newServers[index] = updatedServer

        set({ servers: newServers })
        await electron.store.set(storageKey, newServers)

        // Reconnect if it was connected or auto-connect is on
        if (updatedServer.autoConnect) {
            get().connectServer(id)
        }
    },

    removeServer: async (id) => {
        const uid = get().activeUserId
        const storageKey = getPersistenceKey(uid)

        const currentServers = get().servers
        const server = currentServers.find(s => s.id === id)

        if (server?.connected) {
            await get().disconnectServer(id)
        }

        const newServers = currentServers.filter(s => s.id !== id)
        set({ servers: newServers })
        await electron.store.set(storageKey, newServers)
    },

    connectServer: async (id) => {
        const server = get().servers.find(s => s.id === id)
        if (!server) return

        try {
            // Optimistic update
            set(state => ({
                servers: state.servers.map(s =>
                    s.id === id ? { ...s, error: undefined } : s
                )
            }))

            const result = await electron.mcp.connect({
                id: server.id,
                type: server.type,
                command: server.command,
                args: server.args,
                url: server.url,
                env: server.env
            })

            if (result.success) {
                const toolsResult = await electron.mcp.listTools(id) as { tools: { name: string; description: string; inputSchema?: Record<string, unknown> }[], error?: string }

                set(state => ({
                    servers: state.servers.map(s =>
                        s.id === id ? {
                            ...s,
                            connected: true,
                            tools: toolsResult.tools?.map(t => ({
                                name: t.name,
                                description: t.description,
                                inputSchema: t.inputSchema || {}
                            })) || [],
                            error: toolsResult.error
                        } : s
                    )
                }))
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            set(state => ({
                servers: state.servers.map(s =>
                    s.id === id ? {
                        ...s,
                        connected: false,
                        error: errorMessage
                    } : s
                )
            }))

            // If the process failed to spawn due to missing system tools (e.g. uv, python, node), surface the setup screen
            if (errorMessage.includes('Environment Setup Needed') || errorMessage.includes('ENOENT')) {
                window.dispatchEvent(new Event('app:check-dependencies'))
            }

            // Re-throw so UI can catch if needed, but state is already updated
            throw error
        }
    },

    disconnectServer: async (id) => {
        try {
            await electron.mcp.disconnect(id)
            set(state => ({
                servers: state.servers.map(s =>
                    s.id === id ? { ...s, connected: false, tools: [] } : s
                )
            }))
        } catch (error) {
            console.error('Disconnect failed:', error)
        }
    },

    setAutoConnect: async (id, enabled) => {
        const uid = get().activeUserId
        const storageKey = getPersistenceKey(uid)

        const newServers = get().servers.map(s =>
            s.id === id ? { ...s, autoConnect: enabled } : s
        )
        set({ servers: newServers })
        await electron.store.set(storageKey, newServers)
    },

    // Sync from cloud (Firestore)
    syncServers: async (remoteServers) => {
        const uid = get().activeUserId
        const storageKey = getPersistenceKey(uid)

        const currentServers = get().servers
        let hasChanges = false

        // Merge strategy:
        // 1. Map remote servers by Name (since IDs might differ or we want to dedup)
        // 2. If exists locally, update config BUT KEEP LOCAL SECRETS (env)
        // 3. If new, add it

        const newServerList = [...currentServers]

        for (const remote of remoteServers) {
            if (!remote.name) continue

            const existingIndex = newServerList.findIndex(s => s.name === remote.name)

            if (existingIndex !== -1) {
                // Update existing
                const existing = newServerList[existingIndex]

                // Only update if something changed
                if (
                    existing.command !== remote.command ||
                    JSON.stringify(existing.args) !== JSON.stringify(remote.args) ||
                    existing.url !== remote.url ||
                    existing.type !== remote.type
                ) {
                    newServerList[existingIndex] = {
                        ...existing,
                        ...remote,
                        id: existing.id, // Keep local ID
                        env: existing.env, // KEEP LOCAL SECRETS
                        autoConnect: remote.autoConnect ?? existing.autoConnect,
                        // Preserve runtime state
                        connected: existing.connected,
                        tools: existing.tools,
                        error: existing.error
                    } as MCPServer
                    hasChanges = true
                }
            } else {
                // Add new
                const newServer: MCPServer = {
                    id: generateId(), // Generate new local ID
                    name: remote.name,
                    description: remote.description || '',
                    type: remote.type as 'stdio' | 'sse' | 'http',
                    command: remote.command,
                    args: remote.args,
                    url: remote.url,
                    env: {}, // No secrets from cloud
                    autoConnect: remote.autoConnect ?? true,
                    connected: false,
                    tools: []
                }
                newServerList.push(newServer)
                hasChanges = true
            }
        }

        if (hasChanges) {
            set({ servers: newServerList })
            await electron.store.set(storageKey, newServerList)

            // Auto-connect any new/updated servers that are not connected
            newServerList
                .filter(s => s.autoConnect && !s.connected)
                .forEach(s => get().connectServer(s.id))
        }
    },

    updateServerState: (id, serverState) => {
        set(state => ({
            servers: state.servers.map(s =>
                s.id === id ? { ...s, ...serverState } : s
            )
        }))
    },

    getServer: (id) => get().servers.find(s => s.id === id),

    getAllTools: () => {
        const toolMap: Map<string, MCPTool> = new Map();
        get().servers.forEach((server) => {
            if (server.connected) {
                server.tools.forEach(tool => {
                    const existing = toolMap.get(tool.name);

                    // If we don't have this tool yet, or if the new one has a richer schema, take it
                    const newScore = Object.keys(tool.inputSchema?.properties || {}).length;
                    const existingScore = existing ? Object.keys(existing.inputSchema?.properties || {}).length : -1;

                    if (!existing || newScore > existingScore) {
                        toolMap.set(tool.name, tool);
                    }
                });
            }
        });
        return Array.from(toolMap.values());
    },

    findServerForTool: (toolName) => {
        return get().servers.find(s =>
            s.connected && s.tools.some(t => t.name === toolName)
        ) || null
    }
}))
