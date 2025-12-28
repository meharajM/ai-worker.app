import React from 'react'
import { Trash2, Bot, User } from 'lucide-react'
import { Message } from '../stores/chatStore'

interface MessageBubbleProps {
    message: Message
    onDelete?: (id: string) => void
}

export function MessageBubble({ message, onDelete }: MessageBubbleProps) {
    const isUser = message.role === 'user'
    const isSystem = message.role === 'system'

    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    if (isSystem) {
        return (
            <div className="flex justify-center my-2">
                <div className="bg-white/5 text-white/40 text-xs px-3 py-1 rounded-full">
                    {message.content}
                </div>
            </div>
        )
    }

    return (
        <div className={`flex gap-3 group ${isUser ? 'justify-end' : 'justify-start'}`}>
            {/* Avatar for assistant */}
            {!isUser && (
                <div className="w-8 h-8 rounded-lg bg-[#00a896] flex items-center justify-center flex-shrink-0">
                    <Bot size={18} className="text-white" />
                </div>
            )}

            {/* Message bubble */}
            <div className="relative max-w-[70%]">
                <div
                    className={`rounded-2xl px-4 py-3 ${isUser
                            ? 'bg-[#4fd1c5] text-white'
                            : 'bg-[#1a1d23] border border-white/10 text-white/90'
                        }`}
                >
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>

                    {/* Tool calls display */}
                    {message.toolCalls && message.toolCalls.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/10">
                            {message.toolCalls.map((tool) => (
                                <div key={tool.id} className="text-xs text-white/50">
                                    <span className="font-mono">🔧 {tool.name}</span>
                                    {tool.result && (
                                        <div className="mt-1 p-2 bg-black/20 rounded text-white/40">
                                            {tool.result}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <p className={`text-[10px] mt-1 ${isUser ? 'text-white/60' : 'text-white/30'}`}>
                        {formatTime(message.timestamp)}
                    </p>
                </div>

                {/* Delete button on hover */}
                {onDelete && (
                    <button
                        onClick={() => onDelete(message.id)}
                        className="absolute -right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 
                       p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                        title="Delete message"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>

            {/* Avatar for user */}
            {isUser && (
                <div className="w-8 h-8 rounded-lg bg-[#4fd1c5] flex items-center justify-center flex-shrink-0">
                    <User size={18} className="text-white" />
                </div>
            )}
        </div>
    )
}
