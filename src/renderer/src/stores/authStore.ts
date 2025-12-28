import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { FEATURE_FLAGS, RATE_LIMITS } from '../lib/constants'

export interface User {
    uid: string
    email: string | null
    displayName: string | null
    photoURL: string | null
}

interface UsageTracking {
    chatsToday: number
    mcpOpsThisHour: number
    lastChatDate: string
    lastMcpHour: number
}

interface AuthState {
    user: User | null
    loading: boolean
    error: string | null
    usage: UsageTracking

    // Actions
    setUser: (user: User | null) => void
    setLoading: (loading: boolean) => void
    setError: (error: string | null) => void
    signInWithGoogle: () => Promise<void>
    signOut: () => Promise<void>

    // Rate limiting
    canChat: () => boolean
    canUseMcp: () => boolean
    recordChat: () => void
    recordMcpOp: () => void
    getRemainingChats: () => number
    getRemainingMcpOps: () => number
}

const getDefaultUsage = (): UsageTracking => ({
    chatsToday: 0,
    mcpOpsThisHour: 0,
    lastChatDate: new Date().toDateString(),
    lastMcpHour: new Date().getHours(),
})

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            user: null,
            loading: false,
            error: null,
            usage: getDefaultUsage(),

            setUser: (user) => set({ user, error: null }),
            setLoading: (loading) => set({ loading }),
            setError: (error) => set({ error, loading: false }),

            signInWithGoogle: async () => {
                if (!FEATURE_FLAGS.AUTH_ENABLED) {
                    console.log('Auth is disabled via feature flag')
                    return
                }

                set({ loading: true, error: null })

                try {
                    // TODO: Implement actual Firebase Google sign-in
                    // For now, simulate auth
                    await new Promise((resolve) => setTimeout(resolve, 1000))

                    // Mock user for development
                    set({
                        user: {
                            uid: 'mock_user_123',
                            email: 'user@example.com',
                            displayName: 'Test User',
                            photoURL: null,
                        },
                        loading: false,
                    })
                } catch (error) {
                    set({
                        error: error instanceof Error ? error.message : 'Sign in failed',
                        loading: false,
                    })
                }
            },

            signOut: async () => {
                set({ loading: true })

                try {
                    // TODO: Implement actual Firebase sign out
                    await new Promise((resolve) => setTimeout(resolve, 500))
                    set({ user: null, loading: false })
                } catch (error) {
                    set({
                        error: error instanceof Error ? error.message : 'Sign out failed',
                        loading: false,
                    })
                }
            },

            canChat: () => {
                if (!FEATURE_FLAGS.RATE_LIMITING_ENABLED) return true

                const { user, usage } = get()
                if (user) return true // Authenticated users have no limits

                // Check if it's a new day
                const today = new Date().toDateString()
                if (usage.lastChatDate !== today) {
                    set({ usage: { ...usage, chatsToday: 0, lastChatDate: today } })
                    return true
                }

                return usage.chatsToday < RATE_LIMITS.ANONYMOUS.CHATS_PER_DAY
            },

            canUseMcp: () => {
                if (!FEATURE_FLAGS.RATE_LIMITING_ENABLED) return true

                const { user, usage } = get()
                if (user) return true

                // Check if it's a new hour
                const currentHour = new Date().getHours()
                if (usage.lastMcpHour !== currentHour) {
                    set({ usage: { ...usage, mcpOpsThisHour: 0, lastMcpHour: currentHour } })
                    return true
                }

                return usage.mcpOpsThisHour < RATE_LIMITS.ANONYMOUS.MCP_OPERATIONS_PER_HOUR
            },

            recordChat: () => {
                const { usage } = get()
                const today = new Date().toDateString()

                if (usage.lastChatDate !== today) {
                    set({ usage: { ...usage, chatsToday: 1, lastChatDate: today } })
                } else {
                    set({ usage: { ...usage, chatsToday: usage.chatsToday + 1 } })
                }
            },

            recordMcpOp: () => {
                const { usage } = get()
                const currentHour = new Date().getHours()

                if (usage.lastMcpHour !== currentHour) {
                    set({ usage: { ...usage, mcpOpsThisHour: 1, lastMcpHour: currentHour } })
                } else {
                    set({ usage: { ...usage, mcpOpsThisHour: usage.mcpOpsThisHour + 1 } })
                }
            },

            getRemainingChats: () => {
                const { user, usage } = get()
                if (user || !FEATURE_FLAGS.RATE_LIMITING_ENABLED) return Infinity

                const today = new Date().toDateString()
                if (usage.lastChatDate !== today) return RATE_LIMITS.ANONYMOUS.CHATS_PER_DAY

                return Math.max(0, RATE_LIMITS.ANONYMOUS.CHATS_PER_DAY - usage.chatsToday)
            },

            getRemainingMcpOps: () => {
                const { user, usage } = get()
                if (user || !FEATURE_FLAGS.RATE_LIMITING_ENABLED) return Infinity

                const currentHour = new Date().getHours()
                if (usage.lastMcpHour !== currentHour) return RATE_LIMITS.ANONYMOUS.MCP_OPERATIONS_PER_HOUR

                return Math.max(0, RATE_LIMITS.ANONYMOUS.MCP_OPERATIONS_PER_HOUR - usage.mcpOpsThisHour)
            },
        }),
        {
            name: 'ai-worker-auth',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                user: state.user,
                usage: state.usage,
            }),
        }
    )
)
