// Task Analysis & Confirmation Utilities
// Provides smart detection of ambiguous tasks and generates clarification suggestions

export interface TaskAnalysis {
  isAmbiguous: boolean;
  missingDetails: string[];
  suggestions: TaskSuggestion[];
  detectedIntent: string;
  potentialMistakes: string[];
  shouldConfirm: boolean; // Smart detection result
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
  
  const analysisPrompt = `You are a task analysis expert. Analyze the following user prompt and determine if it needs clarification.

USER PROMPT: "${userPrompt}"

Analyze for:
1. Missing critical details that CANNOT be inferred (e.g., "email John" - which John?).
2. Potential typos or "fat finger" mistakes (e.g., "goggle" instead of "google").
3. Single-word or extremely vague prompts (e.g., "yes", "shoes", "ok").
4. Follow-up confirmations without clear context (e.g., "yes" after being asked a question).

RULES for shouldConfirm:
- Set shouldConfirm: TRUE if the prompt is a single word, extremely vague, or could mean many different things.
- Set shouldConfirm: TRUE if the prompt is a confirmation like "yes", "ok", "proceed" but it's unclear what action is being confirmed.
- Set shouldConfirm: FALSE if the prompt has a clear action and target (e.g., "open google and search for adidas 7 shoes").
- Set shouldConfirm: FALSE if missing details (like URLs) can be found via search AND the intent is clear.

Generate 2-3 suggestions if shouldConfirm is true.

Respond with a JSON object:
{
  "isAmbiguous": true/false,
  "missingDetails": ["detail 1", "detail 2"],
  "detectedIntent": "what you think the user wants",
  "potentialMistakes": ["mistake 1"],
  "suggestions": [
    {
      "id": "1",
      "label": "Short description",
      "enrichedPrompt": "Full detailed prompt",
      "confidence": 0.9
    }
  ],
  "shouldConfirm": true/false
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
      shouldConfirm: analysis.shouldConfirm || false
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
    shouldConfirm: false
  };
}
