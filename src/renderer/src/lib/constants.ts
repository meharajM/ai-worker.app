// Base Feature Flags - Default values, can be overridden in development mode
export const BASE_FEATURE_FLAGS = {
    AUTH_ENABLED: false,          // Flip to true when Firebase is configured
    RATE_LIMITING_ENABLED: false, // Flip to true when auth is ready
    TTS_ENABLED: true,            // Text-to-speech readout
    BROWSER_LLM_ENABLED: true,    // Try Gemini Nano / Phi first
    OLLAMA_ENABLED: true,         // Local Ollama models
    CLOUD_LLM_ENABLED: true,      // OpenAI-compatible APIs
    
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
