import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Database } from 'lucide-react'
import {
    MCPServer,
    addCustomServer,
    updateServer,
    removeServer,
    getServers,
    connectServer,
    disconnectServer,
} from '../lib/mcp'
import { useChatStore } from '../stores/chatStore'
import { McpServerCard } from './mcp/McpServerCard'
import { McpServerForm } from './mcp/McpServerForm'

export function ConnectionsPanel() {
    const [servers, setServers] = useState<MCPServer[]>([])
    const [showForm, setShowForm] = useState(false)
    const [editingServerId, setEditingServerId] = useState<string | null>(null)
    const [expandedServer, setExpandedServer] = useState<string | null>(null)
    const [connecting, setConnecting] = useState<string | null>(null)

    // Load servers on mount
    useEffect(() => {
        setServers(getServers())
    }, [])

    // Refresh servers
    const refreshServers = useCallback(() => {
        setServers(getServers())
    }, [])

    // Add or Update server
    const handleFormSubmit = (config: any) => {
        if (editingServerId) {
            updateServer(editingServerId, config)
        } else {
            addCustomServer(config)
        }
        refreshServers()
        setShowForm(false)
        setEditingServerId(null)
    }

    const handleEdit = (server: MCPServer) => {
        setEditingServerId(server.id)
        setShowForm(true)
        // Scroll to top to see form
        window.scrollTo({ top: 0, behavior: 'smooth' })
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
    const handleRemove = (serverId: string) => {
        if (window.confirm('Remove this MCP server?')) {
            removeServer(serverId)
            refreshServers()
        }
    }

    // Troubleshooting
    const handleTroubleshoot = useCallback((server: MCPServer) => {
        if (!server.error) return

        const chatStore = useChatStore.getState()
        const prompt = `I'm having trouble connecting to an MCP server named "${server.name}".
        
**Server Configuration:**
- Type: ${server.type}
- Command: ${server.command || 'N/A'}
- Arguments: ${server.args?.join(' ') || 'N/A'}
- URL: ${server.url || 'N/A'}

**Error Message:**
${server.error}

Can you help me troubleshoot this?`

        chatStore.addMessage({
            role: 'user',
            content: prompt
        })

        // Notify user
        alert('Prompt sent to AI tutor! Check the Chat view for the solution.')
    }, [])

    const connectedCount = servers.filter((s) => s.connected).length
    const editingServer = servers.find(s => s.id === editingServerId) || null

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
                    onClick={() => {
                        if (showForm && editingServerId) {
                            setEditingServerId(null)
                        } else {
                            setShowForm(!showForm)
                        }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-[#4fd1c5] text-white rounded-xl
                       hover:bg-[#5fe0d4] transition-all shadow-lg shadow-[#4fd1c5]/20"
                >
                    <Plus size={18} />
                    {editingServerId ? 'Add New Instead' : (showForm ? 'Hide Form' : 'Add Connection')}
                </button>
            </div>

            {/* Add/Edit Server Form */}
            {showForm && (
                <McpServerForm
                    editingServer={editingServer}
                    onSubmit={handleFormSubmit}
                    onCancel={() => { setShowForm(false); setEditingServerId(null); }}
                />
            )}

            {/* Server List */}
            {servers.length === 0 ? (
                <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-xl">
                    <Database size={48} className="mx-auto text-white/20 mb-4" />
                    <p className="text-white/40 mb-2 font-medium">No MCP servers configured</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {servers.map((server) => (
                        <McpServerCard
                            key={server.id}
                            server={server}
                            isExpanded={expandedServer === server.id}
                            isEditing={editingServerId === server.id}
                            isConnecting={connecting === server.id}
                            onToggleExpand={() => setExpandedServer(expandedServer === server.id ? null : server.id)}
                            onEdit={() => handleEdit(server)}
                            onToggleConnection={() => handleToggleConnection(server)}
                            onRemove={() => handleRemove(server.id)}
                            onTroubleshoot={() => handleTroubleshoot(server)}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
