// Task Analysis & Confirmation Utilities
// Provides smart detection of ambiguous tasks and generates clarification suggestions

export interface TaskAnalysis {
  isAmbiguous: boolean;
  missingDetails: string[];
  suggestions: TaskSuggestion[];
  detectedIntent: string;
  potentialMistakes: string[];
  shouldConfirm: boolean; // Smart detection result
  complexity?: TaskComplexity;
  category?: 'shopping' | 'research' | 'admin' | 'coding' | 'filesystem' | 'general';
}

export interface TaskComplexity {
  level: 'simple' | 'moderate' | 'complex';
  needsExternalModel: boolean;
  reason: string;
  userFriendlyMessage: string;
  estimatedTime: string;
}

export interface TaskSuggestion {
  id: string;
  label: string; // "Proceed with Assumptions"
  type: 'defaults' | 'memory' | 'clarification'; // New field for UI categorization
  enrichedPrompt: string; // IMPERATIVE INSTRUCTION: "Assume X... then execute"
  confidence: number; // 0-1
}

/**
 * Analyzes a user prompt to detect ambiguity and generate clarification suggestions.
 * Uses LLM to intelligently detect when confirmation is needed.
 */
export async function analyzeTask(
  userPrompt: string,
  llmSettings: any
): Promise<TaskAnalysis> {
  const { chat } = await import('./llm');

  const analysisPrompt = `Analyze this user prompt and determine if clarification is needed.

USER PROMPT: "${userPrompt}"

# ANALYSIS:
1. **Is the intent clear?** Can you understand exactly what the user wants?
2. **Missing details?** Are there critical pieces of information needed to complete the task?
3. **Potential typos?** Common misspellings (e.g., "goolge" = "google")
4. **Safety concerns?** Does this involve sensitive data, payments, or irreversible actions?

# COMPLEXITY:
- **Simple**: Single action, clear target (e.g., "open google.com")
- **Moderate**: Multiple steps but clear goal (e.g., "search for X on Y")
- **Complex**: Multi-step with decisions needed (e.g., "compare X and Y, then...")

# RULES for shouldConfirm:
- FALSE (DO NOT confirm) for:
  • Greetings, casual conversation, or pleasantries (e.g., "hi", "hello", "thanks")
  • Clear, specific tasks (e.g., "open google.com", "search amazon for shoes")
  • Tasks with reasonable defaults (e.g., "buy shoes" → assume popular site like Amazon)
  • Questions about the agent (e.g., "what can you do?")
  • Single-word context replies (e.g., "yes", "no", "continue", "stop")
  • **Coding/debugging tasks** (agent should explore autonomously)
  • **Research tasks with clear topics** (agent can start broad, then narrow)

- TRUE (CONFIRM) for:
  • Vague TASK requests starting a NEW topic (e.g., "buy shoes" - site/size missing?)
  • Single words that imply a complex action without target (e.g., "research", "booking", "deploy")
  • Sensitive actions (logins, payments, deletions)
  • Ambiguous pronouns without context

- If typos detected, auto-correct in suggestions

Respond with JSON:
# CATEGORY CLASSIFICATION:
Classify the task into one of these categories:
- **shopping**: Buying, finding products, prices, e-commerce.
- **research**: Finding information, summaries, comparison, news.
- **admin**: Filling forms, scheduling, email, account management, official websites.
- **coding**: Implementing features, fixing bugs, refactoring, reading code.
- **filesystem**: Managing files, organizing directories, file operations, workspace exploration.
- **general**: Simple navigation, opening sites, weather, etc.

# SUGGESTION GENERATION RULES (CRITICAL):
You MUST generate 2-3 distinct options for the user. Do NOT ask questions. Provide executable actions.

1. **Option 1: Proceed with Assumptions (type: 'defaults')**
   - Fill in missing details with the most common/popular choices.
   - IMPERATIVE prompt: "Assume [Assumption 1] and [Assumption 2], then execute [Task]."
   - Example: "Assume the user wants a size 10 US Men's shoe from Amazon. Search for 'Nike Air Max size 10' on amazon.com."

2. **Option 2: Use Memory & Context (type: 'memory')**
   - Instruct the agent to check memory for preferences.
   - IMPERATIVE prompt: "First, use the 'memory_search' tool to find [Information]. Then use that context to execute [Task]."
   - Example: "Check memory for the user's shoe size and brand preferences. Then search for matches on their preferred retailer."

3. **Option 3: Clarify (type: 'clarification')** - ONLY if truly blocked
   - Use this if the task is impossible to guess (e.g., "Delete the file" -> which file?).
   - Prompt: "Ask the user specifically about [Missing Detail]."


Respond with JSON:
{
  "isAmbiguous": true/false,
  "missingDetails": ["what's missing"],
  "detectedIntent": "What you think the user wants",
  "category": "shopping|research|admin|coding|filesystem|general",
  "potentialMistakes": ["typos found"],
  "suggestions": [
    {
      "id": "1", 
      "label": "Proceed with Assumptions (Amazon)", 
      "type": "defaults",
      "enrichedPrompt": "Assume standard Amazon search...", 
      "confidence": 0.8
    },
    {
      "id": "2", 
      "label": "Use Memory Context", 
      "type": "memory",
      "enrichedPrompt": "Check memory for preferences...", 
      "confidence": 0.9
    }
  ],
  "shouldConfirm": true/false,
  "complexity": {
    "level": "simple|moderate|complex",
    "needsExternalModel": true/false,
    "reason": "Why this complexity",
    "userFriendlyMessage": "Brief message for user",
    "estimatedTime": "How long it might take"
  }
}`;

  try {
    const { chat, safeParseJSON } = await import('./llm');

    const response = await chat(
      [
        { role: 'system', content: 'You are a task analysis expert. Always respond with valid JSON.' },
        { role: 'user', content: analysisPrompt }
      ],
      undefined,
      llmSettings
    );

    // Parse the LLM response robustly
    const analysis: TaskAnalysis = safeParseJSON(response.content);

    // Validate and ensure proper structure
    return {
      isAmbiguous: analysis.isAmbiguous || false,
      missingDetails: analysis.missingDetails || [],
      suggestions: analysis.suggestions || [],
      detectedIntent: analysis.detectedIntent || userPrompt,
      potentialMistakes: analysis.potentialMistakes || [],
      shouldConfirm: analysis.shouldConfirm || false,
      complexity: analysis.complexity,
      category: analysis.category as any
    };
  } catch (error) {
    console.error('[TaskAnalysis] Error analyzing task:', error);
    return createDefaultAnalysis(userPrompt);
  }
}

function createDefaultAnalysis(prompt: string): TaskAnalysis {
  return {
    isAmbiguous: false,
    missingDetails: [],
    suggestions: [{
      id: 'default',
      label: 'Proceed as typed',
      type: 'defaults',
      enrichedPrompt: prompt,
      confidence: 1.0
    }],
    detectedIntent: prompt,
    potentialMistakes: [],
    shouldConfirm: false,
    complexity: {
      level: 'simple',
      needsExternalModel: false,
      reason: 'Direct navigation',
      userFriendlyMessage: 'Opening now...',
      estimatedTime: 'Instant'
    },
    category: 'general'
  };
}
