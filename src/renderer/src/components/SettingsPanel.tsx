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
    Flag,
    Download,
    HardDrive,
    Trash2,
    FolderOpen
} from 'lucide-react'
import { useSettingsStore, Theme, LLMProviderType } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { FEATURE_FLAGS, APP_INFO } from '../lib/constants'
import { isDevelopmentMode } from '../lib/featureFlags'
import { EnhancedFeatureFlagsPanel } from './EnhancedFeatureFlagsPanel'
import { getAvailableProviders, testOllamaConnection, testOpenAIConnection, testWebLLMConnection, checkOllama, checkOpenAI, downloadBrowserModel, WEBLLM_MODELS, subscribeToWebLLMStatus, deleteWebLLMModel, checkWebLLMModelCompatibility } from '../lib/llm'
import { ModelSelect } from './ModelSelect'

type SettingsSection = 'account' | 'llm' | 'voice' | 'appearance' | 'flags' | 'about'

interface ProviderStatus {
    ollama: { available: boolean; model?: string; models?: string[]; error?: string; modelsEndpointAvailable?: boolean }
    openai: { available: boolean; model?: string; models?: string[]; error?: string; modelsEndpointAvailable?: boolean }
    browser?: {
        available: boolean;
        model?: string;
        models?: string[];
        error?: string;
        isWebGPUSupported?: boolean;
        isLoaded?: boolean;
        isLoading?: boolean;
        loadingProgress?: number;
        loadingStage?: string;
        downloadedModels?: string[];
        adapterInfo?: {
            vendor: string;
            architecture: string;
            device: string;
            description: string;
        };
    }
}

