// LLM Orchestrator - Manages different LLM providers
// Priority: WebLLM (On-Device) > Ollama > OpenAI-compatible

import { FEATURE_FLAGS, LLM_CONFIG } from "./constants";
import {
  getWebLLMStatus,
  loadWebLLMModel,
  chatWithWebLLM,
  chatStreamWithWebLLM,
  subscribeToWebLLMStatus,
  WEBLLM_MODELS,
  type WebLLMStatus,
  type WebLLMModelId,
  checkDownloadedWebLLMModels,
  deleteWebLLMModel,
  downloadWebLLMModelOnly,
  getWebLLMDownloadStatus,
  checkWebLLMModelCompatibility,
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
    return { available: false, error: "On-Device AI disabled" };
  }

  try {
    const status = getWebLLMStatus();
    console.log("[WebLLM] Status:", status);

    if (!status.isSupported) {
      return {
        available: false,
        error: status.error || "WebGPU not supported",
        isWebGPUSupported: false,
      };
    }

    // WebGPU is supported
    const models = WEBLLM_MODELS.map((m) => m.id);

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
    };
  } catch (error) {
    console.error("[WebLLM] Check error:", error);
    return {
      available: false,
      error: error instanceof Error ? error.message : "WebLLM check failed",
    };
  }
}

