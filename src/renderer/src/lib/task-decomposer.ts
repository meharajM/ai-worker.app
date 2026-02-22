/**
 * Task Decomposer Module
 * 
 * Analyzes user requests to determine the optimal decomposition strategy:
 * - Sequential by default (fixes Issue 1)
 * - Parallel only when: (a) parallel keywords detected AND (b) LLM verifies independence
 * - Single context, complex tasks → Sequential sub-agent
 */

import { chat } from './llm';

export interface TaskDecomposition {
  type: 'single_context' | 'multi_context';
  contexts: string[];           // URLs or app names detected
  estimatedActions: number;     // Estimated number of actions needed
  shouldFork: boolean;          // Whether to spawn sub-agents
  forkReason?: string;          // Explanation for the decision
  forkStrategy?: 'parallel' | 'sequential'; // How to execute sub-agents
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

// Multi-step task indicators
const MULTI_STEP_INDICATORS = [
  'and then', 'after that', 'next', 'finally', 'then',
  'step 1', 'step 2', 'first', 'second', 'third',
  'compare', 'multiple', 'several', 'all', 'each',
];

// Simple cache for LLM analysis results (avoid redundant calls)
const analysisCache = new Map<string, {
  result: { shouldParallelize: boolean; contexts: string[]; reasoning: string };
  timestamp: number;
}>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;

function getCachedAnalysis(userRequest: string) {
  const cached = analysisCache.get(userRequest);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[TaskDecomposer] Using cached analysis');
    return cached.result;
  }
  return null;
}

function setCachedAnalysis(
  userRequest: string,
  result: { shouldParallelize: boolean; contexts: string[]; reasoning: string }
) {
  // Simple LRU: if cache is full, remove oldest entry
  if (analysisCache.size >= MAX_CACHE_SIZE) {
    const firstKey = analysisCache.keys().next().value;
    if (firstKey !== undefined) {
      analysisCache.delete(firstKey);
    }
  }
  analysisCache.set(userRequest, { result, timestamp: Date.now() });
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
 * Use LLM to analyze task and detect contexts + dependencies
 * Returns execution strategy with detected contexts
 */
async function analyzeTaskWithLLM(
  userRequest: string,
  settings: any
): Promise<{
  shouldParallelize: boolean;
  contexts: string[];
  reasoning: string;
}> {
  // Check cache first to avoid redundant LLM calls
  const cached = getCachedAnalysis(userRequest);
  if (cached) {
    return cached;
  }

  const prompt = `Analyze this workflow automation request and determine the optimal execution strategy.

User Request: "${userRequest}"

TASK:
1. Identify if there are multiple INDEPENDENT contexts that can be processed in PARALLEL
2. Extract the contexts (e.g., websites, files, APIs, applications, data sources, locations)
3. Determine if tasks have dependencies between them

CONTEXT TYPES TO CONSIDER:
- Websites/URLs (amazon.com, google.com)
- Files/Directories (multiple files to process)
- Applications (Excel, Word, different browser tabs)
- APIs/Services (different API endpoints)
- Data sources (databases, spreadsheets, documents)
- Locations (cities, regions for data collection)
- Entities (companies, products, people to research)

CRITICAL RULES FOR PARALLELIZATION:
✅ PARALLEL: Only if multiple contexts exist AND they have ZERO dependencies
  - Each context can be processed independently
  - No task needs output from another
  - Can run simultaneously without conflicts

❌ SEQUENTIAL: Use in these cases:
  - One task needs output from another (dependency chain)
  - Single context/workflow
  - Conditional logic (if X then Y)
  - Multi-step workflow on same context
  - Verbs like "google" (action) vs "google.com" (website)

EXAMPLES:

PARALLEL (Multiple Independent Contexts):
✅ "Compare laptop prices on Amazon, eBay, and BestBuy" → 3 websites, independent
✅ "Extract data from file1.csv, file2.csv, and file3.csv" → 3 files, independent
✅ "Get weather for NYC, LA, and Chicago" → 3 locations, independent
✅ "Check order status on Amazon and track package on FedEx" → 2 platforms, independent
✅ "Fetch user data from API1 and API2" → 2 APIs, independent

SEQUENTIAL (Single Context or Dependent Tasks):
❌ "google flipkart.com and give me details" → "google" is a verb, 1 context: flipkart.com
❌ "Search Amazon for laptops, then compare top result with eBay" → Dependent (eBay needs Amazon)
❌ "Research Apple and Microsoft trends" → Single research task, 2 topics
❌ "Process file1.csv, then use results to update file2.csv" → Dependent workflow
❌ "Check price on Amazon, if over $500 check eBay" → Conditional dependency
❌ "Fill form on website1, submit, then download confirmation" → Sequential workflow

Return JSON:
{
  "should_parallelize": true/false,
  "contexts": ["context1", "context2", ...],
  "reasoning": "Brief explanation of decision"
}`;

  try {
    // Add timeout to prevent hanging (max 5 seconds for analysis)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('LLM analysis timeout')), 5000)
    );

    const llmPromise = chat(
      [{ role: 'user', content: prompt }],
      undefined,
      settings
    );

    const response = await Promise.race([llmPromise, timeoutPromise]) as any;

    // Parse and validate response
    const result = JSON.parse(response.content || '{}');

    // Validate required fields
    if (typeof result.should_parallelize !== 'boolean') {
      throw new Error('Invalid LLM response: missing should_parallelize');
    }
    if (!Array.isArray(result.contexts)) {
      throw new Error('Invalid LLM response: contexts must be array');
    }

    // Normalize contexts (lowercase, trim)
    const normalizedContexts = result.contexts
      .map((ctx: string) => ctx.toLowerCase().trim())
      .filter((ctx: string) => ctx.length > 0);

    const analysisResult = {
      shouldParallelize: result.should_parallelize || false,
      contexts: normalizedContexts.length > 0 ? normalizedContexts : ['current_page'],
      reasoning: result.reasoning || 'LLM analysis completed'
    };

    // Cache the result for future use
    setCachedAnalysis(userRequest, analysisResult);

    return analysisResult;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[TaskDecomposer] LLM analysis failed:', errorMsg);

    // Default to sequential if parsing fails (safer option)
    // This handles: network errors, timeouts, malformed JSON, invalid responses
    return {
      shouldParallelize: false,
      contexts: ['current_page'],
      reasoning: `LLM analysis failed (${errorMsg}), defaulting to sequential`
    };
  }
}

