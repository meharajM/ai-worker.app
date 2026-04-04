/**
 * Task Decomposer Module
 * 
 * Analyzes user requests to determine the optimal decomposition strategy:
 * - Sequential by default (fixes Issue 1)
 * - Parallel only when: (a) parallel keywords detected AND (b) LLM verifies independence
 * - Single context, complex tasks → Sequential sub-agent
 */

import { chat } from './llm';
import { LLMResponse } from './types';

export interface TaskDecomposition {
  type: 'single_context' | 'multi_context';
  contexts: string[];           // URLs or app names detected
  estimatedActions: number;     // Estimated number of actions needed
  shouldFork: boolean;          // Whether to spawn sub-agents
  forkReason?: string;          // Explanation for the decision
  forkStrategy?: 'parallel' | 'sequential'; // How to execute sub-agents
  /** Confidence score 0–1 for the decomposition decision (Issue #4 #14) */
  confidence?: number;
  /** Whether the decision came from heuristics or LLM analysis (Issue #4 #14) */
  decisionSource?: 'heuristic' | 'llm' | 'fallback';
  /** If the decision was a fallback, why (Issue #4) */
  fallbackReason?: string;
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

const DOMAIN_PATTERN = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.(?:com|org|net|io|in|co|ai|gov|edu|us|uk|de|fr|ca|au|jp|es|it|nl|se|no|fi|pl|biz|info|me))\b/gi;
const PARALLEL_INTENT_PATTERN = /\b(compare|across|between|both|each|vs|versus|in parallel|simultaneously)\b/i;
const SEQUENTIAL_INTENT_PATTERN = /\b(and then|then|after that|next|finally|first|second|third|before|once)\b/i;
const CONDITIONAL_SEQUENTIAL_INTENT_PATTERN = /\b(if|unless)\b[\s\S]{0,80}\b(then|else|otherwise)\b/i;
const OPTIONAL_CONDITIONAL_PATTERN = /\bif\s+(possible|available|you can|feasible)\b/i;
const DEPENDENCY_CHAIN_PATTERN = /\b(then|after that|use (the )?(result|output|data) (from|of)|based on)\b/i;
const WEBSITE_ALIAS_TO_DOMAIN: Record<string, string> = {
  amazon: 'amazon.com',
  ebay: 'ebay.com',
  bestbuy: 'bestbuy.com',
  flipkart: 'flipkart.com',
  reuters: 'reuters.com',
  bbc: 'bbc.com',
  cnn: 'cnn.com',
  redbus: 'redbus.in',
  ajio: 'ajio.com',
  'hacker news': 'news.ycombinator.com',
  ycombinator: 'news.ycombinator.com',
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractExplicitWebsiteContexts(text: string): string[] {
  const normalized = new Set<string>();
  for (const match of text.matchAll(DOMAIN_PATTERN)) {
    const domain = (match[1] || match[0]).toLowerCase().replace(/^www\./, '').trim();
    if (domain) normalized.add(domain);
  }
  const lower = text.toLowerCase();
  for (const [alias, domain] of Object.entries(WEBSITE_ALIAS_TO_DOMAIN)) {
    const aliasPattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
    if (aliasPattern.test(lower)) {
      normalized.add(domain);
    }
  }
  return Array.from(normalized);
}

// Simple cache for LLM analysis results (avoid redundant calls)
const analysisCache = new Map<string, {
  result: { shouldParallelize: boolean; contexts: string[]; reasoning: string };
  timestamp: number;
}>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;

function getCacheKey(request: string, context?: string): string {
  if (!context) return request;
  // Simple hash to keep key reasonable size
  let hash = 0;
  for (let i = 0; i < context.length; i++) {
    hash = ((hash << 5) - hash) + context.charCodeAt(i);
    hash |= 0;
  }
  return `${request}|${Math.abs(hash).toString(16)}`;
}

function getCachedAnalysis(userRequest: string, conversationSummary?: string) {
  const key = getCacheKey(userRequest, conversationSummary);
  const cached = analysisCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[TaskDecomposer] Using cached analysis');
    return cached.result;
  }
  return null;
}