// Test WebLLM connection (simple chat)
export async function testWebLLMConnection(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const status = getWebLLMStatus();
    if (!status.isLoaded) {
      return { success: false, error: "Model not loaded" };
    }

    // specific test message to avoid long responses
    const response = await chatWithWebLLM([
      { role: "user", content: 'Say "test" and nothing else.' },
    ]);

    if (response.content) {
      return { success: true };
    }
    return { success: false, error: "No response content" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Test failed",
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
export async function getAvailableProviders(
  settings?: LLMSettings
): Promise<Record<LLMProvider, ProviderStatus>> {
  const preferred = settings?.preferredProvider || "auto";

  if (preferred === "ollama") {
    const ollama = await checkOllama(settings);
    return {
      browser: { available: false, error: "Not implemented yet" },
      ollama,
      openai: { available: false },
    };
  }

  if (preferred === "openai") {
    const openai = await checkOpenAI(settings);
    return {
      browser: { available: false, error: "Not implemented yet" },
      ollama: { available: false },
      openai,
    };
  }

  if (preferred === "browser") {
    const browser = await checkBrowserLLM();
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
  ]);

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
  const content = data.message?.content || "";

  // Try native tool calls first
  let toolCalls = data.message?.tool_calls?.map(
    (tc: {
      function: { name: string; arguments: Record<string, unknown> };
    }) => ({
      id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: tc.function.name,
      arguments: tc.function.arguments,
    })
  );

  // If no native tool calls but we have tools and content, try JSON parsing
  if (!toolCalls && content && tools && tools.length > 0) {
    toolCalls = parseToolCallsFromJson(content);
  }

  return {
    content: content,
    toolCalls: toolCalls,
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
  settings?: LLMSettings,
  servers?: ServerInfo[],
  onStream?: (chunk: string, fullContent: string) => void
): Promise<LLMResponse> {
  try {
    const status = getWebLLMStatus();

    // Check if model is loaded
    if (!status.isLoaded) {
      console.log("[WebLLM] Model not loaded, attempting to load...");
      await loadWebLLMModel();
    }

    // =========================================================================
    // Context Window Optimization for WebLLM (small models have 4096 context)
    // =========================================================================
    
    // Budget allocation for 4096 context:
    // - System prompt: ~400 tokens (compact)
    // - Response: ~256 tokens (max_tokens in webllm.ts)
    // - Conversation: ~3000 tokens (remaining budget)
    const MAX_CONVERSATION_TOKENS = 2800; // Conservative to leave room for response
    
    // Replace system message with compact version
    let processedMessages = [...messages];
    const systemMsgIndex = processedMessages.findIndex(m => m.role === "system");
    const compactSystemPrompt = buildCompactSystemPrompt(tools, servers);
    
    // We already check for system message in the caller (chat function), but 
    // we need to REPLACE it with compact version here for WebLLM specifically
    if (systemMsgIndex >= 0) {
      processedMessages[systemMsgIndex] = {
        role: "system" as const,
        content: compactSystemPrompt,
      };
    } else {
      processedMessages.unshift({
        role: "system" as const,
        content: compactSystemPrompt,
      });
    }
    
    // Truncate conversation history to fit within context window
    processedMessages = truncateConversationHistory(processedMessages, MAX_CONVERSATION_TOKENS);
    
    console.log(`[WebLLM] Messages truncated: ${messages.length} -> ${processedMessages.length}`);

    // Pass tools to WebLLM so it can perform JSON fallback parsing if native tools aren't supported
    // The WebLLM manager handles the check for native support vs JSON fallback
    let response;
    
    if (onStream) {
      response = await chatStreamWithWebLLM(
        processedMessages.map((m) => ({ role: m.role, content: m.content })),
        onStream,
        tools
      );
    } else {
      response = await chatWithWebLLM(
        processedMessages.map((m) => ({ role: m.role, content: m.content })),
        tools
      );
    }

    // Parse tool calls from JSON in response content (same as existing JSON fallback)
    let toolCalls = response.toolCalls;
    if (!toolCalls && response.content && tools && tools.length > 0) {
      console.log(`[WebLLM] Attempting JSON parse, content length: ${response.content.length}, preview: ${response.content.substring(0, 200)}`);
      toolCalls = parseToolCallsFromJson(response.content);
    }

    // Normalize tool names (fix common model hallucinations)
    if (toolCalls) {
      toolCalls = toolCalls.map((tc: any) => {
        let name = tc.name;
        
        // Fix sequential thinking
        if (name === 'sequential-thinking') {
          name = 'sequentialthinking';
        }
        
        // Strip common hallucinatory prefixes - REMOVED
        // Real tools from @playwright/mcp ACTUALLY have 'browser_' prefix
        // so stripping it breaks them.
        /* 
        if (name.startsWith('browser_')) {
          name = name.replace('browser_', '');
        } else if (name.startsWith('playwright_')) {
          name = name.replace('playwright_', '');
        }
        */
        
        // Ensure snake_case (some models output camelCase)
        if (/[A-Z]/.test(name)) {
          name = name.replace(/([A-Z])/g, "_$1").toLowerCase();
        }
        
        return { ...tc, name };
      });
    }

    // Strip the JSON from the content to clean up UI
    let finalContent = response.content;
    if (toolCalls && toolCalls.length > 0 && finalContent) {
      finalContent = stripToolCallsJson(finalContent);
    }

    return {
      content: finalContent,
      toolCalls,
      provider: "browser",
      model: status.currentModel || "webllm",
    };
  } catch (error) {
    console.error("[WebLLM] Chat error:", error);
    throw new Error(
      `WebLLM error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
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

  // Strip the JSON from the content if we parsed generic tool calls
  let finalContent = content;
  if (!choice.message?.tool_calls && toolCalls && toolCalls.length > 0 && finalContent) {
    finalContent = stripToolCallsJson(finalContent);
  }

  return {
    content: finalContent,
    toolCalls,
    provider: "openai",
    model: model,
  };
}

// Cached regex patterns for better performance
// Note: CODE_BLOCK_REGEX uses greedy match to capture full JSON with nested braces
const CODE_BLOCK_REGEX = /```(?:json)?\s*(\{[\s\S]*\})\s*```/;
const TOOL_CALLS_REGEX = /"tool_calls"\s*:\s*\[([\s\S]*?)\]/i;
const MARKDOWN_CLEANUP_REGEX = /^```(?:json)?\s*|\s*```$/gi;

// Parse tool calls from JSON in response content
// Optimized with early exits and efficient strategy ordering


// ============================================================================
// Context Window Management for WebLLM
// ============================================================================

/**
 * Estimate token count for a string (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens for a list of messages
 */
function estimateMessagesTokens(messages: LLMMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg.content) + 4, 0); // +4 for role/formatting overhead
}

/**
 * Truncate conversation history to fit within token budget using sliding window.
 * Always preserves the system message and most recent messages.
 * 
 * @param messages - Full conversation history
 * @param maxTokens - Maximum tokens allowed for messages (excluding response)
 * @returns Truncated messages that fit within token budget
 */
export function truncateConversationHistory(
  messages: LLMMessage[],
  maxTokens: number
): LLMMessage[] {
  // Separate system message and conversation messages
  const systemMsg = messages.find(m => m.role === "system");
  const conversationMsgs = messages.filter(m => m.role !== "system");
  
  // Calculate tokens used by system message
  const systemTokens = systemMsg ? estimateTokens(systemMsg.content) + 4 : 0;
  const availableTokens = maxTokens - systemTokens;
  
  if (availableTokens <= 0) {
    // System message alone exceeds budget - return just system message
    return systemMsg ? [systemMsg] : [];
  }
  
  // Build result from newest messages backwards (sliding window)
  const result: LLMMessage[] = [];
  let usedTokens = 0;
  
  for (let i = conversationMsgs.length - 1; i >= 0; i--) {
    const msg = conversationMsgs[i];
    const msgTokens = estimateTokens(msg.content) + 4;
    
    if (usedTokens + msgTokens <= availableTokens) {
      result.unshift(msg);
      usedTokens += msgTokens;
    } else {
      // No more room, stop
      break;
    }
  }
  
  // WebLLM REQUIREMENT: Last message must be from "user" or "tool"
  // If last message is from "assistant", remove it
  while (result.length > 0 && result[result.length - 1].role === "assistant") {
    result.pop();
  }
  
  // Add system message at the beginning
  if (systemMsg) {
    result.unshift(systemMsg);
  }
  
  return result;
}

/**
 * Build a compact system prompt for WebLLM (small context window models).
 * Uses minimal tokens while preserving essential tool calling capability.
 */
function buildCompactSystemPrompt(
  tools?: LLMTool[],
  servers?: ServerInfo[]
): string {
  if (!tools || tools.length === 0) {
    return `You are AI-Worker, a helpful assistant. Be concise.`;
  }

  // Compact tool list: just name and very brief description
  const toolList = tools
    .slice(0, 15) // Limit to 15 most important tools
    .map(t => `- ${t.name}: ${t.description.split('.')[0]}`) // First sentence only
    .join('\n');

  const hasSequentialThinking = tools.some(t => t.name.includes('sequential') && t.name.includes('thinking'));
  
  const seqThinkingNote = hasSequentialThinking 
    ? `\n- **SEQUENTIAL THINKING**: Use 'sequentialthinking' tool to break down complex tasks and create a Todo list. EXECUTE ONE STEP AT A TIME.` 
    : '';

  return `You are AI-Worker. You have a REAL BROWSER and tools.

**AVAILABLE TOOLS:**
${toolList}

**BROWSER RULES:**
- You CAN navigate to websites, click, type, and read pages.
- When asked to "open X" or "search Y", use 'browser_navigate' or 'google_search' tools IMMEDIATELY.
- DO NOT explain how to do it. DO IT.
- DO NOT say "I cannot browse". You HAVE a browser.${seqThinkingNote}

**FORMAT:**
To use a tool, output ONLY this JSON (no text before/after):
{"tool_calls": [{"name": "tool_name", "arguments": {"param": "value"}}]}

**CRITICAL:**
- Use ONLY the tools listed above.
- Do NOT invent tools like 'browser_evaluate' or 'run_code'.
- Do NOT output python/javascript code explanations.
- If you need to browse, use the 'browser_navigate' tool.`;
}
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

  // Add JSON format instruction if using fallback (optimized for token efficiency)
  const jsonFormatNote = useJsonFallback
    ? `\n\n**JSON TOOL CALLING (REQUIRED)**

This model doesn't support native tool calling. Use JSON format to call tools.

**FORMAT:**
Return ONLY valid JSON (no markdown, no text before/after):
{"tool_calls": [{"name": "tool_name", "arguments": {"param": "value"}}]}

**RULES:**
- Use tools when user asks to DO something (create, read, write, search, navigate, etc.)
- Return ONLY the JSON object, nothing else
- If no tools needed, respond with normal text
- Tools execute sequentially - you'll receive results and can call more tools

**EXAMPLES:**
User: "Read /tmp/test.txt" → {"tool_calls": [{"name": "read_file", "arguments": {"path": "/tmp/test.txt"}}]}
User: "What's 2+2?" → Normal text response (no tools)`
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
          ? ` (params: ${paramNames}${
              Object.keys(properties).length > 3 ? "..." : ""
            })`
          : "";

        return `${idx + 1}. **${tool.name}**${paramHint}\n   ${
          tool.description
        }`;
      })
      .join("\n\n") || "";

  // Group tools by server if we have server info (for context)
  let serverContext = "";
  if (serverCount > 0 && servers) {
    const serverList = servers
      .map((s) => {
        console.log("server", s);
        if (s.isReasoningServer) {
          return `${s.name} (reasoning server - provides step-by-step reasoning capabilities)`;
        }
        return `${s.name} (${s.toolCount} tool${s.toolCount !== 1 ? "s" : ""})`;
      })
      .join(", ");


    const reasoningServers = servers.filter((s) => s.isReasoningServer && s.toolCount > 0);
    const reasoningNote =
      reasoningServers.length > 0
        ? `\n\n**SEQUENTIAL THINKING (REQUIRED)**:
The 'sequentialthinking' tool is available. You MUST use it to strictly follow this process:
1. Divide the task into multiple sub-tasks.
2. Create and show a Todo list.
3. Execute one task/tool at a time.
4. Listen for response/feedback from the tool and perform the next task based on that feedback.
5. Loop until all tasks are done and results are achieved.
6. **NO ASSUMPTIONS ALLOWED**: Ask questions if you have doubts before proceeding.`
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
    browserCapabilityNote = `\n\n**IMPORTANT: You have browser control tools available!** You CAN open websites, navigate to URLs, take screenshots, and interact with web pages. When users ask to "open [website]" or "go to [URL]", use the 'browser_navigate' tool immediately. Do NOT say you cannot open browsers - you have the tools to do it!
    
**MULTI-STEP BROWSER TASKS**: For complex browser tasks like "search for X on Google" or "fill out a form", you MUST complete ALL steps:
1. Navigate to the website (e.g., use the 'browser_navigate' tool to go to google.com)
2. Wait for the page to load (check the result)
3. Fill in search boxes or forms (e.g., use 'browser_fill_form' or 'browser_type' tools)
4. Submit or click buttons (e.g., use 'browser_click' or 'browser_press_key' tools)
5. Continue until the task is COMPLETE

Example: "search for nike shoes on Google" requires:
- Step 1: Use 'browser_navigate' to go to google.com
- Step 2: Use fill or type to enter "nike shoes" in the search box
- Step 3: Use click or press_key to submit
- Step 4: Verify the search completed (check results)

DO NOT stop after just navigating - complete the entire workflow!`;
  }

  return `You are a helpful AI assistant with access to ${toolCount} tool${
    toolCount !== 1 ? "s" : ""
  } from ${serverCount} connected server${
    serverCount !== 1 ? "s" : ""
  }. When users ask you to perform actions, you MUST use the appropriate tools instead of providing manual instructions.${jsonFormatNote}

# Available Tools
${toolsDescription}${serverContext}${browserCapabilityNote}

# CRITICAL RULES
1. **USE TOOLS, DON'T EXPLAIN**: When a user asks you to DO something (create, update, search, navigate, read, write, execute, etc.), immediately use the appropriate tool. Never provide step-by-step instructions or templates when a tool can do it.

2. **AUTONOMOUS EXECUTION**: Execute tool calls immediately without asking for permission, unless the action is destructive or irreversible (like deleting files, formatting drives, etc.).

3. **ITERATIVE EXECUTION**: You can call multiple tools in sequence. After one tool completes, you'll receive its result and can use that information to call the next tool.

4. **CHAINED WORKFLOWS**: For complex tasks requiring multiple steps:
   - Call the first tool immediately
   - Wait for its result
   - Use information from that result in the next tool call
   - Repeat until the workflow is complete
   - Example: Read file → Parse content → Create new file with processed data

5. **CONFIRM WITH RESULTS**: After using tool(s), confirm the action with specific details from the tool's response:
   - File paths, IDs, or keys created/updated
   - Direct links/URLs if available (look for fields like 'url', 'link', 'web_url', 'self', 'path', etc.)
   - Status or confirmation of the action taken
   - Any relevant data retrieved

6. **HANDLE ERRORS**: If a tool fails, explain the specific error clearly and offer to retry with corrections if applicable.

7. **VOICE-OPTIMIZED**: All responses will be read aloud. Keep them concise, natural, and conversational. Use shorter sentences and pause-friendly phrasing.

# Response Pattern
- User asks to create/update/search/read/write/navigate → You call the tool immediately → You confirm: "Done! [specific details from response]"
- User asks for complex workflow → You call tools iteratively in sequence → You provide comprehensive summary
- User asks for help/instructions → You explain what's available but ALWAYS prefer using tools when applicable

Remember: Your goal is to TAKE ACTION using tools, not to teach users how to do it themselves. You can call tools multiple times in sequence to accomplish complex tasks!`;
}

// Main chat function - automatically selects best provider
export async function chat(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  servers?: ServerInfo[],
  onStream?: (chunk: string, fullContent: string) => void
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

  // Try to detect if we need JSON fallback (will be handled in callOpenAI if error occurs)
  // For browser (WebLLM), we always use JSON fallback for now to ensure compatibility
  // across all models (Qwen, Llama, etc.) without native tool calling errors
  let useJsonFallback = provider === "browser";

  console.log(`[LLM] Using provider: ${provider}`);

  // Add system message if not present, or replace existing one to ensure it has tools
  const messagesWithSystem = [...messages];
  if (!messagesWithSystem.find((m) => m.role === "system")) {
    const compactSystemPrompt = buildCompactSystemPrompt(tools, servers);
    // Use compact prompt for browser, full prompt for others (unless restricted)
    const prompt = provider === 'browser'
      ? compactSystemPrompt
      : buildSystemPrompt(tools, servers, provider === "ollama");

    messagesWithSystem.unshift({
      role: "system",
      content: prompt,
    });
  }

  // Route to provider
  switch (provider) {
    case "ollama":
      // Currently using non-streaming backend for Ollama (could be updated later)
      return callOllama(messagesWithSystem, tools, settings);
    case "openai":
      return callOpenAI(
        messagesWithSystem,
        tools,
        settings,
        useJsonFallback,
        servers
      );
    case "browser":
      return callBrowserLLM(messagesWithSystem, tools, settings, servers, onStream);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
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
      return { success: false, error: status.error || "WebGPU not supported" };
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
      error: error instanceof Error ? error.message : "Failed to load model",
    };
  }
}

/**
 * Remove JSON tool call blocks from content to cleaner UI
 */
function stripToolCallsJson(content: string): string {
  if (!content) return "";
  
  let cleaned = content;
  
  // Remove markdown code blocks containing JSON
  cleaned = cleaned.replace(CODE_BLOCK_REGEX, "");
  
  // Remove standalone JSON-like structures that match tool_calls
  // This is a bit aggressive but necessary if the model doesn't use markdown blocks
  const toolCallsMatch = cleaned.match(TOOL_CALLS_REGEX);
  if (toolCallsMatch) {
    // Find the encompassing braces if possible
    const matchIndex = toolCallsMatch.index || 0;
    const braceStart = cleaned.lastIndexOf("{", matchIndex);
    if (braceStart !== -1) {
       // Simple heuristic: if we found tool_calls, try to remove the whole JSON object
       // We can iterate forward to find the closing brace
       let braceCount = 0;
       let end = -1;
       for (let i = braceStart; i < cleaned.length; i++) {
         if (cleaned[i] === "{") braceCount++;
         else if (cleaned[i] === "}") {
           braceCount--;
           if (braceCount === 0) {
             end = i + 1;
             break;
           }
         }
       }
       if (end !== -1) {
         cleaned = cleaned.substring(0, braceStart) + cleaned.substring(end);
       }
    }
  }
  
  return cleaned.trim();
}
function parseToolCallsFromJson(
  content: string
): LLMResponse["toolCalls"] | undefined {
  // Early exit checks
  if (!content || typeof content !== "string" || !content.trim()) {
    return undefined;
  }

  const jsonStr = content.trim();

  // Strategy 1: Attempt to parse the entire string as JSON
  try {
    const parsed = JSON.parse(jsonStr);
    return extractToolCallsFromObject(parsed);
  } catch (e) {
    // Continue to next strategy
  }

  // Strategy 2: Extract JSON from markdown code blocks
  const codeBlockMatch = jsonStr.match(CODE_BLOCK_REGEX);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      return extractToolCallsFromObject(parsed);
    } catch (e) {
      // Continue
    }
  }

  // Strategy 3: Heuristic scan for {"tool_calls": ...} pattern
  // This is needed when the model outputs raw JSON but with some extra text or without markdown
  const toolCallsMatch = jsonStr.match(TOOL_CALLS_REGEX);
  if (toolCallsMatch) {
    // Find startup brace
    const matchIndex = toolCallsMatch.index || 0;
    const braceStart = jsonStr.lastIndexOf("{", matchIndex);
    
    if (braceStart !== -1) {
      // Try to find the matching closing brace by counting
      let braceCount = 0;
      for (let i = braceStart; i < jsonStr.length; i++) {
        if (jsonStr[i] === "{") braceCount++;
        else if (jsonStr[i] === "}") {
          braceCount--;
          if (braceCount === 0) {
            // Found potential end
            const potentialJson = jsonStr.substring(braceStart, i + 1);
            try {
              const parsed = JSON.parse(potentialJson);
              const result = extractToolCallsFromObject(parsed);
              if (result) return result;
            } catch (e) {
              // regex match might have continued
            }
          }
        }
      }
    }
  }

  return undefined;
}

// Helper to validate and extract tool calls from a parsed object
function extractToolCallsFromObject(parsed: any): LLMResponse["toolCalls"] | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;

  const validateToolCall = (tc: any, idx: number) => {
    if (!tc || typeof tc !== "object") return null;
    
    // Normalize name
    let name = tc.name || tc.function?.name || tc.tool_name;
    if (!name || typeof name !== "string") return null;
    
    // Normalize arguments
    let args = tc.arguments || tc.function?.arguments || tc.parameters || {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (e) {
        // Keep as string or empty object if parse fails
        if (!args.trim().startsWith("{")) {
            // Maybe it's just a string value? wrap it
            args = { value: args };
        } else {
            args = {};
        } 
      }
    } else if (typeof args !== "object" || Array.isArray(args)) {
      args = {};
    }

    return {
      id: tc.id || `json_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 5)}`,
      name: name.trim(),
      arguments: args,
    };
  };

  // Check for standard formats
  let candidates: any[] = [];
  
  if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
    candidates = parsed.tool_calls;
  } else if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (parsed.name || parsed.function?.name || parsed.tool_name) {
    candidates = [parsed];
  }

  const toolCalls = candidates
    .map((tc, idx) => validateToolCall(tc, idx))
    .filter((tc): tc is NonNullable<LLMResponse["toolCalls"]>[0] => tc !== null);

  return toolCalls.length > 0 ? toolCalls : undefined;
}
