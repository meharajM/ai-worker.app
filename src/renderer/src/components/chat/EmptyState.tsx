import React from 'react'
import { WorkflowTiles } from '../WorkflowTiles'
import { StatusBadge } from '../primitives/StatusDot'

/**
 * Co-Worker Hub Welcome Screen
 */
export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-full max-w-4xl mx-auto w-full pt-8 pb-32">
      
      {/* System Active Badge */}
      <div className="mb-8">
        <StatusBadge variant="active" label="System Active" animated />
      </div>

      {/* Greeting */}
      <div className="text-center mb-6">
        <h1 className="text-[var(--text-4xl)] md:text-[var(--text-3xl)] font-[var(--font-weight-bold)] tracking-tight text-[var(--color-text-primary)] mb-2">
          Hey!
        </h1>
        <h2 className="text-[var(--text-4xl)] md:text-[var(--text-3xl)] font-[var(--font-weight-bold)] tracking-tight text-[var(--color-text-primary)]">
          What's on your mind?
        </h2>
      </div>

      {/* Subtitle */}
      <p className="text-[var(--color-text-secondary)] text-[var(--text-base)] text-center max-w-2xl mb-8">
        Your Co-Worker is ready. Delegate tasks across connected systems right here or press <span className="font-[var(--font-family-mono)] bg-[var(--color-surface)] px-1 py-0.5 rounded text-[var(--color-text-primary)] text-[var(--text-sm)]">Cmd+K</span> to quickly search.
      </p>

      {/* Agent Cards Grid */}
      <div className="w-full">
        <WorkflowTiles />
      </div>

    </div>
  )
}
