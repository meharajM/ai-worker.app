/**
 * LLMProviderSettings — replaces the inline "LLM Provider" section in SettingsPanel.
 *
 * Owns:
 *  - Provider selector pill row
 *  - providerStatus state + checkProviders logic (moved out of SettingsPanel)
 *  - Renders the correct provider card(s) based on selection
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
    getAvailableProviders,
    checkOllama,
    checkOpenAI,
    checkGemini,
    checkOpenRouter,
} from '../../../lib/llm'
import { useSettingsStore, LLMProviderType } from '../../../stores/settingsStore'
import { OllamaSettings } from './OllamaSettings'
import { OpenAISettings } from './OpenAISettings'
import { GeminiSettings } from './GeminiSettings'

interface SingleProviderStatus {
    available: boolean
    model?: string
    models?: string[]
    error?: string
    modelsEndpointAvailable?: boolean
}

interface ProviderStatusMap {
    ollama: SingleProviderStatus
    openai: SingleProviderStatus
    gemini: SingleProviderStatus
    openrouter: SingleProviderStatus
    browser?: SingleProviderStatus
}

const PROVIDERS: { id: LLMProviderType; label: string }[] = [
    { id: 'ollama', label: 'Ollama' },
    { id: 'openai', label: 'OpenAI / Compatible' },
    { id: 'gemini', label: 'Gemini' },
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'auto', label: 'Auto' },
    { id: 'browser', label: 'On-Device' },
]

export function LLMProviderSettings() {
    const settings = useSettingsStore()
    const [providerStatus, setProviderStatus] = useState<ProviderStatusMap | null>(null)
    const [checking, setChecking] = useState(false)
    const checkRef = useRef<Promise<void> | null>(null)

    const checkProviders = useCallback(async () => {
        if (checkRef.current) return checkRef.current

        const settingsForLLM = {
            preferredProvider: settings.preferredProvider,
            ollamaModel: settings.ollamaModel,
            ollamaBaseUrl: settings.ollamaBaseUrl,
            openaiApiKey: settings.openaiApiKey,
            openaiBaseUrl: settings.openaiBaseUrl,
            openaiModel: settings.openaiModel,
            geminiApiKey: settings.geminiApiKey,
            geminiModel: settings.geminiModel,
            openrouterApiKey: settings.openrouterApiKey,
            openrouterModel: settings.openrouterModel,
            browserModel: settings.browserModel,
        }

        const promise = (async () => {
            setChecking(true)
            try {
                const p = settings.preferredProvider
                if (p === 'ollama') {
                    const ollama = await checkOllama(settingsForLLM)
                    setProviderStatus({ ollama, openai: { available: false }, gemini: { available: false }, openrouter: { available: false } })
                } else if (p === 'openai') {
                    const openai = await checkOpenAI(settingsForLLM)
                    setProviderStatus({ ollama: { available: false }, openai, gemini: { available: false }, openrouter: { available: false } })
                } else if (p === 'gemini') {
                    const gemini = await checkGemini(settingsForLLM)
                    setProviderStatus({ ollama: { available: false }, openai: { available: false }, gemini, openrouter: { available: false } })
                } else if (p === 'openrouter') {
                    const openrouter = await checkOpenRouter(settingsForLLM)
                    setProviderStatus({ ollama: { available: false }, openai: { available: false }, gemini: { available: false }, openrouter })
                } else {
                    const providers = await getAvailableProviders(settingsForLLM)
                    setProviderStatus({
                        ollama: providers.ollama,
                        openai: providers.openai,
                        gemini: providers.gemini,
                        openrouter: providers.openrouter,
                        browser: providers.browser,
                    })
                }
            } catch (err) {
                console.error('[LLMProviderSettings] Error checking providers:', err)
            } finally {
                setChecking(false)
                checkRef.current = null
            }
        })()

        checkRef.current = promise
        return promise
    }, [
        settings.preferredProvider,
        settings.ollamaModel, settings.ollamaBaseUrl,
        settings.openaiApiKey, settings.openaiBaseUrl, settings.openaiModel,
        settings.geminiApiKey, settings.geminiModel,
        settings.openrouterApiKey, settings.openrouterModel,
        settings.browserModel,
    ])

    // Debounced auto-check when relevant settings change
    useEffect(() => {
        const t = setTimeout(() => checkProviders(), 500)
        return () => clearTimeout(t)
    }, [checkProviders])

    const p = settings.preferredProvider
    const showOllama = p === 'ollama' || p === 'auto'
    const showOpenAI = p === 'openai' || p === 'auto'
    const showGemini = p === 'gemini' || p === 'auto'
    const showOpenRouter = p === 'openrouter' || p === 'auto'

    return (
        <div>
            <h3 className="text-xl font-bold mb-6">LLM Provider</h3>
            <div className="space-y-4">

                {/* Provider pill selector */}
                <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg p-4">
                    <label className="block text-sm text-[var(--color-text-secondary)] mb-3">Preferred Provider</label>
                    <div className="flex gap-2 flex-wrap">
                        {PROVIDERS.map(({ id, label }) => (
                            <button
                                key={id}
                                onClick={() => settings.setPreferredProvider(id)}
                                aria-label={`Select ${label} provider`}
                                className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${settings.preferredProvider === id
                                        ? 'bg-[var(--color-accent)] text-[var(--color-bg-dark)]'
                                        : 'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-raised)]'
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Provider cards */}
                {showOllama && (
                    <OllamaSettings
                        available={providerStatus?.ollama.available}
                        models={providerStatus?.ollama.models}
                        checking={checking}
                        onRefresh={checkProviders}
                    />
                )}
                {showOpenAI && (
                    <OpenAISettings
                        available={providerStatus?.openai.available}
                        models={providerStatus?.openai.models}
                        modelsEndpointAvailable={providerStatus?.openai.modelsEndpointAvailable}
                        error={providerStatus?.openai.error}
                        checking={checking}
                        onRefresh={checkProviders}
                    />
                )}
                {showGemini && (
                    <GeminiSettings
                        available={providerStatus?.gemini.available}
                        models={providerStatus?.gemini.models}
                        checking={checking}
                        onRefresh={checkProviders}
                    />
                )}
                {showOpenRouter && (
                    <OpenAISettings
                        isOpenRouter
                        available={providerStatus?.openrouter.available}
                        models={providerStatus?.openrouter.models}
                        error={providerStatus?.openrouter.error}
                        checking={checking}
                        onRefresh={checkProviders}
                    />
                )}
            </div>
        </div>
    )
}
