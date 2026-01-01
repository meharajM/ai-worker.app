import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('settingsStore', () => {
    let useSettingsStore: any

    beforeEach(async () => {
        // Reset modules to get fresh store
        vi.resetModules()

        // Import the store
        const module = await import('../../../src/renderer/src/stores/settingsStore')
        useSettingsStore = module.useSettingsStore

        // Reset store to defaults
        useSettingsStore.getState().resetToDefaults()
    })

    describe('TTS Settings', () => {
        it('should toggle TTS enabled', () => {
            expect(useSettingsStore.getState().ttsEnabled).toBe(true)

            useSettingsStore.getState().setTtsEnabled(false)
            expect(useSettingsStore.getState().ttsEnabled).toBe(false)

            useSettingsStore.getState().setTtsEnabled(true)
            expect(useSettingsStore.getState().ttsEnabled).toBe(true)
        })

        it('should update TTS rate', () => {
            useSettingsStore.getState().setTtsRate(1.5)
            expect(useSettingsStore.getState().ttsRate).toBe(1.5)
        })

        it('should update TTS pitch', () => {
            useSettingsStore.getState().setTtsPitch(0.8)
            expect(useSettingsStore.getState().ttsPitch).toBe(0.8)
        })
    })

    describe('LLM Settings', () => {
        it('should set preferred provider', () => {
            useSettingsStore.getState().setPreferredProvider('ollama')
            expect(useSettingsStore.getState().preferredProvider).toBe('ollama')

            useSettingsStore.getState().setPreferredProvider('openai')
            expect(useSettingsStore.getState().preferredProvider).toBe('openai')

            useSettingsStore.getState().setPreferredProvider('browser')
            expect(useSettingsStore.getState().preferredProvider).toBe('browser')
        })

        it('should set Ollama model', () => {
            useSettingsStore.getState().setOllamaModel('llama2:7b')
            expect(useSettingsStore.getState().ollamaModel).toBe('llama2:7b')
        })

        it('should set Ollama base URL', () => {
            useSettingsStore.getState().setOllamaBaseUrl('http://localhost:8080')
            expect(useSettingsStore.getState().ollamaBaseUrl).toBe('http://localhost:8080')
        })

        it('should set OpenAI API key', () => {
            useSettingsStore.getState().setOpenaiApiKey('sk-test-key')
            expect(useSettingsStore.getState().openaiApiKey).toBe('sk-test-key')
        })
    })

    describe('Theme Settings', () => {
        it('should set theme', () => {
            useSettingsStore.getState().setTheme('light')
            expect(useSettingsStore.getState().theme).toBe('light')

            useSettingsStore.getState().setTheme('system')
            expect(useSettingsStore.getState().theme).toBe('system')
        })
    })

    describe('Reset to Defaults', () => {
        it('should reset all settings to default values', () => {
            // Modify settings
            useSettingsStore.getState().setTtsEnabled(false)
            useSettingsStore.getState().setTtsRate(2.0)
            useSettingsStore.getState().setPreferredProvider('openai')
            useSettingsStore.getState().setTheme('light')

            // Reset
            useSettingsStore.getState().resetToDefaults()

            // Check defaults
            const state = useSettingsStore.getState()
            expect(state.ttsEnabled).toBe(true)
            expect(state.ttsRate).toBe(1.0)
            expect(state.preferredProvider).toBe('auto')
            expect(state.theme).toBe('dark')
        })
    })
})
