interface MessageTimestampProps {
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Whether this is a user message (affects color) */
  isUser?: boolean
}

/**
 * Formatted message timestamp (e.g., "2:34 PM").
 * Extracted from MessageBubble for independent styling and experiment control.
 */
export function MessageTimestamp({ timestamp, isUser = false }: MessageTimestampProps) {
  const formatted = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <p
      className={`text-[var(--font-size-meta)] mt-1 ${
        isUser ? 'text-white/60' : 'text-white/30'
      }`}
    >
      {formatted}
    </p>
  )
}
