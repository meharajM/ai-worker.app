import React, { useState, useEffect, useCallback } from 'react'
import {
    Plus,
    Power,
    PowerOff,
    Trash2,
    ChevronDown,
    ChevronRight,
    Database,
    Globe,
    AlertCircle,
    Loader2,
    Server,
    Terminal
} from 'lucide-react'
import {
    MCPServer,
    addCustomServer,
    removeServer,
    getServers,
    connectServer,
    disconnectServer,
} from '../lib/mcp'

// Icon mapping (simplified)
function getServerIcon(type: string): React.ReactNode {
    return type === 'stdio' ? <Terminal size={20} /> : <Globe size={20} />
}

export function ConnectionsPanel() {
    const [servers, setServers] = useState<MCPServer[]>([])
    const [showAddForm, setShowAddForm] = useState(false)
    const [expandedServer, setExpandedServer] = useState<string | null>(null)
    const [connecting, setConnecting] = useState<string | null>(null)

    // Form State
    const [serverType, setServerType] = useState<'stdio' | 'sse'>('stdio')
    const [name, setName] = useState('')
    const [command, setCommand] = useState('')
    const [args, setArgs] = useState('')
    const [url, setUrl] = useState('')

    // Load servers on mount
    useEffect(() => {
        setServers(getServers())
    }, [])

    // Refresh servers
    const refreshServers = useCallback(() => {
        setServers(getServers())
    }, [])

    // Add server
    const handleAddServer = useCallback(() => {
        if (!name.trim()) return

        if (serverType === 'stdio' && !command.trim()) return
        if (serverType === 'sse' && !url.trim()) return

        addCustomServer({
            name: name.trim(),
            description: serverType === 'stdio' ? 'Local CLI Tool' : 'Remote SSE Server',
            type: serverType,
            command: serverType === 'stdio' ? command.trim() : undefined,
            args: serverType === 'stdio' ? args.split(' ').filter(Boolean) : undefined,
            url: serverType === 'sse' ? url.trim() : undefined,
        })

        refreshServers()
        setShowAddForm(false)
        resetForm()
    }, [name, serverType, command, args, url, refreshServers])

    const resetForm = () => {
        setName('')
        setCommand('')
        setArgs('')
        setUrl('')
        setServerType('stdio')
    }

    // Connect/disconnect server
    const handleToggleConnection = useCallback(async (server: MCPServer) => {
        setConnecting(server.id)
        try {
            if (server.connected) {
                await disconnectServer(server.id)
            } else {
                await connectServer(server.id)
            }
            refreshServers()
        } catch (error) {
            console.error('Connection error:', error)
        } finally {
            setConnecting(null)
        }
    }, [refreshServers])

    // Remove server
    const handleRemove = useCallback((serverId: string) => {
        if (window.confirm('Remove this MCP server?')) {
            removeServer(serverId)
            refreshServers()
        }
    }, [refreshServers])

    const connectedCount = servers.filter((s) => s.connected).length

    return (
        <div className="flex-1 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold">MCP Connections</h2>
                    <p className="text-sm text-white/40 mt-1">
                        {connectedCount} connected · {servers.length} configured
                    </p>
                </div>

                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="flex items-center gap-2 px-4 py-2 bg-[#4fd1c5] text-white rounded-xl
                       hover:bg-[#5fe0d4] transition-all shadow-lg shadow-[#4fd1c5]/20"
                >
                    <Plus size={18} />
                    Add Connection
                </button>
            </div>

            {/* Add Server Form */}
            {showAddForm && (
                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-6 mb-6 animate-in slide-in-from-top-2">
                    <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                        <Server size={20} className="text-[#4fd1c5]" />
                        New MCP Connection
                    </h3>

                    <div className="space-y-4">
                        {/* Name */}
                        <div>
                            <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">Name</label>
                            <input
                                type="text"
                                placeholder="My Server"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                     placeholder-white/30 focus:border-[#4fd1c5]/50 focus:outline-none focus:ring-1 focus:ring-[#4fd1c5]/50"
                            />
                        </div>

                        {/* Type Selection */}
                        <div>
                            <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">Connection Type</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setServerType('stdio')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors border ${serverType === 'stdio'
                                        ? 'bg-[#4fd1c5]/10 border-[#4fd1c5] text-[#4fd1c5]'
                                        : 'bg-black/30 border-white/10 text-white/60 hover:bg-white/5'
                                        }`}
                                >
                                    <Terminal size={16} />
                                    Stdio (Local)
                                </button>
                                <button
                                    onClick={() => setServerType('sse')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors border ${serverType === 'sse'
                                        ? 'bg-[#4fd1c5]/10 border-[#4fd1c5] text-[#4fd1c5]'
                                        : 'bg-black/30 border-white/10 text-white/60 hover:bg-white/5'
                                        }`}
                                >
                                    <Globe size={16} />
                                    SSE (Remote)
                                </button>
                            </div>
                        </div>

                        {/* Dynamic Fields */}
                        {serverType === 'stdio' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-1">
                                    <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">Command</label>
                                    <input
                                        type="text"
                                        placeholder="npx, python, node..."
                                        value={command}
                                        onChange={(e) => setCommand(e.target.value)}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                             placeholder-white/30 focus:border-[#4fd1c5]/50 focus:outline-none focus:ring-1 focus:ring-[#4fd1c5]/50 font-mono"
                                    />
                                </div>
                                <div className="md:col-span-1">
                                    <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">Arguments</label>
                                    <input
                                        type="text"
                                        placeholder="-y @modelcontextprotocol/server-..."
                                        value={args}
                                        onChange={(e) => setArgs(e.target.value)}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                             placeholder-white/30 focus:border-[#4fd1c5]/50 focus:outline-none focus:ring-1 focus:ring-[#4fd1c5]/50 font-mono"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">Server URL</label>
                                <input
                                    type="text"
                                    placeholder="http://localhost:8000/sse"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                         placeholder-white/30 focus:border-[#4fd1c5]/50 focus:outline-none focus:ring-1 focus:ring-[#4fd1c5]/50 font-mono"
                                />
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={handleAddServer}
                                disabled={!name || (serverType === 'stdio' ? !command : !url)}
                                className="px-6 py-2 bg-[#4fd1c5] text-white rounded-lg text-sm font-medium
                                   hover:bg-[#5fe0d4] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Add Connection
                            </button>
                            <button
                                onClick={() => {
                                    setShowAddForm(false)
                                    resetForm()
                                }}
                                className="px-6 py-2 bg-white/5 text-white/60 rounded-lg text-sm font-medium
                                   hover:bg-white/10 transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Server List */}
            {servers.length === 0 ? (
                <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-xl">
                    <Database size={48} className="mx-auto text-white/20 mb-4" />
                    <p className="text-white/40 mb-2 font-medium">No MCP servers configured</p>
                    <p className="text-sm text-white/30 max-w-sm mx-auto">
                        Connect to local or remote MCP servers to give your AI access to tools and data.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {servers.map((server) => (
                        <div
                            key={server.id}
                            className="bg-[#1a1d23] border border-white/10 rounded-xl overflow-hidden shadow-sm hover:border-white/20 transition-colors"
                        >
                            {/* Server Header */}
                            <div className="flex items-center gap-4 p-4">
                                <button
                                    onClick={() => setExpandedServer(expandedServer === server.id ? null : server.id)}
                                    className="p-1 text-white/40 hover:text-white transition-colors"
                                >
                                    {expandedServer === server.id ? (
                                        <ChevronDown size={20} />
                                    ) : (
                                        <ChevronRight size={20} />
                                    )}
                                </button>

                                <div className={`p-2.5 rounded-lg ${server.connected ? 'bg-[#4fd1c5]/10 text-[#4fd1c5]' : 'bg-white/5 text-white/40'}`}>
                                    {getServerIcon(server.type)}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3">
                                        <h3 className="font-medium text-white/90 truncate">{server.name}</h3>
                                        {server.connected ? (
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
                                        onClick={() => handleToggleConnection(server)}
                                        disabled={connecting === server.id}
                                        className={`p-2 rounded-lg transition-all ${server.connected
                                            ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                                            : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                                            } disabled:opacity-50`}
                                        title={server.connected ? 'Disconnect' : 'Connect'}
                                    >
                                        {connecting === server.id ? (
                                            <Loader2 size={18} className="animate-spin" />
                                        ) : (
                                            <Power size={18} />
                                        )}
                                    </button>

                                    <button
                                        onClick={() => handleRemove(server.id)}
                                        className="p-2 rounded-lg bg-white/5 text-white/40 
                                           hover:bg-red-500/10 hover:text-red-400 transition-all border border-transparent hover:border-red-500/20"
                                        title="Remove server"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>

                            {/* Details & Error Message */}
                            {(expandedServer === server.id || server.error) && (
                                <div className="border-t border-white/5 bg-black/20">
                                    {server.error && (
                                        <div className="p-4 bg-red-500/5 border-b border-red-500/10">
                                            <div className="flex items-start gap-3">
                                                <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
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
                                            </div>
                                        </div>
                                    )}

                                    {expandedServer === server.id && (
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
                    ))}
                </div>
            )}
        </div>
    )
}
