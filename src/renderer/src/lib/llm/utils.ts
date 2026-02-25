import { LLMContentPart, LLMResponse } from "../types";

// Helper to extract text from multimodal content for providers that only support text
function extractTextForLegacyProviders(content: string | LLMContentPart[]): string {
  if (typeof content === 'string') return content;
  return content.map(p => p.type === 'text' ? p.text : '').join('\n');
}
export { extractTextForLegacyProviders };

export function ensureRecord(input: any): Record<string, unknown> {
  if (input === null || input === undefined) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        return { input: parsed };
      } catch (e) {
        // Fall through to default wrapping
      }
    }
    return { input: trimmed };
  }

  return { value: input };
}

export function safeParseJSON(input: string | any): any {
  if (input === null || input === undefined) return {};
  if (typeof input !== 'string') return input;
  if (!input || input.trim() === '') return {};

  try {
    const trimmed = input.trim();
    // Quick path for pure JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch (e) { /* fall through to extraction */ }
    }

    // Find the first occurrence of { or [ and the last occurrence of } or ]
    const startObj = input.indexOf('{');
    const startArr = input.indexOf('[');

    let start = -1;
    let end = -1;

    if (startObj !== -1 && (startArr === -1 || startObj < startArr)) {
      start = startObj;
      end = input.lastIndexOf('}');
    } else if (startArr !== -1) {
      start = startArr;
      end = input.lastIndexOf(']');
    }

    if (start !== -1 && end !== -1 && end > start) {
      const potentialJson = input.substring(start, end + 1);
      return JSON.parse(potentialJson);
    }

    // If all else fails, return as-is
    return input;
  } catch (error) {
    console.warn('[safeParseJSON] Extraction failed:', error);
    return input;
  }
}

export // Parse tool calls from JSON in response content
function parseToolCallsFromJson(
  content: string
): LLMResponse["toolCalls"] | undefined {
  try {
    // Try to find JSON in the content (might be in code blocks or raw)
    let jsonStr = content.trim();

    // Remove markdown code blocks if present
    jsonStr = jsonStr
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    // Try to extract JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Standard Format: { "tool_calls": [...] }
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        console.log('[LLM] Identified Standard JSON Tool Call Format');
        return parsed.tool_calls.map(
          (
            tc: { name: string; arguments: Record<string, unknown> },
            idx: number
          ) => {
            console.log(`[LLM] JSON Recovered Call: ${tc.name}`, tc.arguments);
            return {
              id: `json_call_${Date.now()}_${idx}`,
              name: tc.name,
              arguments: ensureRecord(tc.arguments),
            };
          }
        );
      }

      // Alternate Format (Common in some models): { "tool": "name", "params": {...} }
      if (parsed.tool && typeof parsed.tool === 'string') {
        console.log('[LLM] Identified Alternate JSON Tool Call Format:', parsed.tool);
        // Normalize parameters: some models use params, parameters, arguments, or even 'args'
        const params = parsed.params || parsed.parameters || parsed.arguments || parsed.args || {};
        console.log(`[LLM] Normalized parameters for "${parsed.tool}":`, params);

        return [{
          id: `json_call_${Date.now()}`,
          name: parsed.tool,
          arguments: ensureRecord(params)
        }];
      }
    }
  } catch (error) {
    // Failed to parse, return undefined
    console.warn("Failed to parse tool calls from JSON:", error);
  }
  return undefined;
}
