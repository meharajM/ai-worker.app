import { LLMMessage, LLMSettings, LLMTool, LLMResponse } from "../types";
import type { AntigravityCredentials } from "../antigravity-gateway";
import { ProviderStatus } from "./types";
import { LLM_CONFIG } from "../constants";
import { extractTextForLegacyProviders, ensureRecord } from "./utils";

/**
 * Resolves Gemini credentials from settings / secure store / Antigravity OAuth.
 * Priority: settings object → electron secure store → Antigravity (no-key path).
 */
export async function getGeminiSettings(settings?: LLMSettings): Promise<{
  apiKey: string;
  baseUrl: string;
  model: string;
  antigravity: AntigravityCredentials | null;
}> {
  const electron = (await import("../electron")).default;
  const { getAntigravityCredentials } = await import("../antigravity-gateway");

  const apiKey =
    settings?.geminiApiKey ||
    (await electron.secure.get("gemini_api_key")).value ||
    "";
  const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;
  const model = settings?.geminiModel || LLM_CONFIG.GEMINI.DEFAULT_MODEL;
  const antigravity = await getAntigravityCredentials();

  return { apiKey, baseUrl, model, antigravity };
}

/**
 * Checks whether Gemini is configured and reachable.
 * Returns available=true if either an API key or Antigravity OAuth is present.
 */
export async function checkGemini(settings?: LLMSettings): Promise<ProviderStatus> {
  const { apiKey, model, antigravity } = await getGeminiSettings(settings);

  if (!apiKey && !antigravity) {
    return { available: false, error: 'Sign in with Google or set Gemini API Key' };
  }

  // Antigravity path: gateway doesn't expose /models — use the known model list.
  if (antigravity && !apiKey) {
    const { SUPPORTED_GATEWAY_MODELS } = await import('../antigravity-gateway');
    const models = Array.from(SUPPORTED_GATEWAY_MODELS);
    return {
      available: true,
      model: (models as string[]).includes(model as string) ? model : models[0],
      models,
      modelsEndpointAvailable: false,
    };
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
 * Falls back to Antigravity gateway when no API key is provided.
 */
export async function testGeminiConnection(
  apiKey: string,
  model: string,
  _settings?: LLMSettings
): Promise<{
  success: boolean;
  error?: string;
  models?: string[];
  modelsEndpointAvailable?: boolean;
}> {
  try {
    if (apiKey) {
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
    }

    // No API key — try Antigravity
    const { getAntigravityCredentials, buildGatewayRequest, SUPPORTED_GATEWAY_MODELS } = await import('../antigravity-gateway');
    const antigravity = await getAntigravityCredentials();

    if (antigravity) {
      const payload = {
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1 }
      };
      const request = buildGatewayRequest(antigravity, model, payload);
      const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body });

      if (response.ok) {
        return { success: true, models: Array.from(SUPPORTED_GATEWAY_MODELS), modelsEndpointAvailable: false };
      }
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
      return { success: false, error: (errorData.error as any)?.message || `Gateway error: ${response.statusText}` };
    }

    return { success: false, error: 'No API key provided and not signed in with Google.' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Connection failed" };
  }
}

/**
 * Sends a chat request to Gemini via either:
 *   1. Antigravity gateway (OAuth, higher rate limits) — preferred when signed in
 *   2. Standard Gemini REST API (API key)
 */
export async function callGemini(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  abortSignal?: AbortSignal
): Promise<LLMResponse> {
  const { apiKey, model, antigravity } = await getGeminiSettings(settings);
  const { buildGatewayRequest, unwrapGatewayResponse, sanitizeToolSchema } = await import('../antigravity-gateway');
  const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;

  // Build a lookup: tool_call_id → function name
  // Note: at runtime, tool_calls on LLMMessage objects are stored in OpenAI wire format
  // ({ id, type, function: { name, arguments } }) by agent-runtime — we must handle both shapes.
  type RuntimeToolCall = { id?: string; name?: string; function?: { name: string; arguments: Record<string, unknown> } };
  const toolIdToName = new Map<string, string>();
  messages.forEach(m => {
    if (m.role === 'assistant' && m.tool_calls) {
      (m.tool_calls as unknown as RuntimeToolCall[]).forEach((tc) => {
        const id = tc.id;
        const name = tc.name || tc.function?.name;
        if (id && name) toolIdToName.set(id, name);
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
        m.content.forEach(part => {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
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
        });
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
      (m.tool_calls as unknown as RuntimeToolCall[]).forEach((tc) => {
        // Handle both our internal format (tc.name/tc.arguments) and OpenAI wire
        // format (tc.function.name/tc.function.arguments) which agent-runtime uses at runtime.
        const name = tc.name || tc.function?.name;
        const rawArgs = (tc as unknown as { arguments?: Record<string, unknown> }).arguments ?? tc.function?.arguments;
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

  // Route: Antigravity gateway → standard API
  let data: Record<string, unknown>;
  if (antigravity) {
    const gw = buildGatewayRequest(antigravity, model, geminiPayload);
    const result = await (await import('../electron')).default.antigravity.callGateway(gw.url, gw.headers, gw.body as string);
    data = unwrapGatewayResponse(result) as unknown as Record<string, unknown>;
  } else if (apiKey) {
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
    data = await response.json();
  } else {
    throw new Error('No Gemini authentication available. Sign in with Google or set a Gemini API key.');
  }

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
