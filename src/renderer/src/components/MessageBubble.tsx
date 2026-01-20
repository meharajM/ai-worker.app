import React from 'react'
import { Trash2, Bot, User } from 'lucide-react'
import { Message } from '../stores/chatStore'
import { AgentPlan, parseAgentPlan } from './AgentPlan'

interface MessageBubbleProps {
    message: Message
    onDelete?: (id: string) => void
    isLast?: boolean
}

export function MessageBubble({ message, onDelete, isLast = false }: MessageBubbleProps) {
    const isUser = message.role === 'user'
    const isSystem = message.role === 'system'

    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    // Check for agent plan in tool calls (New Method)
    const planToolCall = message.toolCalls?.find(tc => tc.name === 'create_execution_plan');
    const toolPlanData = planToolCall ? parseAgentPlan(planToolCall.arguments) : null;
    
    const agentPlan = toolPlanData;

    const visibleToolCalls = message.toolCalls?.filter(tc => tc.name !== 'create_execution_plan');

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
            <div className="relative max-w-[80%] min-w-0 overflow-hidden">
                <div
                    className={`rounded-2xl px-4 py-3 ${isUser
                        ? 'bg-[#4fd1c5] text-white'
                        : 'bg-[#1a1d23] border border-white/10 text-white/90'
                        }`}
                >
                    {/* Render Agent Plan if present */}
                    {agentPlan && <AgentPlan plan={agentPlan} />}

                    {/* Render Message Content */}
                    {message.content && (
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    )}

                    {/* Tool calls display - Collapsible */}
                    {/* Tool calls display - Action Steps View */}
                    {visibleToolCalls && visibleToolCalls.length > 0 && (
                        <div className="mt-2 space-y-2">
                             {visibleToolCalls.map((tool) => {
                                // Infer Agent Name
                                let agentName = 'SystemAgent';
                                if (tool.name.startsWith('browser_') || tool.name.startsWith('playwright_')) agentName = 'NavigationAgent';
                                else if (tool.name.startsWith('fs_') || tool.name.startsWith('file_')) agentName = 'FilesystemAgent';
                                else if (tool.name === 'create_execution_plan') agentName = 'PlannerAgent';

                                // Format Description
                                let description = `Executing ${tool.name}`;
                                try {
                                    const args = typeof tool.arguments === 'string' ? JSON.parse(tool.arguments) : tool.arguments;
                                    if (tool.name.includes('navigate') && args.url) description = `Navigating to ${args.url}`;
                                    else if (tool.name.includes('type') && args.text) description = `Typing "${args.text}"`;
                                    else if (tool.name.includes('click') && args.selector) description = `Clicking element ${args.selector}`;
                                    else if (tool.name.includes('search') && args.query) description = `Searching for "${args.query}"`;
                                    else if (tool.name.includes('screenshot')) description = `Taking a screenshot`;
                                } catch (e) { /* ignore parse error */ }

                                return (
                                    <div key={tool.id} className="flex items-start gap-3 p-2 rounded-lg bg-black/20 border border-white/5">
                                        {/* Status Icon - If it has a result, it's done. If isLast and no result (or incomplete), it's active. */}
                                        <div className="mt-0.5 flex-shrink-0">
                                            {tool.result ? (
                                                <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
                                                </div>
                                            ) : (
                                                <div className="w-4 h-4 rounded-full bg-[#4fd1c5]/20 flex items-center justify-center animate-pulse">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-[#4fd1c5]"></div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-white/90 font-medium">
                                                {description}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-[#4fd1c5]/10 border-[#4fd1c5]/30 text-[#4fd1c5]">
                                                    {agentName}
                                                </span>
                                                <span className="text-[10px] text-white/30 font-mono">
                                                    {tool.name}
                                                </span>
                                            </div>
                                            
                                            {/* Optional: Show Result in a tiny collapsed detail if needed, or keep hidden for cleanliness */}
                                        </div>
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


