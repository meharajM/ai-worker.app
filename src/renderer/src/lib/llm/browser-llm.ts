import { LLMMessage, LLMSettings, LLMTool, LLMResponse } from "../types";
import { ProviderStatus } from "./types";
import { FEATURE_FLAGS } from "../constants";
import { extractTextForLegacyProviders, parseToolCallsFromJson } from "./utils";
import {
  getWebLLMStatus,
  loadWebLLMModel,
  chatWithWebLLM,
  subscribeToWebLLMStatus,
  WEBLLM_MODELS,
} from "../webllm";

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

export // Call WebLLM (On-Device AI via WebGPU)
// Note: Most WebLLM models don't support native tool calling, so we rely on
// the system prompt to instruct the model to output JSON, then parse it
async function callBrowserLLM(
  messages: LLMMessage[],
  tools?: LLMTool[],
  settings?: LLMSettings,
  workspacePath?: string // New parameter 
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
        .map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: extractTextForLegacyProviders(m.content)
        }))
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
