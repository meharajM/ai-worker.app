/// <reference path="../env.d.ts" />

// Platform detection and Electron API wrapper
// Provides fallbacks for browser environment

export const isElectron = (): boolean => {
    return !!(window.electron && typeof window.electron === 'object')
}

export const getPlatform = (): 'mac' | 'windows' | 'linux' | 'browser' => {
    if (!isElectron()) return 'browser'

    const platform = window.electron?.platform
    switch (platform) {
        case 'darwin': return 'mac'
        case 'win32': return 'windows'
        case 'linux': return 'linux'
        default: return 'browser'
    }
}

// Safe wrapper for Electron APIs with browser fallbacks
export const electron = {
    // Open external URL
    openExternal: async (url: string): Promise<void> => {
        if (isElectron() && window.electron?.shell) {
            await window.electron.shell.openExternal(url)
        } else {
            window.open(url, '_blank', 'noopener,noreferrer')
        }
    },

    // Get app version
    getVersion: async (): Promise<string> => {
        if (isElectron() && window.electron?.app) {
            return await window.electron.app.getVersion()
        }
        return '0.1.0' // Fallback to package.json version
    },

    // MCP operations
    mcp: {
        connect: async (serverConfig: unknown) => {
            if (isElectron() && window.electron?.mcp) {
                return await window.electron.mcp.connect(serverConfig)
            }
            // Browser fallback - mock implementation
            console.log('[Browser] MCP connect mock:', serverConfig)
            return { success: true, serverId: `mock_${Date.now()}` }
        },

        disconnect: async (serverId: string) => {
            if (isElectron() && window.electron?.mcp) {
                return await window.electron.mcp.disconnect(serverId)
            }
            console.log('[Browser] MCP disconnect mock:', serverId)
            return { success: true }
        },

        listTools: async (serverId: string) => {
            if (isElectron() && window.electron?.mcp) {
                return await window.electron.mcp.listTools(serverId)
            }
            console.log('[Browser] MCP list tools mock:', serverId)
            return { tools: [] }
        },

        callTool: async (serverId: string, toolName: string, args: unknown) => {
            if (isElectron() && window.electron?.mcp) {
                return await window.electron.mcp.callTool(serverId, toolName, args)
            }
            console.log('[Browser] MCP call tool mock:', { serverId, toolName, args })
            return { result: null }
        },
        onStatusUpdate: (callback: (event: any, data: { serverId: string, status: string }) => void) => {
            if (isElectron() && window.electron?.mcp?.onStatusUpdate) {
                return window.electron.mcp.onStatusUpdate(callback)
            }
            return () => { }
        }
    },

    // Storage with localStorage fallback
    store: {
        get: async <T>(key: string, defaultValue?: T): Promise<T | undefined> => {
            if (isElectron() && window.electron?.store) {
                const value = await window.electron.store.get(key)
                return (value as T) ?? defaultValue
            }
            // Browser fallback to localStorage
            const stored = localStorage.getItem(key)
            if (stored) {
                try {
                    return JSON.parse(stored) as T
                } catch {
                    return stored as unknown as T
                }
            }
            return defaultValue
        },

        set: async (key: string, value: unknown): Promise<boolean> => {
            if (isElectron() && window.electron?.store) {
                return await window.electron.store.set(key, value)
            }
            // Browser fallback
            localStorage.setItem(key, JSON.stringify(value))
            return true
        },

        delete: async (key: string): Promise<boolean> => {
            if (isElectron() && window.electron?.store) {
                return await window.electron.store.delete(key)
            }
            localStorage.removeItem(key)
            return true
        },
    },
}

export default electron
