import React, { useState, useEffect } from 'react'
import {
    User,
    Volume2,
    VolumeX,
    Palette,
    Info,
    ChevronRight,
    LogIn,
    LogOut,
    Cpu,
    Loader2,
    Check,
    AlertCircle
} from 'lucide-react'
import { useSettingsStore, Theme, LLMProviderType } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { FEATURE_FLAGS, APP_INFO } from '../lib/constants'
import { getAvailableProviders } from '../lib/llm'

type SettingsSection = 'account' | 'llm' | 'voice' | 'appearance' | 'about'

interface ProviderStatus {
    ollama: { available: boolean; model?: string; error?: string }
    openai: { available: boolean; model?: string; error?: string }
}

export function SettingsPanel() {
    const [activeSection, setActiveSection] = useState<SettingsSection>('llm')
    const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
    const [checkingProviders, setCheckingProviders] = useState(false)

    const settings = useSettingsStore()
    const auth = useAuthStore()

    // Check provider availability
    useEffect(() => {
        async function check() {
            setCheckingProviders(true)
            try {
                const providers = await getAvailableProviders()
                setProviderStatus({
                    ollama: providers.ollama,
                    openai: providers.openai,
                })
            } catch (error) {
                console.error('Error checking providers:', error)
            } finally {
                setCheckingProviders(false)
            }
        }
        check()
    }, [settings.openaiApiKey])

    const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
        ...(FEATURE_FLAGS.AUTH_ENABLED ? [{ id: 'account' as const, label: 'Account', icon: <User size={20} /> }] : []),
        { id: 'llm', label: 'LLM Provider', icon: <Cpu size={20} /> },
        { id: 'voice', label: 'Voice', icon: <Volume2 size={20} /> },
        { id: 'appearance', label: 'Appearance', icon: <Palette size={20} /> },
        { id: 'about', label: 'About', icon: <Info size={20} /> },
    ]

    return (
        <div className="flex-1 flex overflow-hidden">
            {/* Sidebar */}
            <div className="w-48 bg-[#1a1d23]/50 border-r border-white/5 p-4">
                <h2 className="text-lg font-bold mb-4 px-2">Settings</h2>
                <nav className="space-y-1">
                    {sections.map((section) => (
                        <button
                            key={section.id}
                            onClick={() => setActiveSection(section.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeSection === section.id
                                    ? 'bg-white/10 text-white'
                                    : 'text-white/60 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {section.icon}
                            {section.label}
                        </button>
                    ))}
                </nav>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {/* Account Section */}
                {activeSection === 'account' && FEATURE_FLAGS.AUTH_ENABLED && (
                    <div>
                        <h3 className="text-xl font-bold mb-6">Account</h3>

                        {auth.user ? (
                            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                                <div className="flex items-center gap-4 mb-4">
                                    {auth.user.photoURL && (
                                        <img
                                            src={auth.user.photoURL}
                                            alt="Profile"
                                            className="w-12 h-12 rounded-full"
                                        />
                                    )}
                                    <div>
                                        <p className="font-medium">{auth.user.displayName}</p>
                                        <p className="text-sm text-white/40">{auth.user.email}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => auth.signOut()}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 
                             rounded-lg hover:bg-red-500/20 transition-colors"
                                >
                                    <LogOut size={18} />
                                    Sign Out
                                </button>
                            </div>
                        ) : (
                            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-6 text-center">
                                <p className="text-white/60 mb-4">Sign in to unlock unlimited usage</p>
                                <button
                                    onClick={() => auth.signInWithGoogle()}
                                    disabled={auth.loading}
                                    className="flex items-center gap-2 px-6 py-3 bg-white text-black 
                             rounded-xl hover:bg-white/90 transition-colors mx-auto"
                                >
                                    {auth.loading ? (
                                        <Loader2 size={18} className="animate-spin" />
                                    ) : (
                                        <LogIn size={18} />
                                    )}
                                    Sign in with Google
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* LLM Provider Section */}
                {activeSection === 'llm' && (
                    <div>
                        <h3 className="text-xl font-bold mb-6">LLM Provider</h3>

                        <div className="space-y-4">
                            {/* Provider Selection */}
                            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                                <label className="block text-sm text-white/60 mb-2">Preferred Provider</label>
                                <select
                                    value={settings.preferredProvider}
                                    onChange={(e) => settings.setPreferredProvider(e.target.value as LLMProviderType)}
                                    className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 
                             text-white focus:border-white/20 focus:outline-none"
                                >
                                    <option value="auto">Auto (best available)</option>
                                    <option value="ollama">Ollama</option>
                                    <option value="openai">OpenAI / Compatible API</option>
                                </select>
                            </div>

                            {/* Ollama Config */}
                            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-medium">Ollama</h4>
                                    {checkingProviders ? (
                                        <Loader2 size={16} className="animate-spin text-white/40" />
                                    ) : providerStatus?.ollama.available ? (
                                        <span className="flex items-center gap-1 text-xs text-green-400">
                                            <Check size={14} /> Connected
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-xs text-yellow-400">
                                            <AlertCircle size={14} /> Not Available
                                        </span>
                                    )}
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs text-white/40 mb-1">Base URL</label>
                                        <input
                                            type="text"
                                            value={settings.ollamaBaseUrl}
                                            onChange={(e) => settings.setOllamaBaseUrl(e.target.value)}
                                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                 placeholder-white/30 focus:border-white/20 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-white/40 mb-1">Model</label>
                                        <input
                                            type="text"
                                            value={settings.ollamaModel}
                                            onChange={(e) => settings.setOllamaModel(e.target.value)}
                                            placeholder="qwen2.5:3b"
                                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                 placeholder-white/30 focus:border-white/20 focus:outline-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* OpenAI Config */}
                            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-medium">OpenAI / Compatible API</h4>
                                    {providerStatus?.openai.available ? (
                                        <span className="flex items-center gap-1 text-xs text-green-400">
                                            <Check size={14} /> Configured
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-xs text-white/40">
                                            No API Key
                                        </span>
                                    )}
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs text-white/40 mb-1">API Key</label>
                                        <input
                                            type="password"
                                            value={settings.openaiApiKey}
                                            onChange={(e) => settings.setOpenaiApiKey(e.target.value)}
                                            placeholder="sk-..."
                                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                 placeholder-white/30 focus:border-white/20 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-white/40 mb-1">Base URL</label>
                                        <input
                                            type="text"
                                            value={settings.openaiBaseUrl}
                                            onChange={(e) => settings.setOpenaiBaseUrl(e.target.value)}
                                            placeholder="https://api.openai.com/v1"
                                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                 placeholder-white/30 focus:border-white/20 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-white/40 mb-1">Model</label>
                                        <input
                                            type="text"
                                            value={settings.openaiModel}
                                            onChange={(e) => settings.setOpenaiModel(e.target.value)}
                                            placeholder="gpt-4o-mini"
                                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                 placeholder-white/30 focus:border-white/20 focus:outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Voice Section */}
                {activeSection === 'voice' && (
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
                                <label className="block text-sm mb-3">Speech Rate: {settings.ttsRate.toFixed(1)}x</label>
                                <input
                                    type="range"
                                    min="0.5"
                                    max="2"
                                    step="0.1"
                                    value={settings.ttsRate}
                                    onChange={(e) => settings.setTtsRate(parseFloat(e.target.value))}
                                    className="w-full"
                                />
                            </div>

                            {/* Speech Pitch */}
                            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                                <label className="block text-sm mb-3">Speech Pitch: {settings.ttsPitch.toFixed(1)}</label>
                                <input
                                    type="range"
                                    min="0.5"
                                    max="2"
                                    step="0.1"
                                    value={settings.ttsPitch}
                                    onChange={(e) => settings.setTtsPitch(parseFloat(e.target.value))}
                                    className="w-full"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Appearance Section */}
                {activeSection === 'appearance' && (
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
                )}

                {/* About Section */}
                {activeSection === 'about' && (
                    <div>
                        <h3 className="text-xl font-bold mb-6">About</h3>

                        <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-6 text-center">
                            <div className="w-16 h-16 bg-[#00a896] rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <div className="w-8 h-8 border-2 border-white rounded-lg flex items-center justify-center">
                                    <div className="w-4 h-[2px] bg-white rounded-full"></div>
                                </div>
                            </div>
                            <h4 className="text-xl font-bold">{APP_INFO.NAME}</h4>
                            <p className="text-white/40 text-sm">Version {APP_INFO.VERSION}</p>
                            <p className="text-white/60 mt-4 text-sm">
                                Voice-first desktop workspace with MCP integration
                            </p>
                            <div className="mt-6 pt-4 border-t border-white/10">
                                <p className="text-xs text-white/30">
                                    Built with Electron, React, and ❤️
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
