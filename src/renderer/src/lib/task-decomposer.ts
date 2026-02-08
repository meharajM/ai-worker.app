/**
 * Task Decomposer Module (Simplified)
 * 
 * Analyzes user requests to determine if they are simple or complex.
 * Complex tasks are handed off to the Orchestrator for structured planning.
 */

export interface TaskDecomposition {
  type: 'simple' | 'complex';
  estimatedActions: number;     // Estimated number of actions needed
  shouldFork: boolean;          // Whether to spawn sub-agents
  forkReason?: string;          // Explanation for the decision
}

// Action keywords that indicate browser/UI actions
const ACTION_KEYWORDS = [
  // Navigation
  'go to', 'open', 'navigate', 'visit', 'browse',
  // Search
  'search', 'find', 'look for', 'look up', 'search for',
  // Interaction
  'click', 'tap', 'press', 'select', 'choose', 'pick',
  // Input
  'type', 'enter', 'fill', 'write', 'input', 'fill out', 'fill in',
  // Form actions
  'submit', 'send', 'confirm', 'apply', 'save',
  // Shopping
  'add to cart', 'buy', 'purchase', 'checkout', 'order',
  // Comparison
  'compare', 'vs', 'versus', 'difference between',
  // Data extraction
  'get', 'extract', 'copy', 'download', 'scrape',
  // Scrolling
  'scroll', 'scroll down', 'scroll up',
  // Verification
  'check', 'verify', 'confirm', 'validate',
];

// Multi-step task indicators (sequential)
const MULTI_STEP_INDICATORS = [
  'and then', 'after that', 'next', 'finally', 'then',
  'step 1', 'step 2', 'first', 'second', 'third',
];

// Parallel task indicators (manual request for parallelism)
const PARALLEL_INDICATORS = [
  'simultaneously', 'concurrently', 'at the same time', 'parallel',
  'both', 'all of', 'simultaneous', 'in parallel'
];

/**
 * Count estimated actions in a request
 */
function countActions(text: string): number {
  const textLower = text.toLowerCase();
  let actionCount = 0;

  for (const keyword of ACTION_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = textLower.match(regex);
    if (matches) {
      actionCount += matches.length;
    }
  }

  // Count sequential multi-step indicators
  for (const indicator of MULTI_STEP_INDICATORS) {
    if (textLower.includes(indicator)) {
      actionCount += 1;
    }
  }

  // Count parallel indicators as "complex" but distinct logic
  for (const indicator of PARALLEL_INDICATORS) {
    if (textLower.includes(indicator)) {
      actionCount += 2; // Parallel tasks usually involve multiple steps
    }
  }

  return Math.max(actionCount, 1);
}

/**
 * Analyze task and decide if it needs decomposition
 */
export function analyzeTaskForDecomposition(text: string): TaskDecomposition {
  const actions = countActions(text);
  const textLower = text.toLowerCase();

  // Complexity indicators:
  // 1. High action count
  // 2. Presence of parallel indicators (and, both, all)
  // 3. Presence of list patterns (A, B, and C)
  const hasParallelKeywords = PARALLEL_INDICATORS.some(p => textLower.includes(p));
  const hasListPattern = (text.match(/,/g) || []).length >= 1 && textLower.includes('and');
  const hasConjunction = textLower.includes(' and ') && actions >= 1;

  const isComplex = actions >= 3 || hasParallelKeywords || hasListPattern || (actions >= 2 && hasConjunction);

  if (isComplex) {
    return {
      type: 'complex',
      estimatedActions: actions,
      shouldFork: true,
      forkReason: `Task detected as complex (${actions} actions, keywords: ${hasParallelKeywords}, list: ${hasListPattern}).`
    };
  }

  return {
    type: 'simple',
    estimatedActions: actions,
    shouldFork: false,
    forkReason: 'Task is simple and can be handled in a single context.'
  };
}

/**
 * Generate sub-agent instructions for a specific context
 */
export function generateSubAgentInstruction(
  originalRequest: string,
  targetContext: string
): string {
  return `Target: ${targetContext}. Goal: ${originalRequest}\n\nReturn brief result. End with "✓ Done".`;
}
