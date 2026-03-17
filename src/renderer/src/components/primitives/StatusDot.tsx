import React from 'react'
import { cn } from '../../lib/utils'

type StatusVariant = 'success' | 'warning' | 'error' | 'idle' | 'active'
type StatusSize = 'sm' | 'md' | 'lg'

interface StatusDotProps {
  variant?: StatusVariant
  size?: StatusSize
  animated?: boolean
  className?: string
}

export function StatusDot({
  variant = 'idle',
  size = 'md',
  animated = false,
  className,
}: StatusDotProps) {
  return (
    <span
      className={cn(
        'status-dot',
        `status-dot-${variant}`,
        `status-dot-${size}`,
        animated && 'status-dot-animated',
        className
      )}
    />
  )
}

interface StatusBadgeProps {
  variant?: StatusVariant
  label: string
  showDot?: boolean
  animated?: boolean
  className?: string
}

export function StatusBadge({
  variant = 'idle',
  label,
  showDot = true,
  animated = false,
  className,
}: StatusBadgeProps) {
  const dotVariant = variant === 'idle' ? 'idle' : variant

  return (
    <span className={cn('status-badge', `status-badge-${variant}`, className)}>
      {showDot && (
        <StatusDot variant={dotVariant} size="sm" animated={animated && variant !== 'idle'} />
      )}
      {label}
    </span>
  )
}
