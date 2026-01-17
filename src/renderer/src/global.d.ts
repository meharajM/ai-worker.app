// Global type declarations for AI-Worker
// This file ensures TypeScript recognizes window.electron

// Electron API type (matches preload/index.ts)
interface ElectronAPI {
    platform: string

    mcp: {
        connect: (serverConfig: unknown) => Promise<{ success: boolean; serverId?: string; error?: string }>
        disconnect: (serverId: string) => Promise<{ success: boolean }>
        listTools: (serverId: string) => Promise<{ tools: Array<{ name: string; description: string }> }>
        callTool: (serverId: string, toolName: string, args: unknown) => Promise<{ result: unknown }>
    }

    llm: {
        chat: (messages: unknown[], tools?: unknown[]) => Promise<unknown>
        getProviders: () => Promise<Record<string, { available: boolean }>>
        fetchOpenAIModels: (baseUrl: string, apiKey: string) => Promise<{ success: boolean; models?: string[]; error?: string }>
        fetchOllamaModels: (baseUrl: string) => Promise<{ success: boolean; models?: string[]; error?: string }>
    }

    store: {
        get: (key: string) => Promise<unknown>
        set: (key: string, value: unknown) => Promise<boolean>
        delete: (key: string) => Promise<boolean>
    }

    shell: {
        openExternal: (url: string) => Promise<void>
    }

    app: {
        getVersion: () => Promise<string>
        getName: () => Promise<string>
    }

    speech: {
        checkSupport: () => Promise<{
            supported: boolean
            modelDownloaded: boolean
            modelsPath: string
            error: string | null
        }>
        initialize: (options?: { modelName?: string }) => Promise<{ success: boolean; error?: string }>
        startListening: () => Promise<{ success: boolean; error?: string; message?: string }>
        stopListening: () => Promise<{ success: boolean; error?: string; message?: string }>
        processAudio: (audioData: ArrayBuffer) => Promise<{
            success: boolean
            isFinal?: boolean
            transcript?: string
            error?: string
        }>
        getFinalResult: () => Promise<{ success: boolean; transcript?: string; error?: string }>
        downloadModel: (modelUrl?: string) => Promise<{
            success: boolean
            error?: string
            downloadUrl?: string
            targetPath?: string
        }>
        getStatus: () => Promise<{
            isInitialized: boolean
            isListening: boolean
            error: string | null
            modelsPath: string
            modelDownloaded: boolean
        }>
        cleanup: () => Promise<{ success: boolean; error?: string }>
    }
}

// Extend the Window interface globally
declare global {
    interface Window {
        electron?: ElectronAPI
        SpeechRecognition?: typeof SpeechRecognition
        webkitSpeechRecognition?: typeof SpeechRecognition
    }
}

export { }
