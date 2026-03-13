import React from 'react'
import { Mic, Square } from 'lucide-react'

interface VoiceButtonProps {
  /** Whether speech is actively listening */
  isListening: boolean
  /** Whether the speech engine is initializing */
  isInitializing: boolean
  /** Whether this is the first-time setup (downloading model) */
  isFirstSetup: boolean
  /** Download progress percentage (0-100) */
  setupProgress?: number
  /** Whether speech-to-text is supported */
  sttSupported: boolean
  /** Whether the entire input is disabled */
  disabled?: boolean
  /** Click handler for mic toggle */
  onClick: () => void
}

/**
 * Microphone toggle button with download progress indicator.
 *
 * Three states:
 *   1. First setup — circular progress ring showing model download
 *   2. Listening/initializing — red pulsing stop button
 *   3. Idle — standard mic icon
 */
export function VoiceButton({
  isListening,
  isInitializing,
  isFirstSetup,
  setupProgress = 0,
  sttSupported,
  disabled = false,
  onClick,
}: VoiceButtonProps) {
  // State 1: Downloading speech model
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
              className="text-emerald-500 transition-all duration-normal ease-out"
              strokeDasharray={88}
              strokeDashoffset={88 - (88 * setupProgress) / 100}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-emerald-400">
            {Math.round(setupProgress)}%
          </div>
        </div>
      </div>
    )
  }

  // State 2: Recording / initializing
  if (isListening || isInitializing) {
    return (
      <button
        onClick={onClick}
        className="p-3 mb-[1px] rounded-xl flex items-center justify-center transition-all active:scale-95 bg-red-500/20 hover:bg-red-500/30 text-red-400 animate-pulse ring-1 ring-red-500/50 h-[44px] w-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        title="Stop Recording"
      >
        <Square size={16} className="fill-current" />
      </button>
    )
  }

  // State 3: Idle
  return (
    <button
      onClick={onClick}
      disabled={disabled || !sttSupported}
      className={`p-3 mb-[1px] rounded-xl flex items-center justify-center transition-all active:scale-95 shadow-lg group bg-[var(--color-surface)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] h-[44px] w-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
        disabled || !sttSupported ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      title="Start Voice Mode"
    >
      <Mic size={20} />
    </button>
  )
}
