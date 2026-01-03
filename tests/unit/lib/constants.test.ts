import { describe, it, expect } from 'vitest'

describe('Constants', () => {
    it('should load constants module without errors', async () => {
        // Dynamic import to avoid issues with module loading
        const constants = await import('../../../src/renderer/src/lib/constants')

        expect(constants.APP_INFO).toBeDefined()
        expect(constants.APP_INFO.NAME).toBe('AI-Worker')
        expect(constants.APP_INFO.VERSION).toBe('0.1.0')
    })

    it('should have feature flags with correct defaults', async () => {
        const constants = await import('../../../src/renderer/src/lib/constants')

        expect(constants.BASE_FEATURE_FLAGS).toBeDefined()
        expect(constants.BASE_FEATURE_FLAGS.AUTH_ENABLED).toBe(false)
        expect(constants.BASE_FEATURE_FLAGS.TTS_ENABLED).toBe(true)
        expect(constants.BASE_FEATURE_FLAGS.BROWSER_LLM_ENABLED).toBe(true)
        expect(constants.BASE_FEATURE_FLAGS.OLLAMA_ENABLED).toBe(true)
        expect(constants.BASE_FEATURE_FLAGS.CLOUD_LLM_ENABLED).toBe(true)
    })

    it('should have rate limits configuration', async () => {
        const constants = await import('../../../src/renderer/src/lib/constants')

        expect(constants.RATE_LIMITS.ANONYMOUS.CHATS_PER_DAY).toBe(10)
        expect(constants.RATE_LIMITS.AUTHENTICATED.CHATS_PER_DAY).toBe(Infinity)
    })

    it('should have LLM configuration defaults', async () => {
        const constants = await import('../../../src/renderer/src/lib/constants')

        expect(constants.LLM_CONFIG.OLLAMA.DEFAULT_MODEL).toBe('qwen2.5:3b')
        expect(constants.LLM_CONFIG.OLLAMA.BASE_URL).toBe('http://localhost:11434')
    })

    it('should have storage keys defined', async () => {
        const constants = await import('../../../src/renderer/src/lib/constants')

        expect(constants.STORAGE_KEYS.MCP_SERVERS).toBe('mcp_servers')
        expect(constants.STORAGE_KEYS.CHAT_HISTORY).toBe('ai-worker-chat')
        expect(constants.STORAGE_KEYS.SETTINGS).toBe('ai-worker-settings')
    })
})
