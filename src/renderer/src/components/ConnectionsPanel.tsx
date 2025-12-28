import React, { useState, useEffect, useCallback } from 'react'
import {
    Plus,
    Power,
    PowerOff,
    Trash2,
    ChevronDown,
    ChevronRight,
    HardDrive,
    Github,
    Cloud,
    Search,
    Database,
    Globe,
    MessageSquare,
    Wrench,
    AlertCircle,
    CheckCircle,
    Loader2
} from 'lucide-react'
import {
    MCPServer,
    MCP_TEMPLATES,
    addServerFromTemplate,
    addCustomServer,
    removeServer,
    getServers,
    connectServer,
    disconnectServer,
} from '../lib/mcp'

// Icon mapping for different server types
const SERVER_ICONS: Record<string, React.ReactNode> = {
    'File System': <HardDrive size={20} />,
    'GitHub': <Github size={20} />,
    'Google Drive': <Cloud size={20} />,
    'Brave Search': <Search size={20} />,
    'Memory': <Database size={20} />,
    'Puppeteer': <Globe size={20} />,
    'Slack': <MessageSquare size={20} />,
    'SQLite': <Database size={20} />,
}

function getServerIcon(name: string): React.ReactNode {
    return SERVER_ICONS[name] || <Wrench size={20} />
}

