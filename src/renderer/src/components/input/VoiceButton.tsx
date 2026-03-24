import React from 'react'
import { Mic, Square } from 'lucide-react'
import { Button } from '../primitives/Button'

interface VoiceButtonProps {
  isListening: boolean
  isInitializing: boolean
  isFirstSetup: boolean
  setupProgress?: number
  sttSupported: boolean
  disabled?: boolean
  onClick: () => void
}

export function VoiceButton({
  isListening,
  isInitializing,
  isFirstSetup,
  setupProgress = 0,
  sttSupported,
  disabled = false,
  onClick,
}: VoiceButtonProps) {
  if (isFirstSetup) {
    return (
      <div
        className="p-2 flex items-center justify-center h-[44px]"
        title="Downloading Speech Model..."
      >
        <div className="relative w-8 h-8">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="16"
              cy="16"
              r="14"
              stroke="currentColor"
              strokeWidth="3"
              fill="transparent"
              className="text-[var(--color-text-dim)]"
            />
            <circle
              cx="16"
              cy="16"
              r="14"
              stroke="currentColor"
              strokeWidth="3"
              fill="transparent"
              className="text-[var(--color-success)] transition-all duration-[var(--duration-normal)] ease-[var(--ease-out)]"
              strokeDasharray={88}
              strokeDashoffset={88 - (88 * setupProgress) / 100}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-[8px] font-[var(--font-weight-bold)] text-[var(--color-success)]">
            {Math.round(setupProgress)}%
          </div>
        </div>
      </div>
    )
  }

  if (isListening || isInitializing) {
    return (
      <button
        onClick={onClick}
        className="p-3 mb-[1px] rounded-[var(--radius-xl)] flex items-center justify-center transition-all active:scale-[0.95] bg-[var(--color-error)]/20 hover:bg-[var(--color-error)]/30 text-[var(--color-error)] ring-1 ring-[var(--color-error)]/50 h-[44px] w-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        title="Stop Recording"
      >
        <Square size={16} className="fill-current" />
      </button>
    )
  }

  return (
    <Button
      variant="secondary"
      size="md"
      onClick={onClick}
      disabled={disabled || !sttSupported}
      className="w-[44px] h-[44px] p-3 mb-[1px]"
      title="Start Voice Mode"
    >
      <Mic size={20} />
    </Button>
  )
}
