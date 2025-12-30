import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface Message {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: number
    toolCalls?: ToolCall[]
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
}

interface ChatState {
    sessions: ChatSession[]
    activeSessionId: string | null
    isProcessing: boolean

    // Session Actions
    createSession: () => string
    deleteSession: (id: string) => void
    setActiveSession: (id: string) => void
    updateSessionTitle: (id: string, title: string) => void

    // Message Actions (operate on active session)
    addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => Message
    updateMessage: (id: string, updates: Partial<Message>) => void
    removeMessage: (id: string) => void
    clearMessages: () => void
    setProcessing: (processing: boolean) => void
    
    // Helpers
    getActiveSession: () => ChatSession | undefined
}

export const useChatStore = create<ChatState>()(
    persist(
        (set, get) => ({
            sessions: [],
            activeSessionId: null,
            isProcessing: false,

            getActiveSession: () => {
                const { sessions, activeSessionId } = get()
                return sessions.find((s) => s.id === activeSessionId)
            },

            createSession: () => {
                const newSession: ChatSession = {
                    id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    title: 'New Chat',
                    messages: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                }
                set((state) => ({
                    sessions: [newSession, ...state.sessions],
                    activeSessionId: newSession.id,
                }))
                return newSession.id
            },

            deleteSession: (id) => {
                set((state) => {
                    const newSessions = state.sessions.filter((s) => s.id !== id)
                    let newActiveId = state.activeSessionId
                    if (state.activeSessionId === id) {
                        newActiveId = newSessions.length > 0 ? newSessions[0].id : null
                    }
                    return {
                        sessions: newSessions,
                        activeSessionId: newActiveId,
                    }
                })
            },

            setActiveSession: (id) => {
                set({ activeSessionId: id })
            },

            updateSessionTitle: (id, title) => {
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === id ? { ...s, title } : s
                    ),
                }))
            },

            addMessage: (message) => {
                const newMessage: Message = {
                    ...message,
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
                            id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
                set((state) => {
                    if (!state.activeSessionId) return state
                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === state.activeSessionId
                                ? { ...s, messages: [], updatedAt: Date.now() }
                                : s
                        ),
                    }
                })
            },

            setProcessing: (processing) => {
                set({ isProcessing: processing })
            },
        }),
        {
            name: 'ai-worker-chat-v2', // Versioned storage to avoid conflicts
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ 
                sessions: state.sessions, 
                activeSessionId: state.activeSessionId 
            }),
        }
    )
)
