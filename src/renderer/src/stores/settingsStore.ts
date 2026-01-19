import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { FEATURE_FLAGS, VOICE_CONFIG, LLM_CONFIG, STORAGE_KEYS } from '../lib/constants'
import electron from '../lib/electron'
import { saveUserSettings, getUserProfile } from '../lib/firebase'

export type Theme = 'dark' | 'light' | 'system'
export type LLMProviderType = 'auto' | 'ollama' | 'openai' | 'gemini' | 'openrouter' | 'browser'

interface SettingsState {
    // Voice settings
    ttsEnabled: boolean
    ttsRate: number
    ttsPitch: number
    ttsVoice: string | null
    speechLang: string

    // LLM settings
    preferredProvider: LLMProviderType
    ollamaModel: string
    ollamaBaseUrl: string
    openaiApiKey: string
    openaiBaseUrl: string
    openaiModel: string
    geminiApiKey: string
    geminiModel: string
    openrouterApiKey: string
    openrouterModel: string
    browserModel: string

    // Appearance
    theme: Theme

    // Sync State
    activeUserId: string | null
    isSyncing: boolean
    lastSyncTime: number

    // Actions
    setTtsEnabled: (enabled: boolean) => void
    setTtsRate: (rate: number) => void
    setTtsPitch: (pitch: number) => void
    setTtsVoice: (voice: string | null) => void
    setSpeechLang: (lang: string) => void
    setPreferredProvider: (provider: LLMProviderType) => void
    setOllamaModel: (model: string) => void
    setOllamaBaseUrl: (url: string) => void
    setOpenaiApiKey: (key: string) => Promise<void>
    setOpenaiBaseUrl: (url: string) => Promise<void>
    setOpenaiModel: (model: string) => void
    setGeminiApiKey: (key: string) => Promise<void>
    setGeminiModel: (model: string) => void
    setOpenrouterApiKey: (key: string) => Promise<void>
    setOpenrouterModel: (model: string) => void
    setBrowserModel: (model: string) => void
    setTheme: (theme: Theme) => void
    resetToDefaults: () => void
    
    // Sync Actions
    setActiveUserId: (uid: string | null) => void
    loadRemoteSettings: (uid: string) => Promise<void>
    hydrateSettings: (settings: Partial<SettingsState>) => void
    loadUserSecrets: (uid: string) => Promise<void>
    clearUserSecrets: () => void
    forceSync: () => Promise<void>
    setIsSyncing: (isSyncing: boolean) => void
}

const defaultSettings = {
    ttsEnabled: FEATURE_FLAGS.TTS_ENABLED,
    ttsRate: VOICE_CONFIG.TTS_RATE,
    ttsPitch: VOICE_CONFIG.TTS_PITCH,
    ttsVoice: null,
    speechLang: VOICE_CONFIG.SPEECH_LANG,
    preferredProvider: 'auto' as LLMProviderType,
    ollamaModel: LLM_CONFIG.OLLAMA.DEFAULT_MODEL,
    ollamaBaseUrl: LLM_CONFIG.OLLAMA.BASE_URL,
    openaiApiKey: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: LLM_CONFIG.OPENAI_COMPATIBLE.DEFAULT_MODEL,
    geminiApiKey: '',
    geminiModel: LLM_CONFIG.GEMINI.DEFAULT_MODEL,
    openrouterApiKey: '',
    openrouterModel: LLM_CONFIG.OPENROUTER.DEFAULT_MODEL,
    browserModel: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', // Default small model
    theme: 'dark' as Theme,
    activeUserId: null,
    isSyncing: false,
    lastSyncTime: 0,
}

// Migrate API credentials from localStorage/plaintext store to secure storage
async function migrateToSecureStorage(): Promise<void> {
    try {
        // Try to migrate from localStorage (legacy)
        const localApiKey = localStorage.getItem('openai_api_key')
        if (localApiKey) {
            await electron.secure.set('openai_api_key', localApiKey)
            localStorage.removeItem('openai_api_key')
            console.log('[Settings] Migrated OpenAI API key from localStorage to secure storage')
        }

        // Migrate base URL (not sensitive, stays in regular store)
        const localBaseUrl = localStorage.getItem('openai_base_url')
        if (localBaseUrl) {
            await electron.store.set('openai_base_url', localBaseUrl)
            localStorage.removeItem('openai_base_url')
        }

        // Note: Old plaintext keys in electron-store will be blocked by store.ts
        // They can be manually migrated if needed, but new keys will use secure storage
    } catch (error) {
        console.error('[Settings] Error migrating to secure storage:', error)
    }
}

