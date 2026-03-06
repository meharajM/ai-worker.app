import React, { useRef, useEffect } from 'react'

interface TextAreaProps {
  /** Current text value */
  value: string
  /** Change handler */
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  /** Key down handler (for Enter submission) */
  onKeyDown: (e: React.KeyboardEvent) => void
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether speech is actively listening */
  isListening?: boolean
  /** Whether the speech model is being set up */
  isFirstSetup?: boolean
  /** Ref forwarding for external focus control */
  textareaRef?: React.RefObject<HTMLTextAreaElement>
}

/**
 * Auto-resizing chat textarea with responsive height.
 *
 * Extracted from VoiceInput — handles only the text editing surface.
 * Speech sync, file drops, and submission are handled by parent components.
 */
export function TextArea({
  value,
  onChange,
  onKeyDown,
  disabled = false,
  isListening = false,
  isFirstSetup = false,
  textareaRef,
}: TextAreaProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const ref = textareaRef || internalRef

  // Auto-resize on content change
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = ref.current.scrollHeight + 'px'
    }
  }, [value, ref])

  return (
    <textarea
      ref={ref}
      value={value}
      data-testid="chat-textarea"
      onChange={onChange}
      onKeyDown={onKeyDown}
      disabled={disabled}
      placeholder={
        isListening
          ? 'Listening...'
          : isFirstSetup
            ? 'Downloading model...'
            : 'Message... (Shift+Enter for new line, or drag files here)'
      }
      rows={5}
      style={{
        resize: 'none',
        minHeight: '120px',
        maxHeight: '400px',
      }}
      className={`
        w-full bg-transparent border-none outline-none
        text-base py-2 transition-colors scrollbar-hide
        ${
          isListening
            ? 'text-white/90 placeholder-white/50'
            : 'text-white placeholder-white/30'
        }
      `}
    />
  )
}
