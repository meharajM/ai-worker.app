/**
 * experimentProvider.tsx — React context + declarative A/B testing components.
 *
 * Provides <Experiment> and <Variant> components for declarative variant rendering,
 * plus the useExperiment() hook for imperative variant access.
 *
 * Uses the experimentStore for variant assignment (localStorage-backed).
 * Future: swap to PostHog feature flags by changing the store implementation.
 */

import React, { createContext, useContext, useMemo, useEffect } from 'react'
import { useExperimentStore } from '../../stores/experimentStore'

// ── Default experiments registry ──────────────────────────────────────────────
// Add new experiments here. The first variant is always the control.

interface ExperimentDefinition {
  key: string
  variants: string[]
  enabled: boolean
}

const DEFAULT_EXPERIMENTS: ExperimentDefinition[] = [
  {
    key: 'copy_button_placement',
    variants: ['footer', 'inline'],
    enabled: false, // Enable when ready to run
  },
  {
    key: 'input_bar_layout',
    variants: ['default', 'compact', 'expanded'],
    enabled: false,
  },
  {
    key: 'message_avatar_style',
    variants: ['rounded', 'circle', 'hidden'],
    enabled: false,
  },
]

// ── Context ─────────────────────────────────────────────────────────────────

interface ExperimentContextValue {
  getVariant: (key: string) => string | null
}

const ExperimentContext = createContext<ExperimentContextValue>({
  getVariant: () => null,
})

// ── Provider ────────────────────────────────────────────────────────────────

interface ExperimentProviderProps {
  children: React.ReactNode
  /** Override the default experiment definitions */
  experiments?: ExperimentDefinition[]
}

export function ExperimentProvider({
  children,
  experiments = DEFAULT_EXPERIMENTS,
}: ExperimentProviderProps) {
  const registerExperiments = useExperimentStore(s => s.registerExperiments)
  const getVariant = useExperimentStore(s => s.getVariant)

  useEffect(() => {
    registerExperiments(experiments)
  }, [experiments, registerExperiments])

  const value = useMemo(() => ({ getVariant }), [getVariant])

  return (
    <ExperimentContext.Provider value={value}>
      {children}
    </ExperimentContext.Provider>
  )
}

// ── Hook ────────────────────────────────────────────────────────────────────

interface UseExperimentResult {
  /** The assigned variant name, or null if experiment is not active */
  variant: string | null
  /** Whether this is the control variant (first in the list) */
  isControl: boolean
}

/**
 * Get the variant assignment for a given experiment key.
 *
 * ```ts
 * const { variant } = useExperiment('copy_button_placement')
 * if (variant === 'inline') { ... }
 * ```
 */
export function useExperiment(experimentKey: string): UseExperimentResult {
  const { getVariant } = useContext(ExperimentContext)
  const variant = getVariant(experimentKey)

  const registry = useExperimentStore(s => s.registry)
  const experiment = registry.find(e => e.key === experimentKey)
  const isControl = variant === experiment?.variants[0]

  return { variant, isControl }
}

// ── Declarative Components ──────────────────────────────────────────────────

interface ExperimentProps {
  /** Experiment key matching a registered experiment */
  name: string
  /** <Variant> children */
  children: React.ReactNode
  /** Fallback to render if experiment is not active */
  fallback?: React.ReactNode
}

interface VariantProps {
  /** Variant name to match against the experiment assignment */
  name: string
  children: React.ReactNode
}

/**
 * Declarative A/B test wrapper. Renders the matching <Variant> child.
 *
 * ```tsx
 * <Experiment name="copy_button_placement">
 *   <Variant name="footer"><CopyButton position="footer" /></Variant>
 *   <Variant name="inline"><CopyButton position="inline" /></Variant>
 * </Experiment>
 * ```
 */
export function Experiment({ name, children, fallback }: ExperimentProps) {
  const { variant } = useExperiment(name)

  if (!variant) {
    // Experiment is not active — render fallback or first child
    if (fallback) return <>{fallback}</>

    // Default: render the first Variant child (control)
    const firstChild = React.Children.toArray(children).find(
      (child): child is React.ReactElement<VariantProps> =>
        React.isValidElement(child)
    )
    return firstChild ? <>{firstChild}</> : null
  }

  // Find the matching variant child
  const matchingChild = React.Children.toArray(children).find(
    (child): child is React.ReactElement<VariantProps> =>
      React.isValidElement(child) &&
      (child.props as VariantProps).name === variant
  )

  return matchingChild ? <>{matchingChild}</> : null
}

/**
 * Variant child for <Experiment>. Only renders when its name matches.
 */
export function Variant({ children }: VariantProps) {
  return <>{children}</>
}
