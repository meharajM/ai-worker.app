import React from 'react'
import { Plus, MessageSquare, Trash2, Edit2 } from 'lucide-react'
import { useChatStore, ChatSession } from '../stores/chatStore'

export function ChatSidebar() {
    const { 
        sessions, 
        activeSessionId, 
        createSession, 
        deleteSession, 
        setActiveSession,
        updateSessionTitle 
    } = useChatStore()

    const [editingId, setEditingId] = React.useState<string | null>(null)
    const [editTitle, setEditTitle] = React.useState('')

    const handleCreateSession = () => {
        createSession()
    }

    const handleDeleteSession = (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        if (window.confirm('Delete this chat?')) {
            deleteSession(id)
        }
    }

    const startEditing = (e: React.MouseEvent, session: ChatSession) => {
        e.stopPropagation()
        setEditingId(session.id)
        setEditTitle(session.title)
    }

    const saveTitle = (id: string) => {
        if (editTitle.trim()) {
            updateSessionTitle(id, editTitle.trim())
        }
        setEditingId(null)
    }

    const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
        if (e.key === 'Enter') {
            saveTitle(id)
        } else if (e.key === 'Escape') {
            setEditingId(null)
        }
    }

    return (
        <div className="w-64 bg-[#1a1d23] border-r border-white/5 flex flex-col h-full">
            <div className="p-4 border-b border-white/5">
                <button
                    onClick={handleCreateSession}
                    className="w-full flex items-center justify-center gap-2 bg-[#00a896] hover:bg-[#008f80] text-white py-2 px-4 rounded-lg transition-colors font-medium text-sm"
                >
                    <Plus size={16} />
                    New Chat
                </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
                {sessions.map((session) => (
                    <div
                        key={session.id}
                        onClick={() => setActiveSession(session.id)}
                        className={`group relative flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors
                            ${session.id === activeSessionId
                                ? 'bg-white/10 text-white'
                                : 'text-white/60 hover:bg-white/5 hover:text-white'
                            }`}
                    >
                        <MessageSquare size={16} className="flex-shrink-0" />
                        
                        {editingId === session.id ? (
                            <input
                                autoFocus
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onBlur={() => saveTitle(session.id)}
                                onKeyDown={(e) => handleKeyDown(e, session.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="flex-1 bg-[#0f1115] text-white text-sm px-2 py-1 rounded outline-none border border-[#00a896]"
                                aria-label="Edit chat title"
                            />
                        ) : (
                            <span className="flex-1 text-sm truncate pr-8">
                                {session.title}
                            </span>
                        )}

                        {/* Actions (visible on hover or active) */}
                        {editingId !== session.id && (
                            <div className={`absolute right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity
                                ${session.id === activeSessionId ? 'opacity-100' : ''}`}>
                                <button
                                    onClick={(e) => startEditing(e, session)}
                                    className="p-1 text-white/40 hover:text-white rounded hover:bg-white/10"
                                    title="Rename"
                                >
                                    <Edit2 size={12} />
                                </button>
                                <button
                                    onClick={(e) => handleDeleteSession(e, session.id)}
                                    className="p-1 text-white/40 hover:text-red-400 rounded hover:bg-red-500/10"
                                    title="Delete"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        )}
                    </div>
                ))}

                {sessions.length === 0 && (
                    <div className="text-center py-8 px-4 text-white/20 text-sm">
                        No chats yet. Start a new conversation!
                    </div>
                )}
            </div>
        </div>
    )
}
