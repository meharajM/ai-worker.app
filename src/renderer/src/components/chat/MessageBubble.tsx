/**
 * MessageBubble.tsx — Slim orchestrator for chat message rendering.
 *
 * Supports two display modes:
 *  - Dev:  shows everything (thinking, tool calls, checkpoints, actions)
 *  - Prod: hides dev internals; sub-tasks are shown via SubTaskChecklist
 *          in ProgressBanner at the session level, not per-message.
 */

import React from 'react'
import { Save } from 'lucide-react'
import { motion } from 'framer-motion'
import { Message } from '../../stores/chatStore'
import { FormattedText } from '../FormattedText'
import { cn } from '../../lib/utils'
import { useDisplayMode } from '../../hooks/useDisplayMode'

import { MessageAvatar } from './MessageAvatar'
import { MessageAttachments } from './MessageAttachments'
import { ThinkingBlock } from './ThinkingBlock'
import { MessageContent } from './MessageContent'
import { ToolCallList } from './ToolCallList'
import { MessageActions } from './MessageActions'
import { MessageTimestamp } from './MessageTimestamp'

interface MessageBubbleProps {
  message: Message
  onDelete?: (id: string) => void
  isLast?: boolean
}

export function MessageBubble({ message, onDelete, isLast = false }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const { isProdView } = useDisplayMode()

  const visibleToolCalls = message.toolCalls?.filter(
    tc =>
      tc.name !== 'create_execution_plan' &&
      tc.name !== 'update_progress_summary' &&
      tc.name !== 'memory_update_entity'
  )

  const progressToolCall = message.toolCalls?.find(
    tc =>
      tc.name === 'update_progress_summary' ||
      tc.name === 'memory_update_entity'
  )

  // ── Prod-mode filtering ───────────────────────────────────────────────────
  // In prod view, only show: user messages, final text-only assistant answers.
  // Hide ALL intermediate orchestration noise — tool calls, plans, status updates.
  if (isProdView && !isUser && !isSystem) {
    // Any message with tool calls is orchestration plumbing → hide
    if ((message.toolCalls?.length ?? 0) > 0) {
      return null
    }

    // Messages that are orchestration narration (no tool calls but not user-facing)
    // These come from OrchestrationService.executeSequentialSubAgents
    const content = (message.content || '').trim()
    if (content) {
      // Strip leading emoji/whitespace for pattern matching
      const strippingRegex = /^[\p{Emoji}\p{Emoji_Presentation}\s#*]*/u
      const stripped = content.replace(strippingRegex, '')
      
      const isOrchestrationNoise =
        stripped.toLowerCase().startsWith('auto-orchestration') ||
        stripped.toLowerCase().startsWith('execution plan') ||
        stripped.toLowerCase().startsWith('task complete') ||
        stripped.toLowerCase().startsWith('results from') ||
        /^\*\*Step \d+\*\*:/i.test(stripped) ||
        /^Step \d+:/i.test(stripped) ||
        /^✓\s*\*\*Step \d+/i.test(content) ||
        /^⚡\s*Parallel Execution/i.test(content) ||
        /^(✅|⚠️|❌)\s*\*\*.+Analysis/i.test(content) ||
        content.toLowerCase() === 'analyzing...' ||
        content.toLowerCase().startsWith('starting sub-agent') ||
        stripped.toLowerCase().startsWith('starting sub-agent')

      if (isOrchestrationNoise) {
        return null
      }
    }

    // Skip empty messages
    if (!content || content.length < 5) {
      return null
    }
  }

  // Progress checkpoint only message
  if (
    !isUser &&
    !message.content &&
    message.toolCalls?.length === 1 &&
    progressToolCall
  ) {
    // In prod mode, hide checkpoint badges entirely
    if (isProdView) return null

    return (
      <div className="flex justify-center my-2">
        <div className="flex items-center gap-1.5 text-[var(--color-text-dim)] text-[10px] font-[var(--font-weight-medium)] px-2 py-1 rounded-[var(--radius-pill)] bg-[var(--color-surface)]">
          <Save size={10} />
          <span>Saving progress checkpoint...</span>
        </div>
      </div>
    )
  }

  // System message
  if (isSystem) {
    // In prod mode, hide system messages
    if (isProdView) return null

    return (
      <div className="flex justify-center my-2">
        <div className="bg-[var(--color-surface)] text-[var(--color-text-muted)] text-[var(--text-xs)] px-3 py-1 rounded-[var(--radius-pill)]">
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
        'flex gap-3 group',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {/* Avatar for assistant */}
      {!isUser && <MessageAvatar isUser={false} />}

      {/* Message Group Container */}
      <div
        className={cn(
          'relative max-w-[80%] min-w-0 flex flex-col gap-1.5',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {/* 1. Attachments (outside the bubble) */}
        <MessageAttachments
          attachments={message.attachments || []}
          isUser={isUser}
        />

        {/* 2. Main Message Bubble */}
        <div
          className={cn(
            'rounded-[var(--radius-bubble)] px-[var(--space-bubble-px)] py-[var(--space-bubble-py)] shadow-[var(--shadow-sm)]',
            isUser
              ? 'bg-[var(--color-primary)] text-[var(--color-text-inverse)]'
              : 'bg-[var(--color-card-dark)] border border-[var(--color-border)] text-[var(--color-text-primary)]'
          )}
        >
          {/* Thinking Block — hidden in prod view */}
          {!isProdView && message.content && <ThinkingBlock content={message.content} />}

          {/* Message Content */}
          {message.content && <MessageContent content={message.content} />}

          {/* Progress checkpoint badge — hidden in prod view */}
          {!isProdView &&
            !isUser &&
            progressToolCall &&
            (message.content ||
              (visibleToolCalls && visibleToolCalls.length > 0)) && (
              <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] text-[10px] font-[var(--font-weight-medium)] mt-3 px-1 border-t border-[var(--color-border)] pt-2">
                <Save size={10} />
                <span>Progress checkpoint saved</span>
              </div>
            )}

          {/* Timestamp */}
          <MessageTimestamp
            timestamp={message.timestamp}
            isUser={isUser}
          />
        </div>

        {/* Tool calls — hidden in prod view (replaced by SubTaskChecklist) */}
        {!isProdView && visibleToolCalls && visibleToolCalls.length > 0 && (
          <div className="w-full mt-2">
            <ToolCallList toolCalls={visibleToolCalls} />
          </div>
        )}

        {/* 3. Action Footer (assistant messages only) */}
        {!isUser && !isSystem && (
          <MessageActions
            messageId={message.id}
            content={message.content || ''}
            actions={message.actions}
          />
        )}
      </div>

      {/* Avatar for user */}
      {isUser && <MessageAvatar isUser={true} />}
    </motion.div>
  )
}
