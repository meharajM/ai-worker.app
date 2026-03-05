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
        className="p-2 mb-[1px] rounded-lg transition-all bg-red-500/20 hover:bg-red-500/30 text-red-400 h-[44px] w-[36px] flex items-center justify-center"
        title="Stop Generation"
      >
        <Square size={18} className="fill-current" />
      </button>
    )
  }

  // Send button
  return (
    <button
      onClick={onSubmit}
      disabled={disabled || !hasContent}
      data-testid="send-button"
      className={`p-2 mb-[1px] rounded-lg transition-all h-[44px] w-[36px] flex items-center justify-center ${
        hasContent && !disabled
          ? 'bg-white text-black hover:bg-gray-200'
          : 'bg-transparent text-white/20 cursor-not-allowed'
      }`}
    >
      <Send size={18} />
    </button>
  )
}
