import { Trash2, Bot, User, History, AlertCircle, CheckCircle2, Circle, ChevronRight } from 'lucide-react'
import { Message, useChatStore, ToolCall } from '../stores/chatStore'
import { AgentPlan, parseAgentPlan } from './AgentPlan'
import { FormattedText } from './FormattedText'
import React from 'react';

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
                    <FormattedText content={message.content} />
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
                        <FormattedText content={message.content} />
                    )}

                    {/* Tool calls display - Grouped Action Steps (Checklist Style) */}
                    {visibleToolCalls && visibleToolCalls.length > 0 && (
                        <div className="mt-3">
                            {(() => {
                                const allDone = visibleToolCalls.every(tc => !!tc.result);
                                const hasFinalContent = message.content && message.content.length > 10;
                                const isProcessing = useChatStore.getState().isProcessing && isLast;
                                const shouldCollapse = allDone && hasFinalContent && !isProcessing;

                                // Group tools by agent
                                const groupedByAgent = visibleToolCalls.reduce((acc, tool) => {
                                    let agentName = 'SystemAgent';
                                    if (tool.name.startsWith('browser_') || tool.name.startsWith('playwright_')) agentName = 'NavigationAgent';
                                    else if (tool.name.startsWith('fs_') || tool.name.startsWith('file_')) agentName = 'FilesystemAgent';
                                    else if (tool.name.startsWith('mcp_')) agentName = 'MCPAgent';
                                    else if (tool.name === 'create_execution_plan') agentName = 'PlannerAgent';
                                    
                                    if (!acc[agentName]) acc[agentName] = [];
                                    acc[agentName].push(tool);
                                    return acc;
                                }, {} as Record<string, ToolCall[]>);

                                const renderContent = () => (
                                    <div className="space-y-4">
                                        {Object.entries(groupedByAgent).map(([agentName, tools]) => {
                                            const completedCount = tools.filter(t => !!t.result).length;
                                            const totalCount = tools.length;
                                            const isAgentDone = completedCount === totalCount;

                                            return (
                                                <div key={agentName} className="space-y-1.5">
                                                    {/* Agent Header with Progress */}
                                                    <div className="flex items-center justify-between px-1">
                                                        <div className="flex items-center gap-2">
                                                            <div className={`w-1.5 h-1.5 rounded-full ${isAgentDone ? 'bg-green-400' : 'bg-[#4fd1c5] animate-pulse'}`} />
                                                            <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">{agentName}</span>
                                                        </div>
                                                        <span className="text-[10px] text-white/30 font-medium">{completedCount}/{totalCount} Done</span>
                                                    </div>

                                                    {/* Steps Checklist */}
                                                    <div className="space-y-1">
                                                        {tools.map((tool) => {
                                                            // Format Description
                                                            let description = `Executing ${tool.name}`;
                                                            try {
                                                                const args = typeof tool.arguments === 'string' ? JSON.parse(tool.arguments) : tool.arguments;
                                                                if (tool.name.includes('navigate') && args.url) description = `Navigating to ${args.url}`;
                                                                else if (tool.name.includes('type') && args.text) description = `Typing "${args.text}"`;
                                                                else if (tool.name.includes('click') && args.selector) description = `Clicking element ${args.selector}`;
                                                                else if (tool.name.includes('search') && args.query) description = `Searching for "${args.query}"`;
                                                                else if (tool.name.includes('screenshot')) description = `Taking a screenshot`;
                                                                else if (tool.name.includes('delegate')) description = `Delegating to sub-task`;
                                                            } catch (e) { /* ignore parse error */ }

                                                            const isError = tool.result?.startsWith('Error:') || 
                                                                           tool.result?.toLowerCase().includes('"iserror":true') ||
                                                                           tool.result?.toLowerCase().includes('"status":"error"');
                                                            const isDone = !!tool.result;

                                                            return (
                                                                <div key={tool.id} className="flex items-start gap-2.5 p-2 rounded-lg bg-black/20 border border-white/5 group/step transition-all hover:bg-black/30">
                                                                    <div className="mt-0.5 flex-shrink-0">
                                                                        {isDone ? (
                                                                            isError ? (
                                                                                <AlertCircle size={14} className="text-orange-400" />
                                                                            ) : (
                                                                                <CheckCircle2 size={14} className="text-green-400" />
                                                                            )
                                                                        ) : (
                                                                            <Circle size={14} className="text-[#4fd1c5] animate-pulse" />
                                                                        )}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className={`text-[12.5px] leading-tight transition-colors ${isDone ? 'text-white/40 line-through decoration-white/20' : 'text-white/90 font-medium'}`}>
                                                                            {description}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );

                                if (shouldCollapse) {
                                    return (
                                        <details className="group">
                                            <summary className="text-[10px] text-white/30 cursor-pointer hover:text-white/60 transition-colors list-none flex items-center gap-1.5 py-1">
                                                <History size={11} className="group-open:rotate-180 transition-transform" />
                                                <span>{visibleToolCalls.length} Action Steps completed by {Object.keys(groupedByAgent).length} Agents</span>
                                            </summary>
                                            <div className="mt-3 pl-2 border-l border-white/5">
                                                {renderContent()}
                                            </div>
                                        </details>
                                    );
                                }

                                return renderContent();
                            })()}
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


