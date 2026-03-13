/**
 * Shared motion duration constants that mirror the CSS design tokens
 * in design-tokens.css. Use these for framer-motion `transition.duration`
 * values so animations stay in sync with the CSS layer.
 *
 * CSS side:   var(--duration-fast)    → 0.15s
 * JS side:    MOTION.duration.fast    → 0.15
 */
export const MOTION = {
  duration: {
    /** 150ms — micro-interactions, tooltips, fades */
    fast: 0.15,
    /** 300ms — standard transitions, collapsibles */
    normal: 0.3,
    /** 500ms — large layout shifts, hero animations */
    slow: 0.5,
  },
  ease: {
    /** Standard ease-out for entrances */
    out: [0.0, 0.0, 0.2, 1] as const,
    /** Standard ease-in for exits */
    in: [0.4, 0.0, 1, 1] as const,
    /** Standard ease-in-out for symmetrical transitions */
    inOut: [0.4, 0.0, 0.2, 1] as const,
  },
} as const
