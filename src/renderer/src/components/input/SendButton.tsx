import React from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '../primitives/Button'

interface SendButtonProps {
  disabled?: boolean
  onAbort?: () => void
  onSubmit: () => void
  hasContent: boolean
}

export function SendButton({
  disabled = false,
  onAbort,
  onSubmit,
  hasContent,
}: SendButtonProps) {
  if (disabled && onAbort) {
    return (
      <Button
        variant="ghost"
        size="md"
        onClick={onAbort}
        className="w-[36px] h-[44px] p-2 mb-[1px] text-[var(--color-error)] hover:bg-[var(--color-error)]/20"
        title="Stop Generation"
      >
        <Square size={18} className="fill-current" />
      </Button>
    )
  }

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
      className={`p-2 mb-[1px] rounded-[var(--radius-lg)] transition-all h-[44px] w-[36px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${hasContent && !disabled
          ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-dark)] hover:opacity-80'
          : 'bg-transparent text-[var(--color-text-dim)] cursor-not-allowed'
        }`}
    >
      <Send size={18} />
    </button>
  )
}
