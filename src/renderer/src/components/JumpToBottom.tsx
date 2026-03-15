import React from 'react'
import { ArrowDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface JumpToBottomProps {
  isAtBottom: boolean
  hasUnread: boolean
  onScrollToBottom: () => void
}

/**
 * Animated jump-to-bottom overlay for scrollable chat containers.
 *
 * Two visual variants:
 * - **Unread pill** (accent) — shown when new assistant messages arrived off-screen.
 * - **Subtle circle** — shown when the user simply scrolled up, no new messages.
 *
 * Both disappear when the user reaches the bottom of the list.
 */
export function JumpToBottom({ isAtBottom, hasUnread, onScrollToBottom }: JumpToBottomProps) {
  return (
    <AnimatePresence>
      {!isAtBottom && hasUnread && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10"
        >
          <button
            onClick={onScrollToBottom}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-bg-dark)] rounded-full shadow-lg text-sm font-medium transition-all hover:scale-105"
          >
            <ArrowDown size={16} />
            New messages
          </button>
        </motion.div>
      )}
      {!isAtBottom && !hasUnread && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10"
        >
          <button
            onClick={onScrollToBottom}
            className="flex items-center gap-2 p-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] hover:bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-full shadow-lg text-sm transition-all"
          >
            <ArrowDown size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