export function SettingsPanel() {
    const [activeSection, setActiveSection] = useState<SettingsSection>('llm')
    const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
    const [checkingProviders, setCheckingProviders] = useState(false)
    const [testingOllama, setTestingOllama] = useState(false)
    const [testingOpenAI, setTestingOpenAI] = useState(false)
    const [testingBrowser, setTestingBrowser] = useState(false)
    const [downloadingBrowser, setDownloadingBrowser] = useState(false)
    const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null)
    const [downloadProgress, setDownloadProgress] = useState(0)
    const [testResults, setTestResults] = useState<{ ollama?: string; openai?: string; browser?: string }>({})
    const [modelCompatibility, setModelCompatibility] = useState<Record<string, { compatible: boolean; reasons: string[] }>>({})

    const settings = useSettingsStore()
    const auth = useAuthStore()

    // Check model compatibility on mount
    useEffect(() => {
        const checkAll = async () => {
            const results: Record<string, { compatible: boolean; reasons: string[] }> = {};
            for (const model of WEBLLM_MODELS) {
                results[model.id] = await checkWebLLMModelCompatibility(model.id);
            }
            setModelCompatibility(results);
        };
        checkAll();
    }, []);

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

                    // Auto-load Logic for Browser Model
                    // This logic is now handled by a separate useEffect.

                    setProviderStatus({
                        ollama: providers.ollama,
                        openai: providers.openai,
                        browser: providers.browser,
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

    // Auto-load effect
    const autoLoadAttempted = useRef(false);
    useEffect(() => {
        if (
            !autoLoadAttempted.current &&
            providerStatus?.browser?.available &&
            settings.preferredProvider === 'browser' &&
            settings.browserModel &&
            !providerStatus.browser.isLoaded &&
            !providerStatus.browser.isLoading
        ) {
            const isDownloaded = providerStatus.browser.downloadedModels?.includes(settings.browserModel);
            if (isDownloaded) {
                autoLoadAttempted.current = true;
                console.log('[Settings] Auto-loading preferred model:', settings.browserModel);
                setDownloadingBrowser(true);
                setDownloadingModelId(settings.browserModel);
                downloadBrowserModel((p) => setDownloadProgress(p), settings.browserModel)
                    .then((result) => {
                        setDownloadingBrowser(false);
                        setDownloadingModelId(null);
                        if (result.success) {
                            checkProviders();
                        }
                    });
            } else {
                // If preferred model is not downloaded, do nothing (wait for user)
                // or mark as attempted so we don't try again repeatedly
                autoLoadAttempted.current = true;
            }
        }
    }, [providerStatus, settings.preferredProvider, settings.browserModel]);

    // Synchronize with global background download status
    useEffect(() => {
        const unsubscribe = subscribeToWebLLMStatus((status) => {
            // Update local state if a background download is active
            if (status.backgroundDownload) {
                setDownloadingModelId(status.backgroundDownload.modelId);
                setDownloadProgress(status.backgroundDownload.progress);
                setDownloadingBrowser(true);
            } else if (status.isLoading) {
                // If main engine is loading, it's the preferred browser model
                setDownloadingModelId(settings.browserModel);
                setDownloadProgress(status.loadingProgress);
                setDownloadingBrowser(true);
            } else {
                // No active loading/downloading in global state
                // If our local state says we ARE downloading, check if it's actually finished
                setDownloadingModelId(null);
                setDownloadProgress(0);
                setDownloadingBrowser(false);
            }
        });
        return () => unsubscribe();
    }, [settings.browserModel]);

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
                                    <button
                                        onClick={() => settings.setPreferredProvider('browser')}
                                        className={`flex-1 py-2 px-4 rounded-lg text-sm transition-colors ${settings.preferredProvider === 'browser'
                                            ? 'bg-[#4fd1c5] text-white'
                                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                                            }`}
                                        aria-label="Select Browser / On-Device provider"
                                    >
                                        On-Device II
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

                            {/* WebLLM / On-Device Config */}
                            {(settings.preferredProvider === 'browser' || settings.preferredProvider === 'auto') && (
                                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="font-medium flex items-center gap-2">
                                            <Cpu size={18} className="text-[#4fd1c5]" />
                                            On-Device AI (WebLLM)
                                        </h4>
                                        <div className="flex items-center gap-2">
                                            {providerStatus?.browser?.isLoaded ? (
                                                <span className="flex items-center gap-1 text-xs text-green-400">
                                                    <Check size={14} /> Model Loaded
                                                </span>
                                            ) : providerStatus?.browser?.isLoading ? (
                                                <span className="flex items-center gap-1 text-xs text-yellow-400">
                                                    <Loader2 size={14} className="animate-spin" /> Loading...
                                                </span>
                                            ) : providerStatus?.browser?.isWebGPUSupported ? (
                                                <span className="flex items-center gap-1 text-xs text-blue-400">
                                                    <Download size={14} /> Ready to Download
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-xs text-red-400">
                                                    <AlertCircle size={14} /> Not Supported
                                                </span>
                                            )}
                                            <button
                                                onClick={checkProviders}
                                                className="px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors"
                                                title="Refresh status"
                                            >
                                                ↻
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        {/* Download Location */}
                                        <div className="bg-black/20 rounded-lg p-3 border border-white/5 flex items-center justify-between">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <label className="text-xs text-white/40 block">Download Storage</label>
                                                    <div className="relative group/storage-info">
                                                        <Info size={12} className="text-white/30 cursor-help hover:text-white/60" />
                                                        <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-black border border-white/20 rounded-lg text-xs z-20 hidden group-hover/storage-info:block shadow-xl backdrop-blur-md">
                                                            <p className="font-bold text-white mb-2">Storage & Memory Info</p>
                                                            <ul className="space-y-1.5 text-white/70 list-disc pl-3">
                                                                <li>
                                                                    <span className="text-white/90">Persistence:</span> Models remain saved on your disk even after you close the app.
                                                                </li>
                                                                <li>
                                                                    <span className="text-white/90">Location:</span> Stored in the application's secure cache folder (User Data).
                                                                </li>
                                                                <li>
                                                                    <span className="text-white/90">RAM/VRAM:</span> Models use system memory only when <strong>Active</strong>. Downloaded (Saved) models use disk space only.
                                                                </li>
                                                            </ul>
                                                        </div>
                                                    </div>
                                                </div>
                                                <p className="text-sm text-white/70 flex items-center gap-2">
                                                    <HardDrive size={14} />
                                                    Default (Browser Cache)
                                                </p>
                                                <p className="text-[10px] text-white/30 mt-0.5">Models are stored in your browser's Cache Storage.</p>
                                            </div>
                                        </div>

                                        {/* System Requirements */}
                                        <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                                            <h5 className="text-xs font-bold text-white/70 mb-2 uppercase tracking-wider flex items-center gap-2">
                                                <HardDrive size={12} /> System Requirements
                                            </h5>
                                            <ul className="text-xs text-white/50 space-y-1">
                                                <li>• WebGPU-capable GPU (modern integrated/discrete)</li>
                                                <li>• 2-6GB storage for model weights (varies by model)</li>
                                                <li>• 4GB+ available VRAM recommended</li>
                                            </ul>
                                        </div>

                                        {/* GPU Warning */}
                                        {providerStatus?.browser?.adapterInfo && (
                                            (() => {
                                                const info = providerStatus.browser!.adapterInfo!;
                                                const name = (info.description || info.device || '').toLowerCase();
                                                // Simple heuristic for likely integrated/weak GPUs
                                                const isLikelyIntegrated =
                                                    (name.includes('intel') && !name.includes('arc')) ||
                                                    name.includes('microsoft basic') ||
                                                    name.includes('llvmpipe') ||
                                                    name.includes('softpipe');

                                                if (isLikelyIntegrated) {
                                                    return (
                                                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                                                            <div className="flex items-start gap-2">
                                                                <AlertCircle size={16} className="text-yellow-400 mt-0.5" />
                                                                <div>
                                                                    <p className="text-xs font-bold text-yellow-400 mb-1">
                                                                        Integrated/Weak GPU Detected
                                                                    </p>
                                                                    <p className="text-xs text-yellow-400/80 mb-1">
                                                                        Current Renderer: <span className="text-white/80">{info.description || info.device || 'Unknown'}</span>
                                                                    </p>
                                                                    <p className="text-[10px] text-yellow-400/60 leading-relaxed">
                                                                        Performance may be slow. If you have a dedicated GPU (NVIDIA/AMD), consider forcing the app to use it in your OS settings.
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()
                                        )}

                                        {providerStatus?.browser?.isWebGPUSupported ? (
                                            <div className="space-y-3">
                                                {/* Model Selection */}
                                                <div>
                                                    <label className="block text-xs text-white/40 mb-2">Available Models</label>
                                                    <div className="space-y-2">
                                                        {WEBLLM_MODELS.map((model) => {
                                                            const isCurrentModel = providerStatus?.browser?.model === model.id;
                                                            const isLoaded = isCurrentModel && providerStatus?.browser?.isLoaded;
                                                            const isDownloaded = providerStatus?.browser?.downloadedModels?.includes(model.id);

                                                            const compatibility = modelCompatibility[model.id];

                                                            // We track which specific model is downloading
                                                            const isThisModelDownloading = downloadingModelId === model.id;
                                                            const isAnyModelDownloading = downloadingModelId !== null;

                                                            return (
                                                                <div
                                                                    key={model.id}
                                                                    className={`p-3 rounded-lg border transition-all ${isCurrentModel
                                                                        ? 'border-[#4fd1c5] bg-[#4fd1c5]/10 ring-1 ring-[#4fd1c5]/50' // Selected
                                                                        : 'border-white/10 bg-black/20 hover:border-white/20'
                                                                        } ${compatibility && !compatibility.compatible ? 'opacity-70' : ''}`}
                                                                >
                                                                    <div className="flex justify-between items-start gap-3">
                                                                        <div className="flex-1 min-w-0 group relative">
                                                                            <div className="flex items-center gap-2">
                                                                                <p className="font-medium text-sm text-white">
                                                                                    {model.name}
                                                                                    {isCurrentModel && <span className="ml-2 text-[10px] text-[#4fd1c5] font-bold uppercase">(Selected)</span>}
                                                                                </p>
                                                                                {model.supportsTools && (
                                                                                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-purple-500/20 text-purple-300 rounded">
                                                                                        Tools
                                                                                    </span>
                                                                                )}
                                                                                {isDownloaded && !isLoaded && (
                                                                                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/20 text-blue-300 rounded flex items-center gap-1">
                                                                                        <HardDrive size={10} /> Saved
                                                                                    </span>
                                                                                )}
                                                                                {compatibility && (
                                                                                    compatibility.compatible ? (
                                                                                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/20 text-green-400 rounded">
                                                                                            Compatible
                                                                                        </span>
                                                                                    ) : (
                                                                                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-400 rounded flex items-center gap-1">
                                                                                            <AlertCircle size={10} /> Limited
                                                                                        </span>
                                                                                    )
                                                                                )}
                                                                                <div className="relative group/info">
                                                                                    <Info size={14} className="text-white/30 cursor-help hover:text-white/60" />
                                                                                    <div className="absolute left-0 bottom-full mb-2 w-48 p-2 bg-black border border-white/20 rounded-lg text-xs z-10 hidden group-hover/info:block shadow-xl backdrop-blur-md">
                                                                                        <p className="font-bold text-white mb-1">Technical Details</p>
                                                                                        <div className="space-y-0.5 text-white/70">
                                                                                            <p>Params: {model.size}</p>
                                                                                            <p>Quantization: q4f16_1</p>
                                                                                            <p>VRAM Req: {model.vram}</p>
                                                                                            <p>RAM Req: {model.requiredRamGB}GB</p>
                                                                                            <p>Cached: {isDownloaded ? 'Yes' : 'No'}</p>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                            <p className="text-xs text-white/50">{model.description}</p>
                                                                            {compatibility && !compatibility.compatible && (
                                                                                <div className="mt-1 flex flex-col gap-0.5">
                                                                                    {compatibility.reasons.map((reason, i) => (
                                                                                        <p key={i} className="text-[10px] text-red-400/80">• {reason}</p>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                            <div className="flex gap-3 mt-1 text-xs text-white/40">
                                                                                <span>{model.size}</span>
                                                                                <span>VRAM: {model.vram}</span>
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex-shrink-0 flex flex-col gap-2 items-end">
                                                                            {isLoaded ? (
                                                                                <div className="flex flex-col items-end gap-2">
                                                                                    <span className="flex items-center gap-1 px-3 py-1.5 text-xs text-green-400 bg-green-500/20 rounded-lg">
                                                                                        <Check size={14} /> Active
                                                                                    </span>
                                                                                    <button
                                                                                        onClick={async (e) => {
                                                                                            e.stopPropagation();
                                                                                            setTestingBrowser(true);
                                                                                            setTestResults({ ...testResults, browser: undefined });
                                                                                            const result = await testWebLLMConnection();
                                                                                            setTestingBrowser(false);
                                                                                            if (result.success) {
                                                                                                setTestResults({ ...testResults, browser: 'Test successful! Model is responding.' });
                                                                                            } else {
                                                                                                setTestResults({ ...testResults, browser: `Error: ${result.error}` });
                                                                                            }
                                                                                        }}
                                                                                        disabled={testingBrowser}
                                                                                        className="text-xs text-[#4fd1c5] hover:text-[#4fd1c5]/80 hover:underline disabled:opacity-50"
                                                                                    >
                                                                                        {testingBrowser ? 'Testing...' : 'Test Model'}
                                                                                    </button>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="flex gap-2">
                                                                                    {isDownloaded && (
                                                                                        <button
                                                                                            onClick={async (e) => {
                                                                                                e.stopPropagation();
                                                                                                if (confirm(`Are you sure you want to delete ${model.name} from cache? This will free up space.`)) {
                                                                                                    await deleteWebLLMModel(model.id);
                                                                                                    await checkProviders();
                                                                                                }
                                                                                            }}
                                                                                            className="p-1.5 text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                                                                                            title="Delete from cache"
                                                                                        >
                                                                                            <Trash2 size={14} />
                                                                                        </button>
                                                                                    )}
                                                                                    <button
                                                                                        onClick={async () => {
                                                                                            setDownloadingModelId(model.id);
                                                                                            setDownloadProgress(0);
                                                                                            setTestResults({ ...testResults, browser: undefined });

                                                                                            if (isDownloaded) {
                                                                                                // User wants to LOAD (switch to) this model
                                                                                                settings.setBrowserModel(model.id);
                                                                                                const result = await downloadBrowserModel(
                                                                                                    (p) => setDownloadProgress(p),
                                                                                                    model.id
                                                                                                );
                                                                                                if (result.success) checkProviders();
                                                                                                else setTestResults({ ...testResults, browser: `Error: ${result.error}` });
                                                                                                setDownloadingModelId(null);
                                                                                            } else {
                                                                                                // User wants to DOWNLOAD this model
                                                                                                if (providerStatus.browser?.isLoaded) {
                                                                                                    // Background download
                                                                                                    import('../lib/llm').then(async ({ downloadWebLLMModelOnly }) => {
                                                                                                        try {
                                                                                                            await downloadWebLLMModelOnly(model.id);
                                                                                                            checkProviders();
                                                                                                        } catch (e: any) {
                                                                                                            setTestResults({ ...testResults, browser: `Error: ${e.message}` });
                                                                                                        } finally {
                                                                                                            setDownloadingModelId(null);
                                                                                                        }
                                                                                                    });
                                                                                                } else {
                                                                                                    // Normal load/download (will become active)
                                                                                                    settings.setBrowserModel(model.id);
                                                                                                    const result = await downloadBrowserModel(
                                                                                                        (p) => setDownloadProgress(p),
                                                                                                        model.id
                                                                                                    );
                                                                                                    if (result.success) checkProviders();
                                                                                                    else setTestResults({ ...testResults, browser: `Error: ${result.error}` });
                                                                                                    setDownloadingModelId(null);
                                                                                                }
                                                                                            }
                                                                                        }}
                                                                                        disabled={isAnyModelDownloading}
                                                                                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${isDownloaded
                                                                                            ? 'bg-white/10 text-white hover:bg-white/20' // Load (already downloaded)
                                                                                            : 'bg-[#4fd1c5] text-black hover:bg-[#4fd1c5]/90' // Download
                                                                                            }`}
                                                                                    >
                                                                                        {isDownloaded ? <Cpu size={14} /> : <Download size={14} />}
                                                                                        {isThisModelDownloading
                                                                                            ? (isDownloaded ? 'Loading...' : 'Downloading...')
                                                                                            : (isDownloaded ? 'Load' : 'Download')
                                                                                        }
                                                                                    </button>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {/* Loading Progress */}
                                                {downloadingModelId && (
                                                    <div className="space-y-2">
                                                        <div className="flex justify-between text-xs text-white/60">
                                                            <span>
                                                                {providerStatus?.browser?.loadingStage || 'Processing...'}
                                                            </span>
                                                            <span>{downloadProgress.toFixed(0)}%</span>
                                                        </div>
                                                        <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-gradient-to-r from-[#4fd1c5] to-[#38b2ac] transition-all duration-300"
                                                                style={{ width: `${downloadProgress}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Status Message */}
                                                {providerStatus?.browser?.isLoaded && (
                                                    <div className="text-sm text-green-400/80 bg-green-500/10 p-3 rounded-lg border border-green-500/20">
                                                        ✓ Model loaded and ready. On-device AI will be used for chat.
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                                                <div className="flex items-start gap-3 mb-3">
                                                    <AlertCircle className="text-red-400 mt-0.5" size={18} />
                                                    <div>
                                                        <p className="font-medium text-red-300">
                                                            {providerStatus?.browser?.error || 'WebGPU is not supported on this device.'}
                                                        </p>
                                                        <p className="text-xs text-white/50 mt-1">
                                                            WebGPU requires: macOS (Metal), Windows (DX12), or Linux (Vulkan).
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="space-y-4 pt-3 border-t border-white/10">
                                                    {/* Linux Section */}
                                                    <div className="space-y-2">
                                                        <p className="text-xs font-bold text-white/70 uppercase tracking-wider">Troubleshooting (Linux)</p>
                                                        <p className="text-[11px] text-white/40">1. Install Vulkan drivers:</p>
                                                        <div className="flex gap-2">
                                                            <code className="flex-1 bg-black/40 p-2 rounded text-[10px] text-[#4fd1c5] font-mono break-all">
                                                                sudo apt update && sudo apt install mesa-vulkan-drivers libvulkan1
                                                            </code>
                                                            <button
                                                                onClick={() => navigator.clipboard.writeText('sudo apt update && sudo apt install mesa-vulkan-drivers libvulkan1')}
                                                                className="px-2 py-1 text-[10px] bg-white/5 hover:bg-white/10 rounded border border-white/10 transition-colors"
                                                            >
                                                                Copy
                                                            </button>
                                                        </div>
                                                        <p className="text-[11px] text-white/40 mt-2">2. If still failing, try launching with:</p>
                                                        <div className="flex gap-2">
                                                            <code className="flex-1 bg-black/40 p-2 rounded text-[10px] text-[#4fd1c5] font-mono break-all">
                                                                VULKAN_ICD_FILENAMES=/usr/share/vulkan/icd.d/intel_icd.x86_64.json
                                                            </code>
                                                            <button
                                                                onClick={() => navigator.clipboard.writeText('VULKAN_ICD_FILENAMES=/usr/share/vulkan/icd.d/intel_icd.x86_64.json')}
                                                                className="px-2 py-1 text-[10px] bg-white/5 hover:bg-white/10 rounded border border-white/10 transition-colors"
                                                            >
                                                                Copy
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Windows Section */}
                                                    <div className="space-y-2 pt-2 border-t border-white/5">
                                                        <p className="text-xs font-bold text-white/70 uppercase tracking-wider">Troubleshooting (Windows)</p>
                                                        <ul className="text-[11px] text-white/50 space-y-1.5 list-disc pl-3">
                                                            <li>Update drivers directly from <strong>Intel.com</strong>, <strong>Nvidia.com</strong>, or <strong>AMD.com</strong>.</li>
                                                            <li><strong>Multi-GPU:</strong> Go to Settings &gt; System &gt; Display &gt; Graphics, add the app, and select "High Performance".</li>
                                                        </ul>
                                                    </div>

                                                    <p className="text-[10px] text-white/30 italic mt-2">
                                                        * Restart the app after applying these steps.
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {testResults.browser && (
                                            <div className={`p-2 rounded text-xs ${testResults.browser.includes('Error') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                                                {testResults.browser}
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
