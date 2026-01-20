// LLM Orchestrator - Manages different LLM providers
// Priority: WebLLM (On-Device) > Ollama > OpenAI-compatible

import { FEATURE_FLAGS, LLM_CONFIG } from "./constants";
import {
  getWebLLMStatus,
  loadWebLLMModel,
  chatWithWebLLM,
  subscribeToWebLLMStatus,
  WEBLLM_MODELS,
  type WebLLMStatus,
  type WebLLMModelId,
  checkDownloadedWebLLMModels,
  deleteWebLLMModel,
  downloadWebLLMModelOnly,
  getWebLLMDownloadStatus,
  checkWebLLMModelCompatibility
} from "./webllm";
import { CREATE_PLAN_TOOL } from "./plan_manager";
import { EXECUTION_PLAN_SCHEMA } from "./agent-protocol";
import { 
  LLMMessage, 
  LLMTool, 
  ServerInfo, 
  LLMResponse, 
  LLMProvider, 
  LLMSettings 
} from "./types";
import { pruneContext } from "./dcp";

export {
  getWebLLMStatus,
  WEBLLM_MODELS,
  subscribeToWebLLMStatus,
  checkDownloadedWebLLMModels,
  deleteWebLLMModel,
  downloadWebLLMModelOnly,
  getWebLLMDownloadStatus,
  checkWebLLMModelCompatibility,
  type WebLLMStatus,
  // Types re-exported
  type LLMMessage,
  type LLMTool,
  type ServerInfo,
  type LLMResponse,
  type LLMProvider,
  type LLMSettings
};

interface ProviderStatus {

  available: boolean;
  model?: string;
  error?: string;
  models?: string[]; // Available models list
  modelsEndpointAvailable?: boolean; // Whether /models endpoint exists
  // WebLLM specific
  isWebGPUSupported?: boolean;
  isLoaded?: boolean;
  isLoading?: boolean;
  loadingProgress?: number;
  loadingStage?: string;
  downloadedModels?: string[]; // WebLLM cached models
}

// Get Ollama settings from store or use defaults
function getOllamaSettings(settings?: LLMSettings) {
  const baseUrl = settings?.ollamaBaseUrl || LLM_CONFIG.OLLAMA.BASE_URL;
  const model = settings?.ollamaModel || LLM_CONFIG.OLLAMA.DEFAULT_MODEL;
  return { baseUrl, model };
}

// Get OpenAI settings from store or use defaults
async function getOpenAISettings(
  settings?: LLMSettings
): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  // Import electron here to avoid circular dependencies
  const electron = (await import("./electron")).default;

  const apiKey =
    settings?.openaiApiKey ||
    (await electron.store.get<string>("openai_api_key")) ||
    "";
  const baseUrl =
    settings?.openaiBaseUrl ||
    (await electron.store.get<string>("openai_base_url")) ||
    "https://api.openai.com/v1";
  const model =
    settings?.openaiModel || LLM_CONFIG.OPENAI_COMPATIBLE.DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

// Get Gemini settings from store or use defaults
async function getGeminiSettings(
  settings?: LLMSettings
): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  const electron = (await import("./electron")).default;
  const apiKey =
    settings?.geminiApiKey ||
    (await electron.store.get<string>("gemini_api_key")) ||
    "";
  const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;
  const model = settings?.geminiModel || LLM_CONFIG.GEMINI.DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

// Get OpenRouter settings from store or use defaults
async function getOpenRouterSettings(
  settings?: LLMSettings
): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  const electron = (await import("./electron")).default;
  const apiKey =
    settings?.openrouterApiKey ||
    (await electron.store.get<string>("openrouter_api_key")) ||
    "";
  const baseUrl = LLM_CONFIG.OPENROUTER.BASE_URL;
  const model = settings?.openrouterModel || LLM_CONFIG.OPENROUTER.DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
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

