import React from 'react'
import { cn } from '../../lib/utils'
import { FileIcon } from '../primitives/FileIcon'

interface Attachment {
  name: string
  type: string
  path: string
}

interface MessageAttachmentsProps {
  /** Array of file attachments */
  attachments: Attachment[]
  /** Whether this is a user message (affects alignment) */
  isUser?: boolean
}

/**
 * File attachment cards displayed above the message bubble.
 *
 * Each card shows a type-aware icon, file name, and extension badge.
 * Extracted from MessageBubble for independent styling.
 */
export function MessageAttachments({ attachments, isUser = false }: MessageAttachmentsProps) {
  if (!attachments || attachments.length === 0) return null

  return (
    <div
      className={cn(
        'flex flex-wrap gap-2 mb-1',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {attachments.map((att, idx) => (
        <div
          key={`${att.name}-${idx}`}
          className="group/card flex items-center gap-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-3 pr-5 transition-all hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-hover)] shadow-sm"
          title={att.path}
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[var(--color-tool-chip-bg)] flex items-center justify-center border border-[var(--color-border)]">
            <FileIcon type={att.type} name={att.name} size={20} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-medium text-[var(--color-text-primary)] truncate max-w-[200px] leading-tight">
              {att.name}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold mt-0.5">
              {att.type.split('/')[1]?.toUpperCase() ||
                att.name.split('.').pop()?.toUpperCase() ||
                'FILE'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