/**
 * Main function to analyze a task and determine decomposition strategy
 * Now uses LLM for complete context detection and dependency analysis
 */
export async function analyzeTaskForDecomposition(
  userRequest: string,
  settings: any,
  currentUrl?: string
): Promise<TaskDecomposition> {
  const estimatedActions = countActions(userRequest);

  // Use LLM to analyze task for contexts and dependencies
  console.log('[TaskDecomposer] Analyzing task with LLM...');
  const analysis = await analyzeTaskWithLLM(userRequest, settings);

  // If LLM recommends parallel execution
  if (analysis.shouldParallelize && analysis.contexts.length > 1) {
    console.log(`[TaskDecomposer] LLM detected ${analysis.contexts.length} independent contexts: ${analysis.contexts.join(', ')}`);
    return {
      type: 'multi_context',
      contexts: analysis.contexts,
      estimatedActions,
      shouldFork: true,
      forkStrategy: 'parallel',
      forkReason: `LLM-verified independent tasks: ${analysis.reasoning}`
    };
  }

  console.log(`[TaskDecomposer] Sequential execution: ${analysis.reasoning}`);

  // For backward compatibility, still check if this is a complex single-context task
  // that might benefit from a sequential sub-agent
  const hasMultiStepLanguage = MULTI_STEP_INDICATORS.some(indicator =>
    userRequest.toLowerCase().includes(indicator)
  );

  if (analysis.contexts.length === 1 && estimatedActions >= 4) {
    return {
      type: 'single_context',
      contexts: analysis.contexts,
      estimatedActions,
      shouldFork: true,
      forkReason: `Task involves ${estimatedActions} actions - using sub-agent to protect context`,
      forkStrategy: 'sequential'
    };
  }

  if (analysis.contexts.length === 0 && estimatedActions >= 5 && hasMultiStepLanguage) {
    return {
      type: 'single_context',
      contexts: ['current_page'],
      estimatedActions,
      shouldFork: true,
      forkReason: `Complex multi-step task (~${estimatedActions} actions) - using sub-agent to protect context`,
      forkStrategy: 'sequential'
    };
  }

  // DEFAULT: Sequential/direct execution
  return {
    type: 'single_context',
    contexts: analysis.contexts.length > 0 ? analysis.contexts : ['current_page'],
    estimatedActions,
    shouldFork: false,
    forkReason: analysis.reasoning
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
  const isComparison = allContexts.length > 1;

  if (isComparison) {
    return `SUB-AGENT TASK: ${targetContext}
CRITICAL ROLE: You are a highly specialized sub-agent.
YOUR EXCLUSIVE TARGET: **${targetContext}**

You have ONE job: Extract data ONLY for ${targetContext}.
DO NOT perform generalized searches. DO NOT click links to other websites. 
If you need to search, append "${targetContext}" to your search query to keep results scoped to your target.

BACKGROUND CONTEXT (Why you are doing this):
The main agent is trying to: "${originalRequest}"
Other agents are already handling: ${allContexts.filter(c => c !== targetContext).join(', ')}. Do not duplicate their work!

EXECUTION RULES:
1. Navigate directly to ${targetContext} (if it's a website) OR search specifically for your target.
2. Extract the specifically requested info for ${targetContext}.
3. Ignore all other websites/retailers in the search results.

OUTPUT REQUIREMENTS:
- **Structured Bullet Points**: Use a list format for clarity.
- **Bold Key Terms**: Bold the main item name or key feature (e.g., **Price:** $99).
- **Concise**: Max 150 words.
- NO navigation steps or process descriptions.
- End your final message with exactly: "✓ ${targetContext} complete"

Example:
"- **Dell XPS 13**: $1299, 16GB RAM, ships in 2 days.
- **Rating**: 4.5/5 stars (2k reviews).
- ✓ ${targetContext} complete"`;
  }

  return `SUB-AGENT TASK

OBJECTIVE: ${originalRequest}

OUTPUT REQUIREMENTS:
- Execute task step-by-step
- Return **concise summary** (max 200 words)
- Use <think> tags for internal reasoning
- Focus on results, not process
- End with: "✓ Complete"`;
}
