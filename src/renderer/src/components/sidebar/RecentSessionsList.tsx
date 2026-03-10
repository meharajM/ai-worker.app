import React, { useState } from 'react'
import { MessageSquare, Plus, Edit2, Trash2 } from 'lucide-react'
import { useChatStore, ChatSession } from '../../stores/chatStore'
import { useLogStore } from '../../stores/logStore'

export function RecentSessionsList() {
  const {
    sessions,
    activeSessionId,
    createSession,
    deleteSession,
    setActiveSession,
    updateSessionTitle,
    _processingSessions,
  } = useChatStore()
  
  const { addLog } = useLogStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const handleCreateSession = () => {
    const newSessionId = createSession()
    setActiveSession(newSessionId)
    addLog({
      eventType: 'SESSION_START',
      sessionId: newSessionId,
      component: 'RecentSessionsList',
      details: { metadata: { createdAt: new Date().toISOString() } }
    })
  }

  const startEditing = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation()
    setEditingId(session.id)
    setEditTitle(session.title)
  }

  const saveTitle = (id: string) => {
    if (editTitle.trim()) updateSessionTitle(id, editTitle.trim())
    setEditingId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') saveTitle(id)
    if (e.key === 'Escape') setEditingId(null)
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (window.confirm('Delete this session?')) deleteSession(id)
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      {/* Header section with + Icon */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold text-white/40 tracking-wider uppercase">
          Recent Sessions
        </h3>
        <button
          onClick={handleCreateSession}
          className="text-white/40 hover:text-white transition-colors p-1"
          title="New Chat Session"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex flex-col gap-0.5">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId
          const isProcessing = _processingSessions.has(session.id)
          return (
            <div
              key={session.id}
              onClick={() => setActiveSession(session.id)}
              className={`group relative flex items-center justify-between py-2 px-2 -mx-2 rounded-lg cursor-pointer transition-all
                ${isActive 
                  ? 'bg-white/5 text-white shadow-sm' 
                  : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare size={14} className="flex-shrink-0 opacity-70" />
                
                {editingId === session.id ? (
                  <input
                    autoFocus
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => saveTitle(session.id)}
                    onKeyDown={(e) => handleKeyDown(e, session.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-[var(--color-bg-dark)] text-white text-xs px-2 py-1 rounded outline-none border border-[var(--color-primary)] w-full"
                  />
                ) : (
                  <span className="text-xs font-medium truncate">
                    {session.title}
                  </span>
                )}

                {/* Pulsing indicator for actively running sessions */}
                {isProcessing && (
                  <span
                    className="flex-shrink-0 w-2 h-2 rounded-full bg-[var(--color-primary)]"
                    style={{ animation: 'pulse-dot 1.4s ease-in-out infinite' }}
                    title="Processing..."
                  />
                )}
              </div>

              {editingId !== session.id && (
                <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isActive ? 'opacity-100' : ''}`}>
                  <button onClick={(e) => startEditing(e, session)} className="p-1 text-white/40 hover:text-white rounded">
                    <Edit2 size={12} />
                  </button>
                  <button onClick={(e) => handleDelete(e, session.id)} className="p-1 text-white/40 hover:text-red-400 rounded">
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {sessions.length === 0 && (
          <div className="text-center py-6 text-xs text-white/20">
            No active sessions.
          </div>
        )}
      </div>
    </div>
  )
}
