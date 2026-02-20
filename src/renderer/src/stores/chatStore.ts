import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface MessageAction {
    type: 'continue' | 'cancel' | 'custom';
    label: string;
    payload?: Record<string, unknown>;
}

export interface Message {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: number
    toolCalls?: ToolCall[]
    actions?: MessageAction[]
    attachments?: { name: string; path: string; type: string }[]
}

export interface ToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
    result?: string
}

export interface ChatSession {
    id: string
    title: string
    messages: Message[]
    createdAt: number
    updatedAt: number
    workspacePath?: string  // Optional workspace folder for this chat session
}

interface ChatState {
    sessions: ChatSession[]
    activeSessionId: string | null
    isProcessing: boolean
    processingSessionId: string | null
    abortController: AbortController | null
    offlineSpeech: boolean

    // Session Actions
    createSession: (workspacePath?: string) => string
    deleteSession: (id: string) => void
    setActiveSession: (id: string) => void
    updateSessionTitle: (id: string, title: string) => void
    updateSessionWorkspace: (id: string, workspacePath: string) => void
    setOfflineSpeech: (enabled: boolean) => void

    // Message Actions (operate on active session)
    addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => Message
    addSessionMessage: (sessionId: string, message: Omit<Message, 'id' | 'timestamp'>) => Message
    updateMessage: (id: string, updates: Partial<Message>) => void
    updateSessionMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void
    removeMessage: (id: string) => void
    clearMessages: () => void
    setProcessing: (processing: boolean) => void
    abortProcessing: () => void
    getAbortSignal: () => AbortSignal | null
    
    // UI State
    sidebarOpen: boolean
    toggleSidebar: () => void

    // Helpers
    getActiveSession: () => ChatSession | undefined
}

