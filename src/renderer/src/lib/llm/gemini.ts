import { LLMMessage, LLMSettings, LLMTool, LLMResponse } from "../types";
import { ProviderStatus } from "./types";
import { LLM_CONFIG } from "../constants";
import { extractTextForLegacyProviders, ensureRecord, getEnvFallback } from "./utils";

function sanitizeToolSchema(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeToolSchema);
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "$schema" || key === "title") continue;
    cleaned[key] = sanitizeToolSchema(value);
  }
  return cleaned;
}

/**
 * Resolves Gemini credentials from settings / secure store / env variables.
 */
export async function getGeminiSettings(settings?: LLMSettings): Promise<{
  apiKey: string;
  baseUrl: string;
  model: string;
}> {
  const electron = (await import("../electron")).default;

  const envKey = getEnvFallback('gemini', 'api_key');
  const envModel = getEnvFallback('gemini', 'model');

  const apiKey =
    settings?.geminiApiKey ||
    (await electron.secure.get("gemini_api_key")).value ||
    envKey ||
    "";
  const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;
  const model = settings?.geminiModel || envModel || LLM_CONFIG.GEMINI.DEFAULT_MODEL;

  return { apiKey, baseUrl, model };
}

/**
 * Checks whether Gemini is configured and reachable.
 * Requires a valid API key.
 */
export async function checkGemini(settings?: LLMSettings): Promise<ProviderStatus> {
  const { apiKey, model } = await getGeminiSettings(settings);

  if (!apiKey) {
    return { available: false, error: 'Set Gemini API Key to use this provider' };
  }

  // API-key path: fetch the available models list.
  try {
    const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;
    const response = await fetch(`${baseUrl}/models?key=${apiKey}`);

    if (response.ok) {
      const data = await response.json();
      const models = (data.models || [])
        .filter((m: { name: string }) => m.name.includes("gemini"))
        .map((m: { name: string }) => m.name.split("/").pop())
        .filter(Boolean) as string[];

      return {
        available: true,
        model: models.find(m => m === model) || models[0] || model,
        models: models,
        modelsEndpointAvailable: true,
      };
    }
    return {
      available: true,
      model: model,
      models: [model],
      modelsEndpointAvailable: false,
      error: "Could not fetch Gemini models list",
    };
  } catch {
    return {
      available: true,
      model: model,
      models: [model],
      modelsEndpointAvailable: false,
    };
  }
}

/**
 * Tests the Gemini connection.
 * Requires an API key.
 */
export async function testGeminiConnection(
  apiKey: string,
  _model: string,
  _settings?: LLMSettings
): Promise<{
  success: boolean;
  error?: string;
  models?: string[];
  modelsEndpointAvailable?: boolean;
}> {
  try {
    if (!apiKey) {
      return { success: false, error: 'No Gemini API key provided.' };
    }

    const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;
    const response = await fetch(`${baseUrl}/models?key=${apiKey}`);

    if (response.ok) {
      const data = await response.json();
      const models = (data.models || [])
        .filter((m: { name: string }) => m.name.includes("gemini"))
        .map((m: { name: string }) => m.name.split("/").pop())
        .filter(Boolean) as string[];
      return { success: true, models, modelsEndpointAvailable: true };
    }

    const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      success: false,
      error: (errorData.error as any)?.message || `API error: ${response.statusText}`
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Connection failed" };
  }
}

/**
 * Sends a chat request to Gemini using the standard Gemini REST API.
 */
