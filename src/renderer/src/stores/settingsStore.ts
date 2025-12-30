import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { FEATURE_FLAGS, VOICE_CONFIG, LLM_CONFIG, STORAGE_KEYS } from '../lib/constants'
import electron from '../lib/electron'

export type Theme = 'dark' | 'light' | 'system'
export type LLMProviderType = 'auto' | 'ollama' | 'openai' | 'browser'

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

    // Appearance
    theme: Theme

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
    setTheme: (theme: Theme) => void
    resetToDefaults: () => void
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
    theme: 'dark' as Theme,
}

// Migrate OpenAI credentials from localStorage to electron-store
async function migrateOpenAICredentials(): Promise<void> {
    try {
        // Check if we need to migrate OpenAI credentials
        const existingApiKey = await electron.store.get<string>('openai_api_key')
        const existingBaseUrl = await electron.store.get<string>('openai_base_url')
        
        if (!existingApiKey && !existingBaseUrl) {
            // Try to migrate from localStorage
            const localApiKey = localStorage.getItem('openai_api_key')
            const localBaseUrl = localStorage.getItem('openai_base_url')
            
            if (localApiKey) {
                await electron.store.set('openai_api_key', localApiKey)
                console.log('[Settings] Migrated OpenAI API key from localStorage to electron-store')
            }
            
            if (localBaseUrl) {
                await electron.store.set('openai_base_url', localBaseUrl)
                console.log('[Settings] Migrated OpenAI base URL from localStorage to electron-store')
            }
            
            // Clear localStorage after successful migration
            if (localApiKey || localBaseUrl) {
                localStorage.removeItem('openai_api_key')
                localStorage.removeItem('openai_base_url')
            }
        }
    } catch (error) {
        console.error('[Settings] Error migrating OpenAI credentials:', error)
    }
}

// Run migration on module load
migrateOpenAICredentials().catch(console.error)

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
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
                // Persist to electron-store
                await electron.store.set('openai_api_key', key || '')
            },
            setOpenaiBaseUrl: async (url) => {
                set({ openaiBaseUrl: url })
                // Persist to electron-store
                await electron.store.set('openai_base_url', url)
            },
            setOpenaiModel: (model) => set({ openaiModel: model }),
            setTheme: (theme) => set({ theme }),
            resetToDefaults: () => set(defaultSettings),
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
