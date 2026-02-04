import { Trash2, Bot, User, History, AlertCircle, CheckCircle2, Circle, ChevronRight, Save } from 'lucide-react'
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

    // Filter out internal tools from the standard checklist view
    const visibleToolCalls = message.toolCalls?.filter(tc =>
        tc.name !== 'create_execution_plan' &&
        tc.name !== 'update_progress_summary'
    );

    // Check for progress summary update
    const progressToolCall = message.toolCalls?.find(tc => tc.name === 'update_progress_summary');

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

                    {/* Render Thinking Block (Devin/o1 Style) */}
                    {(() => {
                        if (!message.content) return null;

                        // Check for complete block
                        let thinkMatch = message.content.match(/<think>([\s\S]*?)<\/think>/);
                        let thinking = thinkMatch ? thinkMatch[1].trim() : null;
                        let isComplete = !!thinkMatch;

                        // Check for incomplete/streaming block (only if at start)
                        // This handles the "Thinking..." state while the model is outputting the thoughts
                        if (!thinking && message.content.trim().startsWith('<think>')) {
                            thinking = message.content.replace('<think>', '').trim();
                            isComplete = false;
                        }

                        // If we have thinking content, render it
                        if (thinking) {
                            return (
                                <details className="mb-3 group" open={!isComplete}>
                                    <summary className="text-[10px] text-[#00a896] cursor-pointer hover:text-[#4fd1c5] transition-colors list-none flex items-center gap-1.5 font-medium select-none">
                                        <div className={`w-1 h-3 rounded-full ${isComplete ? 'bg-[#00a896]' : 'bg-yellow-400 animate-pulse'}`} />
                                        <span>{isComplete ? 'Thinking Process' : 'Thinking...'}</span>
                                        <ChevronRight size={10} className="group-open:rotate-90 transition-transform text-white/20" />
                                    </summary>
                                    <div className="mt-2 text-[11px] leading-relaxed text-white/60 bg-black/20 rounded-md p-3 border border-white/5 font-mono shadow-inner whitespace-pre-wrap">
                                        {thinking}
                                    </div>
                                </details>
                            );
                        }
                        return null;
                    })()}

                    {/* Render Message Content (cleaned of thinking and unwrapped reasoning) */}
                    {message.content && (() => {
                        // Step 1: Remove properly wrapped thinking
                        let cleanedContent = message.content
                            .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
                            .trim();

                        // Step 2: Detect leaked reasoning patterns (outside <think> tags)
                        const leakedReasoningPatterns = [
                            /^,?\s*(?:the user|let me|since this|looking at|wait,?\s+the|I (?:need|should|will|don't|can))/i,
                            /^(?:Therefore|Thus|So),?\s+(?:the\s+)?(?:response|answer)\s+should/i,
                            /^(?:Yep|No need|Okay so)/i,
                            /^(?:Hmm|Well|Alright),?\s+(?:the user|let me|I should)/i,
                        ];

                        const hasLeakedReasoning = leakedReasoningPatterns.some(p => p.test(cleanedContent));

                        if (hasLeakedReasoning) {
                            // Try to extract the actual response from the end
                            // Look for quoted content or content after common conclusion markers
                            const extractPatterns = [
                                /["""]([^"""]+)["""]\.?\s*$/,  // Quoted response at end
                                /(?:should be|responds with|the answer is)[:\s]+[""']?([^""'\n]+)[""']?\s*$/i,
                                /(?:So|Therefore)[,:\s]+([A-Z][^.!?]*[.!?])\s*$/,  // Sentence after So/Therefore
                            ];

                            for (const pattern of extractPatterns) {
                                const match = cleanedContent.match(pattern);
                                if (match && match[1] && match[1].trim().length > 3) {
                                    cleanedContent = match[1].trim();
                                    break;
                                }
                            }

                            // If still starts with meta, try last sentence as fallback
                            if (leakedReasoningPatterns.some(p => p.test(cleanedContent))) {
                                const sentences = cleanedContent.match(/[^.!?]+[.!?]+/g) || [];
                                const lastSentence = sentences[sentences.length - 1]?.trim();
                                if (lastSentence && !leakedReasoningPatterns.some(p => p.test(lastSentence)) && lastSentence.length > 10) {
                                    cleanedContent = lastSentence;
                                } else {
                                    // Can't salvage - show thinking indicator
                                    return <div className="text-white/40 text-xs italic">Thinking...</div>;
                                }
                            }
                        }

                        // Step 3: Strip leading comma (common artifact)
                        cleanedContent = cleanedContent.replace(/^,\s*/, '');

                        // Step 4: Hide if too short (likely broken)
                        if (cleanedContent.length < 5) {
                            return null;
                        }

                        return <FormattedText content={cleanedContent} />;
                    })()}

                    {/* Progress checkpoint badge (mixed content) */}
                    {!isUser && progressToolCall && (message.content || (visibleToolCalls && visibleToolCalls.length > 0)) && (
                        <div className="flex items-center gap-1.5 text-white/30 text-[10px] font-medium mt-3 px-1 border-t border-white/5 pt-2">
                            <Save size={10} />
                            <span>Progress checkpoint saved</span>
                        </div>
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
                                                            let description = `Using ${tool.name}`;
                                                            try {
                                                                const args = typeof tool.arguments === 'string' ? JSON.parse(tool.arguments) : tool.arguments;
                                                                if (tool.name.includes('navigate') && args.url) description = `Visiting ${new URL(args.url).hostname}`;
                                                                else if (tool.name.includes('type') && args.text) description = `Typing "${args.text}"`;
                                                                else if (tool.name.includes('click')) description = `Clicking item`;
                                                                else if (tool.name.includes('search') && args.query) description = `Searching for "${args.query}"`;
                                                                else if (tool.name.includes('screenshot')) description = `Capturing page view`;
                                                                else if (tool.name.includes('delegate')) description = `Asking specialist agent`;
                                                                else if (tool.name.includes('plan')) description = `Creating work plan`;
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

                    {/* Action Buttons (for handoff confirmation) */}
                    {message.actions && message.actions.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            {message.actions.map((action, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        // Dispatch custom event to trigger handleSubmit in App.tsx
                                        const content = action.type === 'continue' ? 'continue' : 'stop';
                                        window.dispatchEvent(new CustomEvent('agent-action', {
                                            detail: { type: action.type, content }
                                        }));
                                    }}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${action.type === 'continue'
                                        ? 'bg-[#00a896] hover:bg-[#00a896]/80 text-white'
                                        : 'bg-white/10 hover:bg-white/20 text-white/70'
                                        }`}
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


