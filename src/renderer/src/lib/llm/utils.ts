import { LLMContentPart, LLMResponse } from "../types";

// Helper to extract text from multimodal content for providers that only support text
function extractTextForLegacyProviders(content: string | LLMContentPart[]): string {
  if (typeof content === 'string') return content;
  return content.map(p => p.type === 'text' ? p.text : '').join('\n');
}

/**
 * Modularly gets standard environment fallbacks for LLM Configuration.
 * Uses hardcoded `import.meta.env` references since Vite requires static analysis.
 */
export function getEnvFallback(provider: 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'browser' | 'default', keyType: 'api_key' | 'model' | 'provider'): string | undefined {
  if (keyType === 'provider') {
    return import.meta.env.VITE_LLM_PROVIDER;
  }
  
  if (keyType === 'api_key') {
    switch (provider) {
      case 'openai': return import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.VITE_LLM_API_KEY;
      case 'gemini': return import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_LLM_API_KEY;
      case 'openrouter': return import.meta.env.VITE_OPENROUTER_API_KEY || import.meta.env.VITE_LLM_API_KEY;
      default: return import.meta.env.VITE_LLM_API_KEY;
    }
  } else if (keyType === 'model') {
    switch (provider) {
      case 'openai': return import.meta.env.VITE_OPENAI_MODEL || import.meta.env.VITE_LLM_MODEL;
      case 'gemini': return import.meta.env.VITE_GEMINI_MODEL || import.meta.env.VITE_LLM_MODEL;
      case 'openrouter': return import.meta.env.VITE_OPENROUTER_MODEL || import.meta.env.VITE_LLM_MODEL;
      case 'ollama': return import.meta.env.VITE_OLLAMA_MODEL || import.meta.env.VITE_LLM_MODEL;
      default: return import.meta.env.VITE_LLM_MODEL;
    }
  }
  return undefined;
}

export { extractTextForLegacyProviders };

/**
 * Converts a file URL (file://) to a Base64 data URI using Electron's FS bridge.
 * Essential for multimodal/vision LLM requests.
 */
export async function fileUrlToBase64(fileUrl: string): Promise<string | null> {
    if (!fileUrl.startsWith('file://')) return null;

    try {
        const electron = (await import("../electron")).default;
        const filePath = fileUrl.replace('file://', '');
        
        if (electron.fs?.readFileBase64) {
           const result = await electron.fs.readFileBase64(filePath);
           if (result.success && result.content) {
               return result.content; 
           }
        }
    } catch (err) {
        console.error('[LLM Utils] Base64 conversion failed:', err);
    }
    return null;
}

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

    // Try to extract JSON object (handling multiple contiguous JSON blocks)
    let jsonStrFixed = jsonStr;
    if (jsonStrFixed.match(/\}\s*\{/)) {
      jsonStrFixed = `[${jsonStrFixed.replace(/\}\s*\{/g, '},{')}]`;
    }

    const jsonMatch = jsonStrFixed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      let parsed = JSON.parse(jsonMatch[0]);

      // If the model output multiple identical JSON objects, just evaluate the first one.
      if (Array.isArray(parsed) && parsed.length > 0) {
          parsed = parsed[0];
      }

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

      // Bare Execution Plan Format: { "goal": "...", "steps": [...] }
      if (parsed.goal && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        console.log('[LLM] Identified Bare Execution Plan Format. Recovering as create_execution_plan tool call.');
        return [{
          id: `plan_call_${Date.now()}`,
          name: 'create_execution_plan',
          arguments: ensureRecord({ goal: parsed.goal, steps: parsed.steps })
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

// Parse tool calls from XML-wrapped JSON payloads in response content.
// Example supported payload: <tools>{"name":"fs_list_directory","params":{"path":"."}}</tools>
export function parseToolCallsFromXml(content: string): LLMResponse["toolCalls"] | undefined {
  try {
    const tagMatch = content.match(/<tools?>([\s\S]*?)<\/tools?>/i);
    if (!tagMatch) return undefined;

    const payload = (tagMatch[1] || '').trim();
    if (!payload) return undefined;

    const parsed = JSON.parse(payload) as unknown;
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    const now = Date.now();

    const calls = entries
      .map((entry, idx) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

        const candidate = entry as Record<string, unknown>;
        const name =
          (typeof candidate.name === 'string' && candidate.name) ||
          (typeof candidate.tool === 'string' && candidate.tool) ||
          '';

        if (!name) return null;

        const args =
          candidate.arguments ??
          candidate.params ??
          candidate.parameters ??
          candidate.args ??
          {};

        return {
          id: `xml_call_${now}_${idx}`,
          name,
          arguments: ensureRecord(args),
        };
      })
      .filter((call): call is NonNullable<typeof call> => Boolean(call));

    if (calls.length > 0) {
      console.log(`[LLM] Identified XML Tool Call Format (${calls.length})`);
      return calls;
    }
  } catch (error) {
    console.warn('Failed to parse tool calls from XML:', error);
  }

  return undefined;
}
