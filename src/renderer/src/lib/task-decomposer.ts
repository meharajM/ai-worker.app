/**
 * Task Decomposer Module
 * 
 * Analyzes user requests to determine if they are simple or complex.
 * Complex tasks are handed off to the Orchestrator for structured planning.
 */

export interface TaskDecomposition {
  type: 'simple' | 'complex';
  estimatedActions: number;     // Estimated number of actions needed
  shouldFork: boolean;          // Whether to spawn sub-agents
  contexts: string[];           // Extracted contexts (e.g. websites, entities) for parallel tasks
  forkReason?: string;          // Explanation for the decision
}

// Action keywords that indicate browser/UI actions
const ACTION_KEYWORDS = [
  'go to', 'open', 'navigate', 'visit', 'browse',
  'search', 'find', 'look for', 'look up', 'search for',
  'click', 'tap', 'press', 'select', 'choose', 'pick',
  'type', 'enter', 'fill', 'write', 'input', 'fill out', 'fill in',
  'submit', 'send', 'confirm', 'apply', 'save',
  'add to cart', 'buy', 'purchase', 'checkout', 'order',
  'compare', 'vs', 'versus', 'difference between',
  'get', 'extract', 'copy', 'download', 'scrape',
  'scroll', 'scroll down', 'scroll up',
  'check', 'verify', 'confirm', 'validate',
];

// Multi-step task indicators (sequential)
const MULTI_STEP_INDICATORS = [
  'and then', 'after that', 'next', 'finally', 'then',
  'step 1', 'step 2', 'first', 'second', 'third',
];

// Parallel task indicators
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

  for (const indicator of MULTI_STEP_INDICATORS) {
    if (textLower.includes(indicator)) {
      actionCount += 1;
    }
  }

  for (const indicator of PARALLEL_INDICATORS) {
    if (textLower.includes(indicator)) {
      actionCount += 2;
    }
  }

  return Math.max(actionCount, 1);
}

/**
 * Extract contexts (websites, entities) for parallel processing
 */
function extractContexts(text: string): string[] {
  const textLower = text.toLowerCase();

  // Look for comparison patterns: "Amazon vs eBay vs Walmart"
  if (textLower.includes(' vs ') || textLower.includes(' versus ')) {
    return text.split(/\s+vs\s+|\s+versus\s+/i).map(c => c.trim());
  }

  // Look for "on X and Y"
  const onMatch = text.match(/\bon\s+(.+?)(?:\.|$)/i);
  if (onMatch) {
    const apps = onMatch[1].split(/\s+and\s+|,\s*/i);
    if (apps.length > 1) return apps.map(a => a.trim());
  }

  return [];
}

/**
 * Analyze task and decide if it needs decomposition
 */
export function analyzeTaskForDecomposition(text: string): TaskDecomposition {
  const actions = countActions(text);
  const contexts = extractContexts(text);
  const textLower = text.toLowerCase();

  const hasParallelKeywords = PARALLEL_INDICATORS.some(p => textLower.includes(p));
  const hasListPattern = (text.match(/,/g) || []).length >= 1 && textLower.includes('and');
  const hasConjunction = textLower.includes(' and ') && actions >= 1;

  const isComplex = actions >= 3 || hasParallelKeywords || hasListPattern || (actions >= 2 && hasConjunction) || contexts.length > 1;

  return {
    type: isComplex ? 'complex' : 'simple',
    estimatedActions: actions,
    shouldFork: isComplex,
    contexts: contexts,
    forkReason: isComplex ? `Complex task (${actions} actions, ${contexts.length} contexts)` : 'Simple task'
  };
}

/**
 * Generate high-fidelity sub-agent instructions
 */
export function generateSubAgentInstruction(
  originalRequest: string,
  targetContext: string,
  allContexts: string[] = []
): string {
  const isComparison = allContexts.length > 1;

  if (isComparison) {
    return `SUB-AGENT TASK: ${targetContext}

OBJECTIVE: ${originalRequest}

YOUR SCOPE: Focus ONLY on ${targetContext}. Other agents handle: ${allContexts.filter(c => c !== targetContext).join(', ')}

OUTPUT REQUIREMENTS:
- **Structured Bullet Points**: Use a list format for clarity.
- **Bold Key Terms**: Bold the main item name or key feature (e.g., **Price:** $99).
- **Concise**: Max 150 words.
- NO navigation steps or process descriptions.
- End with: "✓ ${targetContext} complete"

Example:
"- **Dell XPS 13**: $1299, 16GB RAM, ships in 2 days.
- **Rating**: 4.5/5 stars (2k reviews).
- ✓ ${targetContext} complete"`;
  }

  return `SUB-AGENT TASK

OBJECTIVE: ${originalRequest}

CURRENT FOCUS: ${targetContext}

OUTPUT REQUIREMENTS:
- Execute task step-by-step
- Return **concise summary** (max 200 words)
- Use <think> tags for internal reasoning
- Focus on results, not process
- End with: "✓ Complete"`;
}
