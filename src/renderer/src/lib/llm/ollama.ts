import { LLMMessage, LLMSettings, LLMTool, LLMResponse } from "../types";
import { ProviderStatus } from "./types";
import { LLM_CONFIG, FEATURE_FLAGS } from "../constants";
import { extractTextForLegacyProviders } from "./utils";

export // Get Ollama settings from store or use defaults
function getOllamaSettings(settings?: LLMSettings) {
  const baseUrl = settings?.ollamaBaseUrl || LLM_CONFIG.OLLAMA.BASE_URL;
  const model = settings?.ollamaModel || LLM_CONFIG.OLLAMA.DEFAULT_MODEL;
  return { baseUrl, model };
}

// Check if Ollama is running and list available models
export async function checkOllama(
  settings?: LLMSettings
): Promise<ProviderStatus> {
  if (!FEATURE_FLAGS.OLLAMA_ENABLED) {
    return { available: false, error: "Ollama disabled" };
  }

  const { baseUrl, model: preferredModel } = getOllamaSettings(settings);

  try {
    // Use IPC to fetch models from main process (bypasses potential CORS issues)
    const electron = (window as any).electron;
    if (electron?.llm?.fetchOllamaModels) {
      const result = await electron.llm.fetchOllamaModels(baseUrl);

      if (result.success && result.models && result.models.length > 0) {
        const defaultModel =
          result.models.find((m: string) => m.startsWith(preferredModel)) ||
          result.models[0] ||
          preferredModel;
        return {
          available: true,
          model: defaultModel,
          models: result.models,
        };
      } else if (result.error) {
        return { available: false, error: result.error };
      }
      return { available: false, error: "No models found" };
    }

    // Fallback to direct fetch if IPC not available (for development/testing)
    const response = await fetch(`${baseUrl}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      const models = (data.models || []).map((m: { name: string }) => m.name);
      const defaultModel =
        models.find((m: string) => m.startsWith(preferredModel)) ||
        models[0] ||
        preferredModel;
      return {
        available: true,
        model: defaultModel,
        models: models,
      };
    }
    return { available: false, error: "Ollama not responding" };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Ollama not running",
    };
  }
}

// Test Ollama connection with a specific model
export async function testOllamaConnection(
  baseUrl: string,
  model: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "test",
        stream: false,
      }),
    });
    if (response.ok) {
      return { success: true };
    }
    const error = await response.json().catch(() => ({}));
    return { success: false, error: error.error || "Connection failed" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

export // Call Ollama API
async function callOllama(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  abortSignal?: AbortSignal,
  workspacePath?: string // New parameter
): Promise<LLMResponse> {
  const { baseUrl, model } = getOllamaSettings(settings);

  console.log(`[LLM Chat] Calling Ollama at: ${baseUrl}/api/chat`);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortSignal,
    body: JSON.stringify({
      model: model,
      messages: messages.map((m) => ({
        role: m.role,
        content: extractTextForLegacyProviders(m.content),
      })),
      stream: false,
      tools: tools?.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    }),
  });

  if (!response || !response.ok) {
    if (response?.status === 404) {
      console.error(`[LLM Chat] 404 Error: Ollama endpoint not found at ${baseUrl}/api/chat`);
    }
    const error = response ? await response.json().catch(() => ({})) : { error: "Fetch failed" };
    throw new Error(error.error || `Ollama error: ${response?.statusText || "Unknown"}`);
  }

  const data = await response.json();

  return {
    content: data.message?.content || "",
    toolCalls: data.message?.tool_calls?.map(
      (tc: {
        function: { name: string; arguments: Record<string, unknown> };
      }) => ({
        id: `call_${Date.now()}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })
    ),
    provider: "ollama",
    model: model,
  };
}
