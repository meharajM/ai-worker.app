// LLM Orchestrator - Manages different LLM providers
// Priority: Browser LLM > Ollama > OpenAI-compatible

import { FEATURE_FLAGS, LLM_CONFIG } from "./constants";

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
}

// Get Ollama settings from store or use defaults
function getOllamaSettings(settings?: LLMSettings) {
  const baseUrl = settings?.ollamaBaseUrl || LLM_CONFIG.OLLAMA.BASE_URL;
  const model = settings?.ollamaModel || LLM_CONFIG.OLLAMA.DEFAULT_MODEL;
  return { baseUrl, model };
}

// Get OpenAI settings from store or use defaults
function getOpenAISettings(settings?: LLMSettings) {
  const apiKey =
    settings?.openaiApiKey || localStorage.getItem("openai_api_key") || "";
  const baseUrl =
    settings?.openaiBaseUrl ||
    localStorage.getItem("openai_base_url") ||
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

// Check if OpenAI-compatible API is configured and fetch available models
export async function checkOpenAI(
  settings?: LLMSettings
): Promise<ProviderStatus> {
  if (!FEATURE_FLAGS.CLOUD_LLM_ENABLED) {
    return { available: false, error: "Cloud LLM disabled" };
  }

  const { apiKey, baseUrl, model } = getOpenAISettings(settings);
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
  const [ollama, openai] = await Promise.all([
    checkOllama(settings),
    checkOpenAI(settings),
  ]);

  return {
    browser: { available: false, error: "Not implemented yet" }, // TODO: Implement browser LLM detection
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

// Call OpenAI-compatible API
async function callOpenAI(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  useJsonFallback = false,
  servers?: ServerInfo[]
): Promise<LLMResponse> {
  const { apiKey, baseUrl, model } = getOpenAISettings(settings);

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
    ? `\n\n**CRITICAL: JSON TOOL CALLING FORMAT**\nThis model doesn't support native tool calling. When you need to use a tool, return ONLY a JSON object (no markdown, no code blocks, no text before/after, just raw JSON):\n{\n  "tool_calls": [\n    {\n      "name": "tool_name",\n      "arguments": {"param": "value"}\n    }\n  ]\n}\n\nIMPORTANT: 
- If you need to use tools, return ONLY the JSON object, nothing else
- If no tools are needed, respond with normal text
- The JSON must be valid and parseable
- Use the exact tool names from the "Available Tools" section above`
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
      .map(
        (s) => `${s.name} (${s.toolCount} tool${s.toolCount !== 1 ? "s" : ""})`
      )
      .join(", ");
    serverContext = `\n\n## Connected MCP Servers\nThese are Model Context Protocol (MCP) servers that provide the tools listed above:\n${serverList}\n\nWhen users ask about "MCP servers" or "what tools do you have", refer to the tools and servers listed above.`;
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
    browserCapabilityNote = `\n\n**IMPORTANT: You have browser control tools available!** You CAN open websites, navigate to URLs, take screenshots, and interact with web pages. When users ask to "open [website]" or "go to [URL]", use the browser navigation tool immediately. Do NOT say you cannot open browsers - you have the tools to do it!`;
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
  servers?: ServerInfo[]
): Promise<LLMResponse> {
  const providers = await getAvailableProviders(settings);

  // Determine which provider to use
  let provider: LLMProvider | null = null;
  const preferredProvider = settings?.preferredProvider;

  if (preferredProvider === "auto" || !preferredProvider) {
    // Auto-select: try ollama first, then openai
    if (providers.ollama.available) {
      provider = "ollama";
    } else if (providers.openai.available) {
      provider = "openai";
    }
  } else if (preferredProvider === "ollama" && providers.ollama.available) {
    provider = "ollama";
  } else if (preferredProvider === "openai" && providers.openai.available) {
    provider = "openai";
  } else if (preferredProvider === "browser" && providers.browser.available) {
    provider = "browser";
  }

  if (!provider) {
    throw new Error(
      "No LLM provider available. Please configure Ollama or add an OpenAI API key."
    );
  }

  // Try to detect if we need JSON fallback (will be handled in callOpenAI if error occurs)
  let useJsonFallback = false;

  // Add system message if not present, or replace existing one to ensure it has tools
  let messagesWithSystem = [...messages];
  const systemMsgIndex = messagesWithSystem.findIndex(
    (m) => m.role === "system"
  );
  const systemPrompt = buildSystemPrompt(tools, servers, useJsonFallback);

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
