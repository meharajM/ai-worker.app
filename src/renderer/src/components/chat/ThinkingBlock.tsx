import React from 'react'
import { ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { filterThinkBlocks } from '../../lib/thinkBlockFilter'

interface ThinkingBlockProps {
  /** Raw message content (before filtering) */
  content: string
}

/**
 * Collapsible "thinking process" block for LLM reasoning.
 *
 * Renders the extracted thinking content from <think> blocks. The block
 * auto-opens when thinking is in progress and collapses once complete.
 */
export function ThinkingBlock({ content }: ThinkingBlockProps) {
  const { thinking, isComplete } = filterThinkBlocks(content)

  if (!thinking) return null

  return (
    <div className="mb-3">
      <details className="group" open={!isComplete}>
        <summary className="text-[10px] text-[var(--color-accent)] cursor-pointer hover:text-[var(--color-primary)] transition-colors list-none flex items-center gap-1.5 font-medium select-none">
          <div
            className={`w-1 h-3 rounded-full ${
              isComplete ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-warning)] shadow-[0_0_8px_var(--color-warning)]'
            }`}
          />
          <span>{isComplete ? 'Thinking Process' : 'Thinking...'}</span>
          <ChevronRight
            size={10}
            className="group-open:rotate-90 transition-transform text-[var(--color-text-dim)]"
          />
        </summary>
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <div className="mt-2 text-[11px] leading-[var(--leading-relaxed)] text-[var(--color-text-secondary)] bg-[var(--color-surface)] rounded-[var(--radius-md)] p-3 border border-[var(--color-border)] font-[var(--font-family-mono)] shadow-inner whitespace-pre-wrap">
            {thinking}
          </div>
        </motion.div>
      </details>
    </div>
  )
}