export const useChatStore = create<ChatState>()(
    persist(
        (set, get) => ({
            sessions: [],
            activeSessionId: null,
            isProcessing: false,
            processingSessionId: null,
            abortController: null,

            getActiveSession: () => {
                const { sessions, activeSessionId } = get()
                return sessions.find((s) => s.id === activeSessionId)
            },

            createSession: (workspacePath?: string) => {
                const newSession: ChatSession = {
                    id: `chat_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                    title: 'New Chat',
                    messages: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    workspacePath,  // Store workspace path if provided
                }
                set((state) => ({
                    sessions: [newSession, ...state.sessions],
                    activeSessionId: newSession.id,
                    isProcessing: false,
                    processingSessionId: null
                }))
                return newSession.id
            },

            deleteSession: (id) => {
                set((state) => {
                    if (state.activeSessionId === id && state.isProcessing) {
                        const { abortProcessing } = get()
                        abortProcessing()
                    }

                    const newSessions = state.sessions.filter((s) => s.id !== id)
                    let newActiveId = state.activeSessionId
                    if (state.activeSessionId === id) {
                        newActiveId = newSessions.length > 0 ? newSessions[0].id : null
                    }
                    return {
                        sessions: newSessions,
                        activeSessionId: newActiveId,
                        ...(state.activeSessionId === id && state.isProcessing ? { isProcessing: false, processingSessionId: null } : {})
                    }
                })
            },

            setActiveSession: (id) => {
                set({ activeSessionId: id })
            },

            updateSessionTitle: (id, title) => {
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === id ? { ...s, title, updatedAt: Date.now() } : s
                    ),
                }))
            },

            updateSessionWorkspace: (id, workspacePath) => {
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === id ? { ...s, workspacePath, updatedAt: Date.now() } : s
                    ),
                }))
            },

            addMessage: (message) => {
                const newMessage: Message = {
                    ...message,
                    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                    timestamp: Date.now(),
                }

                set((state) => {
                    let activeId = state.activeSessionId
                    let sessions = state.sessions

                    // Verify activeId is valid
                    if (activeId && !sessions.find(s => s.id === activeId)) {
                        activeId = null
                    }

                    // Auto-create session if none exists
                    if (!activeId) {
                        const newSession: ChatSession = {
                            id: `chat_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                            title: 'New Chat',
                            messages: [],
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                        }
                        sessions = [newSession, ...sessions]
                        activeId = newSession.id
                    }

                    // Update title based on first user message if it's "New Chat"
                    const activeSession = sessions.find(s => s.id === activeId)
                    let newTitle = activeSession?.title
                    if (activeSession && activeSession.messages.length === 0 && message.role === 'user') {
                        newTitle = message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '')
                    }

                    return {
                        sessions: sessions.map((s) =>
                            s.id === activeId
                                ? {
                                    ...s,
                                    messages: [...s.messages, newMessage],
                                    updatedAt: Date.now(),
                                    title: newTitle || s.title
                                }
                                : s
                        ),
                        activeSessionId: activeId
                    }
                })
                return newMessage
            },

            addSessionMessage: (sessionId, message) => {
                const newMessage: Message = {
                    ...message,
                    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                    timestamp: Date.now(),
                }

                set((state) => {
                    const sessions = state.sessions.map((s) =>
                        s.id === sessionId
                            ? {
                                ...s,
                                messages: [...s.messages, newMessage],
                                updatedAt: Date.now()
                            }
                            : s
                    )
                    return { sessions }
                })
                return newMessage
            },

            updateMessage: (id, updates) => {
                set((state) => {
                    if (!state.activeSessionId) return state
                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === state.activeSessionId
                                ? {
                                    ...s,
                                    messages: s.messages.map((msg) =>
                                        msg.id === id ? { ...msg, ...updates } : msg
                                    ),
                                    updatedAt: Date.now()
                                }
                                : s
                        ),
                    }
                })
            },

            updateSessionMessage: (sessionId, messageId, updates) => {
                set((state) => {
                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === sessionId
                                ? {
                                    ...s,
                                    messages: s.messages.map((msg) =>
                                        msg.id === messageId ? { ...msg, ...updates } : msg
                                    ),
                                    updatedAt: Date.now()
                                }
                                : s
                        ),
                    }
                })
            },

            removeMessage: (id) => {
                set((state) => {
                    if (!state.activeSessionId) return state
                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === state.activeSessionId
                                ? {
                                    ...s,
                                    messages: s.messages.filter((msg) => msg.id !== id),
                                    updatedAt: Date.now()
                                }
                                : s
                        ),
                    }
                })
            },

            clearMessages: () => {
                const { abortProcessing } = get()
                abortProcessing() // Modular: cleanly abort any active LLM calls on this session

                set((state) => {
                    if (!state.activeSessionId) return state
                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === state.activeSessionId
                                ? { ...s, messages: [], updatedAt: Date.now() }
                                : s
                        ),
                        isProcessing: false, // Ensure UI resets
                        processingSessionId: null
                    }
                })
            },

            setProcessing: (processing) => {
                if (processing) {
                    // Create new AbortController when starting processing
                    // Capture active session ID
                    const { activeSessionId } = get();
                    set({ isProcessing: true, processingSessionId: activeSessionId, abortController: new AbortController() })
                } else {
                    // Clear AbortController when done
                    set({ isProcessing: false, processingSessionId: null, abortController: null })
                }
            },

            abortProcessing: () => {
                const { abortController } = get()
                if (abortController) {
                    abortController.abort()
                }
                set({ isProcessing: false, abortController: null })
            },

            getAbortSignal: () => {
                const { abortController } = get()
                return abortController?.signal || null
            },

            offlineSpeech: false, // Default to online (Google)
            setOfflineSpeech: (enabled) => set({ offlineSpeech: enabled }),

            sidebarOpen: true,
            toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
        }),
        {
            name: 'ai-worker-chat-v2', // Versioned storage to avoid conflicts
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                sessions: state.sessions,
                activeSessionId: state.activeSessionId,
                offlineSpeech: state.offlineSpeech,
                sidebarOpen: state.sidebarOpen
            }),
        }
    )
)
