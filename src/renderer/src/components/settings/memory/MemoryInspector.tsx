import React, { useState, useEffect } from 'react'
import { FileJson, FolderOpen, RefreshCw, Copy, Check } from 'lucide-react'

export function MemoryInspector() {
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [expanded, setExpanded] = useState(false)

    const loadData = async () => {
        setLoading(true)
        setError(null)
        try {
            if (!window.electron?.memory) {
                throw new Error('Memory API not available')
            }
            const result = await window.electron.memory.exportAll()
            if (result.success) {
                setData(result.data)
            } else {
                setError(result.error || 'Unknown error')
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const openFileLocation = async () => {
        if (!window.electron?.memory) return
        await window.electron.memory.openFileLocation()
    }

    const handleCopy = () => {
        if (data) {
            navigator.clipboard.writeText(JSON.stringify(data, null, 2))
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    return (
        <div className="bg-[var(--color-card-elevated)] border border-[var(--color-border)] rounded-xl overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <FileJson className="text-[var(--color-brand-teal)]" size={20} />
                    <h3 className="font-medium text-[var(--color-text-primary)]">Data Inspector</h3>
                </div>
                <div className="flex gap-2">
                     <button
                        onClick={openFileLocation}
                        className="p-2 hover:bg-[var(--color-surface)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                        title="Open File Location"
                    >
                        <FolderOpen size={16} />
                    </button>
                    <button
                        onClick={() => {
                            if (!expanded) loadData()
                            setExpanded(!expanded)
                        }}
                        className="px-3 py-1.5 bg-[var(--color-brand-teal)]/10 text-[var(--color-brand-teal)] rounded-lg text-xs font-medium hover:bg-[var(--color-brand-teal)]/20 transition-colors"
                    >
                        {expanded ? 'Hide Data' : 'View Raw JSON'}
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="p-0 bg-[var(--color-bg-dark)]">
                    <div className="flex items-center justify-end px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                        <button
                            onClick={loadData}
                            className="p-1.5 hover:bg-[var(--color-border)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                        </button>
                        <button
                            onClick={handleCopy}
                            className="p-1.5 hover:bg-[var(--color-border)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors ml-2"
                            title="Copy JSON"
                        >
                            {copied ? <Check size={14} className="text-[var(--color-success)]" /> : <Copy size={14} />}
                        </button>
                    </div>
                    
                    <div className="p-4 overflow-auto max-h-[400px] text-xs font-mono">
                        {loading ? (
                            <div className="text-[var(--color-text-muted)] text-center py-8">Loading memory data...</div>
                        ) : error ? (
                            <div className="text-[var(--color-error)] p-2">{error}</div>
                        ) : (
                            <pre className="text-[var(--color-text-primary)]">
                                {JSON.stringify(data, null, 2)}
                            </pre>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
