import React, { useRef, useEffect } from 'react'
import { Trash2, Bot } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { MessageBubble } from './MessageBubble'

interface ChatViewProps {
    onClearChat?: () => void
}

export function ChatView({ onClearChat }: ChatViewProps) {
    const { sessions, activeSessionId, isProcessing, removeMessage, clearMessages } = useChatStore()
    const messagesEndRef = useRef<HTMLDivElement>(null)

    const activeSession = sessions.find(s => s.id === activeSessionId)
    const messages = activeSession?.messages || []

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, isProcessing])

    const handleClear = () => {
        if (window.confirm('Clear all messages? This cannot be undone.')) {
            clearMessages()
            onClearChat?.()
        }
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header with clear button */}
            {messages.length > 0 && (
                <div className="flex justify-end px-4 py-2 border-b border-white/5">
                    <button
                        onClick={handleClear}
                        className="flex items-center gap-1.5 text-xs text-white/40 hover:text-red-400 
                       px-2 py-1 rounded hover:bg-red-500/10 transition-all"
                    >
                        <Trash2 size={14} />
                        Clear Chat
                    </button>
                </div>
            )}

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 ? (
                    // Welcome message
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-[#00a896] rounded-xl flex items-center justify-center shadow-lg shadow-[#00a896]/20 flex-shrink-0">
                            <Bot size={24} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold mb-1">AI Worker</h1>
                            <p className="text-white/60">
                                I'm ready to help. Press the mic button to speak or type your message below.
                            </p>
                            <p className="text-white/40 mt-2 text-sm">
                                Connect MCP servers in the Connections tab to enable tool usage.
                            </p>
                        </div>
                    </div>
                ) : (
                    // Messages list
                    messages.map((message) => (
                        <MessageBubble
                            key={message.id}
                            message={message}
                            onDelete={removeMessage}
                        />
                    ))
                )}

                {/* Processing indicator */}
                {isProcessing && (
                    <div className="flex gap-3 justify-start">
                        <div className="w-8 h-8 rounded-lg bg-[#00a896] flex items-center justify-center flex-shrink-0">
                            <Bot size={18} className="text-white" />
                        </div>
                        <div className="bg-[#1a1d23] border border-white/10 rounded-2xl px-4 py-3">
                            <div className="flex gap-1.5">
                                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Scroll anchor */}
                <div ref={messagesEndRef} />
            </div>
        </div>
    )
}
