import React from 'react'
import { Bot } from 'lucide-react'
import { motion } from 'framer-motion'
import { ChatSession } from '../../stores/chatStore'
import { AgentPlan } from '../AgentPlan'
import { MessageAvatar } from './MessageAvatar'

interface ProgressBannerProps {
  /** The active chat session (for progress, ETA, plan) */
  session: ChatSession
}

function formatETA(etaSeconds?: number): string | null {
  if (etaSeconds === undefined || etaSeconds < 0) return null
  if (etaSeconds < 60) return '< 1m remaining'
  const m = Math.floor(etaSeconds / 60)
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `~${h}h ${m % 60}m remaining`
  }
  return `~${m}m remaining`
}

/**
 * Task progress bar + plan display shown during active agent work.
 * Extracted from ChatView for independent styling and experiment control.
 */
export function ProgressBanner({ session }: ProgressBannerProps) {
  if (
    session.progress === undefined ||
    session.progress <= 0 ||
    session.progress >= 100
  ) {
    return null
  }

  return (
    <div className="flex gap-3 justify-start max-w-3xl mx-auto w-full">
      <MessageAvatar isUser={false} />
      <div className="flex-1 bg-[var(--color-card-dark)] border border-[var(--color-border)] rounded-2xl px-4 py-3 shadow-sm text-[var(--color-text-primary)]">
        <div className="mb-3 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1.5">
              Task Progress
              {session.eta !== undefined && (
                <span className="text-[var(--color-accent)] normal-case tracking-normal">
                  ({formatETA(session.eta)})
                </span>
              )}
            </span>
            <span>{session.progress}%</span>
          </div>
          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${session.progress}%` }}
              className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-primary)] relative"
            >
              <div className="absolute inset-0 bg-white/20 animate-pulse" />
            </motion.div>
          </div>
        </div>
        {session.plan && <AgentPlan plan={session.plan} />}
      </div>
    </div>
  )
}
