import { LLMMessage, LLMSettings, LLMTool, LLMResponse, ServerInfo } from "../types";
import { ProviderStatus } from "./types";
import { LLM_CONFIG, FEATURE_FLAGS } from "../constants";
import { ensureRecord, parseToolCallsFromJson } from "./utils";
import { buildSystemPrompt } from "./prompts";

// Get OpenAI settings from store or use defaults
async function getOpenAISettings(
  settings?: LLMSettings
): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  // Import electron here to avoid circular dependencies
  const electron = (await import("../electron")).default;

  const apiKey =
    settings?.openaiApiKey ||
    (await electron.secure.get("openai_api_key")).value ||
    "";
  const baseUrl =
    settings?.openaiBaseUrl ||
    (await electron.store.get<string>("openai_base_url")) ||
    "https://api.openai.com/v1";
  const model =
    settings?.openaiModel || LLM_CONFIG.OPENAI_COMPATIBLE.DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

// Get OpenRouter settings from store or use defaults
async function getOpenRouterSettings(
  settings?: LLMSettings
): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  const electron = (await import("../electron")).default;
  const apiKey =
    settings?.openrouterApiKey ||
    (await electron.secure.get("openrouter_api_key")).value ||
    "";
  const baseUrl = LLM_CONFIG.OPENROUTER.BASE_URL;
  const model = settings?.openrouterModel || LLM_CONFIG.OPENROUTER.DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
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
    const electron = (window as unknown as { electron: { llm: { fetchOpenAIModels: (url: string, key: string) => Promise<{ success: boolean; models?: string[]; error?: string }> } } }).electron;
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
  const { apiKey } = await getOpenRouterSettings(settings);
  if (!apiKey) return { available: false, error: "OpenRouter API Key not set" };

  // reuse OpenAI check with OpenRouter specific headers if needed
  return checkOpenAI(settings, "openrouter");
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
    const electron = (window as unknown as { electron: { llm: { fetchOpenAIModels: (url: string, key: string) => Promise<{ success: boolean; models?: string[]; error?: string }> } } }).electron;
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
      } catch {
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

// Helper to format messages for OpenAI-compatible APIs
function formatMessagesForOpenAI(messages: LLMMessage[]): Record<string, unknown>[] {
  return messages.map(m => {
    // Basic message structure
    const formatted: Record<string, unknown> = {
      role: m.role,
      content: m.content
    };

    // Add tool_calls if present (and strictly stringify arguments)
    if (m.tool_calls && m.tool_calls.length > 0) {
      // At runtime, tool_calls can be in OpenAI wire format { function: { name, arguments } }
      // (set by agent-runtime via `as any`) or our internal LLMMessage format { name, arguments }.
      // We handle both gracefully.
      type RuntimeToolCall = {
        id: string;
        name?: string;
        arguments?: Record<string, unknown>;
        function?: { name: string; arguments: string | Record<string, unknown> };
      };
      formatted.tool_calls = (m.tool_calls as unknown as RuntimeToolCall[]).map((tc) => {
        const name = tc.name ?? tc.function?.name ?? '';
        const rawArgs = tc.arguments ?? tc.function?.arguments ?? {};
        return {
          id: tc.id,
          type: 'function',
          function: {
            name,
            arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs)
          }
        };
      });
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

export // Call OpenAI-compatible API
  async function callOpenAI(
    messages: LLMMessage[],
    tools?: LLMTool[],
    settings?: LLMSettings,
    useJsonFallback: boolean = false,
    servers?: ServerInfo[],
    isOpenRouter: boolean = false,
    abortSignal?: AbortSignal,
    _dynamicRules?: string,
    _isSubAgent?: boolean,
    _workspacePath?: string // New parameter
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
    const systemPrompt = await buildSystemPrompt(tools, servers, true);
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
      const systemPrompt = await buildSystemPrompt(tools, servers, true);
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

  if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    throw new Error(`Unexpected API response format: ${JSON.stringify(data)}`);
  }

  const choice = data.choices[0];
  const content = choice.message?.content || "";

  // If using JSON fallback, try to parse tool calls from content
  let toolCalls = choice.message?.tool_calls?.map(
    (tc: { id: string; function: { name: string; arguments: string } }) => {
      let args: Record<string, unknown> = {};

      // Handle null, undefined, or empty string arguments
      if (!tc.function.arguments || tc.function.arguments === 'null' || tc.function.arguments === 'undefined') {
        console.warn(`[LLM] Tool call "${tc.function.name}" has null/empty arguments. Using empty object.`);
        args = {};
      } else {
        try {
          const parsed = JSON.parse(tc.function.arguments);
          // JSON.parse(null) returns null, so we need to check the result
          args = parsed !== null && typeof parsed === 'object' ? parsed : {};
        } catch {
          console.warn(`[LLM] Failed to parse tool arguments for "${tc.function.name}":`, tc.function.arguments);
          args = { _parse_error: "Invalid JSON arguments from LLM" };
        }
      }

      console.log(`[LLM] Native Tool Call Identified: ${tc.function.name}`, {
        tool: tc.function.name,
        arguments: args,
        raw: tc.function.arguments
      });

      return {
        id: tc.id,
        name: tc.function.name,
        arguments: ensureRecord(args), // Use parsed args
      };
    }
  );

  // If no native tool calls, try to parse from content (Self-Healing)
  if (!toolCalls || toolCalls.length === 0) {
    if (useJsonFallback && content) {
      console.log('[LLM] No native tool calls found. Attempting to parse JSON from content...');
      toolCalls = parseToolCallsFromJson(content);
      if (toolCalls && toolCalls.length > 0) {
        console.log(`[LLM] Successfully recovered ${toolCalls.length} tool calls from content body.`);
      }
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
