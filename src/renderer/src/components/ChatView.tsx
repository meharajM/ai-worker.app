import React, { useRef, useEffect } from 'react'
import { Trash2, Bot } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { MessageBubble } from './MessageBubble'
import { WorkflowTiles } from './WorkflowTiles'

interface ChatViewProps {
    onClearChat?: () => void
}

export function ChatView({ onClearChat }: ChatViewProps) {
    const { sessions, activeSessionId, isProcessing, processingSessionId, removeMessage, clearMessages } = useChatStore()
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
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
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
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-4 min-w-0">
                {messages.length === 0 ? (
                    // Welcome message
                    <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full pt-12">
                        <div className="flex items-start gap-4">
                            <div className="w-12 h-12 bg-[#00a896] rounded-xl flex items-center justify-center shadow-lg shadow-[#00a896]/20 flex-shrink-0 animate-in zoom-in duration-500">
                                <Bot size={24} className="text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold mb-1 tracking-tight">How can I help you today?</h1>
                                <p className="text-white/60 text-lg">
                                    I'm your autonomous AI worker, ready to handle complex browser and local tasks.
                                </p>
                            </div>
                        </div>

                        {/* Workflow Automation Templates Grid */}
                        <div className="space-y-4">
                            <h2 className="text-sm font-semibold text-white/40 uppercase tracking-widest pl-1">
                                Workflow Templates
                            </h2>
                            <WorkflowTiles />
                        </div>
                    </div>
                ) : (
                    // Messages list
                    messages.map((message, index) => (
                        <MessageBubble
                            key={message.id}
                            message={message}
                            onDelete={removeMessage}
                            isLast={index === messages.length - 1}
                        />
                    ))
                )}

                {/* Processing indicator - Hide if last message is a dynamic status update */}
                {isProcessing && processingSessionId === activeSessionId && !messages[messages.length - 1]?.content.includes('Parallel Execution') && (
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
