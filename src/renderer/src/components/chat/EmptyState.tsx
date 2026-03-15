import React from 'react'
import { WorkflowTiles } from '../WorkflowTiles'

/**
 * Co-Worker Hub Welcome Screen
 */
export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-full max-w-4xl mx-auto w-full pt-8 pb-32">
      
      {/* System Active Badge */}
      <div className="mb-8 px-3 py-1 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-[10px] font-bold tracking-widest uppercase">
        System Active
      </div>

      {/* Greeting */}
      <div className="text-center mb-6">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-[var(--color-text-primary)] mb-2">
          Hey!
        </h1>
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-[image:var(--gradient-text)]">
          What's on your mind?
        </h2>
      </div>

      {/* Subtitle */}
      <p className="text-[var(--color-text-secondary)] text-md text-center max-w-2xl mb-8">
        Your Co-Worker is ready. Delegate tasks across connected systems right here or press <span className="font-mono bg-[var(--color-surface)] px-1 py-0.5 rounded text-[var(--color-text-primary)] text-sm">Cmd+K</span> to quickly search.
      </p>

      {/* Agent Cards Grid */}
      <div className="w-full">
        <WorkflowTiles />
      </div>

    </div>
  )
}
