import React from 'react'
import { cn } from '../../lib/utils'

interface AvatarProps {
  /** Lucide icon component to render inside the avatar */
  icon: React.ReactNode
  /** Background color class or CSS value */
  colorClass?: string
  /** Size in pixels */
  size?: number
  /** Additional class names */
  className?: string
}

/**
 * Reusable avatar circle with icon slot.
 * Used for user/bot avatars in the chat, and anywhere a small icon badge is needed.
 */
export function Avatar({
  icon,
  colorClass = 'bg-[var(--color-accent)]',
  size = 32,
  className,
}: AvatarProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center flex-shrink-0',
        colorClass,
        className
      )}
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-avatar)',
      }}
    >
      {icon}
    </div>
  )
}
