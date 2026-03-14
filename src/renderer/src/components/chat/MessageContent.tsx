import React from 'react'
import { motion } from 'framer-motion'
import { FormattedText } from '../FormattedText'
import { filterThinkBlocks, hasLeakedReasoning } from '../../lib/thinkBlockFilter'

interface MessageContentProps {
  /** Raw message content string */
  content: string
}

/**
 * Renders the cleaned message text via FormattedText (Markdown).
 *
 * Handles:
 *   - Stripping think blocks (the thinking content is rendered separately by ThinkingBlock)
 *   - Detecting and cleaning up leaked reasoning artifacts
 *   - Skipping content that's too short to display
 */
export function MessageContent({ content }: MessageContentProps) {
  const { cleanedContent: initialCleaned } = filterThinkBlocks(content)
  let cleanedContent = initialCleaned

  // Clean up leaked reasoning and artifacts
  const hasLeak = hasLeakedReasoning(cleanedContent)
  if (hasLeak) {
    const sentences = cleanedContent.match(/[^.!?]+[.!?]+/g) || []
    const lastSentence = sentences[sentences.length - 1]?.trim()
    if (
      lastSentence &&
      !hasLeakedReasoning(lastSentence) &&
      lastSentence.length > 10
    ) {
      cleanedContent = lastSentence
    } else {
      return <div className="text-white/40 text-xs italic">Thinking...</div>
    }
  }

  cleanedContent = cleanedContent.replace(/^,\s*/, '')

  if (cleanedContent.length < 5) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <FormattedText content={cleanedContent} />
    </motion.div>
  )
}
