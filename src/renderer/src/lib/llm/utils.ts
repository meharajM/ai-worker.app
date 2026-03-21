import { LLMContentPart, LLMResponse } from "../types";

// Helper to extract text from multimodal content for providers that only support text
function extractTextForLegacyProviders(content: string | LLMContentPart[]): string {
  if (typeof content === 'string') return content;
  return content.map(p => p.type === 'text' ? p.text : '').join('\n');
}
export { extractTextForLegacyProviders };

export function ensureRecord(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        return { input: parsed };
      } catch {
        // Fall through to default wrapping
      }
    }
    return { input: trimmed };
  }

  return { value: input };
}

export function safeParseJSON(input: unknown): unknown {
  if (input === null || input === undefined) return {};
  if (typeof input !== 'string') return input;
  if (!input || input.trim() === '') return {};

  try {
    const trimmed = input.trim();
    // Quick path for pure JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch { /* fall through to extraction */ }
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

      // Plan+Commands Format: { "analysis": "...", "plan": "...", "commands": [{"type": "tool_name", ...args}] }
      // Some models (e.g. Ollama-hosted) output this planning blob when in JSON fallback mode.
      // Without handling it here the raw JSON leaks to the user as a chat bubble.
      if (parsed.commands && Array.isArray(parsed.commands) && parsed.commands.length > 0) {
        console.log('[LLM] Identified Plan+Commands JSON Format. Recovering tool calls from commands array.');
        const calls = parsed.commands
          .filter((cmd: unknown) => typeof cmd === 'object' && cmd !== null && typeof (cmd as Record<string, unknown>).type === 'string')
          .map((cmd: Record<string, unknown>, idx: number) => {
            const { type, ...args } = cmd;
            const toolName = type as string;
            console.log(`[LLM] Recovered command as tool call: ${toolName}`, args);
            return {
              id: `cmd_call_${Date.now()}_${idx}`,
              name: toolName,
              arguments: ensureRecord(args),
            };
          });
        if (calls.length > 0) return calls;
      }
    }
  } catch (error) {
    // Failed to parse, return undefined
    console.warn("Failed to parse tool calls from JSON:", error);
  }
  return undefined;
}
