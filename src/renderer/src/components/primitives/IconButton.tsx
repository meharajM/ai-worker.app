import React from 'react'
import { cn } from '../../lib/utils'

interface IconButtonProps {
  /** Click handler */
  onClick: (e: React.MouseEvent) => void
  /** Lucide icon or any React node to render */
  icon: React.ReactNode
  /** Tooltip / aria label */
  title: string
  /** Additional class names */
  className?: string
  /** Whether the button is disabled */
  disabled?: boolean
  /** Visual size variant */
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_CLASSES = {
  sm: 'p-1 rounded-md',
  md: 'p-1.5 rounded-lg',
  lg: 'p-2 rounded-xl',
} as const

/**
 * Base icon-only button with consistent hover states.
 * Use this as the building block for action buttons throughout the UI.
 */
export function IconButton({
  onClick,
  icon,
  title,
  className,
  disabled = false,
  size = 'md',
}: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        SIZE_CLASSES[size],
        'text-white/40 hover:text-white hover:bg-white/10 transition-colors',
        'disabled:opacity-30 disabled:pointer-events-none',
        className
      )}
      title={title}
      aria-label={title}
    >
      {icon}
    </button>
  )
}
