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
  category?: 'shopping' | 'research' | 'admin' | 'general';
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
  label: string; // "Search Nike official site for size 6 shoes"
  enrichedPrompt: string; // Full detailed prompt for execution
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
  • Greetings, pleasantries, or casual conversation (e.g., "hi", "hello", "thanks", "how are you?")
  • Clear, specific tasks (e.g., "open google.com", "search amazon for shoes")
  • Tasks with clear context or simple defaults
  • Questions about the agent generally (e.g., "what can you do?")
  • Single-word replies that fit a conversation flow (e.g., "yes", "no", "continue", "stop", "back", "next")

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
- **general**: Simple navigation, opening sites, weather, etc.

Respond with JSON:
{
  "isAmbiguous": true/false,
  "missingDetails": ["what's missing"],
  "detectedIntent": "What you think the user wants",
  "category": "shopping|research|admin|general",
  "potentialMistakes": ["typos found"],
  "suggestions": [
    {"id": "1", "label": "Suggested interpretation", "enrichedPrompt": "Clear version of the request", "confidence": 0.9}
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
    const response = await chat(
      [
        { role: 'system', content: 'You are a task analysis expert. Always respond with valid JSON.' },
        { role: 'user', content: analysisPrompt }
      ],
      undefined,
      llmSettings
    );

    // Parse the LLM response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return createDefaultAnalysis(userPrompt);
    }

    const analysis: TaskAnalysis = JSON.parse(jsonMatch[0]);

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
