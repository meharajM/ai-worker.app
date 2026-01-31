/**
 * Task Decomposer Module
 * 
 * Analyzes user requests to determine the optimal decomposition strategy:
 * - Multiple websites/apps → Parallel sub-agents (1 per context)
 * - Single context, 3+ actions → Sub-agent to protect main context
 * - Single context, 1-2 actions → Direct execution
 */

export interface TaskDecomposition {
  type: 'single_context' | 'multi_context';
  contexts: string[];           // URLs or app names detected
  estimatedActions: number;     // Estimated number of actions needed
  shouldFork: boolean;          // Whether to spawn sub-agents
  forkReason?: string;          // Explanation for the decision
  forkStrategy?: 'parallel' | 'sequential'; // How to execute sub-agents
}

// Common website patterns to detect
const WEBSITE_PATTERNS = [
  /amazon\.com/i,
  /ebay\.com/i,
  /google\.com/i,
  /youtube\.com/i,
  /facebook\.com/i,
  /twitter\.com|x\.com/i,
  /linkedin\.com/i,
  /instagram\.com/i,
  /reddit\.com/i,
  /github\.com/i,
  /netflix\.com/i,
  /spotify\.com/i,
  /bestbuy\.com/i,
  /walmart\.com/i,
  /target\.com/i,
  /newegg\.com/i,
  /booking\.com/i,
  /airbnb\.com/i,
  /expedia\.com/i,
  /kayak\.com/i,
  /tripadvisor\.com/i,
  /yelp\.com/i,
  /zillow\.com/i,
  /craigslist\.org/i,
  /indeed\.com/i,
  /glassdoor\.com/i,
];

// Generic URL pattern
const URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+)/gi;

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

// Multi-step task indicators
const MULTI_STEP_INDICATORS = [
  'and then', 'after that', 'next', 'finally', 'then',
  'step 1', 'step 2', 'first', 'second', 'third',
  'compare', 'multiple', 'several', 'all', 'each',
];

/**
 * Extract unique website/domain mentions from text
 */
function extractWebsites(text: string): string[] {
  const websites = new Set<string>();

  // Check for known website patterns
  for (const pattern of WEBSITE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      websites.add(match[0].toLowerCase().replace('www.', ''));
    }
  }

  // Also check for generic URLs
  const urlMatches = text.match(URL_PATTERN);
  if (urlMatches) {
    for (const url of urlMatches) {
      const domain = url.replace(/https?:\/\//i, '').replace('www.', '').split('/')[0];
      websites.add(domain.toLowerCase());
    }
  }

  // Check for website mentions without full URLs (e.g., "on Amazon", "at BestBuy")
  const textLower = text.toLowerCase();
  const siteKeywords = [
    'amazon', 'ebay', 'google', 'youtube', 'facebook', 'twitter',
    'linkedin', 'instagram', 'reddit', 'github', 'netflix', 'spotify',
    'bestbuy', 'best buy', 'walmart', 'target', 'newegg', 'booking',
    'airbnb', 'expedia', 'kayak', 'tripadvisor', 'yelp', 'zillow',
    'craigslist', 'indeed', 'glassdoor'
  ];

  for (const site of siteKeywords) {
    if (textLower.includes(site)) {
      // Normalize "best buy" to "bestbuy"
      websites.add(site.replace(' ', ''));
    }
  }

  return Array.from(websites);
}

/**
 * Count estimated actions in a request
 */
function countActions(text: string): number {
  const textLower = text.toLowerCase();
  let actionCount = 0;

  for (const keyword of ACTION_KEYWORDS) {
    // Count occurrences (but not duplicates in same phrase)
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = textLower.match(regex);
    if (matches) {
      actionCount += matches.length;
    }
  }

  // Check for multi-step indicators
  for (const indicator of MULTI_STEP_INDICATORS) {
    if (textLower.includes(indicator)) {
      actionCount += 1; // Add bonus for multi-step language
    }
  }

  // Minimum of 1 action if any website is mentioned
  return Math.max(actionCount, 1);
}

/**
 * Main function to analyze a task and determine decomposition strategy
 */
export function analyzeTaskForDecomposition(
  userRequest: string,
  currentUrl?: string
): TaskDecomposition {
  const websites = extractWebsites(userRequest);
  const estimatedActions = countActions(userRequest);

  // Add current URL context if provided and not already in list
  if (currentUrl) {
    const currentDomain = currentUrl.replace(/https?:\/\//i, '').replace('www.', '').split('/')[0];
    if (!websites.includes(currentDomain.toLowerCase())) {
      // Don't add - we only care about mentioned websites
    }
  }

  // Decision logic
  if (websites.length > 1) {
    // Multiple websites = parallel sub-agents
    return {
      type: 'multi_context',
      contexts: websites,
      estimatedActions,
      shouldFork: true,
      forkReason: `Task involves ${websites.length} websites: ${websites.join(', ')}`,
      forkStrategy: 'parallel'
    };
  }

  if (websites.length === 1 && estimatedActions >= 4) {
    return {
      type: 'single_context',
      contexts: websites,
      estimatedActions,
      shouldFork: true,
      forkReason: `Task involves ${estimatedActions} actions on ${websites[0]} - using sub-agent to protect context`,
      forkStrategy: 'sequential'
    };
  }

  // No website mentioned but many actions - still might benefit from orchestration
  // But only if there's clear multi-step language AND 5+ actions (higher threshold for generic tasks)
  const hasMultiStepLanguage = MULTI_STEP_INDICATORS.some(indicator =>
    userRequest.toLowerCase().includes(indicator)
  );
  if (websites.length === 0 && estimatedActions >= 5 && hasMultiStepLanguage) {
    return {
      type: 'single_context',
      contexts: ['current_page'],
      estimatedActions,
      shouldFork: true,
      forkReason: `Complex multi-step task (~${estimatedActions} actions) - using sub-agent to protect context`,
      forkStrategy: 'sequential'
    };
  }

  // Simple task - direct execution
  return {
    type: 'single_context',
    contexts: websites.length > 0 ? websites : ['current_page'],
    estimatedActions,
    shouldFork: false,
    forkReason: 'Simple task - direct execution'
  };
}

/**
 * Generate sub-agent instructions for a specific context
 */
export function generateSubAgentInstruction(
  originalRequest: string,
  targetContext: string,
  allContexts: string[]
): string {
  // MINIMAL instruction - just target and goal
  if (allContexts.length > 1) {
    // Parallel comparison - focus on one site
    return `On ${targetContext}: ${originalRequest}

Return key findings only. End with "✓ Done".`;
  }

  // Single context
  return `${originalRequest}

Return brief result. End with "✓ Done".`;
}
