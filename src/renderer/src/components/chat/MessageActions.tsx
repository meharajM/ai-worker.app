import React from 'react'
import { RotateCcw } from 'lucide-react'
import { CopyButton } from '../primitives/CopyButton'
import { IconButton } from '../primitives/IconButton'

interface MessageAction {
  type: string
  label: string
}

interface MessageActionsProps {
  /** Message ID (for regenerate) */
  messageId: string
  /** Message content (for copy) */
  content: string
  /** Action buttons from the message (continue/stop) */
  actions?: MessageAction[]
}

/**
 * Footer action bar for assistant messages: copy, regenerate, and custom actions.
 * Extracted from MessageBubble for independent experiment control.
 */
export function MessageActions({ messageId, content, actions }: MessageActionsProps) {
  return (
    <>
      {/* Custom action buttons (continue, stop) */}
      {actions && actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((action, idx) => (
            <button
              key={`${action.type}-${idx}`}
              onClick={() => {
                const eventContent =
                  action.type === 'continue' ? 'continue' : 'stop'
                window.dispatchEvent(
                  new CustomEvent('agent-action', {
                    detail: { type: action.type, content: eventContent },
                  })
                )
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                action.type === 'continue'
                  ? 'bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/80 text-[var(--color-text-inverse)]'
                  : 'bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Hover action bar (copy + regenerate) */}
      <div className="flex items-center gap-2 mt-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton content={content} />
        <IconButton
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('agent-action', {
                detail: { type: 'regenerate', messageId },
              })
            )
          }
          icon={<RotateCcw size={16} />}
          title="Regenerate"
        />
      </div>
    </>
  )
}
