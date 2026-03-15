import React from 'react'
import { ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

interface CollapsibleSectionProps {
  /** Summary label shown in the header */
  label: string
  /** Whether the section starts open */
  defaultOpen?: boolean
  /** Status dot color class (e.g. 'bg-green-500', 'bg-yellow-400') */
  statusColor?: string
  /** Whether the status dot should pulse */
  statusPulse?: boolean
  /** Content to render inside the collapsible body */
  children: React.ReactNode
  /** Additional class names for the outer container */
  className?: string
}

/**
 * Animated collapsible section using native <details>.
 *
 * WHY: The ThinkingBlock and ToolCallList in MessageBubble both use the same
 * pattern — a tiny status dot, a label, a chevron, and an animated body.
 * This component extracts that shared UI so both can reuse it.
 */
export function CollapsibleSection({
  label,
  defaultOpen = false,
  statusColor = 'bg-[var(--color-primary)]',
  statusPulse = false,
  children,
  className,
}: CollapsibleSectionProps) {
  return (
    <details className={cn('group', className)} open={defaultOpen}>
      <summary className="text-[10px] text-white/40 cursor-pointer hover:text-white/60 transition-colors list-none flex items-center gap-1.5 font-medium select-none">
        <div
          className={cn(
            'w-1 h-3 rounded-full',
            statusColor,
            statusPulse && 'shadow-[0_0_8px_var(--color-primary)]'
          )}
        />
        <span>{label}</span>
        <ChevronRight
          size={10}
          className="group-open:rotate-90 transition-transform text-white/20"
        />
      </summary>

      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="overflow-hidden"
      >
        {children}
      </motion.div>
    </details>
  )
}
