import React from 'react'
import { Bot, User } from 'lucide-react'
import { Avatar } from '../primitives/Avatar'

interface MessageAvatarProps {
  /** Whether this is a user message */
  isUser: boolean
}

/**
 * Chat message avatar — shows user or bot icon.
 * Extracted from MessageBubble to be independently styled and experimentable.
 */
export function MessageAvatar({ isUser }: MessageAvatarProps) {
  return (
    <Avatar
      icon={
        isUser ? (
          <User size={18} className="text-white" />
        ) : (
          <Bot size={18} className="text-white" />
        )
      }
      colorClass={
        isUser
          ? 'bg-[var(--color-primary)]'
          : 'bg-[var(--color-accent)]'
      }
      size={32}
    />
  )
}