export function ConnectionsPanel() {
    const [servers, setServers] = useState<MCPServer[]>([])
    const [showAddMenu, setShowAddMenu] = useState(false)
    const [showCustomForm, setShowCustomForm] = useState(false)
    const [expandedServer, setExpandedServer] = useState<string | null>(null)
    const [connecting, setConnecting] = useState<string | null>(null)

    // Custom server form
    const [customName, setCustomName] = useState('')
    const [customCommand, setCustomCommand] = useState('')
    const [customArgs, setCustomArgs] = useState('')

    // Load servers on mount
    useEffect(() => {
        setServers(getServers())
    }, [])

    // Refresh servers
    const refreshServers = useCallback(() => {
        setServers(getServers())
    }, [])

    // Add server from template
    const handleAddTemplate = useCallback((index: number) => {
        addServerFromTemplate(index)
        refreshServers()
        setShowAddMenu(false)
    }, [refreshServers])

    // Add custom server
    const handleAddCustom = useCallback(() => {
        if (!customName.trim() || !customCommand.trim()) return

        addCustomServer({
            name: customName.trim(),
            description: 'Custom MCP server',
            type: 'stdio',
            command: customCommand.trim(),
            args: customArgs.split(' ').filter(Boolean),
        })

        refreshServers()
        setShowCustomForm(false)
        setCustomName('')
        setCustomCommand('')
        setCustomArgs('')
    }, [customName, customCommand, customArgs, refreshServers])

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
    const totalTools = servers.reduce((acc, s) => acc + (s.connected ? s.tools.length : 0), 0)

    return (
        <div className="flex-1 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold">MCP Connections</h2>
                    <p className="text-sm text-white/40 mt-1">
                        {connectedCount} connected · {totalTools} tools available
                    </p>
                </div>

                {/* Add Server Button */}
                <div className="relative">
                    <button
                        onClick={() => setShowAddMenu(!showAddMenu)}
                        className="flex items-center gap-2 px-4 py-2 bg-[#4fd1c5] text-white rounded-xl
                       hover:bg-[#5fe0d4] transition-all shadow-lg shadow-[#4fd1c5]/20"
                    >
                        <Plus size={18} />
                        Add Server
                    </button>

                    {/* Add Server Menu */}
                    {showAddMenu && (
                        <div className="absolute right-0 top-12 w-72 bg-[#1a1d23] border border-white/10 
                            rounded-xl shadow-2xl z-10 overflow-hidden">
                            <div className="p-2 border-b border-white/10">
                                <p className="text-xs text-white/40 uppercase tracking-wider px-2 py-1">
                                    Pre-configured Servers
                                </p>
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                                {MCP_TEMPLATES.map((template, index) => {
                                    const alreadyAdded = servers.some((s) => s.name === template.name)
                                    return (
                                        <button
                                            key={template.name}
                                            onClick={() => !alreadyAdded && handleAddTemplate(index)}
                                            disabled={alreadyAdded}
                                            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                        ${alreadyAdded
                                                    ? 'opacity-50 cursor-not-allowed'
                                                    : 'hover:bg-white/5'
                                                }`}
                                        >
                                            <span className="text-white/60">{getServerIcon(template.name)}</span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{template.name}</p>
                                                <p className="text-xs text-white/40 truncate">{template.description}</p>
                                            </div>
                                            {alreadyAdded && <span className="text-xs text-white/30">Added</span>}
                                        </button>
                                    )
                                })}
                            </div>
                            <div className="p-2 border-t border-white/10">
                                <button
                                    onClick={() => {
                                        setShowCustomForm(true)
                                        setShowAddMenu(false)
                                    }}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-[#4fd1c5] 
                             hover:bg-white/5 rounded-lg transition-colors"
                                >
                                    <Wrench size={16} />
                                    <span className="text-sm">Add Custom Server</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Custom Server Form */}
            {showCustomForm && (
                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4 mb-6">
                    <h3 className="text-sm font-medium mb-4">Add Custom MCP Server</h3>
                    <div className="space-y-3">
                        <input
                            type="text"
                            placeholder="Server Name"
                            value={customName}
                            onChange={(e) => setCustomName(e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                         placeholder-white/30 focus:border-white/20 focus:outline-none"
                        />
                        <input
                            type="text"
                            placeholder="Command (e.g., npx, node, python)"
                            value={customCommand}
                            onChange={(e) => setCustomCommand(e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                         placeholder-white/30 focus:border-white/20 focus:outline-none"
                        />
                        <input
                            type="text"
                            placeholder="Arguments (space-separated)"
                            value={customArgs}
                            onChange={(e) => setCustomArgs(e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                         placeholder-white/30 focus:border-white/20 focus:outline-none"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={handleAddCustom}
                                disabled={!customName.trim() || !customCommand.trim()}
                                className="px-4 py-2 bg-[#4fd1c5] text-white rounded-lg text-sm
                           hover:bg-[#5fe0d4] transition-all disabled:opacity-50"
                            >
                                Add Server
                            </button>
                            <button
                                onClick={() => setShowCustomForm(false)}
                                className="px-4 py-2 bg-white/5 text-white/60 rounded-lg text-sm
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
                <div className="text-center py-12">
                    <Database size={48} className="mx-auto text-white/20 mb-4" />
                    <p className="text-white/40 mb-2">No MCP servers configured</p>
                    <p className="text-sm text-white/30">
                        Add servers to enable tool usage and automation
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {servers.map((server) => (
                        <div
                            key={server.id}
                            className="bg-[#1a1d23] border border-white/10 rounded-xl overflow-hidden"
                        >
                            {/* Server Header */}
                            <div className="flex items-center gap-3 p-4">
                                {/* Expand/Collapse */}
                                <button
                                    onClick={() => setExpandedServer(expandedServer === server.id ? null : server.id)}
                                    className="text-white/40 hover:text-white transition-colors"
                                >
                                    {expandedServer === server.id ? (
                                        <ChevronDown size={18} />
                                    ) : (
                                        <ChevronRight size={18} />
                                    )}
                                </button>

                                {/* Icon */}
                                <span className={server.connected ? 'text-[#4fd1c5]' : 'text-white/40'}>
                                    {getServerIcon(server.name)}
                                </span>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="font-medium truncate">{server.name}</p>
                                        {server.connected ? (
                                            <CheckCircle size={14} className="text-green-400" />
                                        ) : server.error ? (
                                            <AlertCircle size={14} className="text-red-400" />
                                        ) : null}
                                    </div>
                                    <p className="text-xs text-white/40 truncate">
                                        {server.connected
                                            ? `${server.tools.length} tools available`
                                            : server.error || 'Disconnected'
                                        }
                                    </p>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2">
                                    {/* Connect/Disconnect */}
                                    <button
                                        onClick={() => handleToggleConnection(server)}
                                        disabled={connecting === server.id}
                                        className={`p-2 rounded-lg transition-all ${server.connected
                                                ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                                                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'
                                            }`}
                                        title={server.connected ? 'Disconnect' : 'Connect'}
                                    >
                                        {connecting === server.id ? (
                                            <Loader2 size={18} className="animate-spin" />
                                        ) : server.connected ? (
                                            <Power size={18} />
                                        ) : (
                                            <PowerOff size={18} />
                                        )}
                                    </button>

                                    {/* Remove */}
                                    <button
                                        onClick={() => handleRemove(server.id)}
                                        className="p-2 rounded-lg bg-white/5 text-white/40 
                               hover:bg-red-500/10 hover:text-red-400 transition-all"
                                        title="Remove server"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>

                            {/* Expanded Details */}
                            {expandedServer === server.id && (
                                <div className="border-t border-white/10 p-4 bg-black/20">
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <p className="text-white/40 text-xs mb-1">Type</p>
                                            <p className="font-mono text-white/80">{server.type}</p>
                                        </div>
                                        <div>
                                            <p className="text-white/40 text-xs mb-1">Command</p>
                                            <p className="font-mono text-white/80 truncate">{server.command}</p>
                                        </div>
                                    </div>

                                    {server.connected && server.tools.length > 0 && (
                                        <div className="mt-4">
                                            <p className="text-white/40 text-xs mb-2">Available Tools</p>
                                            <div className="flex flex-wrap gap-2">
                                                {server.tools.map((tool) => (
                                                    <span
                                                        key={tool.name}
                                                        className="px-2 py-1 bg-[#4fd1c5]/10 text-[#4fd1c5] 
                                       rounded text-xs font-mono"
                                                    >
                                                        {tool.name}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Click outside to close menu */}
            {showAddMenu && (
                <div
                    className="fixed inset-0 z-0"
                    onClick={() => setShowAddMenu(false)}
                />
            )}
        </div>
    )
}
