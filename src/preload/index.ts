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

    // LLM operations (for future main process LLM handling)
    llm: {
        chat: (messages: unknown[], tools?: unknown[]) =>
            ipcRenderer.invoke('llm:chat', messages, tools),
        getProviders: () => ipcRenderer.invoke('llm:get-providers'),
        fetchOpenAIModels: (baseUrl: string, apiKey: string) =>
            ipcRenderer.invoke('llm:fetch-openai-models', baseUrl, apiKey),
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
    },
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
