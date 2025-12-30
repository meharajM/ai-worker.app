import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { FEATURE_FLAGS, VOICE_CONFIG, LLM_CONFIG } from '../lib/constants'

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
    browserModel: string

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
    setOpenaiApiKey: (key: string) => void
    setOpenaiBaseUrl: (url: string) => void
    setOpenaiModel: (model: string) => void
    setBrowserModel: (model: string) => void
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
    browserModel: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', // Default small model
    theme: 'dark' as Theme,
}

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
            setOpenaiApiKey: (key) => {
                set({ openaiApiKey: key })
                // Also sync to localStorage for LLM lib
                if (key) {
                    localStorage.setItem('openai_api_key', key)
                } else {
                    localStorage.removeItem('openai_api_key')
                }
            },
            setOpenaiBaseUrl: (url) => {
                set({ openaiBaseUrl: url })
                localStorage.setItem('openai_base_url', url)
            },
            setOpenaiModel: (model) => set({ openaiModel: model }),
            setBrowserModel: (model) => set({ browserModel: model }),
            setTheme: (theme) => set({ theme }),
            resetToDefaults: () => set(defaultSettings),
        }),
        {
            name: 'ai-worker-settings',
            storage: createJSONStorage(() => localStorage),
        }
    )
)
