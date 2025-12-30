import React from 'react'
import {
    Power,
    Trash2,
    Edit2,
    ChevronDown,
    ChevronRight,
    Globe,
    AlertCircle,
    Loader2,
    Terminal,
    MessageSquare
} from 'lucide-react'
import { MCPServer } from '../../lib/mcp'

interface McpServerCardProps {
    server: MCPServer
    isExpanded: boolean
    isEditing: boolean
    isConnecting: boolean
    onToggleExpand: () => void
    onEdit: () => void
    onToggleConnection: () => void
    onRemove: () => void
    onTroubleshoot: () => void
}

function getServerIcon(type: string) {
    return type === 'stdio' ? <Terminal size={20} /> : <Globe size={20} />
}

export function McpServerCard({
    server,
    isExpanded,
    isEditing,
    isConnecting,
    onToggleExpand,
    onEdit,
    onToggleConnection,
    onRemove,
    onTroubleshoot
}: McpServerCardProps) {
    return (
        <div
            className={`bg-[#1a1d23] border rounded-xl overflow-hidden shadow-sm hover:border-white/20 transition-colors ${isEditing ? 'border-[#4fd1c5]/50 ring-1 ring-[#4fd1c5]/20' : 'border-white/10'}`}
        >
            {/* Server Header */}
            <div className="flex items-center gap-4 p-4">
                <button
                    onClick={onToggleExpand}
                    className="p-1 text-white/40 hover:text-white transition-colors"
                >
                    {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </button>

                <div className={`p-2.5 rounded-lg ${server.connected ? 'bg-[#4fd1c5]/10 text-[#4fd1c5]' : 'bg-white/5 text-white/40'}`}>
                    {getServerIcon(server.type)}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                        <h3 className="font-medium text-white/90 truncate">{server.name}</h3>
                        {server.installStatus ? (
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-medium uppercase tracking-wide border border-blue-500/20">
                                <Loader2 size={10} className="animate-spin" />
                                {server.installStatus}
                            </span>
                        ) : isConnecting ? (
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 text-[10px] font-medium uppercase tracking-wide border border-yellow-500/20">
                                <Loader2 size={10} className="animate-spin" />
                                Connecting...
                            </span>
                        ) : server.connected ? (
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-[10px] font-medium uppercase tracking-wide border border-green-500/20">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                Active
                            </span>
                        ) : server.error ? (
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px] font-medium uppercase tracking-wide border border-red-500/20">
                                Error
                            </span>
                        ) : (
                            <span className="text-xs text-white/30">Offline</span>
                        )}
                    </div>
                    <p className="text-xs text-white/40 mt-0.5 truncate font-mono">
                        {server.type === 'stdio'
                            ? `${server.command} ${(server.args || []).join(' ')}`
                            : server.url}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={onEdit}
                        className={`p-2 rounded-lg transition-all ${isEditing
                            ? 'bg-[#4fd1c5] text-white'
                            : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'
                            }`}
                        title="Edit configuration"
                    >
                        <Edit2 size={18} />
                    </button>

                    <button
                        onClick={onToggleConnection}
                        disabled={isConnecting || !!server.installStatus}
                        className={`p-2 rounded-lg transition-all ${server.connected
                            ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                            : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title={server.connected ? 'Disconnect' : 'Connect'}
                    >
                        {isConnecting || server.installStatus ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <Power size={18} />
                        )}
                    </button>

                    <button
                        onClick={onRemove}
                        className="p-2 rounded-lg bg-white/5 text-white/40 
                           hover:bg-red-500/10 hover:text-red-400 transition-all border border-transparent hover:border-red-500/20"
                        title="Remove server"
                    >
                        <Trash2 size={18} />
                    </button>
                </div>
            </div>

            {/* Details & Error Message */}
            {(isExpanded || server.error) && (
                <div className="border-t border-white/5 bg-black/20">
                    {server.error && (
                        <div className="p-4 bg-red-500/5 border-b border-red-500/10">
                            <div className="flex items-start gap-3">
                                <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs text-red-200 leading-relaxed font-sans whitespace-pre-wrap">
                                        {server.error.split('`').map((part, i) => (
                                            i % 2 === 1 ? (
                                                <code key={i} className="bg-red-500/20 px-1.5 py-0.5 rounded text-red-300 font-mono text-[11px] mx-0.5 border border-red-500/20 select-all cursor-pointer hover:bg-red-500/30 transition-colors" title="Click to select">
                                                    {part}
                                                </code>
                                            ) : (
                                                <span key={i}>{part}</span>
                                            )
                                        ))}
                                    </div>

                                    <button
                                        onClick={onTroubleshoot}
                                        className="mt-4 flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[11px] text-[#4fd1c5] hover:bg-[#4fd1c5]/10 hover:border-[#4fd1c5]/30 transition-all font-medium"
                                    >
                                        <MessageSquare size={14} />
                                        Troubleshoot with AI
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {isExpanded && (
                        <div className="p-4">
                            {server.connected && server.tools.length > 0 ? (
                                <div>
                                    <p className="text-white/40 text-xs mb-3 uppercase tracking-wider font-medium">Available Tools ({server.tools.length})</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {server.tools.map((tool) => (
                                            <div key={tool.name} className="p-2 rounded bg-white/5 border border-white/5 flex flex-col gap-1">
                                                <span className="text-[#4fd1c5] text-xs font-mono font-medium">{tool.name}</span>
                                                <span className="text-white/40 text-[10px] truncate">{tool.description}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : server.connected ? (
                                <p className="text-white/30 text-sm italic">No tools exposed by this server.</p>
                            ) : (
                                <p className="text-white/30 text-sm italic">Connect to inspect available tools.</p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
