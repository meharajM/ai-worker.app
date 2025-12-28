// Feature Flags - Flip these when ready
export const FEATURE_FLAGS = {
    AUTH_ENABLED: false,          // Flip to true when Firebase is configured
    RATE_LIMITING_ENABLED: false, // Flip to true when auth is ready
    TTS_ENABLED: true,            // Text-to-speech readout
    BROWSER_LLM_ENABLED: true,    // Try Gemini Nano / Phi first
    OLLAMA_ENABLED: true,         // Local Ollama models
    CLOUD_LLM_ENABLED: true,      // OpenAI-compatible APIs
}

// Rate Limits for anonymous users (easily adjustable)
export const RATE_LIMITS = {
    ANONYMOUS: {
        CHATS_PER_DAY: 10,
        MCP_OPERATIONS_PER_HOUR: 20,
    },
    AUTHENTICATED: {
        CHATS_PER_DAY: Infinity,
        MCP_OPERATIONS_PER_HOUR: Infinity,
    }
}

// LLM Configuration
export const LLM_CONFIG = {
    OLLAMA: {
        DEFAULT_MODEL: 'qwen2.5:3b',
        BASE_URL: 'http://localhost:11434',
    },
    OPENAI_COMPATIBLE: {
        BASE_URL: '', // User configurable
        DEFAULT_MODEL: 'gpt-4o-mini',
    }
}

// Voice Configuration
export const VOICE_CONFIG = {
    SPEECH_LANG: 'en-US',
    TTS_RATE: 1.0,
    TTS_PITCH: 1.0,
}

// App Info
export const APP_INFO = {
    NAME: 'AI-Worker',
    VERSION: '0.1.0',
}
