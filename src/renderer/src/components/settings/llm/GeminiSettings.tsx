/**
 * GeminiSettings — self-contained Gemini provider config card.
 *
 * Extracted from SettingsPanel.tsx.
 * Handles: API key input, model select, test connection, Antigravity OAuth link.
 */
import React, { useState } from 'react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { testGeminiConnection } from '../../../lib/llm'
import { ModelSelect } from '../../ModelSelect'
import { ProviderCard } from './ProviderCard'

interface GeminiSettingsProps {
    available?: boolean
    models?: string[]
    checking?: boolean
    onRefresh: () => Promise<void>
}

export function GeminiSettings({ available, models, checking, onRefresh }: GeminiSettingsProps) {
    const settings = useSettingsStore()
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<string | undefined>()

    const canTest = !!settings.geminiApiKey

    async function handleTest() {
        if (!canTest) {
            setTestResult('Error: Please enter a Gemini API key first')
            return
        }
        setTesting(true)
        setTestResult(undefined)
        try {
            const result = await testGeminiConnection(
                settings.geminiApiKey,
                settings.geminiModel || 'gemini-2.0-flash-lite',
                settings
            )
            if (result.success) {
                const msg = result.modelsEndpointAvailable !== false
                    ? `Connection successful! Found ${result.models?.length ?? 0} models.`
                    : 'Connection successful! Using standard gateway models.'
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

    const getApiKeyStatus = (): { available: boolean; error?: string } => {
        if (available) return { available: true }
        return { available: false, error: 'No API Key' }
    }

    return (
        <ProviderCard
            title="Google Gemini"
            status={getApiKeyStatus()}
            checking={checking}
            headerActions={
                <>
                    <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 text-[10px] bg-[var(--color-surface)] text-[var(--color-text-secondary)] rounded border border-[var(--color-border)] hover:bg-[var(--color-border)] transition-colors"
                    >
                        Get API Key
                    </a>
                </>
            }
            testing={testing}
            testDisabled={testing || !canTest}
            onTest={handleTest}
            testResult={testResult}
        >
            {/* API Key */}
            <div>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                    API Key
                </label>
                <input
                    type="password"
                    value={settings.geminiApiKey || ''}
                    onChange={(e) => settings.setGeminiApiKey(e.target.value)}
                    placeholder='Enter Gemini API Key...'
                    className="w-full bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm placeholder:text-[var(--color-text-dim)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                />
            </div>

            {/* Model */}
            <div>
                <label className="block text-xs text-[var(--color-text-muted)] mb-1">Model</label>
                <ModelSelect
                    value={settings.geminiModel}
                    onChange={(value) => settings.setGeminiModel(value)}
                    models={models ?? []}
                    placeholder="gemini-2.0-flash-lite"
                    ariaLabel="Gemini Model Selection"
                />
            </div>
        </ProviderCard>
    )
}
