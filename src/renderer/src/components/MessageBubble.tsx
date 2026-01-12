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
                    {/* Content or Loading Indicator */}
                    {message.content ? (
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    ) : (
                        (!message.toolCalls || message.toolCalls.length === 0) && (
                            <div className="flex gap-1.5 py-1">
                                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </div>
                        )
                    )}

                    {/* Tool calls display - Enhanced UI */}
                    {message.toolCalls && message.toolCalls.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-white/10 space-y-2">
                            {message.toolCalls.map((tool) => {
                                // Map tool names to friendly descriptions
                                const getFriendlyTitle = (name: string) => {
                                    const n = name.toLowerCase();
                                    if (n.includes('navigate') || n.includes('goto')) return 'Navigating to website...';
                                    if (n.includes('click')) return 'Clicking element...';
                                    if (n.includes('type') || n.includes('fill')) return 'Typing input...';
                                    if (n.includes('search')) return 'Searching...';
                                    if (n.includes('screenshot')) return 'Taking screenshot...';
                                    if (n.includes('read')) return 'Reading file...';
                                    if (n.includes('write')) return 'Writing file...';
                                    if (n.includes('list')) return 'Listing files...';
                                    if (n.includes('sequential')) return 'Thinking...';
                                    return `Executing ${name}...`;
                                };
                                
                                return (
                                    <div key={tool.id} className="text-xs bg-black/20 rounded-lg overflow-hidden border border-white/5">
                                        <div className="px-3 py-2 flex items-center gap-2 text-white/70">
                                            <span className="text-emerald-400">⚡</span>
                                            <span className="font-medium">{getFriendlyTitle(tool.name)}</span>
                                        </div>
                                        
                                        {/* Details (collapsed by default logic could be added here, currently just compact) */}
                                        <div className="px-3 py-2 bg-black/10 text-white/40 font-mono border-t border-white/5 text-[10px] break-all">
                                            {JSON.stringify(tool.arguments).substring(0, 100)}
                                            {JSON.stringify(tool.arguments).length > 100 && '...'}
                                        </div>

                                        {tool.result && (
                                            <div className="px-3 py-2 bg-emerald-900/10 text-emerald-200/60 font-mono border-t border-white/5 text-[10px] max-h-20 overflow-y-auto">
                                                {tool.result.startsWith('{') ? '✓ Task completed' : tool.result}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
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
