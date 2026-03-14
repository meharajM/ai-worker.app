/**
 * OpenAISettings — self-contained OpenAI / compatible API config card.
 * Extracted from SettingsPanel.tsx.
 */
import React, { useState } from 'react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { testOpenAIConnection } from '../../../lib/llm'
import { ModelSelect } from '../../ModelSelect'
import { ProviderCard } from './ProviderCard'

interface OpenAISettingsProps {
    available?: boolean
    models?: string[]
    modelsEndpointAvailable?: boolean
    error?: string
    checking?: boolean
    onRefresh: () => Promise<void>
    /** Pass true when rendering for an OpenRouter provider */
    isOpenRouter?: boolean
}

export function OpenAISettings({
    available,
    models,
    modelsEndpointAvailable,
    error,
    checking,
    onRefresh,
    isOpenRouter = false,
}: OpenAISettingsProps) {
    const settings = useSettingsStore()
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<string | undefined>()

    const apiKey = isOpenRouter ? settings.openrouterApiKey : settings.openaiApiKey
    const setApiKey = isOpenRouter ? settings.setOpenrouterApiKey : settings.setOpenaiApiKey
    const baseUrl = isOpenRouter ? 'https://openrouter.ai/api/v1' : (settings.openaiBaseUrl || 'https://api.openai.com/v1')
    const model = isOpenRouter ? settings.openrouterModel : settings.openaiModel
    const setModel = isOpenRouter ? settings.setOpenrouterModel : settings.setOpenaiModel

    async function handleTest() {
        if (!apiKey) {
            setTestResult('Error: Please enter an API key first')
            return
        }
        setTesting(true)
        setTestResult(undefined)
        try {
            const result = await testOpenAIConnection(baseUrl, apiKey, model || (isOpenRouter ? 'anthropic/claude-3-haiku' : 'gpt-4o-mini'))
            if (result.success) {
                let msg = 'Connection successful!'
                if (result.models && result.models.length > 0) msg += ` Found ${result.models.length} model(s).`
                else if (result.modelsEndpointAvailable === false) msg += ' Models endpoint not available for this API.'
                setTestResult(msg)
                await onRefresh()
            } else {
                setTestResult(`Error: ${result.error}`)
            }
        } catch (err) {
            setTestResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
        } finally {
            setTesting(false)
        }
    }

    const title = isOpenRouter ? 'OpenRouter' : 'OpenAI / Compatible API'
    const apiKeyUrl = isOpenRouter ? 'https://openrouter.ai/keys' : 'https://platform.openai.com/api-keys'
    const modelPlaceholder = isOpenRouter ? 'anthropic/claude-3-haiku' : 'gpt-4o-mini'

    return (
        <ProviderCard
            title={title}
            status={available !== undefined ? { available } : undefined}
            checking={checking}
            headerActions={
                <>
                    <a
                        href={apiKeyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-0.5 text-[10px] bg-[var(--color-brand-teal)]/10 text-[var(--color-brand-teal)] rounded border border-[var(--color-brand-teal)]/20 hover:bg-[var(--color-brand-teal)]/20 transition-colors"
                    >
                        Get API Key
                    </a>
                    {!isOpenRouter && (
                        <button
                            onClick={onRefresh}
                            className="px-2 py-1 text-xs bg-[var(--color-surface)] hover:bg-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                            title="Refresh connection status"
                        >
                            ↻
                        </button>
                    )}
                </>
            }
            testLabel="Test Connection & Fetch Models"
            testing={testing}
            testDisabled={testing || !apiKey}
            onTest={handleTest}
            testResult={testResult}
        >
            {/* API Key */}
            <div>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">API Key</label>
                <div className="flex gap-2">
                    <input
                        type="password"
                        value={apiKey || ''}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={isOpenRouter ? 'Enter OpenRouter API Key...' : 'sk-...'}
                        className="flex-1 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm placeholder:text-[var(--color-text-dim)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                    />
                    {!isOpenRouter && apiKey && (
                        <button
                            onClick={onRefresh}
                            disabled={modelsEndpointAvailable === false}
                            className="px-3 py-2 text-xs bg-[var(--color-brand-teal)]/10 hover:bg-[var(--color-brand-teal)]/20 text-[var(--color-brand-teal)] rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={modelsEndpointAvailable === false ? 'Models endpoint not available for this API' : 'Fetch available models'}
                        >
                            Fetch Models
                        </button>
                    )}
                </div>
            </div>

            {/* Base URL — only for OpenAI-compatible, not OpenRouter */}
            {!isOpenRouter && (
                <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Base URL</label>
                    <input
                        type="text"
                        value={settings.openaiBaseUrl || ''}
                        onChange={(e) => settings.setOpenaiBaseUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm placeholder:text-[var(--color-text-dim)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                    />
                </div>
            )}

            {/* Model */}
            <div>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">Model</label>
                <ModelSelect
                    value={model}
                    onChange={(value) => setModel(value)}
                    models={models ?? []}
                    placeholder={modelPlaceholder}
                    ariaLabel={`${title} Model Selection`}
                />
                {models && models.length > 0 ? (
                    <p className="text-xs text-[var(--color-text-dim)] mt-1">{models.length} model(s) available</p>
                ) : error ? (
                    <p className="text-xs text-[var(--color-text-dim)] mt-1">Could not fetch models: {error}. Type model name manually.</p>
                ) : null}
            </div>
        </ProviderCard>
    )
}
