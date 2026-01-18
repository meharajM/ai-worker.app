import React, { useState, useEffect, useCallback } from 'react';
import { Check, X, Clock, Zap, Cloud, ChevronDown, ChevronRight, Shield } from 'lucide-react';
import type { PlanningResponse } from '../types/orchestrator';

interface PlanCardProps {
    plan: PlanningResponse;
    onApprove: () => void;
    onReject: () => void;
    autoApproving?: boolean;
}

export function PlanCard({ plan, onApprove, onReject, autoApproving = false }: PlanCardProps) {
    const [countdown, setCountdown] = useState(plan.autoApproveTimeout || 0);
    const [isExpanded, setIsExpanded] = useState(false);

    // Memoize onApprove to avoid stale closure issues
    const handleApprove = useCallback(() => {
        onApprove();
    }, [onApprove]);

    useEffect(() => {
        if (!autoApproving || !plan.autoApproveTimeout || plan.autoApproveTimeout <= 0) return;

        // Reset countdown when plan changes
        setCountdown(plan.autoApproveTimeout);

        const timer = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    // Use setTimeout to avoid calling during render
                    setTimeout(() => handleApprove(), 0);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [autoApproving, plan.autoApproveTimeout, handleApprove]);

    const complexityConfig = {
        simple: {
            color: 'text-green-400',
            bgGradient: 'from-green-500 to-emerald-600',
            label: 'Simple',
            Icon: Zap,
        },
        moderate: {
            color: 'text-yellow-400',
            bgGradient: 'from-yellow-500 to-orange-500',
            label: 'Moderate',
            Icon: Clock,
        },
        complex: {
            color: 'text-purple-400',
            bgGradient: 'from-purple-500 to-pink-500',
            label: 'Complex',
            Icon: Cloud,
        },
    };

    const config = complexityConfig[plan.complexity];
    const ComplexityIcon = config.Icon;

    return (
        <div className="bg-gradient-to-br from-[#1a1d23] to-[#252930] border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div
                        className={`w-10 h-10 rounded-xl bg-gradient-to-br ${config.bgGradient} flex items-center justify-center shadow-lg`}
                    >
                        <ComplexityIcon size={20} className="text-white" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">Here's my plan</h3>
                        <p className={`text-sm ${config.color} flex items-center gap-1.5 mt-0.5`}>
                            <span>{config.label}</span> task
                            {plan.recommendedProvider === 'cloud' && (
                                <span className="text-white/40">• Cloud AI</span>
                            )}
                        </p>
                    </div>
                </div>

                {autoApproving && countdown > 0 && (
                    <div className="text-sm text-white/40 flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg">
                        <Clock size={14} />
                        {countdown}s
                    </div>
                )}
            </div>

            {/* Intent */}
            <div className="bg-white/5 rounded-xl p-4">
                <p className="text-white/80 italic">"{plan.intent}"</p>
            </div>

            {/* Steps */}
            {plan.plan.length > 0 && (
                <div className="space-y-2">
                    <button
                        className="flex items-center justify-between w-full cursor-pointer text-sm text-white/60 hover:text-white/80 transition-colors"
                        onClick={() => setIsExpanded(!isExpanded)}
                    >
                        <span className="font-medium">
                            Steps ({plan.plan.length})
                        </span>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>

                    {(isExpanded || plan.plan.length <= 3) && (
                        <div className="space-y-2 mt-2">
                            {plan.plan.map((step) => (
                                <div
                                    key={step.stepNumber}
                                    className="flex gap-3 items-start bg-white/5 rounded-lg p-3"
                                >
                                    <div className="w-6 h-6 rounded-full bg-[#00a896] flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                                        {step.stepNumber}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-white/90">{step.description}</p>
                                        {step.toolName && (
                                            <p className="text-xs text-white/40 mt-1">
                                                Tool: {step.toolName}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
                <button
                    onClick={onApprove}
                    className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98]"
                >
                    <Check size={18} />
                    {countdown > 0 ? `Go (${countdown}s)` : 'Go'}
                </button>

                <button
                    onClick={onReject}
                    className="px-4 py-3 rounded-xl border border-white/10 hover:border-red-400/50 hover:bg-red-500/10 text-white/60 hover:text-red-400 transition-all flex items-center gap-2"
                    title="Cancel"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Privacy indicator */}
            {plan.recommendedProvider === 'local' && (
                <div className="text-xs text-white/30 text-center flex items-center justify-center gap-1.5">
                    <Shield size={12} />
                    Runs locally (private)
                </div>
            )}

            {plan.recommendedProvider === 'cloud' && (
                <div className="text-xs text-white/30 text-center flex items-center justify-center gap-1.5">
                    <Cloud size={12} />
                    Uses cloud AI for best results
                </div>
            )}
        </div>
    );
}
