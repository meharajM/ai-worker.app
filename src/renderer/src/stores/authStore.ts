import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useSettingsStore } from './settingsStore'
import { useMcpStore } from './mcpStore'
import { FEATURE_FLAGS, RATE_LIMITS } from '../lib/constants'
import electron from '../lib/electron'
import {
    signInWithGoogle as firebaseSignIn,
    signOutFromFirebase,
    onAuthChange,
    initializeFirebase,
    signInWithEmail as firebaseSignInEmail,
    signUpWithEmail as firebaseSignUpEmail,
    updateUserProfile
} from '../lib/firebase'

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

    // Antigravity OAuth state (for Gemini access without API key)
    antigravitySignedIn: boolean
    antigravityEmail: string | null
    antigravityLoading: boolean

    // Perplexity OAuth state
    perplexitySignedIn: boolean
    perplexityHasToken: boolean
    perplexityLoading: boolean

    // Actions
    setUser: (user: User | null) => void
    setLoading: (loading: boolean) => void
    setError: (error: string | null) => void
    signInWithGoogle: () => Promise<void>
    signInWithEmail: (email: string, pass: string) => Promise<void>
    signUpWithEmail: (email: string, pass: string, name: string) => Promise<void>
    signOut: () => Promise<void>
    initializeAuthListener: () => Promise<() => void>

    // Antigravity actions
    signInWithAntigravity: () => Promise<void>
    signOutFromAntigravity: () => Promise<void>
    initializeAntigravity: () => Promise<void>

    // Perplexity actions
    signInWithPerplexity: () => Promise<void>
    signOutFromPerplexity: () => Promise<void>
    initializePerplexity: () => Promise<void>

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

            // Antigravity OAuth defaults
            antigravitySignedIn: false,
            antigravityEmail: null,
            antigravityLoading: false,

            // Perplexity OAuth defaults
            perplexitySignedIn: false,
            perplexityHasToken: false,
            perplexityLoading: false,

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
                    const firebaseUser = await firebaseSignIn()
                    set({
                        user: {
                            uid: firebaseUser.uid,
                            email: firebaseUser.email,
                            displayName: firebaseUser.displayName,
                            photoURL: firebaseUser.photoURL,
                        },
                        loading: false,
                    })
                } catch (error) {
                    console.error('Sign in failed:', error)
                    set({
                        error: error instanceof Error ? error.message : 'Sign in failed',
                        loading: false,
                    })
                }
            },

            signInWithEmail: async (email, password) => {
                if (!FEATURE_FLAGS.AUTH_ENABLED) return
                set({ loading: true, error: null })
                try {
                    const firebaseUser = await firebaseSignInEmail(email, password)
                    set({
                        user: {
                            uid: firebaseUser.uid,
                            email: firebaseUser.email,
                            displayName: firebaseUser.displayName,
                            photoURL: firebaseUser.photoURL,
                        },
                        loading: false,
                    })
                } catch (error) {
                    console.error('Email sign in failed:', error)
                    set({
                        error: error instanceof Error ? error.message : 'Sign in failed',
                        loading: false
                    })
                    throw error // Re-throw for UI to handle
                }
            },

            signUpWithEmail: async (email, password, name) => {
                if (!FEATURE_FLAGS.AUTH_ENABLED) return
                set({ loading: true, error: null })
                try {
                    const firebaseUser = await firebaseSignUpEmail(email, password)

                    // Update profile with name
                    if (name) {
                        await updateUserProfile(firebaseUser, { displayName: name })
                        // User profile updated on server, proceed to update store
                    }

                    set({
                        user: {
                            uid: firebaseUser.uid,
                            email: firebaseUser.email,
                            displayName: name || firebaseUser.displayName,
                            photoURL: firebaseUser.photoURL,
                        },
                        loading: false,
                    })
                } catch (error) {
                    console.error('Email sign up failed:', error)
                    set({
                        error: error instanceof Error ? error.message : 'Sign up failed',
                        loading: false
                    })
                    throw error
                }
            },

            signOut: async () => {
                set({ loading: true })

                try {
                    await signOutFromFirebase()
                    // Also sign out from Antigravity if signed in
                    try {
                        await electron.antigravity.signOut()
                    } catch { /* Antigravity sign-out is best-effort */ }
                    set({ user: null, loading: false, antigravitySignedIn: false, antigravityEmail: null })
                } catch (error) {
                    console.error('Sign out failed:', error)
                    set({
                        error: error instanceof Error ? error.message : 'Sign out failed',
                        loading: false,
                    })
                }
            },

            // Antigravity OAuth — sign in for Gemini access without API key
            signInWithAntigravity: async () => {
                set({ antigravityLoading: true, error: null })
                try {
                    const result = await electron.antigravity.signIn()
                    set({
                        antigravitySignedIn: result.signedIn,
                        antigravityEmail: result.email,
                        antigravityLoading: false,
                    })
                    // When user links Google/Gemini, set it as default as requested
                    if (result.signedIn) {
                        useSettingsStore.getState().setPreferredProvider('gemini')
                    }
                    console.log('[Auth] Antigravity sign-in successful:', result.email)
                } catch (error) {
                    console.error('[Auth] Antigravity sign-in failed:', error)
                    set({
                        error: error instanceof Error ? error.message : 'Antigravity sign-in failed',
                        antigravityLoading: false,
                    })
                }
            },

            signOutFromAntigravity: async () => {
                try {
                    await electron.antigravity.signOut()
                    set({ antigravitySignedIn: false, antigravityEmail: null })
                    console.log('[Auth] Antigravity signed out')
                } catch (error) {
                    console.error('[Auth] Antigravity sign-out failed:', error)
                }
            },

            // Initialize Antigravity — restore session on app start
            initializeAntigravity: async () => {
                try {
                    const status = await electron.antigravity?.initialize()
                    if (status?.signedIn) {
                        set({
                            antigravitySignedIn: true,
                            antigravityEmail: status.email,
                        })
                        console.log('[Auth] Antigravity session restored:', status.email)
                    }
                } catch (error) {
                    console.error('[Auth] Antigravity initialization failed:', error)
                }
            },

            // Perplexity OAuth — sign in to Perplexity to capture token
            signInWithPerplexity: async () => {
                set({ perplexityLoading: true, error: null })
                try {
                    const result = await electron.perplexity?.signIn()
                    set({
                        perplexitySignedIn: result?.signedIn || false,
                        perplexityHasToken: result?.hasToken || false,
                        perplexityLoading: false,
                    })
                    console.log('[Auth] Perplexity sign-in successful')
                } catch (error) {
                    console.error('[Auth] Perplexity sign-in failed:', error)
                    set({
                        error: error instanceof Error ? error.message : 'Perplexity sign-in failed',
                        perplexityLoading: false,
                    })
                }
            },

            signOutFromPerplexity: async () => {
                try {
                    await electron.perplexity?.signOut()
                    set({ perplexitySignedIn: false, perplexityHasToken: false })
                    console.log('[Auth] Perplexity signed out')
                } catch (error) {
                    console.error('[Auth] Perplexity sign-out failed:', error)
                }
            },

            // Initialize Perplexity
            initializePerplexity: async () => {
                try {
                    const status = await electron.perplexity?.initialize()
                    if (status?.signedIn) {
                        set({
                            perplexitySignedIn: true,
                            perplexityHasToken: status.hasToken,
                        })
                        console.log('[Auth] Perplexity session restored')
                    }
                } catch (error) {
                    console.error('[Auth] Perplexity initialization failed:', error)
                }
            },

            initializeAuthListener: async () => {
                if (!FEATURE_FLAGS.AUTH_ENABLED) {
                    console.log('[Auth] Feature flag disabled, skipping listener')
                    return () => { }
                }

                try {
                    console.log('[Auth] Initializing Firebase...')
                    await initializeFirebase()
                    console.log('[Auth] Firebase initialized, setting up listener...')

                    // Set up auth state listener
                    const unsubscribe = await onAuthChange(async (firebaseUser) => {
                        console.log('[Auth] Auth state changed:', firebaseUser ? 'User Logged In' : 'User Null', firebaseUser?.uid)

                        if (firebaseUser) {
                            const userData = {
                                uid: firebaseUser.uid,
                                email: firebaseUser.email,
                                displayName: firebaseUser.displayName,
                                photoURL: firebaseUser.photoURL,
                            }
                            console.log('[Auth] Updating store with user:', userData)

                            // Load scoped secrets/servers
                            try {
                                await useSettingsStore.getState().loadUserSecrets(firebaseUser.uid)
                                await useMcpStore.getState().loadUserServers(firebaseUser.uid)
                            } catch (err) {
                                console.error('[Auth] Failed to load user data:', err)
                            }

                            set({
                                user: userData,
                                loading: false,
                            })
                        } else {
                            console.log('[Auth] Clearing user from store')

                            // Clear scoped secrets/servers
                            useSettingsStore.getState().clearUserSecrets()
                            useMcpStore.getState().clearUserServers().catch(console.error)

                            set({ user: null, loading: false })
                        }
                    })
                    return unsubscribe
                } catch (error) {
                    console.error('[Auth] Failed to initialize auth listener:', error)
                    return () => { }
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
                antigravitySignedIn: state.antigravitySignedIn,
                antigravityEmail: state.antigravityEmail,
            }),
        }
    )
)
