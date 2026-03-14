/**
 * MessageBubble.tsx — Slim orchestrator for chat message rendering.
 *
 * This component is now a composition of atomic sub-components:
 *   - MessageAvatar — user/bot avatar icon
 *   - MessageAttachments — file attachment cards
 *   - ThinkingBlock — collapsible LLM reasoning
 *   - MessageContent — cleaned markdown rendering
 *   - ToolCallList — grouped tool call checklist
 *   - MessageActions — copy, regenerate, action buttons
 *   - MessageTimestamp — formatted time display
 *
 * Each sub-component can be independently styled, tracked, and experimented on.
 */

import React from 'react'
import { Save } from 'lucide-react'
import { motion } from 'framer-motion'
import { Message } from '../../stores/chatStore'
import { FormattedText } from '../FormattedText'
import { cn } from '../../lib/utils'

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

  // Filter out internal tools from the standard checklist view
  const visibleToolCalls = message.toolCalls?.filter(
    tc =>
      tc.name !== 'create_execution_plan' &&
      tc.name !== 'update_progress_summary' &&
      tc.name !== 'memory_update_entity'
  )

  // Check for progress summary update (Legacy or Memory)
  const progressToolCall = message.toolCalls?.find(
    tc =>
      tc.name === 'update_progress_summary' ||
      tc.name === 'memory_update_entity'
  )

  // SPECIAL CASE: If message is ONLY a progress update (no content, no other tools)
  if (
    !isUser &&
    !message.content &&
    message.toolCalls?.length === 1 &&
    progressToolCall
  ) {
    return (
      <div className="flex justify-center my-2 animate-pulse">
        <div className="flex items-center gap-1.5 text-white/20 text-[10px] font-medium px-2 py-1 rounded-full bg-white/5">
          <Save size={10} />
          <span>Saving progress checkpoint...</span>
        </div>
      </div>
    )
  }

  // System message — minimal centered badge
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
            'rounded-[var(--radius-bubble)] px-[var(--space-bubble-px)] py-[var(--space-bubble-py)] shadow-sm',
            isUser
              ? 'bg-[var(--color-primary)] text-white'
              : 'bg-[var(--color-card-dark)] border border-[var(--color-border)] text-[var(--color-text-primary)]'
          )}
        >
          {/* Thinking Block */}
          {message.content && <ThinkingBlock content={message.content} />}

          {/* Message Content */}
          {message.content && <MessageContent content={message.content} />}

          {/* Progress checkpoint badge */}
          {!isUser &&
            progressToolCall &&
            (message.content ||
              (visibleToolCalls && visibleToolCalls.length > 0)) && (
              <div className="flex items-center gap-1.5 text-white/30 text-[10px] font-medium mt-3 px-1 border-t border-white/5 pt-2">
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

        {/* Tool calls (rendered OUTSIDE the bubble as large cards) */}
        {visibleToolCalls && visibleToolCalls.length > 0 && (
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
