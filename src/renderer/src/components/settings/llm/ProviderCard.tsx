/**
 * ProviderCard — shared card wrapper for every LLM provider settings block.
 *
 * Renders the standard card chrome: title, status badge, extra header actions,
 * a config body, a "Test Connection" button, and the result message.
 * All logic (fetch, test) stays in the parent provider component.
 */
import React from 'react'
import { Check, AlertCircle, Loader2 } from 'lucide-react'

export type ProviderStatus =
    | { available: true }
    | { available: false; error?: string }

interface ProviderCardProps {
    /** Card heading text e.g. "Google Gemini" */
    title: string
    /** Current availability from checkProvider() */
    status?: ProviderStatus
    /** Whether a background availability check is running */
    checking?: boolean
    /** Extra elements rendered in the header row (links, auth buttons…) */
    headerActions?: React.ReactNode
    /** Config fields (inputs, selects…) */
    children: React.ReactNode
    /** Label on the primary CTA button */
    testLabel?: string
    /** Whether the test is in-flight */
    testing?: boolean
    /** Whether the CTA button is disabled */
    testDisabled?: boolean
    /** Called when user clicks the test button */
    onTest?: () => void
    /** Non-empty string → show result; starts with "Error" → red, else green */
    testResult?: string
}

export function ProviderCard({
    title,
    status,
    checking,
    headerActions,
    children,
    testLabel = 'Test Connection',
    testing,
    testDisabled,
    onTest,
    testResult,
}: ProviderCardProps) {
    const isError = testResult?.toLowerCase().startsWith('error') ?? false

    return (
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-[var(--color-text-primary)]">{title}</h4>
                <div className="flex items-center gap-2">
                    {/* Availability badge */}
                    {checking ? (
                        <Loader2 size={16} className="animate-spin text-[var(--color-text-tertiary)]" />
                    ) : status?.available ? (
                        <span className="flex items-center gap-1 text-xs text-[var(--color-success)]">
                            <Check size={14} /> Configured
                        </span>
                    ) : status && !status.available ? (
                        <span className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                            <AlertCircle size={14} /> {(status as any).error || 'Not configured'}
                        </span>
                    ) : null}

                    {/* Caller-supplied actions (auth buttons, install links…) */}
                    {headerActions}
                </div>
            </div>

            {/* Config fields */}
            <div className="space-y-3">
                {children}

                {/* Test CTA */}
                {onTest && (
                    <button
                        onClick={onTest}
                        disabled={testing || testDisabled}
                        className="w-full px-4 py-2 bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent)]/20 text-[var(--color-accent)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {testing ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Testing...
                            </>
                        ) : (
                            testLabel
                        )}
                    </button>
                )}

                {/* Test result */}
                {testResult && (
                    <div
                        className={`p-2 rounded text-xs ${isError
                            ? 'bg-[var(--color-error-muted)] text-[var(--color-error)]'
                            : 'bg-[var(--color-success-muted)] text-[var(--color-success)]'
                            }`}
                    >
                        {testResult}
                    </div>
                )}
            </div>
        </div>
    )
}