// Run migration on module load
migrateToSecureStorage().catch(console.error)

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set, get) => ({
            ...defaultSettings,

            setTtsEnabled: (enabled) => set({ ttsEnabled: enabled }),
            setTtsRate: (rate) => set({ ttsRate: rate }),
            setTtsPitch: (pitch) => set({ ttsPitch: pitch }),
            setTtsVoice: (voice) => set({ ttsVoice: voice }),
            setSpeechLang: (lang) => set({ speechLang: lang }),
            setPreferredProvider: (provider) => set({ preferredProvider: provider }),
            setOllamaModel: (model) => set({ ollamaModel: model }),
            setOllamaBaseUrl: (url) => set({ ollamaBaseUrl: url }),
            setOpenaiApiKey: async (key) => {
                set({ openaiApiKey: key })
                const uid = get().activeUserId || undefined
                // Store API key in encrypted secure storage
                await electron.secure.set('openai_api_key', key || '', uid)
            },
            setOpenaiBaseUrl: async (url) => {
                set({ openaiBaseUrl: url })
                const uid = get().activeUserId
                // Base URL is not sensitive, use regular store
                const storeKey = uid ? `user_${uid}_openai_base_url` : 'openai_base_url'
                await electron.store.set(storeKey, url)
            },
            setOpenaiModel: (model) => set({ openaiModel: model }),
            setGeminiApiKey: async (key) => {
                set({ geminiApiKey: key })
                const uid = get().activeUserId || undefined
                // Store API key in encrypted secure storage
                await electron.secure.set('gemini_api_key', key || '', uid)
            },
            setGeminiModel: (model) => set({ geminiModel: model }),
            setOpenrouterApiKey: async (key) => {
                set({ openrouterApiKey: key })
                const uid = get().activeUserId || undefined
                // Store API key in encrypted secure storage
                await electron.secure.set('openrouter_api_key', key || '', uid)
            },
            setOpenrouterModel: (model) => set({ openrouterModel: model }),
            setBrowserModel: (model) => set({ browserModel: model }),
            setTheme: (theme) => set({ theme }),
            resetToDefaults: () => set(defaultSettings),

            setActiveUserId: (uid) => set({ activeUserId: uid }),

            hydrateSettings: (remoteSettings: Partial<SettingsState>) => {
                set((state) => ({
                    ...state,
                    ...remoteSettings,
                    isSyncing: false,
                    lastSyncTime: Date.now()
                }))
            },

            loadUserSecrets: async (uid: string) => {
                set({ activeUserId: uid })
                // Load scoped secrets from encrypted secure storage
                const openaiResult = await electron.secure.get('openai_api_key', uid)
                const geminiResult = await electron.secure.get('gemini_api_key', uid)
                const openrouterResult = await electron.secure.get('openrouter_api_key', uid)
                // Base URL is not sensitive, use regular store
                const openaiUrl = await electron.store.get<string>(`user_${uid}_openai_base_url`)

                set({
                    openaiApiKey: openaiResult.value || '',
                    openaiBaseUrl: openaiUrl || 'https://api.openai.com/v1',
                    geminiApiKey: geminiResult.value || '',
                    openrouterApiKey: openrouterResult.value || ''
                })
                console.log(`[Settings] Loaded secrets for user ${uid} (encrypted: ${openaiResult.encrypted})`)
            },

            clearUserSecrets: () => {
                set({ 
                    activeUserId: null,
                    openaiApiKey: '', 
                    geminiApiKey: '', 
                    openrouterApiKey: '' 
                    // We might typically clear Base URL too, or leave it as default?
                    // Let's clear it to be safe/reset to default
                })
                console.log('[Settings] Cleared user secrets from memory')
            },

            loadRemoteSettings: async (uid) => {
                if (!uid) return
                set({ isSyncing: true })
                try {
                    const remoteData = await getUserProfile(uid)
                    if (remoteData && remoteData.settings) {
                        console.log('[Settings] Loaded remote settings:', remoteData.settings)
                        // Merge remote settings with local defaults/current
                        // We filter out API keys from remote sync if we decided not to store them
                        // But for now, we just merge what we get, excluding potentially sensitive defaults if needed.
                        // Assuming remote settings structure matches store partially.
                        
                        // Extract only syncable fields
                        const {
                            theme,
                            preferredProvider,
                            ollamaModel,
                            ollamaBaseUrl,
                            // api keys might not be there if we don't save them
                            openaiModel,
                            geminiModel,
                            openrouterModel,
                            browserModel,
                            ttsEnabled,
                            ttsRate,
                            ttsPitch,
                            ttsVoice,
                            speechLang
                        } = remoteData.settings

                        set((state) => ({
                            ...state,
                            theme: theme ?? state.theme,
                            preferredProvider: preferredProvider ?? state.preferredProvider,
                            ollamaModel: ollamaModel ?? state.ollamaModel,
                            ollamaBaseUrl: ollamaBaseUrl ?? state.ollamaBaseUrl,
                            openaiModel: openaiModel ?? state.openaiModel,
                            geminiModel: geminiModel ?? state.geminiModel,
                            openrouterModel: openrouterModel ?? state.openrouterModel,
                            browserModel: browserModel ?? state.browserModel,
                            ttsEnabled: ttsEnabled ?? state.ttsEnabled,
                            ttsRate: ttsRate ?? state.ttsRate,
                            ttsPitch: ttsPitch ?? state.ttsPitch,
                            ttsVoice: ttsVoice ?? state.ttsVoice,
                            speechLang: speechLang ?? state.speechLang,
                            isSyncing: false,
                            lastSyncTime: Date.now()
                        }))
                    } else {
                        set({ isSyncing: false })
                    }
                } catch (error) {
                    console.error('[Settings] Failed to load remote settings:', error)
                    set({ isSyncing: false })
                }
            },

            forceSync: async () => {
                const state = get()
                if (!state.activeUserId) return
                // Trigger the debounced sync immediately or calling save directly
                // implementation handled by subscription
            },

            setIsSyncing: (isSyncing) => set({ isSyncing })
        }),
        {
            name: STORAGE_KEYS.SETTINGS,
            storage: createJSONStorage(() => ({
                getItem: async (name: string): Promise<string | null> => {
                    const value = await electron.store.get(name)
                    return value ? JSON.stringify(value) : null
                },
                setItem: async (name: string, value: string): Promise<void> => {
                    await electron.store.set(name, JSON.parse(value))
                },
                removeItem: async (name: string): Promise<void> => {
                    await electron.store.delete(name)
                },
            })),
        }
    )
)
