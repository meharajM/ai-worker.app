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

    fs: {
        getPendingChanges: () => Promise<Array<{
            id: string
            originalPath: string
            shadowPath: string
            type: 'create' | 'modify' | 'delete'
            content?: string
            timestamp: number
            approvalChannel: 'desktop' | 'whatsapp'
            approvalToken?: string
            status: 'pending' | 'approved' | 'rejected' | 'expired'
            createdAt: number
            resolvedAt?: number
            resolvedBy?: 'ui' | 'wa'
        }>>
        approveChange: (changeId: string) => Promise<{ success: boolean; error?: string }>
        rejectChange: (changeId: string) => Promise<{ success: boolean; error?: string }>
        approveChangeByToken: (token: string) => Promise<{ success: boolean; error?: string }>
        rejectChangeByToken: (token: string) => Promise<{ success: boolean; error?: string }>
        testForceWhatsAppApproval: (changeId: string, token?: string) => Promise<{ success: boolean; token?: string; error?: string }>
        writeInternalFile: (workspacePath: string | undefined, filename: string, content: string) => Promise<{ success: boolean; path?: string; error?: string }>
        readInternalFile: (workspacePath: string | undefined, filename: string) => Promise<{ success: boolean; content?: string; error?: string }>
        readFileBase64: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
    }

    whatsapp: {
        getState: () => Promise<{
            status: 'disconnected' | 'connecting' | 'connected' | 'error'
            qrCode: string | null
            error: string | null
            phoneNumber: string | null
            workerNumber: string | null
        }>
        connect: (phoneNumber?: string) => Promise<{ success: boolean; error?: string }>
        setTargetNumber: (phoneNumber: string) => Promise<{ success: boolean; error?: string }>
        disconnect: (clearAuth?: boolean) => Promise<{ success: boolean; error?: string }>
        sendMessage: (to: string, content: string) => Promise<{ success: boolean; error?: string }>
        sendPresence: (to: string, state: string) => Promise<{ success: boolean; error?: string }>
        sendMediaMessage: (to: string, filePath: string, caption?: string, type?: string) => Promise<{ success: boolean; error?: string }>
        onConnectionChange: (callback: (state: unknown) => void) => () => void
        onMessage: (callback: (message: unknown) => void) => () => void
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
