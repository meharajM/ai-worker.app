import { FEATURE_FLAGS } from './constants'

export interface FeatureFlags {
  AUTH_ENABLED: boolean
  TTS_ENABLED: boolean
  OLLAMA_ENABLED: boolean
  CLOUD_LLM_ENABLED: boolean
  BROWSER_LLM_ENABLED: boolean
  RATE_LIMITING_ENABLED: boolean
}

/**
 * Check if the app is running in development mode
 */
export function isDevelopmentMode(): boolean {
  // Check multiple ways to detect development mode
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.ELECTRON_IS_DEV === '1' ||
    (window as any).electron?.isDev ||
    // @ts-ignore - electron-toolkit utils
    (window.require && window.require('@electron-toolkit/utils')?.is?.dev) ||
    window.location.hostname === 'localhost' ||
    window.location.port !== ''
  )
}

/**
 * Load feature flags from localStorage (for development mode)
 */
export function loadFeatureFlags(): Partial<FeatureFlags> | null {
  try {
    const stored = localStorage.getItem('ai-worker-dev-flags')
    if (stored) {
      return JSON.parse(stored) as Partial<FeatureFlags>
    }
  } catch (error) {
    console.warn('Failed to load feature flags from localStorage:', error)
  }
  return null
}

/**
 * Save feature flags to localStorage (for development mode)
 */
export function saveFeatureFlags(flags: Partial<FeatureFlags>): void {
  try {
    localStorage.setItem('ai-worker-dev-flags', JSON.stringify(flags))
  } catch (error) {
    console.warn('Failed to save feature flags to localStorage:', error)
  }
}

/**
 * Get effective feature flags (merge default with localStorage overrides)
 */
export function getEffectiveFeatureFlags(): FeatureFlags {
  const defaultFlags = { ...FEATURE_FLAGS }
  
  // Only apply localStorage overrides in development mode
  if (isDevelopmentMode()) {
    const storedFlags = loadFeatureFlags()
    if (storedFlags) {
      return {
        ...defaultFlags,
        ...storedFlags,
      }
    }
  }
  
  return defaultFlags
}

/**
 * Reset feature flags to defaults
 */
export function resetFeatureFlags(): void {
  localStorage.removeItem('ai-worker-dev-flags')
}