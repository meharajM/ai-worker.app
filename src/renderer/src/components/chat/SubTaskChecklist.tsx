/**
 * SubTaskChecklist.tsx — Clean sub-task view for prod display mode.
 *
 * Renders ExecutionPlan steps as an animated checkbox list.
 * When all steps are completed, the list auto-collapses into a compact
 * "All tasks done" chip that users can expand to review.
 *
 * Source of truth: session.plan (ExecutionPlan) from create_execution_plan tool.
 */

import React, { useState, useEffect } from 'react'
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ChevronDown,
  Sparkles,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ExecutionPlan } from '../../lib/agent-protocol'
import { cn } from '../../lib/utils'

interface SubTaskChecklistProps {
  plan: ExecutionPlan
  className?: string
}

/**
 * Renders a single step row with status icon, description, and status badge.
 */
function StepRow({ step }: { step: ExecutionPlan['steps'][number] }) {
  const statusConfig = {
    completed: {
      icon: <CheckCircle2 size={16} className="text-[var(--color-success)]" />,
      badge: 'Done',
      badgeClass: 'bg-[var(--color-success)]/15 text-[var(--color-success)] border-[var(--color-success)]/20',
      textClass: 'text-[var(--color-text-muted)] line-through',
    },
    active: {
      icon: <Loader2 size={16} className="text-[var(--color-primary)] animate-spin" />,
      badge: 'In Progress',
      badgeClass: 'bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-[var(--color-primary)]/20',
      textClass: 'text-[var(--color-text-primary)] font-medium',
    },
    pending: {
      icon: <Circle size={16} className="text-[var(--color-text-dim)]" />,
      badge: null,
      badgeClass: '',
      textClass: 'text-[var(--color-text-dim)]',
    },
    failed: {
      icon: <XCircle size={16} className="text-[var(--color-error)]" />,
      badge: 'Failed',
      badgeClass: 'bg-[var(--color-error)]/15 text-[var(--color-error)] border-[var(--color-error)]/20',
      textClass: 'text-[var(--color-error)]',
    },
  }

  const config = statusConfig[step.status] || statusConfig.pending

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
        step.status === 'active' && 'bg-[var(--color-primary)]/5'
      )}
    >
      {/* Status icon */}
      <div className="flex-shrink-0">{config.icon}</div>

      {/* Description */}
      <span className={cn('flex-1 text-[13px] leading-snug', config.textClass)}>
        {step.description}
      </span>

      {/* Status badge */}
      {config.badge && (
        <span
          className={cn(
            'text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0',
            config.badgeClass
          )}
        >
          {config.badge}
        </span>
      )}
    </motion.div>
  )
}

export function SubTaskChecklist({ plan, className = '' }: SubTaskChecklistProps) {
  const steps = plan?.steps || []
  
  const allCompleted = steps.length > 0 && steps.every((s) => s.status === 'completed')
  const completedCount = steps.filter((s) => s.status === 'completed').length
  const hasFailure = steps.some((s) => s.status === 'failed')
  const hasActive = steps.some((s) => s.status === 'active')
  const isTerminal = steps.length > 0 && !hasActive && steps.every((s) => s.status === 'completed' || s.status === 'failed')
  const completedWithIssues = isTerminal && hasFailure && completedCount > 0

  // Auto-collapse when all steps complete
  const [expanded, setExpanded] = useState(!allCompleted)

  // If the plan transitions from incomplete → all complete, collapse
  useEffect(() => {
    if (allCompleted) {
      setExpanded(false)
    } else {
      setExpanded(true)
    }
  }, [allCompleted])

  if (steps.length === 0) return null

  return (
    <div
      className={cn(
        'rounded-xl border backdrop-blur-sm transition-all duration-500 shadow-sm overflow-hidden',
        allCompleted
          ? 'bg-[var(--color-success)]/5 border-[var(--color-success)]/30'
          : hasFailure
            ? 'bg-[var(--color-error)]/5 border-[var(--color-error)]/30'
            : 'bg-[var(--color-surface)]/80 border-[var(--color-border)] shadow-sm',
        className
      )}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-all"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-5 h-5 rounded-full overflow-hidden">
            {allCompleted ? (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 12 }}
              >
                <Sparkles size={16} className="text-[var(--color-success)]" />
              </motion.div>
            ) : completedWithIssues ? (
              <Sparkles size={16} className="text-[var(--color-primary)]" />
            ) : hasFailure ? (
              <XCircle size={16} className="text-[var(--color-error)]" />
            ) : (
              <Loader2 size={16} className="text-[var(--color-primary)] animate-spin" />
            )}
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-[var(--color-text-primary)]">
            {allCompleted
              ? 'All tasks completed'
              : completedWithIssues
                ? `Completed with some issues (${completedCount}/${plan.steps.length})`
              : hasFailure
                ? 'Execution failed'
                : `Working... ${completedCount}/${plan.steps.length}`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Mini progress indicator */}
          {!allCompleted && (
            <div className="flex gap-0.5">
              {plan.steps.map((step, i) => (
                <div
                  key={i}
                  className={cn(
                    'w-1.5 h-1.5 rounded-full transition-colors',
                    step.status === 'completed' && 'bg-[var(--color-success)]',
                    step.status === 'active' && 'bg-[var(--color-primary)] animate-pulse',
                    step.status === 'pending' && 'bg-[var(--color-text-dim)]/30',
                    step.status === 'failed' && 'bg-[var(--color-error)]'
                  )}
                />
              ))}
            </div>
          )}

          <ChevronDown
            size={14}
            className={cn(
              'text-[var(--color-text-dim)] transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </div>
      </button>

      {/* Expandable step list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-2 pb-2 space-y-0.5 border-t border-[var(--color-border)]">
              {/* Goal */}
              {plan.goal && (
                <div className="px-3 py-2 text-[11px] text-[var(--color-text-muted)] italic">
                  {plan.goal}
                </div>
              )}

              {/* Step rows */}
              {plan.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
