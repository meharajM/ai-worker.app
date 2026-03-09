import React from 'react'
import { Bot } from 'lucide-react'
import { motion } from 'framer-motion'
import { MessageAvatar } from './MessageAvatar'

/**
 * Animated typing indicator (three bouncing dots) shown while the
 * agent is generating a response.
 */
export function TypingIndicator() {
  return (
    <div className="flex gap-3 justify-start">
      <MessageAvatar isUser={false} />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-[var(--color-card-dark)] border border-[var(--color-border)] rounded-2xl px-4 py-3"
      >
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="w-2 h-2 bg-white/40 rounded-full"
              animate={{ y: [0, -5, 0] }}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                delay: i * 0.15,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  )
}
