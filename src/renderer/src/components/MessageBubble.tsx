import {  Bot, User, History, AlertCircle, CheckCircle2, Circle, ChevronRight, Save, Copy, RotateCcw, File, FileAudio, FileImage, FileText, FileSpreadsheet } from 'lucide-react'
import { Message, useChatStore, ToolCall } from '../stores/chatStore'
import { motion } from 'framer-motion';
import { AgentPlan, parseAgentPlan } from './AgentPlan'
import { FormattedText } from './FormattedText'
import { filterThinkBlocks, hasLeakedReasoning } from '../lib/thinkBlockFilter'
import { cn } from '../lib/utils'
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

    // Helper to get icon for file type
    const getFileIcon = (type: string, name: string) => {
        const lowerType = type.toLowerCase();
        const lowerName = name.toLowerCase();
        
        if (lowerType.includes('audio') || lowerName.endsWith('.mp3') || lowerName.endsWith('.wav') || lowerName.endsWith('.m4a')) 
            return <FileAudio size={14} className="text-blue-400" />;
        if (lowerType.includes('image') || lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) 
            return <FileImage size={14} className="text-purple-400" />;
        if (lowerType.includes('sheet') || lowerType.includes('excel') || lowerType.includes('csv') || lowerName.endsWith('.csv') || lowerName.endsWith('.xlsx'))
             return <FileSpreadsheet size={14} className="text-green-400" />;
        if (lowerType.includes('text') || lowerType.includes('pdf') || lowerName.endsWith('.txt') || lowerName.endsWith('.md') || lowerName.endsWith('.pdf'))
            return <FileText size={14} className="text-orange-400" />;
            
        return <File size={14} className="text-gray-400" />;
    }

    // Check for agent plan in tool calls (New Method)
    const planToolCall = message.toolCalls?.find(tc => tc.name === 'create_execution_plan');
    const toolPlanData = planToolCall ? parseAgentPlan(planToolCall.arguments) : null;

    const agentPlan = toolPlanData;

    // Filter out internal tools from the standard checklist view
    const visibleToolCalls = message.toolCalls?.filter(tc =>
        tc.name !== 'create_execution_plan' &&
        tc.name !== 'update_progress_summary' &&
        tc.name !== 'memory_update_entity'
    );

    // Check for progress summary update (Legacy or Memory)
    const progressToolCall = message.toolCalls?.find(tc =>
        tc.name === 'update_progress_summary' ||
        tc.name === 'memory_update_entity'
    );

    // SPECIAL CASE: If message is ONLY a progress update (no content, no other tools), render minimal badge
    if (!isUser && !message.content && message.toolCalls?.length === 1 && progressToolCall) {
        return (
            <div className="flex justify-center my-2 animate-pulse">
                <div className="flex items-center gap-1.5 text-white/20 text-[10px] font-medium px-2 py-1 rounded-full bg-white/5">
                    <Save size={10} />
                    <span>Saving progress checkpoint...</span>
                </div>
            </div>
        );
    }

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
        <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={cn(
                "flex gap-3 group",
                isUser ? "justify-end" : "justify-start"
            )}
        >
            {/* Avatar for assistant */}
            {!isUser && (
                <div className="w-8 h-8 rounded-lg bg-[#00a896] flex items-center justify-center flex-shrink-0">
                    <Bot size={18} className="text-white" />
                </div>
            )}

            {/* Message Group Container */}
            <div className={cn(
                "relative max-w-[80%] min-w-0 flex flex-col gap-1.5",
                isUser ? "items-end" : "items-start"
            )}>
                
                {/* 1. Attachments (Rendered OUTSIDE the bubble for "Gemini-style" look) */}
                {message.attachments && message.attachments.length > 0 && (
                    <div className={cn(
                        "flex flex-wrap gap-2 mb-1",
                        isUser ? "justify-end" : "justify-start"
                    )}>
                        {message.attachments.map((att, idx) => (
                            <div 
                                key={idx} 
                                className="group/card flex items-center gap-3 bg-[#1e1e24] border border-white/10 rounded-2xl p-3 pr-5 transition-all hover:bg-[#25252b] hover:border-white/20 shadow-sm"
                                title={att.path}
                            >
                                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/5">
                                    {React.cloneElement(getFileIcon(att.type, att.name) as React.ReactElement, { size: 20 })}
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[13px] font-medium text-white/90 truncate max-w-[200px] leading-tight">
                                        {att.name}
                                    </span>
                                    <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold mt-0.5">
                                        {att.type.split('/')[1]?.toUpperCase() || att.name.split('.').pop()?.toUpperCase() || 'FILE'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 2. Main Message Bubble */}
                <div
                    className={cn(
                        "rounded-2xl px-4 py-3 shadow-sm",
                        isUser 
                            ? "bg-[#4fd1c5] text-white" 
                            : "bg-[#1a1d23] border border-white/10 text-white/90"
                    )}
                >
                    {/* Render Agent Plan if present */}
                    {agentPlan && <AgentPlan plan={agentPlan} />}

                    {/* Render Thinking Block (Universal - works with all LLMs) */}
                    {(() => {
                        if (!message.content) return null;

                        const { thinking, isComplete } = filterThinkBlocks(message.content);

                        // If we have thinking content, render it with animation
                        if (thinking) {
                            return (
                                <div className="mb-3">
                                    <details className="group" open={!isComplete}>
                                        <summary className="text-[10px] text-[#00a896] cursor-pointer hover:text-[#4fd1c5] transition-colors list-none flex items-center gap-1.5 font-medium select-none">
                                            <div className={`w-1 h-3 rounded-full ${isComplete ? 'bg-[#00a896]' : 'bg-yellow-400 animate-pulse'}`} />
                                            <span>{isComplete ? 'Thinking Process' : 'Thinking...'}</span>
                                            <ChevronRight size={10} className="group-open:rotate-90 transition-transform text-white/20" />
                                        </summary>
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.3, ease: 'easeOut' }}
                                            className="overflow-hidden"
                                        >
                                            <div className="mt-2 text-[11px] leading-relaxed text-white/60 bg-black/20 rounded-md p-3 border border-white/5 font-mono shadow-inner whitespace-pre-wrap">
                                                {thinking}
                                            </div>
                                        </motion.div>
                                    </details>
                                </div>
                            );
                        }
                        return null;
                    })()}

                    {/* Render Message Content */}
                    {message.content && (() => {
                        const { cleanedContent: initialCleaned } = filterThinkBlocks(message.content);
                        let cleanedContent = initialCleaned;
                        
                        // Clean up leaked reasoning and artifacts
                        const hasLeak = hasLeakedReasoning(cleanedContent);
                        if (hasLeak) {
                            const sentences = cleanedContent.match(/[^.!?]+[.!?]+/g) || [];
                            const lastSentence = sentences[sentences.length - 1]?.trim();
                            if (lastSentence && !hasLeakedReasoning(lastSentence) && lastSentence.length > 10) {
                                cleanedContent = lastSentence;
                            } else {
                                return <div className="text-white/40 text-xs italic">Thinking...</div>;
                            }
                        }
                        cleanedContent = cleanedContent.replace(/^,\s*/, '');

                        if (cleanedContent.length < 5) return null;

                        return (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, ease: 'easeOut' }}
                            >
                                <FormattedText content={cleanedContent} />
                            </motion.div>
                        );
                    })()}

                    {/* Progress checkpoint badge */}
                    {!isUser && progressToolCall && (message.content || (visibleToolCalls && visibleToolCalls.length > 0)) && (
                        <div className="flex items-center gap-1.5 text-white/30 text-[10px] font-medium mt-3 px-1 border-t border-white/5 pt-2">
                            <Save size={10} />
                            <span>Progress checkpoint saved</span>
                        </div>
                    )}

                    {/* Tool calls display */}
                    {visibleToolCalls && visibleToolCalls.length > 0 && (
                        <div className="mt-3">
                            {/* ... Tool Rendering Logic (Simplified for readability in diff, kept same logic) ... */}
                            {(() => {
                                // ... helper logic ...
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

                                return (
                                    <div className="space-y-4">
                                        {Object.entries(groupedByAgent).map(([agentName, tools]) => (
                                            <div key={agentName} className="space-y-1.5">
                                                <div className="flex items-center justify-between px-1">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-1.5 h-1.5 rounded-full ${tools.every(t=>!!t.result) ? 'bg-green-400' : 'bg-[#4fd1c5] animate-pulse'}`} />
                                                        <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">{agentName}</span>
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    {tools.map((tool) => {
                                                        const isDone = !!tool.result;
                                                        return (
                                                            <div key={tool.id} className="flex items-start gap-2.5 p-2 rounded-lg bg-black/20 border border-white/5">
                                                                <div className="mt-0.5 flex-shrink-0">
                                                                     {isDone ? <CheckCircle2 size={14} className="text-green-400" /> : <Circle size={14} className="text-[#4fd1c5] animate-pulse" />}
                                                                </div>
                                                                <div className="text-[12.5px] leading-tight text-white/90 font-medium">
                                                                     {tool.name}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* Action Buttons */}
                    {message.actions && message.actions.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            {message.actions.map((action, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        const content = action.type === 'continue' ? 'continue' : 'stop';
                                        window.dispatchEvent(new CustomEvent('agent-action', { detail: { type: action.type, content } }));
                                    }}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${action.type === 'continue' ? 'bg-[#00a896] hover:bg-[#00a896]/80 text-white' : 'bg-white/10 hover:bg-white/20 text-white/70'}`}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}
                    
                     <p className={`text-[10px] mt-1 ${isUser ? 'text-white/60' : 'text-white/30'}`}>
                        {formatTime(message.timestamp)}
                    </p>
                </div>

                {/* Action Footer */}
                {!isUser && !isSystem && (
                    <div className="flex items-center gap-2 mt-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         <CopyButton content={message.content || ''} />
                        <button
                            onClick={() => window.dispatchEvent(new CustomEvent('agent-action', { detail: { type: 'regenerate', messageId: message.id } }))}
                            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                            title="Regenerate"
                        >
                            <RotateCcw size={16} />
                        </button>
                    </div>
                )}
            </div>

            {/* Avatar for user */}
            {isUser && (
                <div className="w-8 h-8 rounded-lg bg-[#4fd1c5] flex items-center justify-center flex-shrink-0">
                    <User size={18} className="text-white" />
                </div>
            )}
        </motion.div>
    )
}

function CopyButton({ content }: { content: string }) {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
        } catch (err) {
            console.warn('Clipboard write failed, trying fallback:', err);
            // Fallback
            const textArea = document.createElement("textarea");
            textArea.value = content;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                setCopied(true);
            } catch (err) {
                console.error('Fallback copy failed', err);
            }
            document.body.removeChild(textArea);
        }

        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            title="Copy"
        >
            {copied ? <CheckCircle2 size={16} className="text-green-400" /> : <Copy size={16} />}
        </button>
    );
}


