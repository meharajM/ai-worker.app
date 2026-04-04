import { LLMMessage, LLMSettings, LLMTool, LLMResponse, ServerInfo } from "../types";
import { ProviderStatus } from "./types";
import { LLM_CONFIG, FEATURE_FLAGS } from "../constants";
import { ensureRecord, parseToolCallsFromJson, getEnvFallback } from "./utils";
import { buildSystemPrompt } from "./prompts";

const openRouterBackoffUntilByKey = new Map<string, number>();
const MAX_FREE_TIER_BACKOFF_WAIT_MS = 20_000;

function parseRateLimitReset(raw?: string): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  // Providers may return seconds or milliseconds.
  return parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
}

function getOpenRouterBackoffKey(baseUrl: string, model: string): string {
  return `${baseUrl}::${model.toLowerCase()}`;
}

function getOpenRouterBackoffUntil(key: string): number {
  return openRouterBackoffUntilByKey.get(key) ?? 0;
}

function redactHeadersForLogs(headers: Record<string, string>): Record<string, string> {
  const copy = { ...headers };
  if (copy.Authorization?.startsWith("Bearer ")) {
    const token = copy.Authorization.slice("Bearer ".length);
    copy.Authorization = `Bearer ${token.slice(0, 6)}...${token.slice(-4)}`;
  }
  return copy;
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) {
    throw new Error("Aborted by user");
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error("Aborted by user"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForOpenRouterBackoff(
  isOpenRouter: boolean,
  model: string,
  backoffKey: string,
  signal?: AbortSignal
): Promise<void> {
  if (!isOpenRouter) return;
  if (!model.toLowerCase().includes(":free")) return;
  const waitMs = getOpenRouterBackoffUntil(backoffKey) - Date.now();
  if (waitMs > 0) {
    const boundedWaitMs = Math.min(waitMs, MAX_FREE_TIER_BACKOFF_WAIT_MS);
    if (waitMs > MAX_FREE_TIER_BACKOFF_WAIT_MS) {
      console.warn(
        `[LLM Chat] Backoff window ${waitMs}ms exceeds cap. Waiting ${boundedWaitMs}ms to keep task runtime bounded.`
      );
    } else {
      console.warn(`[LLM Chat] Waiting ${boundedWaitMs}ms for OpenRouter free-tier reset window.`);
    }
    await sleepWithAbort(boundedWaitMs, signal);
  }
}

function updateOpenRouterBackoff(backoffKey: string, resetAt?: number): void {
  if (!resetAt || !Number.isFinite(resetAt)) return;
  const current = getOpenRouterBackoffUntil(backoffKey);
  if (resetAt > current) {
    openRouterBackoffUntilByKey.set(backoffKey, resetAt);
  }
}

// Get OpenAI settings from store or use defaults
async function getOpenAISettings(
  settings?: LLMSettings
): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  // Import electron here to avoid circular dependencies
  const electron = (await import("../electron")).default;

  const envKey = getEnvFallback('openai', 'api_key');
  const envModel = getEnvFallback('openai', 'model');

  const apiKey =
    settings?.openaiApiKey ||
    (await electron.secure.get("openai_api_key")).value ||
    envKey ||
    "";
  const baseUrl =
    settings?.openaiBaseUrl ||
    (await electron.store.get<string>("openai_base_url")) ||
    "https://api.openai.com/v1";
  const model =
    settings?.openaiModel || envModel || LLM_CONFIG.OPENAI_COMPATIBLE.DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

// Get OpenRouter settings from store or use defaults
async function getOpenRouterSettings(
  settings?: LLMSettings
): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  const electron = (await import("../electron")).default;
  
  const envKey = getEnvFallback('openrouter', 'api_key');
  const envModel = getEnvFallback('openrouter', 'model');

  const apiKey =
    settings?.openrouterApiKey ||
    (await electron.secure.get("openrouter_api_key")).value ||
    envKey ||
    "";
  const baseUrl = LLM_CONFIG.OPENROUTER.BASE_URL;
  const model = settings?.openrouterModel || envModel || LLM_CONFIG.OPENROUTER.DEFAULT_MODEL;
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

import { fileUrlToBase64 } from "./utils";

// Helper to format messages for OpenAI-compatible APIs
async function formatMessagesForOpenAI(messages: LLMMessage[], model: string = ''): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = [];
  
  for (const m of messages) {
    // Basic message structure
    const formatted: Record<string, unknown> = {
      role: m.role
    };

    if (typeof m.content === 'string') {
      formatted.content = m.content;
    } else {
      // Process multimodal parts, resolving file:// URLs to base64
      // Also filter out image parts if the provider is likely non-vision (OpenRouter specific safety)
      const processedParts = (await Promise.all(m.content.map(async (part) => {
        if (part.type === 'image_url') {
          // If using a known non-vision model (heuristic check if needed) or just to be safe
          // we resolve the base64 but return null if it fails
          if (part.image_url.url.startsWith('file://')) {
            const base64 = await fileUrlToBase64(part.image_url.url);
            if (!base64) return null;
            return {
              type: 'image_url',
              image_url: { url: base64 }
            };
          }
        }
        return part;
      }))).filter(Boolean) as any[];

      // SAFETY: If every part was an image and filtered out, or if this is a legacy model,
      // fallback to extracting just the text to avoid "no endpoint supports image" errors.
      const hasImages = processedParts.some(p => p.type === 'image_url');
      if (hasImages && (model.includes('sonnet-3-5') || model.includes('haiku') || (!model.includes('gpt-4o') && !model.includes('vision') && !model.includes('gemini')))) {
         console.warn(`[LLM OpenAI] Potential non-vision model "${model}" detected. Filtering image inputs to prevent API errors.`);
         const textOnly = processedParts
           .map(p => p.type === 'text' ? p.text : '')
           .filter(Boolean)
           .join('\n');
         formatted.content = textOnly || "[Image Attachment]";
      } else {
         formatted.content = processedParts;
      }
    }

    // Add tool_calls if present (and strictly stringify arguments)
    if (m.tool_calls && m.tool_calls.length > 0) {
      formatted.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments)
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

    result.push(formatted);
  }
  return result;
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
    _workspacePath?: string, // New parameter
    retryCount: number = 0
  ): Promise<LLMResponse> {
  const { apiKey, baseUrl, model } = isOpenRouter
    ? await getOpenRouterSettings(settings)
    : await getOpenAISettings(settings);
  const openRouterBackoffKey = getOpenRouterBackoffKey(baseUrl, model);

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
  const formattedMessages = await formatMessagesForOpenAI(useJsonFallback ? requestMessages : messages, model);
  
  const body = JSON.stringify({
    model: model,
    messages: formattedMessages,
    ...(tools && tools.length > 0 && !useJsonFallback
      ? {
          tools: tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
        }
      : {}),
  });

  console.log(`[LLM Chat] URL: ${baseUrl}/chat/completions`);
  console.log(`[LLM Chat] Headers:`, JSON.stringify(redactHeadersForLogs(headers), null, 2));
  if (import.meta.env.DEV) {
    console.log(`[LLM Chat] Request Body for ${model}:`, body);
  } else {
    console.log(`[LLM Chat] Request Body for ${model}: <${body.length} chars>`);
  }
  
  await waitForOpenRouterBackoff(isOpenRouter, model, openRouterBackoffKey, abortSignal);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    signal: abortSignal,
    body: body,
  });

  if (!response || !response.ok) {
    if (response?.status === 404) {
      console.error(`[LLM Chat] 404 Error: OpenAI-compatible endpoint not found at ${baseUrl}/chat/completions`);
    }
    const error = response ? await response.json().catch(() => ({})) : { error: "Fetch failed" };
    const bodyPreview =
      body.length > 1500
        ? `${body.slice(0, 1500)}... <truncated ${body.length - 1500} chars>`
        : body;
    const errorMessage = `OpenAI error (${response?.status}): ${JSON.stringify(error)} | Body: ${bodyPreview}`;

    // Retry a few times on provider throttling to reduce flaky delegate_sub_task failures.
    if (response?.status === 429 && retryCount < 2) {
      const headerReset = parseRateLimitReset(response.headers?.get("x-ratelimit-reset") || undefined);
      const metadataHeaders = (error?.error?.metadata?.headers ?? {}) as Record<string, string | undefined>;
      const metadataReset = parseRateLimitReset(
        metadataHeaders["x-ratelimit-reset"] || metadataHeaders["X-RateLimit-Reset"]
      );
      updateOpenRouterBackoff(openRouterBackoffKey, headerReset ?? metadataReset);

      const retryAfterRaw = response.headers?.get("retry-after");
      const retryAfterSeconds = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : NaN;
      const fallbackDelayMs = 2500 * (retryCount + 1);
      const resetDelayMs = Math.max(0, getOpenRouterBackoffUntil(openRouterBackoffKey) - Date.now());
      const baseDelayMs = Number.isFinite(retryAfterSeconds)
        ? Math.max(1000, Math.min(retryAfterSeconds * 1000, 12000))
        : fallbackDelayMs;
      const delayMs = Math.max(baseDelayMs, resetDelayMs);

      console.warn(`[LLM Chat] 429 rate limited. Retrying in ${delayMs}ms (attempt ${retryCount + 1}/2).`);
      await sleepWithAbort(delayMs, abortSignal);
      return callOpenAI(
        messages,
        tools,
        settings,
        useJsonFallback,
        servers,
        isOpenRouter,
        abortSignal,
        _dynamicRules,
        _isSubAgent,
        _workspacePath,
        retryCount + 1
      );
    }

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
      return callOpenAI(retryMessages, tools, settings, true, servers, isOpenRouter, abortSignal, _dynamicRules, _isSubAgent, _workspacePath, retryCount);
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

  // If no native tool calls, try to self-heal by parsing JSON or XML from content.
  // WHY always (not just useJsonFallback): some models (and test mocks) return an empty
  // tool_calls array but embed the tool call as a JSON blob in the content field.
  // Attempting JSON recovery here is safe — it only fires when toolCalls is empty.
  if (!toolCalls || toolCalls.length === 0) {
    if (content) {
      const mayContainStructuredToolPayload =
        /```json/i.test(content) ||
        /"tool_calls"\s*:|"tool"\s*:|"commands"\s*:|"goal"\s*:/i.test(content) ||
        /^[\s]*[[{]/.test(content);
      if (mayContainStructuredToolPayload) {
        console.log('[LLM] No native tool calls found. Attempting to parse JSON from content...');
        const recovered = parseToolCallsFromJson(content);
        if (recovered && recovered.length > 0) {
          toolCalls = recovered;
          console.log(`[LLM] Successfully recovered ${toolCalls.length} tool calls from content body.`);
        }
      }
    }

    // Check for XML Plan (Legacy/Model Hallucination Fallback) — only if JSON didn't match
    if ((!toolCalls || toolCalls.length === 0) && content && content.includes('<agent_plan>')) {
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
