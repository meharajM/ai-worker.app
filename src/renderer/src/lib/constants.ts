// Base Feature Flags - Default values, can be overridden in development mode
export const BASE_FEATURE_FLAGS = {
    AUTH_ENABLED: true,          // Flip to true when Firebase is configured
    RATE_LIMITING_ENABLED: false, // Flip to true when auth is ready

    BROWSER_LLM_ENABLED: true,    // Try Gemini Nano / Phi first
    OLLAMA_ENABLED: true,         // Local Ollama models
    CLOUD_LLM_ENABLED: true,      // OpenAI/OpenRouter compatible APIs
    GEMINI_ENABLED: true,         // Google Gemini models

    // // New flags for demonstration of auto-detection
    // EXPERIMENTAL_FEATURES_ENABLED: false, // Enable experimental/beta features
    // DARK_MODE_ONLY: true,           // Force dark mode theme
    // ANALYTICS_ENABLED: false,     // Enable usage analytics and telemetry
    // EXPORT_FEATURES_ENABLED: true, // Enable data export functionality
}

// Import feature flags logic after BASE_FEATURE_FLAGS is defined
import { getEffectiveFeatureFlags } from './featureFlags'

// Get effective feature flags (merged with localStorage overrides in dev mode)
export const FEATURE_FLAGS = getEffectiveFeatureFlags()

// Export a function to get fresh feature flags (useful for development mode)
export function getFeatureFlags() {
    return getEffectiveFeatureFlags()
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
    },
    OPENROUTER: {
        BASE_URL: 'https://openrouter.ai/api/v1',
        DEFAULT_MODEL: 'nvidia/nemotron-3-super-120b-a12b:free',
    },
    GEMINI: {
        BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
        DEFAULT_MODEL: 'gemini-2.5-flash',
    }
}

// Voice Configuration
export interface VoskModel {
    id: string
    name: string
    url: string
    modelName: string
    locale: string  // For auto-detection matching
}

export const VOICE_CONFIG = {
    SPEECH_LANG: 'en-US',
    DEFAULT_MODEL_ID: 'en-us',
    VOSK_MODELS: [
        { id: 'en-us', name: 'English (US)', url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip', modelName: 'vosk-model-small-en-us-0.15', locale: 'en-US' },
        { id: 'en-in', name: 'English (India)', url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip', modelName: 'vosk-model-small-en-in-0.4', locale: 'en-IN' },
        { id: 'zh-cn', name: 'Mandarin (Chinese)', url: 'https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip', modelName: 'vosk-model-small-cn-0.22', locale: 'zh-CN' },
        { id: 'ja', name: 'Japanese', url: 'https://alphacephei.com/vosk/models/vosk-model-small-ja-0.22.zip', modelName: 'vosk-model-small-ja-0.22', locale: 'ja-JP' },
        { id: 'fr', name: 'French', url: 'https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip', modelName: 'vosk-model-small-fr-0.22', locale: 'fr-FR' },
        { id: 'de', name: 'German', url: 'https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip', modelName: 'vosk-model-small-de-0.15', locale: 'de-DE' },
        { id: 'es', name: 'Spanish', url: 'https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip', modelName: 'vosk-model-small-es-0.42', locale: 'es-ES' },
        { id: 'it', name: 'Italian', url: 'https://alphacephei.com/vosk/models/vosk-model-small-it-0.22.zip', modelName: 'vosk-model-small-it-0.22', locale: 'it-IT' },
        { id: 'hi', name: 'Hindi', url: 'https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip', modelName: 'vosk-model-small-hi-0.22', locale: 'hi-IN' },
    ] as VoskModel[]
}

// App Info
export const APP_INFO = {
    NAME: 'AI-Worker',
    VERSION: '0.1.0',
    CLIENT_ID: 'AI-Worker-Client',
}

// Storage Keys
export const STORAGE_KEYS = {
    MCP_SERVERS: 'mcp_servers',
    CHAT_HISTORY: 'ai-worker-chat',
    SETTINGS: 'ai-worker-settings',
    AUTH_STATE: 'ai-worker-auth'
}

// UI Colors (Tailwind compatible)
export const UI_COLORS = {
    PRIMARY: '#4fd1c5',
    PRIMARY_HOVER: '#5fe0d4',
    BG_DARK: '#0f1115',
    CARD_DARK: '#1a1d23',
    ACCENT: '#4fd1c5'
}
