import { LLMMessage, LLMSettings, LLMTool, LLMResponse } from "../types";
import { ProviderStatus } from "./types";
import { LLM_CONFIG } from "../constants";
import { extractTextForLegacyProviders, ensureRecord, safeParseJSON } from "./utils";

export // Get Gemini settings from store or use defaults
  async function getGeminiSettings(
    settings?: LLMSettings
  ): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  const electron = (await import("../electron")).default;
  const apiKey =
    settings?.geminiApiKey ||
    (await electron.secure.get("gemini_api_key")).value ||
    "";
  const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;
  const model = settings?.geminiModel || LLM_CONFIG.GEMINI.DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

// Check if Gemini is configured and available
export async function checkGemini(
  settings?: LLMSettings
): Promise<ProviderStatus> {
  const { apiKey, model } = await getGeminiSettings(settings);
  if (!apiKey) return { available: false, error: "Gemini API Key not set" };

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
  } catch (error) {
    return {
      available: true,
      model: model,
      models: [model],
      modelsEndpointAvailable: false,
    };
  }
}

// Test Gemini connection and fetch models
export async function testGeminiConnection(
  apiKey: string,
  model: string
): Promise<{
  success: boolean;
  error?: string;
  models?: string[];
  modelsEndpointAvailable?: boolean;
}> {
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
        success: true,
        models,
        modelsEndpointAvailable: true,
      };
    } else {
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        error: error.error?.message || "Connection failed",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

export async function callGemini(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  abortSignal?: AbortSignal
): Promise<LLMResponse> {
  const { apiKey, model } = await getGeminiSettings(settings);
  const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;

  // Create a map of tool_call_id to function name
  const toolIdToName = new Map<string, string>();
  messages.forEach(m => {
    if (m.role === 'assistant' && m.tool_calls) {
      m.tool_calls.forEach((tc: any) => {
        if (tc.id && tc.function?.name) {
          toolIdToName.set(tc.id, tc.function.name);
        }
      });
    }
  });

  // Convert messages to Gemini format, including tool history
  // valid roles: 'user', 'model'
  const contents: any[] = [];
  const validMessages = messages.filter(m => m.role !== 'system');

  for (const m of validMessages) {
    let role: 'user' | 'model' | null = null;
    if (m.role === 'assistant') role = 'model';
    if (m.role === 'user' || m.role === 'tool') role = 'user';
    if (!role) continue;

    const parts: any[] = [];

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

    // Handle assistant tool calls
    if (m.role === 'assistant' && (m as any).tool_calls) {
      (m as any).tool_calls.forEach((tc: any) => {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: typeof tc.function.arguments === 'string'
              ? (() => {
                try {
                  return safeParseJSON(tc.function.arguments);
                } catch (e) {
                  console.warn(`Failed to parse Gemini tool arguments for ${tc.function.name}:`, tc.function.arguments);
                  return { _parse_error: "Invalid JSON arguments" };
                }
              })()
              : tc.function.arguments
          }
        });
      });
    }

    // Handle tool results
    if (m.role === 'tool') {
      const resultText = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? extractTextForLegacyProviders(m.content)
          : JSON.stringify(m.content ?? '');

      // Resolve name from ID if not present
      const fnName = (m as any).name || (m.tool_call_id ? toolIdToName.get(m.tool_call_id) : 'unknown_tool');

      parts.push({
        functionResponse: {
          name: fnName,
          response: { result: resultText }
        }
      });
    }

    // Merge logic: If current message has same role as previous, merge parts
    if (parts.length === 0) continue;

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
      parameters: t.parameters
    }))
  } : undefined;

  const payload = {
    contents,
    system_instruction: systemInstructionText ? { parts: [{ text: systemInstructionText }] } : undefined,
    tools: toolConfig ? [{ function_declarations: toolConfig.function_declarations }] : undefined,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    }
  };

  const response = await fetch(`${baseUrl}/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: abortSignal,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorDetails = await response.json().catch(() => ({}));
    throw new Error(`Gemini API error: ${response.statusText}. ${JSON.stringify(errorDetails)}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const content = candidate?.content?.parts?.[0]?.text || "";
  const toolCalls = candidate?.content?.parts?.filter((p: any) => p.functionCall).map((p: any) => ({
    id: `gemini-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    name: p.functionCall.name,
    arguments: ensureRecord(p.functionCall.args)
  }));

  return {
    content,
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    provider: 'gemini',
    model: model
  };
}
