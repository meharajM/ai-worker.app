import { create } from 'zustand'

export type LogEventType =
    | 'SYSTEM_INIT'      // App startup
    | 'SESSION_START'    // New chat session
    | 'USER_MESSAGE'     // User input
    | 'LLM_REQUEST'      // Outgoing request to LLM
    | 'LLM_RESPONSE'     // Incoming response from LLM
    | 'TOOL_CALL'        // Tool execution request
    | 'TOOL_RESULT'      // Tool execution result
    | 'ERROR'            // Application errors
    | 'STATE_CHANGE'     // Significant state changes
    | 'DEBUG';           // General debug info

export interface CorporateLogEntry {
    timestamp: string
    sessionId: string
    eventType: LogEventType
    component: string
    correlationId?: string
    durationMs?: number
    details: {
        model?: string
        input?: any
        output?: any
        error?: string
        metadata?: any
    }
}

interface LogState {
    addLog: (entry: Omit<CorporateLogEntry, 'timestamp'>) => Promise<void>
    getLogPath: () => Promise<string>
    openLogFolder: () => Promise<void>
}

// Global reference to electron API (defined in preload)
const electron = (window as any).electron

// Keys to scrub from logs
const SENSITIVE_KEYS = [
    'api_key', 'apikey', 'key', 'token', 'secret', 'password', 'credential', 'auth', 'authorization', 'access_token'
]

function sanitize(obj: any): any {
    if (!obj) return obj
    if (typeof obj !== 'object') return obj

    if (Array.isArray(obj)) {
        return obj.map(item => sanitize(item))
    }

    const cleaned: any = {}
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase()
        if (SENSITIVE_KEYS.some(secret => lowerKey.includes(secret))) {
            cleaned[key] = '***REDACTED***'
        } else if (typeof value === 'object' && value !== null) {
            cleaned[key] = sanitize(value)
        } else {
            cleaned[key] = value
        }
    }
    return cleaned
}

export const useLogStore = create<LogState>(() => ({
    addLog: async (entry) => {
        if (!electron?.logs) return

        // Deep sanitize the details object to prevent credential leakage
        const sanitizedDetails = sanitize(entry.details)

        const fullEntry: CorporateLogEntry = {
            ...entry,
            details: sanitizedDetails,
            timestamp: new Date().toISOString(),
        }

        // Fire and forget - don't block the UI for logging
        electron.logs.add(fullEntry).catch((err: any) =>
            console.error('Failed to persist log:', err)
        )
    },

    getLogPath: async () => {
        if (!electron?.logs) return ''
        return await electron.logs.getPath()
    },

    openLogFolder: async () => {
        if (!electron?.logs) return
        await electron.logs.openFolder()
    }
}))
