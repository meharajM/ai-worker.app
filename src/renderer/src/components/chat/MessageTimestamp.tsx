interface MessageTimestampProps {
  timestamp: number
  isUser?: boolean
}

export function MessageTimestamp({ timestamp, isUser = false }: MessageTimestampProps) {
  const formatted = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <p
      className={`text-[var(--font-size-meta)] mt-1 ${
        isUser ? 'text-white/60' : 'text-[var(--color-text-dim)]'
      }`}
    >
      {formatted}
    </p>
  )
}
