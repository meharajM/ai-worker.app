import React from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'

export function VoiceSettings() {
    const settings = useSettingsStore()

    return (
        <div>
            <h3 className="text-xl font-bold mb-6">Voice Settings</h3>

            <div className="space-y-4">
                {/* TTS Toggle */}
                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {settings.ttsEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                            <div>
                                <p className="font-medium">Text-to-Speech</p>
                                <p className="text-xs text-white/40">Read AI responses aloud</p>
                            </div>
                        </div>
                        <button
                            onClick={() => settings.setTtsEnabled(!settings.ttsEnabled)}
                            aria-label={settings.ttsEnabled ? 'Disable Text-to-Speech' : 'Enable Text-to-Speech'}
                            className={`w-12 h-6 rounded-full transition-colors ${settings.ttsEnabled ? 'bg-[#4fd1c5]' : 'bg-white/20'
                                }`}
                        >
                            <div className={`w-5 h-5 bg-white rounded-full transition-transform ${settings.ttsEnabled ? 'translate-x-6' : 'translate-x-0.5'
                                }`} />
                        </button>
                    </div>
                </div>

                {/* Speech Rate */}
                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                    <label className="block text-sm mb-3" htmlFor="tts-rate">Speech Rate: {settings.ttsRate.toFixed(1)}x</label>
                    <input
                        id="tts-rate"
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.1"
                        value={settings.ttsRate}
                        onChange={(e) => settings.setTtsRate(parseFloat(e.target.value))}
                        aria-label="Speech Rate"
                        className="w-full"
                    />
                </div>

                {/* Speech Pitch */}
                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                    <label className="block text-sm mb-3" htmlFor="tts-pitch">Speech Pitch: {settings.ttsPitch.toFixed(1)}</label>
                    <input
                        id="tts-pitch"
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.1"
                        value={settings.ttsPitch}
                        onChange={(e) => settings.setTtsPitch(parseFloat(e.target.value))}
                        aria-label="Speech Pitch"
                        className="w-full"
                    />
                </div>
            </div>
        </div>
    )
}
