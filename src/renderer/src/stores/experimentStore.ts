/**
 * experimentStore.ts — Zustand store for A/B experiment management.
 *
 * Manages experiment variant assignments using localStorage for persistence.
 * In the future, this will be backed by PostHog feature flags.
 *
 * Architecture:
 *   - Each experiment has a key (e.g., 'copy_button_placement') and a set of variants.
 *   - The store randomly assigns a variant on first access, then persists it.
 *   - Dev mode: variant overrides can be set via the Feature Flags panel.
 */

import { create } from 'zustand'

/** Definition of a single experiment */
interface ExperimentDefinition {
  /** Unique experiment key */
  key: string
  /** List of variant names (first is the control/default) */
  variants: string[]
  /** Whether this experiment is currently active */
  enabled: boolean
}

interface ExperimentAssignment {
  variant: string
  assignedAt: number
}

interface ExperimentState {
  /** Map of experiment key → assigned variant */
  assignments: Record<string, ExperimentAssignment>
  /** Dev-mode overrides — these take precedence over assignments */
  overrides: Record<string, string>
  /** Registry of available experiments */
  registry: ExperimentDefinition[]

  /** Get the active variant for an experiment (override > assignment > random) */
  getVariant: (experimentKey: string) => string | null
  /** Set a dev-mode override for an experiment */
  setOverride: (experimentKey: string, variant: string) => void
  /** Clear a dev-mode override */
  clearOverride: (experimentKey: string) => void
  /** Register experiments (called during app init) */
  registerExperiments: (experiments: ExperimentDefinition[]) => void
  /** Force-assign a variant to an experiment */
  assignVariant: (experimentKey: string, variant: string) => void
}

const STORAGE_KEY = 'ai-worker-experiments'
const OVERRIDES_KEY = 'ai-worker-experiment-overrides'

function loadFromStorage<T>(key: string): T | null {
  try {
    const stored = localStorage.getItem(key)
    if (stored) return JSON.parse(stored) as T
  } catch {
    console.warn(`Failed to load ${key} from localStorage`)
  }
  return null
}

function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    console.warn(`Failed to save ${key} to localStorage`)
  }
}

export const useExperimentStore = create<ExperimentState>((set, get) => ({
  assignments: loadFromStorage<Record<string, ExperimentAssignment>>(STORAGE_KEY) ?? {},
  overrides: loadFromStorage<Record<string, string>>(OVERRIDES_KEY) ?? {},
  registry: [],

  getVariant: (experimentKey: string) => {
    const state = get()

    // 1. Check for dev-mode override
    if (state.overrides[experimentKey]) {
      return state.overrides[experimentKey]
    }

    // 2. Check for existing assignment
    if (state.assignments[experimentKey]) {
      return state.assignments[experimentKey].variant
    }

    // 3. Find the experiment definition and auto-assign
    const experiment = state.registry.find(e => e.key === experimentKey)
    if (!experiment || !experiment.enabled || experiment.variants.length === 0) {
      return null
    }

    // Random assignment
    const randomIndex = Math.floor(Math.random() * experiment.variants.length)
    const variant = experiment.variants[randomIndex]

    // Persist the assignment
    const newAssignments = {
      ...state.assignments,
      [experimentKey]: { variant, assignedAt: Date.now() },
    }
    set({ assignments: newAssignments })
    saveToStorage(STORAGE_KEY, newAssignments)

    return variant
  },

  setOverride: (experimentKey: string, variant: string) => {
    const newOverrides = { ...get().overrides, [experimentKey]: variant }
    set({ overrides: newOverrides })
    saveToStorage(OVERRIDES_KEY, newOverrides)
  },

  clearOverride: (experimentKey: string) => {
    const newOverrides = { ...get().overrides }
    delete newOverrides[experimentKey]
    set({ overrides: newOverrides })
    saveToStorage(OVERRIDES_KEY, newOverrides)
  },

  registerExperiments: (experiments: ExperimentDefinition[]) => {
    set({ registry: experiments })
  },

  assignVariant: (experimentKey: string, variant: string) => {
    const newAssignments = {
      ...get().assignments,
      [experimentKey]: { variant, assignedAt: Date.now() },
    }
    set({ assignments: newAssignments })
    saveToStorage(STORAGE_KEY, newAssignments)
  },
}))
