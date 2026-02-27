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
                        className="px-2 py-0.5 text-[10px] bg-[#4fd1c5]/10 text-[#4fd1c5] rounded border border-[#4fd1c5]/20 hover:bg-[#4fd1c5]/20 transition-colors"
                    >
                        Install Ollama
                    </a>
                    <button
                        onClick={onRefresh}
                        className="px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors"
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
                <label className="block text-xs text-white/40 mb-1">Base URL</label>
                <input
                    type="text"
                    value={settings.ollamaBaseUrl}
                    onChange={(e) => settings.setOllamaBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder-white/30 focus:border-white/20 focus:outline-none"
                />
            </div>

            {/* Model */}
            <div>
                <label className="block text-xs text-white/40 mb-1">Model</label>
                <ModelSelect
                    value={settings.ollamaModel}
                    onChange={(value) => settings.setOllamaModel(value)}
                    models={models ?? []}
                    placeholder="qwen2.5:3b"
                    ariaLabel="Ollama Model Selection"
                />
                {models && models.length > 0 && (
                    <p className="text-xs text-white/30 mt-1">{models.length} model(s) available</p>
                )}
            </div>
        </ProviderCard>
    )
}
