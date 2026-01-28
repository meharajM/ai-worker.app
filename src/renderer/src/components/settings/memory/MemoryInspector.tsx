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
        <div className="bg-[#1a1d23] border border-white/10 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <FileJson className="text-[#4fd1c5]" size={20} />
                    <h3 className="font-medium text-white">Data Inspector</h3>
                </div>
                <div className="flex gap-2">
                     <button
                        onClick={openFileLocation}
                        className="p-2 hover:bg-white/5 rounded-lg text-white/60 hover:text-white transition-colors"
                        title="Open File Location"
                    >
                        <FolderOpen size={16} />
                    </button>
                    <button
                        onClick={() => {
                            if (!expanded) loadData()
                            setExpanded(!expanded)
                        }}
                        className="px-3 py-1.5 bg-[#4fd1c5]/10 text-[#4fd1c5] rounded-lg text-xs font-medium hover:bg-[#4fd1c5]/20 transition-colors"
                    >
                        {expanded ? 'Hide Data' : 'View Raw JSON'}
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="p-0 bg-black/30">
                    <div className="flex items-center justify-end px-4 py-2 border-b border-white/5 bg-[#1a1d23]/50">
                        <button
                            onClick={loadData}
                            className="p-1.5 hover:bg-white/5 rounded text-white/40 hover:text-white transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                        </button>
                        <button
                            onClick={handleCopy}
                            className="p-1.5 hover:bg-white/5 rounded text-white/40 hover:text-white transition-colors ml-2"
                            title="Copy JSON"
                        >
                            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                        </button>
                    </div>
                    
                    <div className="p-4 overflow-auto max-h-[400px] text-xs font-mono">
                        {loading ? (
                            <div className="text-white/40 text-center py-8">Loading memory data...</div>
                        ) : error ? (
                            <div className="text-red-400 p-2">{error}</div>
                        ) : (
                            <pre className="text-white/70">
                                {JSON.stringify(data, null, 2)}
                            </pre>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