// Check if WebLLM (On-Device AI via WebGPU) is available
export async function checkBrowserLLM(): Promise<ProviderStatus> {
  if (!FEATURE_FLAGS.BROWSER_LLM_ENABLED) {
    return { available: false, error: 'On-Device AI disabled' }
  }

  try {
    const status = getWebLLMStatus();
    console.log('[WebLLM] Status:', status);

    if (!status.isSupported) {
      return {
        available: false,
        error: status.error || 'WebGPU not supported',
        isWebGPUSupported: false,
      }
    }

    // WebGPU is supported
    const models = WEBLLM_MODELS.map(m => m.id);

    return {
      available: true,
      model: status.currentModel || WEBLLM_MODELS[0].id,
      models: models,
      isWebGPUSupported: true,
      isLoaded: status.isLoaded,
      isLoading: status.isLoading,
      loadingProgress: status.loadingProgress,
      loadingStage: status.loadingStage,
      downloadedModels: status.downloadedModels,
      error: status.error || undefined,
    }
  } catch (error) {
    console.error('[WebLLM] Check error:', error);
    return {
      available: false,
      error: error instanceof Error ? error.message : 'WebLLM check failed'
    }
  }
}

// Test WebLLM connection (simple chat)
export async function testWebLLMConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const status = getWebLLMStatus();
    if (!status.isLoaded) {
      return { success: false, error: 'Model not loaded' };
    }

    // specific test message to avoid long responses
    const response = await chatWithWebLLM([
      { role: 'user', content: 'Say "test" and nothing else.' }
    ]);

    if (response.content) {
      return { success: true };
    }
    return { success: false, error: 'No response content' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Test failed'
    };
  }
}

// Check if OpenAI-compatible API is configured and fetch available models
export async function checkOpenAI(
  settings?: LLMSettings,
  providerOverride?: "openai" | "openrouter"
): Promise<ProviderStatus> {
  if (!FEATURE_FLAGS.CLOUD_LLM_ENABLED) {
    return { available: false, error: "Cloud LLM disabled" };
  }

  const { apiKey, baseUrl, model } =
    providerOverride === "openrouter"
      ? await getOpenRouterSettings(settings)
      : await getOpenAISettings(settings);

  if (!apiKey) {
    return {
      available: false,
      error: `${providerOverride === "openrouter" ? "OpenRouter" : "OpenAI"} API Key not set`,
    };
  }

  try {
    // Use IPC to fetch models from main process (bypasses CORS)
    const electron = (window as any).electron;
    if (electron?.llm?.fetchOpenAIModels) {
      const result = await electron.llm.fetchOpenAIModels(baseUrl, apiKey);

      if (result.success && result.models && result.models.length > 0) {
        const models = result.models;
        // Find the preferred model or use default
        const preferredModel = model;
        const defaultModel =
          models.find((m: string) => m === preferredModel) ||
          models.find((m: string) => m.includes("gpt-4o")) ||
          models.find((m: string) => m.includes("gpt-4")) ||
          models[0] ||
          preferredModel;

        return {
          available: true,
          model: defaultModel,
          models: models,
          modelsEndpointAvailable: true,
        };
      } else {
        // If models endpoint fails, still mark as available if API key exists
        return {
          available: true,
          model: model,
          models: [model], // Fallback to just the configured model
          modelsEndpointAvailable: false,
          error: result.error || "Could not fetch models list",
        };
      }
    } else {
      // Fallback to direct fetch if IPC not available (for development/testing)
      console.log(`[LLM Check] Checking OpenAI models at: ${baseUrl}/models`);
      const response = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response) {
        throw new Error("Fetch returned undefined response");
      }

      if (response.ok) {
        const data = await response.json();
        const models = (data.data || [])
          .filter((m: { id: string }) => {
            const id = m.id.toLowerCase();
            return (
              id.includes("gpt") ||
              id.includes("chat") ||
              id.includes("claude") ||
              id.includes("llama") ||
              id.includes("perplexity")
            );
          })
          .map((m: { id: string }) => m.id)
          .sort();

        const preferredModel = model;
        const defaultModel =
          models.find((m: string) => m === preferredModel) ||
          models.find((m: string) => m.includes("gpt-4o")) ||
          models.find((m: string) => m.includes("gpt-4")) ||
          models[0] ||
          preferredModel;

        return {
          available: true,
          model: defaultModel,
          models: models,
          modelsEndpointAvailable: true,
        };
      } else {
        if (response.status === 404) {
          console.error(`[LLM Check] 404 Error: Models endpoint not found at ${baseUrl}/models`);
        } else {
          console.error(`[LLM Check] HTTP Error ${response.status}: ${response.statusText} at ${baseUrl}/models`);
        }
        return {
          available: true,
          model: model,
          models: [model],
          modelsEndpointAvailable: false,
        };
      }
    }
  } catch (error) {
    // If fetch fails, still mark as available if API key exists
    // User can still use the manually entered model
    return {
      available: true,
      model: model,
      models: [model], // Fallback to just the configured model
      modelsEndpointAvailable: false,
      error:
        error instanceof Error ? error.message : "Could not fetch models list",
    };
  }
}

