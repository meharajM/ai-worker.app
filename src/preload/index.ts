import { contextBridge, ipcRenderer } from 'electron'

// IPC channels for main process communication
const electronAPI = {
    // Platform info
    platform: process.platform,

    // MCP Server operations
    mcp: {
        connect: (serverConfig: unknown) => ipcRenderer.invoke('mcp:connect', serverConfig),
        disconnect: (serverId: string) => ipcRenderer.invoke('mcp:disconnect', serverId),
        listTools: (serverId: string) => ipcRenderer.invoke('mcp:list-tools', serverId),
        callTool: (serverId: string, toolName: string, args: unknown) =>
            ipcRenderer.invoke('mcp:call-tool', serverId, toolName, args),
    },

    // Playwright browser lifecycle
    playwright: {
        closeBrowser: () => ipcRenderer.invoke('playwright:close-browser'),
    },

    // LLM operations (for future main process LLM handling)
    llm: {
        chat: (messages: unknown[], tools?: unknown[]) =>
            ipcRenderer.invoke('llm:chat', messages, tools),
        getProviders: () => ipcRenderer.invoke('llm:get-providers'),
        fetchOpenAIModels: (baseUrl: string, apiKey: string) =>
            ipcRenderer.invoke('llm:fetch-openai-models', baseUrl, apiKey),
        fetchOllamaModels: (baseUrl: string) =>
            ipcRenderer.invoke('llm:fetch-ollama-models', baseUrl),
    },

    // Storage operations (using electron-store in main process)
    store: {
        get: (key: string) => ipcRenderer.invoke('store:get', key),
        set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
        delete: (key: string) => ipcRenderer.invoke('store:delete', key),
    },

    // Shell operations
    shell: {
        openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
    },

    // App info
    app: {
        getVersion: () => ipcRenderer.invoke('app:get-version'),
        getName: () => ipcRenderer.invoke('app:get-name'),
        selectFolder: () => ipcRenderer.invoke('app:select-folder'),
        getMissingDependencies: () => ipcRenderer.invoke('app:get-missing-dependencies'),
        getAllDependencies: () => ipcRenderer.invoke('app:get-all-dependencies'),
        runSetupScript: () => ipcRenderer.invoke('app:run-setup-script'),
    },

    // Logging operations
    logs: {
        add: (entry: any) => ipcRenderer.invoke('logs:add', entry),
        getPath: () => ipcRenderer.invoke('logs:get-path'),
        openFolder: () => ipcRenderer.invoke('logs:open-folder'),
    },

    // Speech recognition operations (native Vosk-based)
    speech: {
        checkSupport: (modelId?: string) => ipcRenderer.invoke('speech:check-support', modelId),
        initialize: (options?: { modelId?: string }) =>
            ipcRenderer.invoke('speech:initialize', options),
        startListening: () => ipcRenderer.invoke('speech:start-listening'),
        stopListening: () => ipcRenderer.invoke('speech:stop-listening'),
        processAudio: (audioData: ArrayBuffer) =>
            ipcRenderer.send('speech:process-audio', audioData),
        downloadModel: (options: { modelId: string, url: string, modelName: string }) =>
            ipcRenderer.invoke('speech:download-model', options),
        getPreferredModel: () => ipcRenderer.invoke('speech:get-preferred-model'), // NEW
        getModelPath: (modelName: string) => ipcRenderer.invoke('speech:get-model-path', modelName),
        getStatus: (modelId?: string) => ipcRenderer.invoke('speech:get-status', modelId),
        cleanup: () => ipcRenderer.invoke('speech:cleanup'),
        onResult: (callback: (result: { text: string, final: boolean }) => void) => {
            const listener = (_event: any, result: { text: string, final: boolean }) => callback(result)
            ipcRenderer.on('speech:result', listener)
            return () => ipcRenderer.removeListener('speech:result', listener)
        },
        onDownloadProgress: (callback: (data: { modelId: string, progress: number }) => void) => {
            const listener = (_event: any, data: { modelId: string, progress: number }) => callback(data)
            ipcRenderer.on('speech:download-progress', listener)
            return () => ipcRenderer.removeListener('speech:download-progress', listener)
        },
    },
    // Secure storage operations (encrypted with OS keychain)
    secure: {
        isAvailable: () => ipcRenderer.invoke('secure:is-available'),
        set: (key: string, value: string, userId?: string) =>
            ipcRenderer.invoke('secure:set', key, value, userId),
        get: (key: string, userId?: string) =>
            ipcRenderer.invoke('secure:get', key, userId),
        delete: (key: string, userId?: string) =>
            ipcRenderer.invoke('secure:delete', key, userId),
        listKeys: (userId?: string) =>
            ipcRenderer.invoke('secure:list-keys', userId),
    },
    // Filesystem Safe Mode operations
    fs: {
        getPendingChanges: () => ipcRenderer.invoke('fs:get-pending-changes'),
        approveChange: (changeId: string) => ipcRenderer.invoke('fs:approve-change', changeId),
        rejectChange: (changeId: string) => ipcRenderer.invoke('fs:reject-change', changeId),
        approveChangeByToken: (token: string) => ipcRenderer.invoke('fs:approve-token', token),
        rejectChangeByToken: (token: string) => ipcRenderer.invoke('fs:reject-token', token),
        testForceWhatsAppApproval: (changeId: string, token?: string) =>
            ipcRenderer.invoke('fs:test-force-whatsapp-approval', changeId, token),
        writeInternalFile: (workspacePath: string | undefined, filename: string, content: string) =>
            ipcRenderer.invoke('fs:write-internal-file', workspacePath, filename, content),
        readInternalFile: (workspacePath: string | undefined, filename: string) =>
            ipcRenderer.invoke('fs:read-internal-file', workspacePath, filename),
        readFileBase64: (filePath: string) =>
            ipcRenderer.invoke('fs:read-file-base64', filePath)
    },
    // Memory operations
    memory: {
        runTests: () => ipcRenderer.invoke('memory:run-tests'),
        getStats: () => ipcRenderer.invoke('memory:get-stats'),
        exportAll: () => ipcRenderer.invoke('memory:export-all'),
        callTool: (name: string, args: any) => ipcRenderer.invoke('memory:call-tool', { name, args }),
        migrate: () => ipcRenderer.invoke('memory:migrate'),
        checkMigration: () => ipcRenderer.invoke('memory:check-migration'),
        openFileLocation: () => ipcRenderer.invoke('memory:open-file-location'),
    },
    // Antigravity OAuth operations (Google sign-in for Gemini access)
    antigravity: {
        initialize: () => ipcRenderer.invoke('antigravity:initialize'),
        signIn: () => ipcRenderer.invoke('antigravity:sign-in'),
        getToken: () => ipcRenderer.invoke('antigravity:get-token'),
        signOut: () => ipcRenderer.invoke('antigravity:sign-out'),
        getStatus: () => ipcRenderer.invoke('antigravity:get-status'),
        callGateway: (url: string, headers: Record<string, string>, body: string) =>
            ipcRenderer.invoke('antigravity:call-gateway', url, headers, body),
    },
    // Clipboard operations
    clipboard: {
        readFilePaths: () => {
            const { clipboard } = require('electron')
            const paths: string[] = []

            if (process.platform === 'darwin') {
                const fileUrl = clipboard.read('public.file-url')
                if (fileUrl) {
                    try {
                        // Decode URI and remove file:// prefix
                        const p = decodeURIComponent(fileUrl).replace(/^file:\/\//, '')
                        paths.push(p)
                    } catch (e) {
                        console.error('Error parsing file url from clipboard:', e)
                    }
                }
            } else {
                // Windows/Linux fallback or implementation
                // For now, on Windows, dragging generic files usually works via web API better than mac paste
                // We can add more robust logic later if needed
            }
            return paths
        }
    },
    // WhatsApp operations
    whatsapp: {
        getState: () => ipcRenderer.invoke('whatsapp:get-state'),
        connect: (phoneNumber?: string) => ipcRenderer.invoke('whatsapp:connect', phoneNumber),
        setTargetNumber: (phoneNumber: string) => ipcRenderer.invoke('whatsapp:set-target-number', phoneNumber),
        disconnect: (clearAuth?: boolean) => ipcRenderer.invoke('whatsapp:disconnect', clearAuth),
        sendMessage: (to: string, content: string) =>
            ipcRenderer.invoke('whatsapp:send-message', to, content),
        sendPresence: (to: string, state: string) =>
            ipcRenderer.invoke('whatsapp:send-presence', to, state),
        sendMediaMessage: (to: string, filePath: string, caption?: string, type?: string) =>
            ipcRenderer.invoke('whatsapp:send-media-message', to, filePath, caption, type),
        onConnectionChange: (callback: (state: unknown) => void) => {
            const listener = (_event: any, state: unknown) => callback(state)
            ipcRenderer.on('whatsapp:connection-change', listener)
            return () => ipcRenderer.removeListener('whatsapp:connection-change', listener)
        },
        onMessage: (callback: (message: unknown) => void) => {
            const listener = (_event: any, message: unknown) => callback(message)
            ipcRenderer.on('whatsapp:message', listener)
            return () => ipcRenderer.removeListener('whatsapp:message', listener)
        },
    },
    // General utils
    utils: {
        getPathForFile: (file: File): string => {
            const { webUtils } = require('electron')
            if (webUtils && webUtils.getPathForFile) {
                try {
                    const result = webUtils.getPathForFile(file)
                    // webUtils may return an empty string if it fails
                    if (result) return result
                } catch (e) {
                    console.error('webUtils.getPathForFile failed:', e)
                }
            }
            // Fallback to internal path property if webUtils isn't available
            return (file as any).path || ''
        }
    }
}

// Expose APIs to renderer
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
    } catch (error) {
        console.error('Failed to expose electron API:', error)
    }
} else {
    // @ts-ignore (define in d.ts)
    window.electron = electronAPI
}

// Type declarations
export type ElectronAPI = typeof electronAPI
