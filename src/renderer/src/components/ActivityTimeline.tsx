import React, { useState, useMemo } from 'react'
import {
    ChevronDown,
    ChevronRight,
    Terminal,
    Cpu,
    Wrench,
    AlertCircle,
    Info,
    Clock,
    Code
} from 'lucide-react'
import { useLogStore, LogEntry } from '../stores/logStore'
import { useChatStore } from '../stores/chatStore'

export function ActivityTimeline() {
    const { activeSessionId } = useChatStore()
    const { logs, clearLogs, fetchSessionLogs } = useLogStore()
    const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({})

    // Fetch logs from filesystem when session changes
    React.useEffect(() => {
        if (activeSessionId) {
            fetchSessionLogs(activeSessionId)
        }
    }, [activeSessionId, fetchSessionLogs])

    const sessionLogs = useMemo(() => {
        if (!activeSessionId) return []
        return logs.filter(log => log.sessionId === activeSessionId).reverse()
    }, [logs, activeSessionId])

    const toggleExpand = (id: string) => {
        setExpandedLogs(prev => ({ ...prev, [id]: !prev[id] }))
    }

    const getIcon = (operation: string) => {
        if (operation.includes('llm')) return <Cpu size={14} className="text-purple-400" />
        if (operation.includes('tool')) return <Wrench size={14} className="text-blue-400" />
        if (operation.includes('error')) return <AlertCircle size={14} className="text-red-400" />
        return <Terminal size={14} className="text-gray-400" />
    }

    if (sessionLogs.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-white/30 text-center">
                <Code size={48} className="mb-4 opacity-20" />
                <p className="text-sm">No technical logs available for this session.</p>
                <p className="text-xs mt-1">Interact with the AI to see activity logs here.</p>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0c10]">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-2">
                    <Terminal size={16} />
                    Technical Activity Timeline
                </h3>
                <button
                    onClick={() => activeSessionId && clearLogs(activeSessionId)}
                    className="text-[10px] text-white/40 hover:text-white transition-colors"
                >
                    Clear Session Logs
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono">
                {sessionLogs.map((log) => (
                    <div
                        key={log.id}
                        className="group border border-white/5 rounded-lg overflow-hidden bg-black/20"
                    >
                        <div
                            onClick={() => toggleExpand(log.id)}
                            className="flex items-center gap-3 p-2 cursor-pointer hover:bg-white/5 transition-colors"
                        >
                            <div className="flex-shrink-0">
                                {expandedLogs[log.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </div>

                            <div className="flex-shrink-0">
                                {getIcon(log.operation)}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className={`text-[10px] uppercase font-bold px-1 rounded ${log.level === 'error' ? 'bg-red-500/20 text-red-400' :
                                        log.level === 'warn' ? 'bg-yellow-500/20 text-yellow-400' :
                                            'bg-white/10 text-white/60'
                                        }`}>
                                        {log.level}
                                    </span>
                                    <span className="text-[10px] text-white/40 flex items-center gap-1">
                                        <Clock size={10} />
                                        {new Date(log.timestamp).toLocaleTimeString()}
                                    </span>
                                </div>
                                <p className="text-xs text-white/80 truncate">{log.message}</p>
                            </div>
                        </div>

                        {expandedLogs[log.id] && log.data && (
                            <div className="p-3 bg-black/40 border-t border-white/5 relative group/data">
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(JSON.stringify(log.data, null, 2))
                                    }}
                                    className="absolute top-2 right-2 p-1 bg-white/5 hover:bg-white/10 rounded text-[10px] text-white/40 hover:text-white transition-opacity opacity-0 group-hover/data:opacity-100"
                                >
                                    Copy
                                </button>
                                <pre className="text-[10px] text-blue-300/80 leading-relaxed overflow-x-auto pr-8">
                                    {JSON.stringify(log.data, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
