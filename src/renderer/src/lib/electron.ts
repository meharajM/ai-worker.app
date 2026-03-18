import '../env.d.ts'
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

    // Select folder dialog
    selectFolder: async (): Promise<string | null> => {
        if (isElectron() && window.electron?.app?.selectFolder) {
            return await window.electron.app.selectFolder()
        }
        // Browser fallback - not supported
        console.warn('[Browser] Folder selection not supported in browser mode')
        return null
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

    // Secure storage for sensitive data (encrypted with OS keychain)
    secure: {
        isAvailable: async (): Promise<boolean> => {
            if (isElectron() && window.electron?.secure) {
                return await window.electron.secure.isAvailable()
            }
            return false // Browser cannot use safeStorage
        },

        set: async (key: string, value: string, userId?: string): Promise<{ success: boolean; encrypted?: boolean; error?: string }> => {
            if (isElectron() && window.electron?.secure) {
                return await window.electron.secure.set(key, value, userId)
            }
            // Browser fallback: warn and use localStorage (insecure)
            console.warn('[Secure] Browser fallback: storing secret in localStorage (not encrypted)')
            localStorage.setItem(`secure_${userId ? `${userId}_` : ''}${key}`, value)
            return { success: true, encrypted: false }
        },

        get: async (key: string, userId?: string): Promise<{ success: boolean; value?: string | null; encrypted?: boolean; error?: string }> => {
            if (isElectron() && window.electron?.secure) {
                return await window.electron.secure.get(key, userId)
            }
            // Browser fallback
            const value = localStorage.getItem(`secure_${userId ? `${userId}_` : ''}${key}`)
            return { success: true, value, encrypted: false }
        },

        delete: async (key: string, userId?: string): Promise<{ success: boolean; error?: string }> => {
            if (isElectron() && window.electron?.secure) {
                return await window.electron.secure.delete(key, userId)
            }
            localStorage.removeItem(`secure_${userId ? `${userId}_` : ''}${key}`)
            return { success: true }
        },

    },

    // FS operations
    fs: {
        getPendingChanges: async () => {
            if (isElectron() && window.electron?.fs) {
                return await window.electron.fs.getPendingChanges()
            }
            return []
        },
        approveChange: async (changeId: string) => {
            if (isElectron() && window.electron?.fs) {
                return await window.electron.fs.approveChange(changeId)
            }
            return { success: false }
        },
        rejectChange: async (changeId: string) => {
            if (isElectron() && window.electron?.fs) {
                return await window.electron.fs.rejectChange(changeId)
            }
            return { success: false }
        },
        writeInternalFile: async (workspacePath: string | undefined, filename: string, content: string) => {
            if (isElectron() && window.electron?.fs && window.electron.fs.writeInternalFile) {
                return await window.electron.fs.writeInternalFile(workspacePath, filename, content)
            }
            return { success: false, error: 'Not supported in browser' }
        },
        readInternalFile: async (workspacePath: string | undefined, filename: string) => {
            if (isElectron() && window.electron?.fs && window.electron.fs.readInternalFile) {
                return await window.electron.fs.readInternalFile(workspacePath, filename)
            }
            return { success: false, error: 'Not supported in browser' }
        }
    },

    // Memory operations
    memory: {
        callTool: async (name: string, args: Record<string, unknown>) => {
            if (isElectron() && window.electron?.memory) {
                return await window.electron.memory.callTool(name, args)
            }
            console.log('[Browser] Memory call tool mock:', { name, args })
            return { result: null }
        },
        getStats: async () => {
            if (isElectron() && window.electron?.memory) {
                return await window.electron.memory.getStats()
            }
            return { entityCount: 0, relationCount: 0, storageSize: 0, avgSearchLatency: 0, backend: 'mock' }
        },
        openFileLocation: async () => {
            if (isElectron() && window.electron?.memory) {
                return await window.electron.memory.openFileLocation()
            }
        }
    },

    // Antigravity OAuth operations (Google sign-in for Gemini access)
    antigravity: {
        initialize: async (): Promise<{ signedIn: boolean; email: string | null; projectId: string | null }> => {
            if (isElectron() && window.electron?.antigravity) {
                return await window.electron.antigravity.initialize()
            }
            return { signedIn: false, email: null, projectId: null }
        },
        signIn: async (): Promise<{ signedIn: boolean; email: string | null; projectId: string | null }> => {
            if (isElectron() && window.electron?.antigravity) {
                return await window.electron.antigravity.signIn()
            }
            console.warn('[Browser] Antigravity sign-in not available in browser mode')
            throw new Error('Antigravity sign-in requires the desktop app')
        },
        getToken: async (): Promise<{ token: string | null; headers: Record<string, string> | null }> => {
            if (isElectron() && window.electron?.antigravity) {
                return await window.electron.antigravity.getToken()
            }
            return { token: null, headers: null }
        },
        signOut: async (): Promise<{ success: boolean }> => {
            if (isElectron() && window.electron?.antigravity) {
                return await window.electron.antigravity.signOut()
            }
            return { success: true }
        },
        getStatus: async (): Promise<{ signedIn: boolean; email: string | null; projectId: string | null }> => {
            if (isElectron() && window.electron?.antigravity) {
                return await window.electron.antigravity.getStatus()
            }
            return { signedIn: false, email: null, projectId: null }
        },
        callGateway: async (url: string, headers: Record<string, string>, body: string): Promise<unknown> => {
            if (isElectron() && window.electron?.antigravity) {
                return await window.electron.antigravity.callGateway(url, headers, body)
            }
            throw new Error('Antigravity gateway calls require the desktop app')
        },
    },

    // Log operations
    logs: {
        add: async (entry: unknown) => {
            if (isElectron() && window.electron?.logs) {
                return await window.electron.logs.add(entry)
            }
        },
        getPath: async () => {
            if (isElectron() && window.electron?.logs) {
                return await window.electron.logs.getPath()
            }
            return 'logs/'
        },
        openFolder: async () => {
            if (isElectron() && window.electron?.logs) {
                return await window.electron.logs.openFolder()
            }
        }
    },
    // Clipboard operations
    clipboard: {
        readFilePaths: (): string[] => {
            if (isElectron() && window.electron?.clipboard) {
                return window.electron.clipboard.readFilePaths()
            }
            return []
        }
    },

    // WhatsApp operations
    whatsapp: {
        getState: async () => {
            if (isElectron() && window.electron?.whatsapp) {
                return window.electron.whatsapp.getState()
            }
            return { status: 'disconnected' as const, qrCode: null, error: null, phoneNumber: null, isVerified: false, connectedPhoneNumber: null }
        },
        connect: async (phoneNumber: string | null) => {
            if (isElectron() && window.electron?.whatsapp) {
                return window.electron.whatsapp.connect(phoneNumber ?? '')
            }
            console.warn('[Browser] WhatsApp not supported in browser mode')
            return { success: false, error: 'Not supported in browser mode' }
        },
        disconnect: async (clearAuth?: boolean) => {
            if (isElectron() && window.electron?.whatsapp) {
                return window.electron.whatsapp.disconnect(clearAuth)
            }
            return { success: true }
        },
        setTargetNumber: async (phoneNumber: string) => {
            if (isElectron() && window.electron?.whatsapp) {
                return window.electron.whatsapp.setTargetNumber(phoneNumber)
            }
            return { success: true }
        },
        sendMessage: async (to: string, content: string) => {
            if (isElectron() && window.electron?.whatsapp) {
                return window.electron.whatsapp.sendMessage(to, content)
            }
            console.warn('[Browser] WhatsApp sendMessage not supported')
            return { success: false, error: 'Not supported in browser mode' }
        },
        sendPresence: async (to: string, state: string) => {
            if (isElectron() && window.electron?.whatsapp) {
                return window.electron.whatsapp.sendPresence(to, state)
            }
            console.warn('[Browser] WhatsApp sendPresence not supported')
            return { success: false, error: 'Not supported in browser mode' }
        },
        onConnectionChange: (callback: (state: import('../stores/whatsappStore').WhatsAppConnectionState) => void): (() => void) => {
            if (isElectron() && window.electron?.whatsapp) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return window.electron.whatsapp.onConnectionChange(callback as any)
            }
            return () => {}
        },
        onMessage: (callback: (message: import('../stores/whatsappStore').WhatsAppConnectionState) => void): (() => void) => {
            if (isElectron() && window.electron?.whatsapp) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return window.electron.whatsapp.onMessage(callback as any)
            }
            return () => {}
        },
    },
}

export default electron
