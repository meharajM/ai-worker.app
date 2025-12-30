import React, { useState, useEffect } from 'react'
import { Flag, Save, RotateCcw, AlertTriangle } from 'lucide-react'
import { getFeatureFlags } from '../lib/constants'
import { FLAG_SYSTEM, getCategorizedFlags } from '../lib/flagSystem'

interface FeatureFlagsPanelProps {
  isDevMode: boolean
}

export function EnhancedFeatureFlagsPanel({ isDevMode }: FeatureFlagsPanelProps) {
  const [flags, setFlags] = useState(() => FLAG_SYSTEM.getAllFlags())
  const [hasChanges, setHasChanges] = useState(false)
  const [originalFlags, setOriginalFlags] = useState(() => FLAG_SYSTEM.getAllFlags())

  // Get categorized flags for better UI organization
  const categorizedFlags = getCategorizedFlags(flags)

  useEffect(() => {
    // Refresh flags when component mounts or when saved
    const currentFlags = FLAG_SYSTEM.getAllFlags()
    setFlags(currentFlags)
    setOriginalFlags([...currentFlags])
  }, [])

  const handleFlagToggle = (key: string, enabled: boolean) => {
    setFlags(prev => prev.map(flag => 
      flag.key === key ? { ...flag, enabled } : flag
    ))
    setHasChanges(true)
  }

  const refreshFlags = () => {
    const currentFlags = FLAG_SYSTEM.getAllFlags()
    setFlags(currentFlags)
    setOriginalFlags([...currentFlags])
  }

  const handleSave = () => {
    // Store flags in localStorage for development mode
    const flagsData = flags.reduce((acc, flag) => {
      acc[flag.key] = flag.enabled
      return acc
    }, {} as Record<string, boolean>)
    
    localStorage.setItem('ai-worker-dev-flags', JSON.stringify(flagsData))
    
    // Show success message with flag count
    const changedCount = flags.filter((flag, i) => flag.enabled !== originalFlags[i]?.enabled).length
    alert(`Feature flags saved! ${changedCount} flag(s) changed. Restart the app to apply changes.`)
    
    // Refresh the flags to show updated values
    refreshFlags()
    setHasChanges(false)
  }

  const handleReset = () => {
    setFlags([...originalFlags])
    setHasChanges(false)
  }

  const handleClearAll = () => {
    if (confirm('Clear all feature flag overrides? This will reset to default values.')) {
      localStorage.removeItem('ai-worker-dev-flags')
      refreshFlags()
      alert('Feature flags cleared! Restart the app to apply defaults.')
    }
  }

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
        <div>
          <h3 className="text-xl font-bold">Feature Flags</h3>
          <p className="text-sm text-white/60 mt-1">
            {flags.length} feature flags detected • {Object.keys(categorizedFlags).length} categories
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearAll}
            className="px-3 py-1.5 text-sm bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-colors"
            title="Clear all overrides"
          >
            Clear All
          </button>
          <button
            onClick={handleReset}
            disabled={!hasChanges}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-2 ${
              hasChanges
                ? 'bg-white/10 hover:bg-white/20 text-white'
                : 'bg-white/5 text-white/40 cursor-not-allowed'
            }`}
          >
            <RotateCcw size={16} />
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-2 ${
              hasChanges
                ? 'bg-[#4fd1c5] hover:bg-[#5fe0d4] text-black'
                : 'bg-white/10 text-white/40 cursor-not-allowed'
            }`}
          >
            <Save size={16} />
            Save Changes
          </button>
        </div>
      </div>

      {/* Flag Statistics */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[#1a1d23] border border-white/10 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-400">
            {flags.filter(f => f.enabled).length}
          </div>
          <div className="text-sm text-white/60">Enabled</div>
        </div>
        <div className="bg-[#1a1d23] border border-white/10 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-400">
            {flags.filter(f => !f.enabled).length}
          </div>
          <div className="text-sm text-white/60">Disabled</div>
        </div>
        <div className="bg-[#1a1d23] border border-white/10 rounded-lg p-4">
          <div className="text-2xl font-bold text-yellow-400">
            {hasChanges ? '!' : '✓'}
          </div>
          <div className="text-sm text-white/60">{hasChanges ? 'Unsaved' : 'Saved'}</div>
        </div>
      </div>

      {/* Categorized Flags */}
      <div className="space-y-6">
        {Object.entries(categorizedFlags).map(([category, categoryFlags]) => (
          <div key={category} className="bg-[#1a1d23] border border-white/10 rounded-xl p-6">
            <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Flag size={20} />
              {category}
              <span className="text-sm text-white/60 font-normal">
                ({categoryFlags.filter(f => f.enabled).length}/{categoryFlags.length} enabled)
              </span>
            </h4>
            <div className="space-y-4">
              {categoryFlags.map((flag) => (
                <div key={flag.key} className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${
                        flag.enabled ? 'bg-green-400' : 'bg-red-400'
                      }`} />
                      <div>
                        <h5 className="font-medium">{flag.label}</h5>
                        <p className="text-sm text-white/60 mt-1">{flag.description}</p>
                        <code className="text-xs text-white/40 bg-white/10 px-2 py-1 rounded mt-2 inline-block">
                          {flag.key}
                        </code>
                      </div>
                    </div>
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
              ))}
            </div>
          </div>
        ))}
      </div>

      {hasChanges && (
        <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p className="text-yellow-300 text-sm">
            ⚠️ You have unsaved changes. Click "Save Changes" to persist your feature flag configuration.
          </p>
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <h5 className="font-medium text-blue-300 mb-2">💡 Pro Tips</h5>
        <ul className="text-blue-300/80 text-sm space-y-1">
          <li>• Changes require app restart to take effect</li>
          <li>• Flags are automatically detected - add new flags to constants.ts</li>
          <li>• Use "Clear All" to reset to default values</li>
          <li>• Categories are auto-generated based on flag names</li>
        </ul>
      </div>
    </div>
  )
}