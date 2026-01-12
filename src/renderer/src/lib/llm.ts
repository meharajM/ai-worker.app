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
};

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ServerInfo {
  name: string;
  description: string;
  toolCount: number;
  isReasoningServer?: boolean; // True for servers that provide reasoning capabilities without traditional tools
}

export interface LLMResponse {
  content: string;
  toolCalls?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }[];
  provider: string;
  model: string;
}

export type LLMProvider = "browser" | "ollama" | "openai";

export interface LLMSettings {
  preferredProvider?: "auto" | "ollama" | "openai" | "browser";
  ollamaModel?: string;
  ollamaBaseUrl?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
}

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

// Check if Ollama is running and list available models
export async function checkOllama(
  settings?: LLMSettings
): Promise<ProviderStatus> {
  if (!FEATURE_FLAGS.OLLAMA_ENABLED) {
    return { available: false, error: "Ollama disabled" };
  }

  const { baseUrl } = getOllamaSettings(settings);

  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      const models = (data.models || []).map((m: { name: string }) => m.name);
      const { model: preferredModel } = getOllamaSettings(settings);
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
  settings?: LLMSettings
): Promise<ProviderStatus> {
  if (!FEATURE_FLAGS.CLOUD_LLM_ENABLED) {
    return { available: false, error: "Cloud LLM disabled" };
  }

  const { apiKey, baseUrl, model } = await getOpenAISettings(settings);
  if (!apiKey) {
    return { available: false, error: "No API key configured" };
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
      const response = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

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
export async function getAvailableProviders(settings?: LLMSettings): Promise<Record<LLMProvider, ProviderStatus>> {
  const preferred = settings?.preferredProvider || 'auto'

  if (preferred === 'ollama') {
    const ollama = await checkOllama(settings)
    return {
      browser: { available: false, error: "Not implemented yet" },
      ollama,
      openai: { available: false },
    };
  }

  if (preferred === 'openai') {
    const openai = await checkOpenAI(settings)
    return {
      browser: { available: false, error: "Not implemented yet" },
      ollama: { available: false },
      openai,
    };
  }

  if (preferred === 'browser') {
    const browser = await checkBrowserLLM()
    return {
      browser,
      ollama: { available: false },
      openai: { available: false },
    };
  }

  // Auto mode - check all providers
  const [browser, ollama, openai] = await Promise.all([
    checkBrowserLLM(),
    checkOllama(settings),
    checkOpenAI(settings),
  ])

  return {
    browser,
    ollama,
    openai,
  };
}

// Call Ollama API
async function callOllama(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings
): Promise<LLMResponse> {
  const { baseUrl, model } = getOllamaSettings(settings);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Ollama error: ${response.statusText}`);
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
      messages.map(m => ({ role: m.role, content: m.content }))
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

// Call OpenAI-compatible API
async function callOpenAI(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  useJsonFallback = false,
  servers?: ServerInfo[]
): Promise<LLMResponse> {
  const { apiKey, baseUrl, model } = await getOpenAISettings(settings);

  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
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

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: useJsonFallback ? requestMessages : messages,
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

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const errorMessage =
      error.error?.message || `OpenAI error: ${response.statusText}`;

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
      arguments: JSON.parse(tc.function.arguments),
    })
  );

  // If no native tool calls but we're using fallback, try to parse JSON from content
  if (!toolCalls && useJsonFallback && content) {
    toolCalls = parseToolCallsFromJson(content);
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
  _servers?: ServerInfo[],
  useJsonFallback = false
): string {
  const toolCount = tools?.length || 0;

  if (toolCount === 0) {
    return `You are AI-Worker, a helpful assistant. Be concise and natural.`;
  }

  // Build compact tools list
  const compactToolList = tools
    ?.map(t => `${t.name}:${t.description.substring(0, 40)}(${Object.keys(t.parameters || {}).join(',')})`)
    .join(' | ') || "";

  if (useJsonFallback) {
    return `You are AI-Worker, an autonomous assistant with tool access.

## CRITICAL FORMATTING RULES:
1. ALWAYS start with <THINK>brief reasoning</THINK>
2. If tool needed: add <TOOL>{"name":"tool_name","args":{}}</TOOL>
3. If final answer: provide after </THINK> with no <TOOL> tag
4. ONE tool per response maximum
5. Keep reasoning under 2 sentences

## AVAILABLE TOOLS (use exact names):
${compactToolList}

## REMEMBER:
- Wait for tool result before next step
- No multiple tools in one response
- Final answer: natural language after </THINK>
- Keep responses EXTREMELY concise`;
  }

  // Build tools description for native tool calling providers (Ollama/OpenAI)
  const toolsDescription =
    tools
      ?.map((tool, idx) => {
        const properties = (tool.parameters as any)?.properties || {};
        const paramNames = Object.keys(properties).slice(0, 3).join(", ");
        const paramHint = paramNames
          ? ` (params: ${paramNames}${Object.keys(properties).length > 3 ? "..." : ""})`
          : "";

        return `${idx + 1}. **${tool.name}**${paramHint}\n   ${tool.description}`;
      })
      .join("\n\n") || "";

  return `You are AI-Worker, a helpful AI assistant with access to ${toolCount} tool${toolCount !== 1 ? "s" : ""}. 

# Available Tools
${toolsDescription}

# CRITICAL RULES
1. **USE TOOLS, DON'T EXPLAIN**: When a user asks you to DO something, immediately use the appropriate tool.
2. **ITERATIVE EXECUTION**: You can call tools in sequence. After one tool completes, you'll receive its result and can call the next tool.
3. **CONCISE**: Keep responses concise and natural.`;
}

// Main chat function - automatically selects best provider
export async function chat(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  servers?: ServerInfo[],
  options: { useSequentialPrompt?: boolean } = {}
): Promise<LLMResponse> {
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
    }
  } else if (preferredProvider === "browser" && providers.browser.available) {
    provider = "browser";
  } else if (preferredProvider === "ollama" && providers.ollama.available) {
    provider = "ollama";
  } else if (preferredProvider === "openai" && providers.openai.available) {
    provider = "openai";
  }

  if (!provider) {
    throw new Error(
      "No LLM provider available. Please enable a provider (Browser LLM, Ollama, or OpenAI) and configure it appropriately."
    );
  }

  // Try to detect if we need JSON fallback
  let useJsonFallback = provider === 'browser' || options.useSequentialPrompt;

  // Add system message if not present, or replace existing one to ensure it has tools
  let messagesWithSystem = [...messages];
  const systemMsgIndex = messagesWithSystem.findIndex(
    (m) => m.role === "system"
  );

  // Re-build system prompt if not already a sequential prompt
  const existingSystemMsg = systemMsgIndex >= 0 ? messagesWithSystem[systemMsgIndex].content : "";
  const isAlreadySequential = existingSystemMsg.includes("<THINK>") && existingSystemMsg.includes("<TOOL>");

  if (!isAlreadySequential) {
    const systemPrompt = buildSystemPrompt(tools, servers, useJsonFallback);
    if (systemMsgIndex >= 0) {
      messagesWithSystem[systemMsgIndex] = {
        role: "system" as const,
        content: systemPrompt,
      };
    } else {
      messagesWithSystem.unshift({
        role: "system" as const,
        content: systemPrompt,
      });
    }
  }

  switch (provider) {
    case "browser":
      return callBrowserLLM(messagesWithSystem, tools, settings);
    case "ollama":
      return callOllama(messagesWithSystem, tools, settings);
    case "openai":
      return callOpenAI(
        messagesWithSystem,
        tools,
        settings,
        useJsonFallback,
        servers
      );
    default:
      throw new Error(`Provider ${provider} not implemented`);
  }
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


