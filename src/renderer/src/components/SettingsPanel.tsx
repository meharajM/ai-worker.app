import React, { useState, useEffect, useRef, useCallback } from 'react'
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
    AlertCircle,
    Flag
} from 'lucide-react'
import { useSettingsStore, Theme, LLMProviderType } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { FEATURE_FLAGS, APP_INFO } from '../lib/constants'
import { isDevelopmentMode } from '../lib/featureFlags'
import { EnhancedFeatureFlagsPanel } from './EnhancedFeatureFlagsPanel'
import { getAvailableProviders, testOllamaConnection, testOpenAIConnection, checkOllama, checkOpenAI } from '../lib/llm'
import { ModelSelect } from './ModelSelect'

type SettingsSection = 'account' | 'llm' | 'voice' | 'appearance' | 'flags' | 'about'

interface ProviderStatus {
    ollama: { available: boolean; model?: string; models?: string[]; error?: string; modelsEndpointAvailable?: boolean }
    openai: { available: boolean; model?: string; models?: string[]; error?: string; modelsEndpointAvailable?: boolean }
}

export function SettingsPanel() {
    const [activeSection, setActiveSection] = useState<SettingsSection>('llm')
    const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
    const [checkingProviders, setCheckingProviders] = useState(false)
    const [testingOllama, setTestingOllama] = useState(false)
    const [testingOpenAI, setTestingOpenAI] = useState(false)
    const [testResults, setTestResults] = useState<{ ollama?: string; openai?: string }>({})

    const settings = useSettingsStore()
    const auth = useAuthStore()

    // Check provider availability with request deduplication
    const checkProvidersRef = React.useRef<Promise<void> | null>(null)
    const checkProviders = React.useCallback(async () => {
        // Prevent duplicate concurrent requests
        if (checkProvidersRef.current) {
            return checkProvidersRef.current
        }

        const promise = (async () => {
            setCheckingProviders(true)
            try {
                const settingsForLLM = {
                    preferredProvider: settings.preferredProvider,
                    ollamaModel: settings.ollamaModel,
                    ollamaBaseUrl: settings.ollamaBaseUrl,
                    openaiApiKey: settings.openaiApiKey,
                    openaiBaseUrl: settings.openaiBaseUrl,
                    openaiModel: settings.openaiModel,
                }
                if (settings.preferredProvider === 'ollama') {
                    const ollama = await checkOllama(settingsForLLM)
                    setProviderStatus({
                        ollama,
                        openai: { available: false },
                    })
                } else if (settings.preferredProvider === 'openai') {
                    const openai = await checkOpenAI(settingsForLLM)
                    setProviderStatus({
                        ollama: { available: false },
                        openai,
                    })
                } else {
                    const providers = await getAvailableProviders(settingsForLLM)
                    setProviderStatus({
                        ollama: providers.ollama,
                        openai: providers.openai,
                    })
                }
            } catch (error) {
                console.error('Error checking providers:', error)
            } finally {
                setCheckingProviders(false)
                checkProvidersRef.current = null
            }
        })()

        checkProvidersRef.current = promise
        return promise
    }, [settings.preferredProvider, settings.ollamaModel, settings.ollamaBaseUrl, settings.openaiApiKey, settings.openaiBaseUrl, settings.openaiModel])

    // Check providers on mount and when settings change (debounced)
    useEffect(() => {
        const timer = setTimeout(() => {
            checkProviders()
        }, 500) // Debounce: wait 500ms after user stops typing
        return () => clearTimeout(timer)
    }, [checkProviders])

    const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    ...(FEATURE_FLAGS.AUTH_ENABLED ? [{ id: 'account' as const, label: 'Account', icon: <User size={20} /> }] : []),
    { id: 'llm', label: 'LLM Provider', icon: <Cpu size={20} /> },
    { id: 'voice', label: 'Voice', icon: <Volume2 size={20} /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={20} /> },
    ...(isDevelopmentMode() ? [{ id: 'flags' as const, label: 'Feature Flags', icon: <Flag size={20} /> }] : []),
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
                                <label className="block text-sm text-white/60 mb-3">Preferred Provider</label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => settings.setPreferredProvider('ollama')}
                                        className={`flex-1 py-2 px-4 rounded-lg text-sm transition-colors ${settings.preferredProvider === 'ollama'
                                            ? 'bg-[#4fd1c5] text-white'
                                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                                        }`}
                                        aria-label="Select Ollama provider"
                                    >
                                        Ollama
                                    </button>
                                    <button
                                        onClick={() => settings.setPreferredProvider('openai')}
                                        className={`flex-1 py-2 px-4 rounded-lg text-sm transition-colors ${settings.preferredProvider === 'openai'
                                            ? 'bg-[#4fd1c5] text-white'
                                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                                        }`}
                                        aria-label="Select OpenAI compatible provider"
                                    >
                                        OpenAI / Compatible
                                    </button>
                                    <button
                                        onClick={() => settings.setPreferredProvider('auto')}
                                        className={`flex-1 py-2 px-4 rounded-lg text-sm transition-colors ${settings.preferredProvider === 'auto'
                                            ? 'bg-[#4fd1c5] text-white'
                                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                                        }`}
                                        aria-label="Select auto provider"
                                    >
                                        Auto
                                    </button>
                                </div>
                            </div>

                            {/* Ollama Config */}
                            {(settings.preferredProvider === 'ollama' || settings.preferredProvider === 'auto') && (
                            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-medium">Ollama</h4>
                                    <div className="flex items-center gap-2">
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
                                        <button
                                            onClick={checkProviders}
                                            className="px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors"
                                            title="Refresh connection status"
                                        >
                                            ↻
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs text-white/40 mb-1">Base URL</label>
                                        <input
                                            type="text"
                                            value={settings.ollamaBaseUrl}
                                            onChange={(e) => settings.setOllamaBaseUrl(e.target.value)}
                                            placeholder="http://localhost:11434"
                                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                 placeholder-white/30 focus:border-white/20 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-white/40 mb-1">Model</label>
                                        <ModelSelect
                                            value={settings.ollamaModel}
                                            onChange={(value) => settings.setOllamaModel(value)}
                                            models={providerStatus?.ollama.models || []}
                                            placeholder="qwen2.5:3b"
                                            ariaLabel="Ollama Model Selection"
                                        />
                                        {providerStatus?.ollama.models && providerStatus.ollama.models.length > 0 && (
                                            <p className="text-xs text-white/30 mt-1">
                                                {providerStatus.ollama.models.length} model(s) available
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        onClick={async () => {
                                            setTestingOllama(true)
                                            setTestResults({ ...testResults, ollama: undefined })
                                            try {
                                                const result = await testOllamaConnection(
                                                    settings.ollamaBaseUrl || 'http://localhost:11434',
                                                    settings.ollamaModel || 'qwen2.5:3b'
                                                )
                                                if (result.success) {
                                                    setTestResults({ ...testResults, ollama: 'Connection successful!' })
                                                    await checkProviders()
                                                } else {
                                                    setTestResults({ ...testResults, ollama: `Error: ${result.error}` })
                                                }
                                            } catch (error) {
                                                setTestResults({ ...testResults, ollama: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` })
                                            } finally {
                                                setTestingOllama(false)
                                            }
                                        }}
                                        disabled={testingOllama}
                                        className="w-full px-4 py-2 bg-[#4fd1c5]/10 hover:bg-[#4fd1c5]/20 text-[#4fd1c5] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {testingOllama ? (
                                            <>
                                                <Loader2 size={16} className="animate-spin" />
                                                Testing Connection...
                                            </>
                                        ) : (
                                            'Test Connection'
                                        )}
                                    </button>
                                    {testResults.ollama && (
                                        <div className={`p-2 rounded text-xs ${testResults.ollama.includes('Error') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                                            {testResults.ollama}
                                        </div>
                                    )}
                                </div>
                            </div>
                            )}

                            {/* OpenAI Config */}
                            {(settings.preferredProvider === 'openai' || settings.preferredProvider === 'auto') && (
                            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-medium">OpenAI / Compatible API</h4>
                                    <div className="flex items-center gap-2">
                                        {providerStatus?.openai.available ? (
                                            <span className="flex items-center gap-1 text-xs text-green-400">
                                                <Check size={14} /> Configured
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-xs text-white/40">
                                                No API Key
                                            </span>
                                        )}
                                        <button
                                            onClick={checkProviders}
                                            className="px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors"
                                            title="Refresh connection status"
                                        >
                                            ↻
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs text-white/40 mb-1">API Key</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="password"
                                                value={settings.openaiApiKey}
                                                onChange={(e) => settings.setOpenaiApiKey(e.target.value)}
                                                placeholder="sk-..."
                                                className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                         placeholder-white/30 focus:border-white/20 focus:outline-none"
                                            />
                                            {settings.openaiApiKey && (
                                                <button
                                                    onClick={checkProviders}
                                                    disabled={providerStatus?.openai.modelsEndpointAvailable === false}
                                                    className="px-3 py-2 text-xs bg-[#4fd1c5]/10 hover:bg-[#4fd1c5]/20 text-[#4fd1c5] rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    title={providerStatus?.openai.modelsEndpointAvailable === false 
                                                        ? "Models endpoint not available for this API" 
                                                        : "Fetch available models"}
                                                >
                                                    Fetch Models
                                                </button>
                                            )}
                                        </div>
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
                                        <ModelSelect
                                            value={settings.openaiModel}
                                            onChange={(value) => settings.setOpenaiModel(value)}
                                            models={providerStatus?.openai.models || []}
                                            placeholder="gpt-4o-mini"
                                            ariaLabel="OpenAI Model Selection"
                                        />
                                        {providerStatus?.openai.models && providerStatus.openai.models.length > 0 ? (
                                            <p className="text-xs text-white/30 mt-1">
                                                {providerStatus.openai.models.length} model(s) available
                                            </p>
                                        ) : providerStatus?.openai.error && (
                                            <p className="text-xs text-white/30 mt-1">
                                                Could not fetch models: {providerStatus.openai.error}. Type model name manually.
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        onClick={async () => {
                                            if (!settings.openaiApiKey) {
                                                setTestResults({ ...testResults, openai: 'Please enter an API key first' })
                                                return
                                            }
                                            setTestingOpenAI(true)
                                            setTestResults({ ...testResults, openai: undefined })
                                            try {
                                                const result = await testOpenAIConnection(
                                                    settings.openaiBaseUrl || 'https://api.openai.com/v1',
                                                    settings.openaiApiKey,
                                                    settings.openaiModel || 'gpt-4o-mini'
                                                )
                                                if (result.success) {
                                                    let message = 'Connection successful!'
                                                    if (result.models && result.models.length > 0) {
                                                        message += ` Found ${result.models.length} model(s).`
                                                        // Update provider status with models
                                                        setProviderStatus(prev => prev ? {
                                                            ...prev,
                                                            openai: {
                                                                ...prev.openai,
                                                                models: result.models,
                                                                modelsEndpointAvailable: result.modelsEndpointAvailable ?? true,
                                                            }
                                                        } : null)
                                                    } else if (result.modelsEndpointAvailable === false) {
                                                        message += ' Models endpoint not available for this API.'
                                                        setProviderStatus(prev => prev ? {
                                                            ...prev,
                                                            openai: {
                                                                ...prev.openai,
                                                                modelsEndpointAvailable: false,
                                                            }
                                                        } : null)
                                                    }
                                                    setTestResults({ ...testResults, openai: message })
                                                    // Refresh providers to get updated status
                                                    await checkProviders()
                                                } else {
                                                    setTestResults({ ...testResults, openai: `Error: ${result.error}` })
                                                }
                                            } catch (error) {
                                                setTestResults({ ...testResults, openai: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` })
                                            } finally {
                                                setTestingOpenAI(false)
                                            }
                                        }}
                                        disabled={testingOpenAI || !settings.openaiApiKey}
                                        className="w-full px-4 py-2 bg-[#4fd1c5]/10 hover:bg-[#4fd1c5]/20 text-[#4fd1c5] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {testingOpenAI ? (
                                            <>
                                                <Loader2 size={16} className="animate-spin" />
                                                Testing Connection...
                                            </>
                                        ) : (
                                            'Test Connection & Fetch Models'
                                        )}
                                    </button>
                                    {testResults.openai && (
                                        <div className={`p-2 rounded text-xs ${testResults.openai.includes('Error') || testResults.openai.includes('Please') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                                            {testResults.openai}
                                        </div>
                                    )}
                                </div>
                            </div>
                            )}
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

                {/* Feature Flags Section */}
                {activeSection === 'flags' && isDevelopmentMode() && (
                    <EnhancedFeatureFlagsPanel isDevMode={true} />
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
