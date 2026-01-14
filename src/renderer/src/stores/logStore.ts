import { create } from 'zustand'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
    id: string
    timestamp: string
    level: LogLevel
    sessionId: string
    operation: string
    component: string
    message: string
    data?: any
}

export interface LogState {
    logs: LogEntry[]
    addLog: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => Promise<void>
    fetchSessionLogs: (sessionId: string) => Promise<void>
    clearLogs: (sessionId?: string) => Promise<void>
}

// Global reference to electron API (defined in preload)
const electron = (window as any).electron

export const useLogStore = create<LogState>((set, get) => ({
    logs: [],

    addLog: async (entry) => {
        const newLog: LogEntry = {
            ...entry,
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
        }

        // Add to local state for immediate feedback
        set((state) => ({
            logs: [...state.logs, newLog].slice(-500), // Keep a smaller local buffer
        }))

        // Persist to filesystem via main process
        if (electron?.logs) {
            await electron.logs.add(newLog)
        }
    },

    fetchSessionLogs: async (sessionId) => {
        if (!electron?.logs) return

        try {
            const sessionLogs = await electron.logs.getSession(sessionId)
            set({ logs: sessionLogs })
        } catch (error) {
            console.error('Error fetching session logs:', error)
        }
    },

    clearLogs: async (sessionId) => {
        if (electron?.logs) {
            await electron.logs.clear(sessionId)
        }

        if (sessionId) {
            set((state) => ({
                logs: state.logs.filter((log) => log.sessionId !== sessionId),
            }))
        } else {
            set({ logs: [] })
        }
    },
}))
