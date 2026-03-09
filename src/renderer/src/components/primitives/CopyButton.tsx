import React, { useState, useCallback } from 'react'
import { Copy, CheckCircle2 } from 'lucide-react'
import { cn } from '../../lib/utils'

interface CopyButtonProps {
  /** The text content to copy to clipboard */
  content: string
  /** Icon size in pixels */
  iconSize?: number
  /** Additional class names */
  className?: string
  /** Optional label shown next to the icon */
  label?: string
}

/**
 * Clipboard copy button with visual feedback.
 *
 * WHY a shared primitive: This exact pattern was duplicated in MessageBubble.tsx
 * and FormattedText.tsx. Centralising it here keeps the copy-to-clipboard
 * logic (including the textarea fallback) in one place.
 */
export function CopyButton({
  content,
  iconSize = 16,
  className,
  label,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
    } catch {
      // Fallback for environments where clipboard API is unavailable
      const textArea = document.createElement('textarea')
      textArea.value = content
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
      } catch (err) {
        console.error('Fallback copy failed', err)
      }
      document.body.removeChild(textArea)
    }

    setTimeout(() => setCopied(false), 2000)
  }, [content])

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1.5',
        className
      )}
      title="Copy"
    >
      {copied ? (
        <CheckCircle2 size={iconSize} className="text-green-400" />
      ) : (
        <Copy size={iconSize} />
      )}
      {label && (
        <span className="text-[10px]">{copied ? 'Copied!' : label}</span>
      )}
    </button>
  )
}
