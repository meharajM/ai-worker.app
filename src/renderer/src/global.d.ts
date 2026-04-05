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
        getHomePath: () => Promise<string>
        selectFolder: () => Promise<string | null>
        getMissingDependencies: () => Promise<any[]>
        getAllDependencies: () => Promise<any[]>
        runSetupScript: () => Promise<void>
    }

    speech: {
        checkSupport: (modelId?: string) => Promise<{
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
        downloadModel: (options: { modelId: string; url: string; modelName: string }) => Promise<{
            success: boolean
            error?: string
        }>
        getPreferredModel: () => Promise<{ id: string; name: string; url: string; lang: string }>
        getModelPath: (modelName: string) => Promise<string | null>
        getStatus: (modelId?: string) => Promise<{
            isInitialized: boolean
            isListening: boolean
            error: string | null
            modelsPath: string
            modelDownloaded: boolean
        }>
        cleanup: () => Promise<{ success: boolean; error?: string }>
        onResult: (callback: (result: { text: string; final: boolean }) => void) => () => void
        onDownloadProgress: (callback: (data: { modelId: string; progress: number }) => void) => () => void
    }

    clipboard: {
        readFilePaths: () => string[]
    }

    utils: {
        getPathForFile: (file: File) => string
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
