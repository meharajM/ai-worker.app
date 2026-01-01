import React from 'react'
import { useSettingsStore, Theme } from '../../stores/settingsStore'

export function AppearanceSettings() {
    const settings = useSettingsStore()

    return (
        <div>
            <h3 className="text-xl font-bold mb-6">Appearance</h3>

            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                <label className="block text-sm text-white/60 mb-3">Theme</label>
                <div className="flex gap-2">
                    {(['dark', 'light', 'system'] as Theme[]).map((theme) => (
                        <button
                            key={theme}
                            onClick={() => settings.setTheme(theme)}
                            className={`flex-1 py-2 px-4 rounded-lg text-sm capitalize transition-colors ${settings.theme === theme
                                ? 'bg-[#4fd1c5] text-white'
                                : 'bg-white/5 text-white/60 hover:bg-white/10'
                                }`}
                        >
                            {theme}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-white/40 mt-2">
                    Note: Light theme coming soon. Currently dark mode only.
                </p>
            </div>
        </div>
    )
}
