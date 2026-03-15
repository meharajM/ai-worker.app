import React from 'react';
import { CheckCircle2, Circle, Clock, Loader2, BrainCircuit } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { AgentStep, AgentPlanData } from '../lib/plan_manager';

interface AgentPlanProps {
  plan: AgentPlanData;
  className?: string;
}

export function AgentPlan({ plan, className = '' }: AgentPlanProps) {
  if (!plan || !plan.steps || plan.steps.length === 0) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: 0.3 }}
      className={`rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border)] overflow-hidden my-2 ${className}`}
    >
      {/* Header */}
      <div className="bg-[var(--color-bg-elevated)] px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
        <BrainCircuit size={16} className="text-[var(--color-accent)]" />
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">Agent Thought Process</span>
      </div>

      {/* Goal */}
      {plan.goal && (
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-tertiary)] mb-1 uppercase tracking-wider font-semibold">Goal</div>
          <div className="text-sm text-[var(--color-text-primary)]">{plan.goal}</div>
        </div>
      )}

      {/* Steps */}
      <div className="p-2 space-y-1">
        <AnimatePresence mode="popLayout">
          {plan.steps.map((step, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05, duration: 0.2 }}
              className={`flex items-start gap-3 p-2 rounded-lg transition-colors ${
                step.status === 'active' ? 'bg-[var(--color-bg-raised)]' : 'hover:bg-[var(--color-bg-raised)]'
              }`}
            >
              {/* Status Icon */}
              <div className="mt-0.5 flex-shrink-0">
                {step.status === 'completed' && <CheckCircle2 size={16} className="text-[var(--color-success)]" />}
                {step.status === 'active' && <Loader2 size={16} className="text-[var(--color-accent)] animate-spin" />}
                {step.status === 'pending' && <Circle size={16} className="text-[var(--color-text-disabled)]" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${
                  step.status === 'completed' ? 'text-[var(--color-text-tertiary)] line-through' : 
                  step.status === 'active' ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-tertiary)]'
                }`}>
                  {step.description}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      step.status === 'active' 
                        ? 'bg-[var(--color-accent-muted)] border-[var(--color-accent)]/30 text-[var(--color-accent)]' 
                        : 'bg-[var(--color-bg-surface)] border-[var(--color-border)] text-[var(--color-text-tertiary)]'
                    }`}>
                    {step.assigned_agent || 'System'}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// Helper to parse plan from tool arguments or message content
export function parseAgentPlan(content: string | any): AgentPlanData | null {
  try {
    // Case 1: Content is already a parsed object (from tool args)
    if (typeof content === 'object' && content !== null) {
      // Robust check for steps array
      if (content.steps && Array.isArray(content.steps)) {
        return {
          goal: content.goal || '',
          steps: content.steps.map((s: any, idx: number) => ({
            id: s.id || idx + 1,
            description: s.description || '', // Ensure string
            status: s.status || 'pending',
            assigned_agent: s.assigned_agent || s.agent || 'System'
          }))
        };
      }
      // Handle Self-Healing Wrapper
      if (content.plan_content) {
        return parseAgentPlan(content.plan_content);
      }
    }

    // Case 2: Content is a string (legacy XML or JSON string)
    if (typeof content === 'string') {
      // Try parsing as JSON first
      try {
        const parsed = JSON.parse(content);
        if (parsed.steps) {
          return parseAgentPlan(parsed);
        }
      } catch (e) {
        // Not JSON
      }
    }

    return null;
  } catch (e) {
    console.error('Failed to parse agent plan:', e);
    return null;
  }
}

