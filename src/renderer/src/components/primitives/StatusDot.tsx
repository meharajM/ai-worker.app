import React from 'react'
import { cn } from '../../lib/utils'

interface StatusDotProps {
  /** Color class (e.g. 'bg-green-400', 'bg-[var(--color-primary)]') */
  color?: string
  /** Whether the dot should animate with a pulse */
  pulse?: boolean
  /** Size variant */
  size?: 'sm' | 'md'
  /** Additional class names */
  className?: string
}

const SIZE_CLASSES = {
  sm: 'w-1 h-1',
  md: 'w-1.5 h-1.5',
} as const

/**
 * Tiny animated status indicator dot.
 * Used throughout the UI, such as in tool call progress, connection status, and session indicators.
 */
export function StatusDot({
  color = 'bg-green-400',
  pulse = false,
  size = 'md',
  className,
}: StatusDotProps) {
  return (
    <span
      className={cn(
        'rounded-full inline-block',
        SIZE_CLASSES[size],
        color,
        pulse && 'animate-pulse',
        className
      )}
    />
  )
}
