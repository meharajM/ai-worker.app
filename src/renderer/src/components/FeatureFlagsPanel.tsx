import React, { useState, useEffect } from 'react'
import { Flag, Save, RotateCcw, AlertTriangle } from 'lucide-react'
import { FEATURE_FLAGS, getFeatureFlags } from '../lib/constants'

interface FeatureFlag {
  key: keyof typeof FEATURE_FLAGS
  label: string
  description: string
  category: 'Authentication' | 'Voice' | 'LLM' | 'Rate Limiting' | 'Development'
  enabled: boolean
}

interface FeatureFlagsPanelProps {
  isDevMode: boolean
}

export function FeatureFlagsPanel({ isDevMode }: FeatureFlagsPanelProps) {
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [hasChanges, setHasChanges] = useState(false)
  const [originalFlags, setOriginalFlags] = useState<FeatureFlag[]>([])

  useEffect(() => {
    // Get fresh feature flags
    const currentFlags = getFeatureFlags()
    
    // Initialize flags from current feature flags
    const initialFlags: FeatureFlag[] = [
      {
        key: 'AUTH_ENABLED',
        label: 'Authentication System',
        description: 'Enable user authentication and account management',
        category: 'Authentication',
        enabled: currentFlags.AUTH_ENABLED,
      },
      {
        key: 'TTS_ENABLED',
        label: 'Text-to-Speech',
        description: 'Enable AI response voice readout',
        category: 'Voice',
        enabled: currentFlags.TTS_ENABLED,
      },
      {
        key: 'OLLAMA_ENABLED',
        label: 'Ollama Integration',
        description: 'Enable local Ollama model support',
        category: 'LLM',
        enabled: currentFlags.OLLAMA_ENABLED,
      },
      {
        key: 'CLOUD_LLM_ENABLED',
        label: 'Cloud LLM APIs',
        description: 'Enable OpenAI-compatible cloud providers',
        category: 'LLM',
        enabled: currentFlags.CLOUD_LLM_ENABLED,
      },
      {
        key: 'BROWSER_LLM_ENABLED',
        label: 'Browser LLM',
        description: 'Enable browser-native LLM (Gemini Nano, Phi)',
        category: 'LLM',
        enabled: currentFlags.BROWSER_LLM_ENABLED,
      },
      {
        key: 'RATE_LIMITING_ENABLED',
        label: 'Rate Limiting',
        description: 'Enable rate limiting for anonymous users',
        category: 'Rate Limiting',
        enabled: currentFlags.RATE_LIMITING_ENABLED,
      },
    ]

    setFlags(initialFlags)
    setOriginalFlags([...initialFlags])
  }, [])

  const handleFlagToggle = (key: keyof typeof FEATURE_FLAGS, enabled: boolean) => {
    setFlags(prev => prev.map(flag => 
      flag.key === key ? { ...flag, enabled } : flag
    ))
    setHasChanges(true)
  }

  const refreshFlags = () => {
    const currentFlags = getFeatureFlags()
    setFlags(prevFlags => 
      prevFlags.map(flag => ({
        ...flag,
        enabled: currentFlags[flag.key as keyof typeof currentFlags]
      }))
    )
  }

  const handleSave = () => {
    // Store flags in localStorage for development mode
    const flagsData = flags.reduce((acc, flag) => {
      acc[flag.key] = flag.enabled
      return acc
    }, {} as Record<string, boolean>)
    
    localStorage.setItem('ai-worker-dev-flags', JSON.stringify(flagsData))
    
    // Show success message
    alert('Feature flags saved! Restart the app to apply changes.')
    
    // Refresh the flags to show updated values
    refreshFlags()
    setOriginalFlags([...flags])
    setHasChanges(false)
  }

  const handleReset = () => {
    setFlags([...originalFlags])
    setHasChanges(false)
  }

  const groupedFlags = flags.reduce((acc, flag) => {
    if (!acc[flag.category]) {
      acc[flag.category] = []
    }
    acc[flag.category].push(flag)
    return acc
  }, {} as Record<string, FeatureFlag[]>)

  if (!isDevMode) {
    return (
      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400" />
          <div>
            <h4 className="font-medium text-yellow-400">Development Mode Required</h4>
            <p className="text-sm text-yellow-300/60 mt-1">
              Feature flags panel is only available in development mode. Run the app with npm run dev.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold">Feature Flags</h3>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-colors"
              >
                <RotateCcw size={16} />
                Reset
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-3 py-2 bg-[#4fd1c5] hover:bg-[#5fe0d4] rounded-lg text-sm text-white transition-colors"
              >
                <Save size={16} />
                Save Changes
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <div className="flex items-center gap-2">
          <Flag size={16} className="text-blue-400" />
          <p className="text-sm text-blue-300">
            Changes to feature flags require an app restart to take effect.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {Object.entries(groupedFlags).map(([category, categoryFlags]) => (
          <div key={category}>
            <h4 className="text-sm font-medium text-white/60 mb-3">{category}</h4>
            <div className="space-y-2">
              {categoryFlags.map((flag) => (
                <div
                  key={flag.key}
                  className="bg-[#1a1d23] border border-white/10 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h5 className="font-medium">{flag.label}</h5>
                        <span className="text-xs px-2 py-0.5 bg-white/10 rounded text-white/60">
                          {flag.key}
                        </span>
                      </div>
                      <p className="text-sm text-white/60 mt-1">{flag.description}</p>
                    </div>
                    <button
                      onClick={() => handleFlagToggle(flag.key, !flag.enabled)}
                      className={`w-12 h-6 rounded-full transition-colors ${
                        flag.enabled ? 'bg-[#4fd1c5]' : 'bg-white/20'
                      }`}
                      title={flag.enabled ? 'Disable feature' : 'Enable feature'}
                      aria-label={`${flag.enabled ? 'Disable' : 'Enable'} ${flag.label}`}
                    >
                      <div
                        className={`w-5 h-5 bg-white rounded-full transition-transform ${
                          flag.enabled ? 'translate-x-6' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {hasChanges && (
        <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-yellow-400" />
            <p className="text-sm text-yellow-300">
              You have unsaved changes. Don't forget to save before restarting the app!
            </p>
          </div>
        </div>
      )}
    </div>
  )
}