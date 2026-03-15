/**
 * OllamaSettings — self-contained Ollama provider config card.
 * Extracted from SettingsPanel.tsx.
 */
import React, { useState } from 'react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { testOllamaConnection } from '../../../lib/llm'
import { ModelSelect } from '../../ModelSelect'
import { ProviderCard } from './ProviderCard'

interface OllamaSettingsProps {
    available?: boolean
    models?: string[]
    checking?: boolean
    onRefresh: () => Promise<void>
}

export function OllamaSettings({ available, models, checking, onRefresh }: OllamaSettingsProps) {
    const settings = useSettingsStore()
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<string | undefined>()

    async function handleTest() {
        setTesting(true)
        setTestResult(undefined)
        try {
            const result = await testOllamaConnection(
                settings.ollamaBaseUrl || 'http://localhost:11434',
                settings.ollamaModel || 'qwen2.5:3b'
            )
            if (result.success) {
                setTestResult('Connection successful!')
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

    return (
        <ProviderCard
            title="Ollama"
            status={available !== undefined ? { available } : undefined}
            checking={checking}
            headerActions={
                <>
                    <a
                        href="https://ollama.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-0.5 text-[10px] bg-[var(--color-accent-muted)] text-[var(--color-accent)] rounded border border-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/20 transition-colors"
                    >
                        Install Ollama
                    </a>
                    <button
                        onClick={onRefresh}
                        className="px-2 py-1 text-xs bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-raised)] rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                        title="Refresh connection status"
                    >
                        ↻
                    </button>
                </>
            }
            testing={testing}
            onTest={handleTest}
            testResult={testResult}
        >
            {/* Base URL */}
            <div>
                <label className="block text-xs text-[var(--color-text-tertiary)] mb-1">Base URL</label>
                <input
                    type="text"
                    value={settings.ollamaBaseUrl}
                    onChange={(e) => settings.setOllamaBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="w-full bg-[var(--color-bg-dark)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] focus:border-[var(--color-border-hover)] focus:outline-none"
                />
            </div>

            {/* Model */}
            <div>
                <label className="block text-xs text-[var(--color-text-tertiary)] mb-1">Model</label>
                <ModelSelect
                    value={settings.ollamaModel}
                    onChange={(value) => settings.setOllamaModel(value)}
                    models={models ?? []}
                    placeholder="qwen2.5:3b"
                    ariaLabel="Ollama Model Selection"
                />
                {models && models.length > 0 && (
                    <p className="text-xs text-[var(--color-text-disabled)] mt-1">{models.length} model(s) available</p>
                )}
            </div>
        </ProviderCard>
    )
}