export async function callGemini(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  abortSignal?: AbortSignal
): Promise<LLMResponse> {
  const { apiKey, model } = await getGeminiSettings(settings);
  const { fileUrlToBase64 } = await import('./utils');
  const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;

  // Build a lookup: tool_call_id → function name
  const toolIdToName = new Map<string, string>();
  messages.forEach(m => {
    if (m.role === 'assistant' && m.tool_calls) {
      m.tool_calls.forEach((tc) => {
        if (tc.id && tc.function.name) toolIdToName.set(tc.id, tc.function.name);
      });
    }
  });

  // Convert messages to Gemini format
  const contents: Array<{ role: 'user' | 'model'; parts: Record<string, unknown>[] }> = [];
  const validMessages = messages.filter(m => m.role !== 'system');

  for (const m of validMessages) {
    let role: 'user' | 'model' | null = null;
    if (m.role === 'assistant') role = 'model';
    if (m.role === 'user' || m.role === 'tool') role = 'user';
    if (!role) continue;

    const parts: Record<string, unknown>[] = [];

    if (m.role !== 'tool' && m.content) {
      if (typeof m.content === 'string') {
        parts.push({ text: m.content });
      } else {
        for (const part of m.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            if (part.image_url.url.startsWith('file://')) {
              const base64Content = await fileUrlToBase64(part.image_url.url);
              if (base64Content) {
                 const matches = base64Content.match(/^data:([^;]+);base64,(.+)$/);
                 if (matches) {
                    parts.push({
                      inline_data: {
                        mime_type: matches[1],
                        data: matches[2]
                      }
                    });
                 }
              }
            } else {
              const matches = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                parts.push({
                  inline_data: {
                    mime_type: matches[1],
                    data: matches[2]
                  }
                });
              }
            }
          }
        }
      }
    }

    const extendedMsg = m as LLMMessage & { thought?: string; thought_signature?: string };
    // Gemini 2.0 Thinking: echo thought_signature back to the API.
    if (m.role === 'assistant' && extendedMsg.thought) {
      parts.push({
        thought: extendedMsg.thought,
        thought_signature: extendedMsg.thought_signature
      });
    }

    // Tool calls
    if (m.role === 'assistant' && m.tool_calls) {
      m.tool_calls.forEach((tc) => {
        const name = tc.function.name;
        const rawArgs = tc.function.arguments;
        const args = typeof rawArgs === 'string'
          ? (() => { try { return JSON.parse(rawArgs); } catch { return { _parse_error: 'Invalid JSON arguments' }; } })()
          : rawArgs;
        parts.push({
          functionCall: { name, args }
        });
      });
    }

    // Tool results
    if (m.role === 'tool') {
      const resultText = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? extractTextForLegacyProviders(m.content)
          : JSON.stringify(m.content ?? '');

      const extendedToolMsg = m as LLMMessage & { name?: string };
      const fnName = extendedToolMsg.name || (m.tool_call_id ? toolIdToName.get(m.tool_call_id) : 'unknown_tool');
      parts.push({
        functionResponse: {
          name: fnName,
          response: { result: resultText }
        }
      });
    }

    if (parts.length === 0) continue;

    // Merge consecutive messages with the same role
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }

  const systemMessage = messages.find(m => m.role === 'system');
  const systemInstructionText = systemMessage ? extractTextForLegacyProviders(systemMessage.content) : undefined;

  // Build tool definitions
  const toolConfig = tools && tools.length > 0 ? {
    function_declarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeToolSchema(t.parameters)
    }))
  } : undefined;

  const geminiPayload: Record<string, unknown> = {
    contents,
    systemInstruction: systemInstructionText ? { parts: [{ text: systemInstructionText }] } : undefined,
    tools: toolConfig ? [{ function_declarations: toolConfig.function_declarations }] : undefined,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    }
  };

  if (!apiKey) {
    throw new Error('Gemini API key is required.');
  }
  const response = await fetch(`${baseUrl}/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: abortSignal,
    body: JSON.stringify(geminiPayload)
  });

  if (!response.ok) {
    const errorDetails = await response.json().catch(() => ({}));
    throw new Error(`Gemini API error: ${response.statusText}. ${JSON.stringify(errorDetails)}`);
  }
  const data = await response.json();

  // Parse response
  const candidate = data.candidates && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const responseParts: Record<string, unknown>[] = (candidate?.content?.parts as Record<string, unknown>[]) || [];

  const content = responseParts.find((p) => p.text && !p.thought)?.text || '';
  const thoughtPart = responseParts.find((p) => p.thought);
  const thought = thoughtPart?.thought as string | undefined;
  const thoughtSignature = thoughtPart?.thought_signature as string | undefined;

  const toolCalls = responseParts
    .filter((p) => p.functionCall !== undefined)
    .map((p) => {
      const fc = p.functionCall as Record<string, unknown>;
      return {
        id: `gemini-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        name: (fc.name as string) || 'unknown',
        arguments: ensureRecord(fc.args)
      };
    });

  return {
    content: (content as string) || '',
    thought,
    thought_signature: thoughtSignature,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    provider: 'gemini',
    model: model
  };
}