function setCachedAnalysis(
  userRequest: string,
  result: { shouldParallelize: boolean; contexts: string[]; reasoning: string },
  conversationSummary?: string
) {
  const key = getCacheKey(userRequest, conversationSummary);
  // Simple LRU: if cache is full, remove oldest entry
  if (analysisCache.size >= MAX_CACHE_SIZE) {
    const firstKey = analysisCache.keys().next().value;
    if (firstKey !== undefined) {
      analysisCache.delete(firstKey);
    }
  }
  analysisCache.set(key, { result, timestamp: Date.now() });
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
  settings: any,
  conversationSummary?: string
): Promise<{
  shouldParallelize: boolean;
  contexts: string[];
  reasoning: string;
}> {
  // Check cache first to avoid redundant LLM calls
  const cached = getCachedAnalysis(userRequest, conversationSummary);
  if (cached) {
    console.info(`[TaskDecomposer][Issue #4/#14/#26] Cache hit. parallel=${cached.shouldParallelize} contexts=${cached.contexts.join(',')}`);
    return cached;
  }

  // Build conversation context block for follow-up detection
  const conversationBlock = conversationSummary
    ? `\nCONVERSATION HISTORY (previous messages in this session):\n${conversationSummary}\n\nIMPORTANT: If the user request above is a follow-up question referencing data from the conversation history (e.g., "give me links", "show me more details", "which one is cheapest"), then it is NOT a new multi-context task. It should be answered using the existing context — set should_parallelize to false and contexts to ["current_page"].\n`
    : '';

  const prompt = `Analyze this workflow automation request and determine the optimal execution strategy.

User Request: "${userRequest}"
${conversationBlock}
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

❌ SEQUENTIAL / DIRECT: Use in these cases:
  - One task needs output from another (dependency chain)
  - Single context/workflow
  - Conditional logic (if X then Y)
  - Multi-step workflow on same context
  - Verbs like "google" (action) vs "google.com" (website)
  - **FOLLOW-UP QUESTIONS** referencing previous results (the data already exists in the conversation)

EXAMPLES:

PARALLEL (Multiple Independent Contexts):
✅ "Compare laptop prices on Amazon, eBay, and BestBuy" → 3 websites, independent
✅ "Extract data from file1.csv, file2.csv, and file3.csv" → 3 files, independent
✅ "Get weather for NYC, LA, and Chicago" → 3 locations, independent
✅ "Check order status on Amazon and track package on FedEx" → 2 platforms, independent
✅ "Fetch user data from API1 and API2" → 2 APIs, independent

SEQUENTIAL / DIRECT (Single Context or Dependent Tasks):
❌ "google flipkart.com and give me details" → "google" is a verb, 1 context: flipkart.com
❌ "Search Amazon for laptops, then compare top result with eBay" → Dependent (eBay needs Amazon)
❌ "Research Apple and Microsoft trends" → Single research task, 2 topics
❌ "Process file1.csv, then use results to update file2.csv" → Dependent workflow
❌ "Check price on Amazon, if over $500 check eBay" → Conditional dependency
❌ "Fill form on website1, submit, then download confirmation" → Sequential workflow
❌ "give me links for products" → Follow-up, data exists in history, no new browsing
❌ "which one is cheapest?" → Follow-up, answer from existing data
❌ "show me more details" → Follow-up referencing prior results

Return ONLY valid JSON, do not include any markdown formatting or conversational text:
{
  "should_parallelize": true/false,
  "contexts": ["context1", "context2", ...],
  "reasoning": "Brief explanation of decision"
}`;

  try {
    const startedAt = Date.now();
    // ── Deadline-aware decomposition (Issue #4) ──────────────────────────
    // If the LLM call nears the timeout budget, we fall back to the
    // deterministic heuristic path instead of a broad fallback that loses
    // the multi-site context detection.
    const DECOMP_TIMEOUT_MS = 12000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('LLM analysis timeout')), DECOMP_TIMEOUT_MS)
    );

    const llmPromise = chat(
      [{ role: 'user', content: prompt }],
      undefined,
      settings
    );

    const response = await Promise.race([llmPromise, timeoutPromise]) as LLMResponse;

    // Extract JSON from response (handle markdown blocks and conversational text)
    let jsonContent = response.content || '{}';
    const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1];
    } else {
      const firstBrace = jsonContent.indexOf('{');
      const lastBrace = jsonContent.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
        jsonContent = jsonContent.substring(firstBrace, lastBrace + 1);
      }
    }

    // Parse and validate response
    const result = JSON.parse(jsonContent);

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

    console.info(
      `[TaskDecomposer][Issue #4/#14/#26] LLM analysis completed in ${Date.now() - startedAt}ms. parallel=${analysisResult.shouldParallelize} contexts=${analysisResult.contexts.join(',')} reason="${analysisResult.reasoning}"`
    );

    // Cache the result for future use
    setCachedAnalysis(userRequest, analysisResult, conversationSummary);

    return analysisResult;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Unknown error';
    const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('Timeout');
    console.error(`[TaskDecomposer][Issue #4/#14/#26] LLM analysis failed: ${errorMsg} isTimeout=${isTimeout}`);

    // ── Deadline-aware fallback (Issue #4) ─────────────────────────────
    // When the timeout fires, fall back to heuristic-based multi-site
    // detection instead of collapsing to single_context. This preserves
    // the parallel intent when the LLM call is just too slow.
    if (isTimeout) {
      const heuristicContexts = extractExplicitWebsiteContexts(userRequest);
      if (heuristicContexts.length > 1 && PARALLEL_INTENT_PATTERN.test(userRequest)) {
        console.info(
          `[TaskDecomposer][Issue #4] timeout_heuristic_fallback contexts=${heuristicContexts.join(',')}`
        );
        return {
          shouldParallelize: true,
          contexts: heuristicContexts,
          reasoning: `LLM timed out — heuristic fallback detected ${heuristicContexts.length} independent contexts`
        };
      }
    }

    // Default to sequential if parsing fails (safer option)
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
  currentUrl?: string,
  conversationHistory?: Array<{ role: string; content: string }>
): Promise<TaskDecomposition> {
  const startedAt = Date.now();
  const estimatedActions = countActions(userRequest);
  const requestLower = userRequest.toLowerCase();
  const explicitContexts = extractExplicitWebsiteContexts(userRequest);
  const hasActionKeyword = ACTION_KEYWORDS.some((keyword) => requestLower.includes(keyword));
  const hasWebsiteReference = explicitContexts.length > 0;

  // Fast path: avoid an extra decomposer LLM call for simple non-automation prompts.
  if (!hasWebsiteReference && !hasActionKeyword && userRequest.trim().length <= 220) {
    console.info(`[TaskDecomposer][Issue #4/#14/#26] direct-short-circuit: no website/action keywords (elapsed=${Date.now() - startedAt}ms)`);
    return {
      type: 'single_context',
      contexts: ['current_page'],
      estimatedActions: 1,
      shouldFork: false,
      forkReason: 'Simple direct request — skipping decomposition analysis',
      confidence: 1.0,
      decisionSource: 'heuristic',
    };
  }

  // Fast path: single explicit site workflows rarely need decomposition analysis.
  if (
    explicitContexts.length === 1 &&
    !PARALLEL_INTENT_PATTERN.test(userRequest) &&
    !SEQUENTIAL_INTENT_PATTERN.test(userRequest) &&
    estimatedActions <= 4
  ) {
    console.info(`[TaskDecomposer][Issue #4/#14/#26] direct-single-site short-circuit: ${explicitContexts[0]} (elapsed=${Date.now() - startedAt}ms)`);
    return {
      type: 'single_context',
      contexts: explicitContexts,
      estimatedActions,
      shouldFork: false,
      forkReason: `Single-site task (${explicitContexts[0]}) — direct execution`,
      confidence: 0.95,
      decisionSource: 'heuristic',
    };
  }

  // ── Follow-up detection guard ──────────────────────────────────────────────
  // If there's existing conversation context AND the user prompt is short/vague
  // (a follow-up), skip the decomposer entirely. Follow-ups should use the
  // main agent's conversation context, not spawn fresh sub-agents.
  if (conversationHistory && conversationHistory.length > 0) {
    const hasAssistantResults = conversationHistory.some(
      m => m.role === 'assistant' && m.content && m.content.length > 50
    );
    const isShortPrompt = userRequest.trim().length < 80;
    const containsExplicitUrls = /https?:\/\/|\b\w+\.(com|org|net|io)\b/i.test(userRequest);

    if (hasAssistantResults && isShortPrompt && !containsExplicitUrls) {
      console.log('[TaskDecomposer][Issue #14/#26] short follow-up detected, keeping single-context execution.');
      return {
        type: 'single_context',
        contexts: ['current_page'],
        estimatedActions: 1,
        shouldFork: false,
        forkReason: 'Follow-up question — using existing conversation context'
      };
    }
  }

  // Fast path: clear multi-site orchestration intent without needing decomposer LLM.
  if (explicitContexts.length > 1) {
    const hasParallelIntent = PARALLEL_INTENT_PATTERN.test(userRequest);
    const hasOptionalConditional = OPTIONAL_CONDITIONAL_PATTERN.test(userRequest);
    const hasDependencyChain = DEPENDENCY_CHAIN_PATTERN.test(userRequest);
    // ── Issue #14 fix: optional conditional wording ("if possible",
    // "if available") should NOT serialize independent contexts. Only
    // mandatory conditionals ("if X then Y else Z") or explicit dependency
    // chains create sequential intent.
    const hasSequentialIntent =
      SEQUENTIAL_INTENT_PATTERN.test(userRequest) ||
      (CONDITIONAL_SEQUENTIAL_INTENT_PATTERN.test(userRequest) && !hasOptionalConditional) ||
      hasDependencyChain;

    // ── Issue #14 deterministic guard: explicit multi-site + optional
    // conditional wording should remain multi-context unless EXPLICIT
    // dependency chain is present.
    if (hasParallelIntent && !hasSequentialIntent) {
      console.info(
        `[TaskDecomposer][Issue #14/#26] heuristic parallel decision contexts=${explicitContexts.join(',')} optionalConditional=${hasOptionalConditional} dependencyChain=${hasDependencyChain}`
      );
      return {
        type: 'multi_context',
        contexts: explicitContexts,
        estimatedActions: Math.max(estimatedActions, explicitContexts.length * 2),
        shouldFork: true,
        forkStrategy: 'parallel',
        forkReason: `Heuristic: independent multi-site comparison (${explicitContexts.join(', ')})`,
        confidence: 0.9,
        decisionSource: 'heuristic',
      };
    }

    // When NO parallel intent is present but multi-site + optional conditional,
    // default to parallel (not sequential) since the contexts are independent
    // and the conditional is advisory, not a dependency chain.
    if (!hasSequentialIntent && hasOptionalConditional && explicitContexts.length > 1) {
      console.info(
        `[TaskDecomposer][Issue #14] optional_conditional_parallel contexts=${explicitContexts.join(',')} — treating as independent`
      );
      return {
        type: 'multi_context',
        contexts: explicitContexts,
        estimatedActions: Math.max(estimatedActions, explicitContexts.length * 2),
        shouldFork: true,
        forkStrategy: 'parallel',
        forkReason: `Heuristic: optional conditional with independent contexts (${explicitContexts.join(', ')})`,
        confidence: 0.75,
        decisionSource: 'heuristic',
      };
    }

    if (hasSequentialIntent) {
      console.info(
        `[TaskDecomposer][Issue #14/#26] heuristic sequential decision contexts=${explicitContexts.join(',')} optionalConditional=${hasOptionalConditional} dependencyChain=${hasDependencyChain}`
      );
      return {
        type: 'single_context',
        contexts: ['current_page'],
        estimatedActions: Math.max(estimatedActions, explicitContexts.length * 2),
        shouldFork: true,
        forkStrategy: 'sequential',
        forkReason: `Heuristic: sequential multi-site workflow (${explicitContexts.join(', ')})`,
        confidence: 0.85,
        decisionSource: 'heuristic',
      };
    }
  }

  // Build a brief summary of the last few messages for the LLM to detect follow-ups
  let conversationSummary: string | undefined;
  if (conversationHistory && conversationHistory.length > 0) {
    const recentMessages = conversationHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6); // Last 6 user/assistant messages max
    conversationSummary = recentMessages
      .map(m => `${m.role}: ${(m.content || '').substring(0, 200)}`)
      .join('\n');
  }

  // Use LLM to analyze task for contexts and dependencies
  console.log('[TaskDecomposer] Analyzing task with LLM...');
  const analysis = await analyzeTaskWithLLM(userRequest, settings, conversationSummary);

  // If LLM recommends parallel execution
  if (analysis.shouldParallelize && analysis.contexts.length > 1) {
    console.log(`[TaskDecomposer][Issue #14/#26] LLM detected ${analysis.contexts.length} independent contexts: ${analysis.contexts.join(', ')} (elapsed=${Date.now() - startedAt}ms)`);
    return {
      type: 'multi_context',
      contexts: analysis.contexts,
      estimatedActions,
      shouldFork: true,
      forkStrategy: 'parallel',
      forkReason: `LLM-verified independent tasks: ${analysis.reasoning}`,
      confidence: 0.85,
      decisionSource: 'llm',
    };
  }

  console.log(`[TaskDecomposer][Issue #14/#26] Sequential execution: ${analysis.reasoning} (elapsed=${Date.now() - startedAt}ms)`);

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
