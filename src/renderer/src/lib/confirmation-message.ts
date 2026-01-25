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

  const analysisPrompt = `You are a Friendly Intent Decoder. Your job is to translate what non-technical users say into what they actually need.

USER PROMPT: "${userPrompt}"

# ANALYSIS CHECKLIST:
1. **Missing but Critical:**
   - Which website/platform? (e.g. Amazon, Nike, etc. - NEVER guess unless obvious)
   - Conditions? (New, used, price range)
   - User Preferences? (Size "UK 8" vs "US 9", Color, Model)
2. **Potential Confusions:**
   - "UK 8" = US 9? = EUR 42? (Flags potential confusion)
   - "Shoes" = running? casual? formal?
   - "Open" = just show options or ready to buy?
3. **Safety & Security:**
   - Personal data? Logins? Payments? -> Set shouldConfirm: TRUE
   - Irreversible actions? -> Set shouldConfirm: TRUE

# COMPLEXITY ANALYSIS:
1. **Simple** (local LLM): "What's the weather?", "Open Gmail"
2. **Moderate** (cloud LLM): "Price check", "Find item"
3. **Complex** (planning needed): "Find X, compare with Y, buy Z"

# PREFERENCE & MEMORY CHECK:
If the user's prompt implies shopping or personal tasks but no preferences are detected:
- Treat this as a "First-Time" or "New Context" request.
- Suggest asking: "To get the best results, I'll ask which stores you prefer and your sizes. Should I remember these for next time?"

# RULES for shouldConfirm:
- Set shouldConfirm: TRUE if missing critical platform, size, color, or preference.
- Set shouldConfirm: TRUE for tasks involving personal/sensitive data without explicit confirmation.
- Set shouldConfirm: TRUE if the prompt is valid but ambiguous ("shoes", "yes").
- Set shouldConfirm: FALSE if the prompt has a clear action and target (e.g., "open google and search for adidas 7 shoes").
- If typos detected (e.g., "goolge"), auto-correct in suggestions.

# RESPONSE FORMAT (warm, helpful):
Respond with a JSON object:
{
  "isAmbiguous": true/false,
  "missingDetails": ["detail 1", "detail 2"],
  "detectedIntent": "User wants to finding Nike shoes in size UK 8",
  "potentialMistakes": ["mistake 1"],
  "suggestions": [
    {
      "id": "1",
      "label": "Corrected: Open Google search for shoes",
      "enrichedPrompt": "Open browser, go to google.com, search for shoes",
      "confidence": 0.9
    },
    { "id": "ask_platform", "label": "Ask which website", "enrichedPrompt": "Ask the user: Which website should I use? (e.g. Nike, Amazon, etc.)" }
  ],
  "shouldConfirm": true/false,
  "complexity": {
    "level": "moderate",
    "needsExternalModel": true,
    "reason": "Shopping tasks need current prices",
    "userFriendlyMessage": "I'll search across websites. This might take a minute!",
    "estimatedTime": "2-3 minutes"
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
      complexity: analysis.complexity
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
    }
  };
}
