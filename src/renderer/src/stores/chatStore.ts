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

interface ChatState {
    messages: Message[]
    isProcessing: boolean

    // Actions
    addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => Message
    updateMessage: (id: string, updates: Partial<Message>) => void
    removeMessage: (id: string) => void
    clearMessages: () => void
    setProcessing: (processing: boolean) => void
}

export const useChatStore = create<ChatState>()(
    persist(
        (set, get) => ({
            messages: [],
            isProcessing: false,

            addMessage: (message) => {
                const newMessage: Message = {
                    ...message,
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    timestamp: Date.now(),
                }
                set((state) => ({
                    messages: [...state.messages, newMessage],
                }))
                return newMessage
            },

            updateMessage: (id, updates) => {
                set((state) => ({
                    messages: state.messages.map((msg) =>
                        msg.id === id ? { ...msg, ...updates } : msg
                    ),
                }))
            },

            removeMessage: (id) => {
                set((state) => ({
                    messages: state.messages.filter((msg) => msg.id !== id),
                }))
            },

            clearMessages: () => {
                set({ messages: [] })
            },

            setProcessing: (processing) => {
                set({ isProcessing: processing })
            },
        }),
        {
            name: 'ai-worker-chat',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ messages: state.messages }),
        }
    )
)
