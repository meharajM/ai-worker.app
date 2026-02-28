/**
 * PerplexitySettings — self-contained Perplexity provider config card.
 */
import React, { useState } from 'react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useAuthStore } from '../../../stores/authStore'
import { ModelSelect } from '../../ModelSelect'
import { ProviderCard } from './ProviderCard'
import { PerplexityLinkButton } from './PerplexityLinkButton'
import electron from '../../../lib/electron'

interface PerplexitySettingsProps {
    available?: boolean
    models?: string[]
    checking?: boolean
    onRefresh: () => Promise<void>
}

export function PerplexitySettings({ available, models, checking, onRefresh }: PerplexitySettingsProps) {
    const settings = useSettingsStore()
    const { perplexitySignedIn } = useAuthStore()
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<string | undefined>()

    const canTest = perplexitySignedIn

    async function handleTest() {
        if (!canTest) {
            setTestResult('Error: Please link your Perplexity account first')
            return
        }
        setTesting(true)
        setTestResult(undefined)
        try {
            await electron.perplexity?.ask('Hello! Reply with a short test message.')
            setTestResult('Connection successful! Perplexity responded.')
            await onRefresh()
        } catch (err) {
            setTestResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
        } finally {
            setTesting(false)
        }
    }

    const getStatus = (): { available: boolean; error?: string } => {
        if (available && perplexitySignedIn) return { available: true }
        if (!perplexitySignedIn) return { available: false, error: 'Not Linked' }
        return { available: false, error: 'Unavailable' }
    }

    return (
        <ProviderCard
            title="Perplexity AI"
            status={getStatus()}
            checking={checking}
            headerActions={
                <>
                    <div className="h-4 w-px bg-white/10 mx-1" />
                    <PerplexityLinkButton variant="compact" />
                </>
            }
            testing={testing}
            testDisabled={testing || !canTest}
            onTest={handleTest}
            testResult={testResult}
        >
            {/* Mode selection for Perplexity searches */}
            <div>
                <label className="block text-xs text-white/40 mb-1">Mode</label>
                <ModelSelect
                    value={settings.perplexityModel || 'concise'}
                    onChange={(value) => settings.setPerplexityModel(value)}
                    models={models ?? ['concise', 'copilot']}
                    placeholder="concise"
                    ariaLabel="Perplexity Mode Selection"
                />
                <p className="mt-2 text-[10px] text-white/40">
                    'concise' uses standard search, 'copilot' uses advanced search (Pro only).
                </p>
            </div>
        </ProviderCard>
    )
}