// Check if OpenRouter is configured and available
export async function checkOpenRouter(
  settings?: LLMSettings
): Promise<ProviderStatus> {
  const { apiKey, baseUrl, model } = await getOpenRouterSettings(settings);
  if (!apiKey) return { available: false, error: "OpenRouter API Key not set" };

  // reuse OpenAI check with OpenRouter specific headers if needed
  return checkOpenAI(settings, "openrouter");
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

// Test OpenAI connection and fetch models
export async function testOpenAIConnection(
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<{
  success: boolean;
  error?: string;
  models?: string[];
  modelsEndpointAvailable?: boolean;
}> {
  try {
    // Test connection with chat completions
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 5,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        error: error.error?.message || "Connection failed",
      };
    }

    // Try to fetch models if connection succeeds
    const electron = (window as any).electron;
    if (electron?.llm?.fetchOpenAIModels) {
      try {
        const modelsResult = await electron.llm.fetchOpenAIModels(
          baseUrl,
          apiKey
        );
        if (modelsResult.success && modelsResult.models) {
          return {
            success: true,
            models: modelsResult.models,
            modelsEndpointAvailable: true,
          };
        } else {
          return {
            success: true,
            modelsEndpointAvailable: false,
            error: modelsResult.error || "Models endpoint not available",
          };
        }
      } catch (modelsError) {
        // Connection works but models endpoint doesn't
        return {
          success: true,
          modelsEndpointAvailable: false,
        };
      }
    }

    return { success: true, modelsEndpointAvailable: false };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

// Get available providers
export async function getAvailableProviders(
  settings?: LLMSettings
): Promise<Record<LLMProvider, ProviderStatus>> {
  const [webLLM, ollama, openai, gemini, openrouter] = await Promise.all([
    getWebLLMStatus(),
    checkOllama(settings),
    checkOpenAI(settings, "openai"),
    checkGemini(settings),
    checkOpenRouter(settings),
  ]);

  const browser: ProviderStatus = {
    ...webLLM,
    error: webLLM.error || undefined,
    available: webLLM.isSupported,
  };

  return {
    browser,
    ollama,
    openai,
    gemini,
    openrouter,
  };
}

// Call Ollama API
async function callOllama(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  abortSignal?: AbortSignal
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
        content: m.content,
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

// Call WebLLM (On-Device AI via WebGPU)
// Note: Most WebLLM models don't support native tool calling, so we rely on
// the system prompt to instruct the model to output JSON, then parse it
async function callBrowserLLM(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings
): Promise<LLMResponse> {
  try {
    const status = getWebLLMStatus();

    // Check if model is loaded
    if (!status.isLoaded) {
      console.log('[WebLLM] Model not loaded, attempting to load...');
      await loadWebLLMModel();
    }

    // Don't pass tools to WebLLM - the system prompt already contains tool definitions
    // Models will output JSON tool calls in their response content
    const response = await chatWithWebLLM(
      messages
        .filter(m => m.role !== 'tool')
        .map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
      // No tools passed - avoids "model doesn't support tools" error
    );

    // Parse tool calls from JSON in response content (same as existing JSON fallback)
    let toolCalls = response.toolCalls;
    if (!toolCalls && response.content && tools && tools.length > 0) {
      toolCalls = parseToolCallsFromJson(response.content);
    }

    return {
      content: response.content,
      toolCalls,
      provider: 'browser',
      model: status.currentModel || 'webllm',
    };
  } catch (error) {
    console.error('[WebLLM] Chat error:', error);
    throw new Error(`WebLLM error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}


// Helper to format messages for OpenAI-compatible APIs
function formatMessagesForOpenAI(messages: LLMMessage[]): any[] {
  return messages.map(m => {
    // Basic message structure
    const formatted: any = {
      role: m.role,
      content: m.content
    };

    // Add tool_calls if present (and strictly stringify arguments)
    if (m.tool_calls && m.tool_calls.length > 0) {
      formatted.tool_calls = m.tool_calls.map((tc: any) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'object' 
            ? JSON.stringify(tc.function.arguments) 
            : tc.function.arguments
        }
      }));
    }

    // Add tool_call_id if it's a tool response
    if (m.role === 'tool' && m.tool_call_id) {
      formatted.tool_call_id = m.tool_call_id;
    }

    // Add name if present (formatting for OpenAI)
    if (m.name) {
      formatted.name = m.name;
    }

    return formatted;
  });
}

// Call OpenAI-compatible API
async function callOpenAI(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  useJsonFallback: boolean = false,
  servers?: ServerInfo[],
  isOpenRouter: boolean = false,
  abortSignal?: AbortSignal
): Promise<LLMResponse> {
  const { apiKey, baseUrl, model } = isOpenRouter
    ? await getOpenRouterSettings(settings)
    : await getOpenAISettings(settings);

  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (isOpenRouter) {
    headers["HTTP-Referer"] = "https://ai-worker.app";
    headers["X-Title"] = "AI-Worker";
  }

  // If using JSON fallback, rebuild system message with JSON instructions
  let requestMessages = messages;
  if (useJsonFallback && tools && tools.length > 0) {
    requestMessages = [...messages];
    // Rebuild system message with JSON fallback instructions
    const systemMsgIndex = requestMessages.findIndex(
      (m) => m.role === "system"
    );
    const systemPrompt = buildSystemPrompt(tools, servers, true);
    if (systemMsgIndex >= 0) {
      requestMessages[systemMsgIndex] = {
        role: "system" as const,
        content: systemPrompt,
      };
    } else {
      requestMessages.unshift({
        role: "system" as const,
        content: systemPrompt,
      });
    }
  }

  console.log(`[LLM Chat] Calling OpenAI-compatible API at: ${baseUrl}/chat/completions`);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    signal: abortSignal,
    body: JSON.stringify({
      model: model,
      messages: formatMessagesForOpenAI(useJsonFallback ? requestMessages : messages),
      ...(useJsonFallback
        ? {}
        : {
          tools: tools?.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
        }),
    }),
  });

  if (!response || !response.ok) {
    if (response?.status === 404) {
      console.error(`[LLM Chat] 404 Error: OpenAI-compatible endpoint not found at ${baseUrl}/chat/completions`);
    }
    const error = response ? await response.json().catch(() => ({})) : { error: "Fetch failed" };
    const errorMessage =
      error.error?.message || `OpenAI error: ${response?.statusText || "Unknown"}`;

    // Check if it's a tool calling not supported error
    if (
      error.error?.code === 400 &&
      (errorMessage.toLowerCase().includes("tool calling") ||
        errorMessage.toLowerCase().includes("tool_call") ||
        errorMessage.toLowerCase().includes("tools")) &&
      !useJsonFallback &&
      tools &&
      tools.length > 0
    ) {
      // Retry with JSON fallback - rebuild messages with proper system prompt
      const retryMessages = [...messages];
      const systemMsgIndex = retryMessages.findIndex(
        (m) => m.role === "system"
      );
      const systemPrompt = buildSystemPrompt(tools, servers, true);
      if (systemMsgIndex >= 0) {
        retryMessages[systemMsgIndex] = {
          role: "system" as const,
          content: systemPrompt,
        };
      } else {
        retryMessages.unshift({
          role: "system" as const,
          content: systemPrompt,
        });
      }
      return callOpenAI(retryMessages, tools, settings, true, servers);
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();
  const choice = data.choices[0];
  const content = choice.message?.content || "";

  // If using JSON fallback, try to parse tool calls from content
  let toolCalls = choice.message?.tool_calls?.map(
    (tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJSON(tc.function.arguments),
    })
  );

  // If no native tool calls, try to parse from content (Self-Healing)
  if (!toolCalls || toolCalls.length === 0) {
    if (useJsonFallback && content) {
       // Legacy JSON fallback
       toolCalls = parseToolCallsFromJson(content);
    } 
    
    // Check for XML Plan (Legacy/Model Hallucination Fallback)
    else if (content.includes('<agent_plan>')) {
      // ... existing XML logic ...
      console.log('[LLM] Detected XML plan in content, converting to tool call');
      toolCalls = [{
        id: `auto_plan_${Date.now()}`,
        name: 'create_execution_plan',
        arguments: { plan_content: content }
      }];
    }
  }

  return {
    content: content,
    toolCalls: toolCalls,
    provider: "openai",
    model: model,
  };
}

// Parse tool calls from JSON in response content
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
        return parsed.tool_calls.map(
          (
            tc: { name: string; arguments: Record<string, unknown> },
            idx: number
          ) => ({
            id: `json_call_${Date.now()}_${idx}`,
            name: tc.name,
            arguments: tc.arguments || {},
          })
        );
      }
      
      // Alternate Format (Common in some models): { "tool": "name", "params": {...} }
      if (parsed.tool && typeof parsed.tool === 'string') {
        const params = parsed.params || parsed.parameters || parsed.arguments || {};
        return [{
          id: `json_call_${Date.now()}`,
          name: parsed.tool,
          arguments: params
        }];
      }
    }
  } catch (error) {
    // Failed to parse, return undefined
    console.warn("Failed to parse tool calls from JSON:", error);
  }
  return undefined;
}

// Build robust but token-efficient system prompt
function buildSystemPrompt(
  tools?: LLMTool[],
  servers?: ServerInfo[],
  useJsonFallback = false
): string {
  const toolCount = tools?.length || 0;
  const serverCount = servers?.length || 0;

  if (toolCount === 0) {
    return `You are AI-Worker, a helpful voice-first assistant. When tools become available, use them to perform actions instead of providing manual instructions. Be concise for voice output.`;
  }

  // Ensure we have tools - this should never happen if tools are passed correctly
  if (!tools || tools.length === 0) {
    console.warn("buildSystemPrompt called with empty tools array");
    return `You are AI-Worker, a helpful voice-first assistant. When tools become available, use them to perform actions instead of providing manual instructions. Be concise for voice output.`;
  }

  // Add JSON format instruction if using fallback
  const jsonFormatNote = useJsonFallback
    ? `\n\n**CRITICAL: JSON TOOL CALLING FORMAT**\nThis model doesn't support native tool calling. When you need to use a tool, return ONLY a JSON object (no markdown, no code blocks, just raw JSON).\n\nFor the 'create_execution_plan' tool, use this exact structure:\n${JSON.stringify(EXECUTION_PLAN_SCHEMA, null, 2)}\n\nIMPORTANT: \n- Return ONLY the JSON object\n- Do not include any text before or after`
    : "";

  // Build tools description - compact format with name and description
  const toolsDescription =
    tools
      ?.map((tool, idx) => {
        // Extract key parameters for context (if available)
        const params = tool.parameters as
          | { properties?: Record<string, unknown>; required?: string[] }
          | undefined;
        const properties = params?.properties || {};
        const paramNames = Object.keys(properties).slice(0, 3).join(", ");
        const paramHint = paramNames
          ? ` (params: ${paramNames}${Object.keys(properties).length > 3 ? "..." : ""
          })`
          : "";

        const server = servers?.find(s => s.toolCount > 0 && tools?.some(t => t.name.startsWith(tool.name.split('_')[0]))); 
        // Heuristic: check if we can query mcp.ts directly or pass server mapping. 
        // Since we don't have direct mapping here, we can rely on grouping by server context below or just hint.
        // Better: The 'servers' list passed to this function usually contains aggregate info. 
        // Let's simplified: The "Connected MCP Servers" section below handles the grouping.
        // We will just leave the tool description as is, but emphasize the Agent Roles above.

        return `${idx + 1}. **${tool.name}**${paramHint}\n   ${tool.description}`;
      })
      .join("\n\n") || "";

  // Group tools by server if we have server info (for context)
  let serverContext = "";
  if (serverCount > 0 && servers) {
    const serverList = servers
      .map((s) => {
        if (s.isReasoningServer) {
          return `${s.name} (reasoning server - provides step-by-step reasoning capabilities)`;
        }
        return `${s.name} (${s.toolCount} tool${s.toolCount !== 1 ? "s" : ""})`;
      })
      .join(", ");

    const reasoningServers = servers.filter((s) => s.isReasoningServer);
    const reasoningNote =
      reasoningServers.length > 0
        ? `\n\n**Reasoning Servers Available**: ${reasoningServers
          .map((s) => s.name)
          .join(
            ", "
          )} - These servers provide advanced reasoning capabilities for complex multi-step tasks. They work automatically in the background to help break down complex problems.`
        : "";

    serverContext = `\n\n## Connected MCP Servers\nThese are Model Context Protocol (MCP) servers that provide the tools listed above:\n${serverList}${reasoningNote}\n\nWhen users ask about "MCP servers" or "what tools do you have", refer to the tools and servers listed above.`;
  }

  // Detect browser tools for special emphasis
  const toolNames = tools?.map((t) => t.name).join(", ") || "";
  const toolNamesLower = toolNames.toLowerCase();
  const hasBrowserOps =
    toolNamesLower.includes("browser") ||
    toolNamesLower.includes("navigate") ||
    toolNamesLower.includes("screenshot") ||
    toolNamesLower.includes("playwright") ||
    toolNamesLower.includes("goto") ||
    toolNamesLower.includes("url");

  // Special emphasis for browser capabilities (addresses training bias)
  let browserCapabilityNote = "";
  if (hasBrowserOps) {
    browserCapabilityNote = `\n\n**IMPORTANT: You have browser control tools available!** You CAN open websites, navigate to URLs, take screenshots, and interact with web pages. When users ask to "open [website]" or "go to [URL]", use the browser navigation tool immediately. Do NOT say you cannot open browsers - you have the tools to do it!

**MULTI-STEP BROWSER TASKS**: For complex browser tasks like "search for X on Google" or "fill out a form", you MUST complete ALL steps:
1. Navigate to the website (e.g., browser_navigate to google.com)
2. Wait for the page to load (check the result)
3. Fill in search boxes or forms (e.g., browser_type or browser_fill)
4. Submit or click buttons (e.g., browser_click or browser_press_key)
5. Continue until the task is COMPLETE

Example: "search for nike shoes on Google" requires:
- Step 1: browser_navigate to google.com
- Step 2: browser_type or browser_fill to enter "nike shoes" in the search box
- Step 3: browser_click the search button OR browser_press_key Enter
- Step 4: Verify the search completed (check results)

DO NOT stop after just navigating - complete the entire workflow!`;
  }

  return `You are a helpful AI assistant with access to ${toolCount} tool${toolCount !== 1 ? "s" : ""
    } from ${serverCount} connected server${serverCount !== 1 ? "s" : ""
    }. When users ask you to perform actions, you MUST use the appropriate tools instead of providing manual instructions.${jsonFormatNote}

# Available Tools
${toolsDescription}${serverContext}${browserCapabilityNote}

# TASK PLANNING & DELEGATION
For complex user requests (like "check nike shoes for size 6" or "find and summarize X"), you MUST first create a structured plan using the **create_execution_plan** tool.

**When to use create_execution_plan:**
1. The request requires multiple steps (search, navigate, verify).
2. The request involves browsing the web or using multiple tools.
3. The request is ambiguous and needs to be broken down.

**Agent Roles:**
${servers && servers.length > 0
      ? servers.map(s => `- **${s.name.charAt(0).toUpperCase() + s.name.slice(1)}Agent**: Specialized in operations using ${s.name} tools (${s.toolCount} tools available).`).join('\n')
      : '- **SystemAgent**: General purpose agent.'
    }
- **System**: General reasoning and coordination.

# CRITICAL RULES
1. **PLAN FIRST**: If the task is complex, your FIRST action MUST be to call 'create_execution_plan'. Do not textually describe the plan, use the tool.

2. **USE TOOLS, DON'T EXPLAIN**: When a user asks you to DO something, use the appropriate tool.

3. **AUTONOMOUS EXECUTION**: Execute tool calls immediately.

4. **ITERATIVE EXECUTION**: Call tools in sequence.

5. **CHAINED WORKFLOWS**:
   - Call 'create_execution_plan' (if complex)
   - Call the first tool
   - Use result for next tool
   - Repeat

6. **CONFIRM WITH RESULTS**: Confirm actions with specific details.

7. **HANDLE ERRORS**: Explain errors clearly.

8. **VOICE-OPTIMIZED**: Keep responses concise and natural.

# Response Pattern
- **Complex Task**:
  [Tool Call: create_execution_plan]
  [Tool Call: browser_navigate ...]
- **Simple Task**:
  [Tool Call: ...]
  "Done!"

Remember: TAKE ACTION using tools!`;
}

// Main chat function - automatically selects best provider
export async function chat(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  servers?: ServerInfo[],
  abortSignal?: AbortSignal
): Promise<LLMResponse> {
  // Apply Dynamic Context Pruning (DCP)
  // This removes redundant tool outputs from history to save tokens
  const prunedMessages = pruneContext(messages);

  const providers = await getAvailableProviders(settings);

  // Determine which provider to use
  let provider: LLMProvider | null = null;
  const preferredProvider = settings?.preferredProvider;

  if (preferredProvider === "auto" || !preferredProvider) {
    // Auto-select: try browser first (if enabled), then ollama, then openai
    if (providers.browser.available) {
      provider = "browser";
    } else if (providers.ollama.available) {
      provider = "ollama";
    } else if (providers.openai.available) {
      provider = "openai";
    } else if (providers.gemini.available) {
      provider = "gemini";
    } else if (providers.openrouter.available) {
      provider = "openrouter";
    }
  } else if (preferredProvider === "browser" && providers.browser.available) {
    provider = "browser";
  } else if (preferredProvider === "ollama" && providers.ollama.available) {
    provider = "ollama";
  } else if (preferredProvider === "openai" && providers.openai.available) {
    provider = "openai";
  } else if (preferredProvider === "gemini" && providers.gemini.available) {
    provider = "gemini";
  } else if (preferredProvider === "openrouter" && providers.openrouter.available) {
    provider = "openrouter";
  }

  if (!provider) {
    throw new Error(
      "No LLM provider available. Please enable a provider (Browser LLM, Ollama, OpenAI, Gemini, or OpenRouter) and configure it appropriately."
    );
  }

  // Try to detect if we need JSON fallback (will be handled in callOpenAI if error occurs)
  // For browser (WebLLM), we always use JSON fallback for now to ensure compatibility
  // across all models (Qwen, Llama, etc.) without native tool calling errors
  let useJsonFallback = provider === 'browser';

  // Add system message if not present, or replace existing one to ensure it has tools
  let messagesWithSystem = [...prunedMessages];
  const systemMsgIndex = messagesWithSystem.findIndex(
    (m) => m.role === "system"
  );
  
  // MERGE default tools with the new CREATE_PLAN_TOOL
  const allTools = [CREATE_PLAN_TOOL, ...(tools || [])];
  
  // Re-build system prompt with current tools and correct fallback setting
  const systemPrompt = buildSystemPrompt(allTools, servers, useJsonFallback);

  if (systemMsgIndex >= 0) {
    // Replace existing system message to ensure it has current tools
    messagesWithSystem[systemMsgIndex] = {
      role: "system" as const,
      content: systemPrompt,
    };
  } else {
    // Add new system message
    messagesWithSystem.unshift({
      role: "system" as const,
      content: systemPrompt,
    });
  }

  switch (provider) {
    case "browser":
      return callBrowserLLM(messagesWithSystem, tools, settings);
    case "ollama":
      return callOllama(messagesWithSystem, tools, settings, abortSignal);
    case "openai":
      return callOpenAI(messagesWithSystem, tools, settings, useJsonFallback, servers, false, abortSignal);
    case "gemini":
      return callGemini(messagesWithSystem, tools, settings, abortSignal);
    case "openrouter":
      return callOpenAI(messagesWithSystem, tools, settings, useJsonFallback, servers, true, abortSignal);
    default:
      throw new Error(`Provider ${provider} not implemented`);
  }
}

// Gemini specific caller
async function callGemini(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  abortSignal?: AbortSignal
): Promise<LLMResponse> {
  const { apiKey, model } = await getGeminiSettings(settings);
  const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;

  // Convert messages to Gemini format, including tool history
  const contents = messages.filter(m => m.role !== 'system').map(m => {
    const role = m.role === 'assistant' ? 'model' : m.role === 'tool' ? 'function' : 'user';

    const parts: any[] = [];
    if (m.content) {
      parts.push({ text: m.content });
    }

    // Handle assistant tool calls
    if (m.role === 'assistant' && (m as any).tool_calls) {
      (m as any).tool_calls.forEach((tc: any) => {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: safeParseJSON(tc.function.arguments)
          }
        });
      });
    }

    // Handle tool results
    if (m.role === 'tool') {
      parts.push({
        functionResponse: {
          name: (m as any).name,
          response: { result: m.content }
        }
      });
    }

    return { role, parts };
  });

  const systemInstruction = messages.find(m => m.role === 'system')?.content;

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
    system_instruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
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
    arguments: p.functionCall.args
  }));

  return {
    content,
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    provider: 'gemini',
    model: model
  };
}

