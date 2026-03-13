import React from 'react'
import { Send, Square } from 'lucide-react'

interface SendButtonProps {
  /** Whether the input is disabled (processing) */
  disabled?: boolean
  /** Abort handler — if provided while disabled, shows a stop button */
  onAbort?: () => void
  /** Submit handler */
  onSubmit: () => void
  /** Whether there's content to send */
  hasContent: boolean
}

/**
 * Submit / Stop generation button.
 *
 * Two states:
 *   1. Processing + onAbort available → red stop button
 *   2. Otherwise → send button (enabled only when hasContent)
 */
export function SendButton({
  disabled = false,
  onAbort,
  onSubmit,
  hasContent,
}: SendButtonProps) {
  // Stop button during generation
  if (disabled && onAbort) {
    return (
      <button
        onClick={onAbort}
        className="p-2 mb-[1px] rounded-lg transition-all bg-red-500/20 hover:bg-red-500/30 text-red-400 h-[44px] w-[36px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        title="Stop Generation"
      >
        <Square size={18} className="fill-current" />
      </button>
    )
  }

  // Send button
  return (
    <button
      type="button"
      onClick={(e) => {
        if (disabled || !hasContent) {
          e.preventDefault()
          return
        }
        onSubmit()
      }}
      aria-disabled={disabled || !hasContent}
      aria-label="Send message"
      data-testid="send-button"
      className={`p-2 mb-[1px] rounded-lg transition-all h-[44px] w-[36px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${hasContent && !disabled
          ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-dark)] hover:opacity-80'
          : 'bg-transparent text-[var(--color-text-dim)] cursor-not-allowed'
        }`}
    >
      <Send size={18} />
    </button>
  )
}
