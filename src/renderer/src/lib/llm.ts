// LLM Orchestrator - Manages different LLM providers
// Priority: WebLLM (On-Device) > Ollama > OpenAI-compatible

import {
  getWebLLMStatus,
  subscribeToWebLLMStatus,
  WEBLLM_MODELS,
  type WebLLMStatus,
  checkDownloadedWebLLMModels,
  deleteWebLLMModel,
  downloadWebLLMModelOnly,
  getWebLLMDownloadStatus,
  checkWebLLMModelCompatibility
} from "./webllm";
import { CREATE_PLAN_TOOL } from "./plan_manager";
import {
  LLMMessage,
  LLMTool,
  ServerInfo,
  LLMResponse,
  LLMProvider,
  LLMSettings
} from "./types";
import { pruneContext } from "./dcp";

// Sub-modules
import { ProviderStatus } from "./llm/types";
import { checkOllama, testOllamaConnection, callOllama } from "./llm/ollama";
import { checkBrowserLLM, testWebLLMConnection, callBrowserLLM, downloadBrowserModel } from "./llm/browser-llm";
import { checkOpenAI, checkOpenRouter, testOpenAIConnection, callOpenAI } from "./llm/openai";
import { checkGemini, testGeminiConnection, callGemini } from "./llm/gemini";
import { buildSystemPrompt } from "./llm/prompts";
import { ensureRecord, safeParseJSON } from "./llm/utils";

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
  type LLMSettings,
  // Provider health checks
  checkOllama,
  testOllamaConnection,
  checkBrowserLLM,
  testWebLLMConnection,
  checkOpenAI,
  checkOpenRouter,
  checkGemini,
  testGeminiConnection,
  testOpenAIConnection,
  downloadBrowserModel,
  // Shared utilities
  ensureRecord,
  safeParseJSON
};

/**
 * Get available providers and their status
 */
export async function getAvailableProviders(
  settings?: LLMSettings
): Promise<{ browser: ProviderStatus; ollama: ProviderStatus; openai: ProviderStatus; gemini: ProviderStatus; openrouter: ProviderStatus }> {
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

/**
 * Main chat function - automatically selects best provider based on configuration
 */
export async function chat(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  servers?: ServerInfo[],
  abortSignal?: AbortSignal,
  dynamicRules?: string,
  isSubAgent = false,
  workspacePath?: string,
  /** WhatsApp context injected by the caller — keeps prompts.ts store-free */
  whatsappContext?: { isConnected: boolean; isEnabled: boolean }
): Promise<LLMResponse> {
  // Apply Dynamic Context Pruning (DCP)
  const prunedMessages = pruneContext(messages);

  const providers = await getAvailableProviders(settings);

  // Determine which provider to use
  let provider: LLMProvider | null = null;
  const preferredProvider = settings?.preferredProvider;

  if (preferredProvider === "auto" || !preferredProvider) {
    // Auto-select: browser ONLY IF already loaded, then ollama, then openai, then gemini, then openrouter
    // We don't auto-select browser if it's just 'available' (supported) to avoid
    // triggering large downloads automatically.
    if (providers.browser.available && providers.browser.isLoaded) {
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

  // If browser is selected but not loaded, check if we should auto-load
  if (provider === 'browser' && !providers.browser.isLoaded) {
    const isDownloaded = providers.browser.downloadedModels?.includes(settings?.browserModel || '');
    if (!isDownloaded) {
      throw new Error(`On-Device model "${settings?.browserModel || 'default'}" is not downloaded. Please go to Settings and click Download.`);
    }
  }

  const useJsonFallback = provider === 'browser';
  const messagesWithSystem = [...prunedMessages];
  const systemMsgIndex = messagesWithSystem.findIndex((m) => m.role === "system");

  // MERGE default tools with the new CREATE_PLAN_TOOL (and deduplicate)
  const toolMap = new Map<string, LLMTool>();
  toolMap.set(CREATE_PLAN_TOOL.name, CREATE_PLAN_TOOL);
  if (tools) {
    tools.forEach(t => toolMap.set(t.name, t));
  }
  const allTools = Array.from(toolMap.values());

  const systemPrompt = await buildSystemPrompt(allTools, servers, useJsonFallback, dynamicRules, isSubAgent, workspacePath, whatsappContext);

  if (isSubAgent) {
    console.log(`[LLM] Using lightweight sub-agent prompt (${systemPrompt.length} chars vs ~4000+ main)`);
  }

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

  switch (provider) {
    case "browser":
      return callBrowserLLM(messagesWithSystem, tools, settings, workspacePath);
    case "ollama":
      return callOllama(messagesWithSystem, tools, settings, abortSignal, workspacePath);
    case "openai":
      return callOpenAI(messagesWithSystem, tools, settings, useJsonFallback, servers, false, abortSignal, dynamicRules, isSubAgent, workspacePath);
    case "gemini":
      return callGemini(messagesWithSystem, tools, settings, abortSignal);
    case "openrouter":
      return callOpenAI(messagesWithSystem, tools, settings, useJsonFallback, servers, true, abortSignal, dynamicRules, isSubAgent, workspacePath);
    default:
      throw new Error(`Provider ${provider} not implemented`);
  }
}