// Load WebLLM model (download if needed)
export async function downloadBrowserModel(
  onProgress?: (progress: number) => void,
  modelId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const status = getWebLLMStatus();

    if (!status.isSupported) {
      return { success: false, error: status.error || 'WebGPU not supported' };
    }

    if (status.isLoaded && (!modelId || status.currentModel === modelId)) {
      return { success: true };
    }

    // Subscribe to progress updates
    let unsubscribe: (() => void) | null = null;
    if (onProgress) {
      unsubscribe = subscribeToWebLLMStatus((s) => {
        if (s.isLoading) {
          onProgress(s.loadingProgress);
        }
      });
    }

    try {
      await loadWebLLMModel(modelId);
      return { success: true };
    } finally {
      if (unsubscribe) unsubscribe();
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load model'
    };
  }
}



// Helper to safely parse JSON that might contain surrounding text or trailing garbage
export function safeParseJSON(input: string | any): any {
  if (typeof input !== 'string') return input;
  if (!input || input.trim() === '') return {};
  
  try {
    return JSON.parse(input.trim());
  } catch (e) {
    try {
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
    } catch (innerE) {
      console.warn('[safeParseJSON] Extraction failed:', innerE);
    }
    
    // If all else fails, return as-is or empty object if it was supposed to be args
    return input;
  }
}
