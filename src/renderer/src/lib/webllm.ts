/**
 * WebLLM Integration for On-Device AI
 * Uses WebGPU to run LLMs directly in the browser/Electron renderer
 */

import * as webllm from '@mlc-ai/web-llm';

// Extend Navigator type for WebGPU
declare global {
    interface Navigator {
        gpu?: any; // WebGPU API
    }
}

// Available models - some support native tool calling, others use JSON fallback
export const WEBLLM_MODELS = [
    {
        id: 'Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC',
        name: 'Hermes 2 Pro 8B (Recommended)',
        description: 'Best for tool calling, good balance',
        size: '~5GB',
        vram: '~6GB',
        requiredRamGB: 8,
        requiredVramGB: 6,
        supportsTools: true,
    },
    {
        id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
        name: 'Qwen 2.5 1.5B (Fast)',
        description: 'Fast responses, uses JSON for tools',
        size: '~1.5GB',
        vram: '~2GB',
        requiredRamGB: 4,
        requiredVramGB: 2,
        supportsTools: false,
    },
    {
        id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
        name: 'Llama 3.2 1B (Lightweight)',
        description: 'Very fast, uses JSON for tools',
        size: '~1GB',
        vram: '~1.5GB',
        requiredRamGB: 4,
        requiredVramGB: 1.5,
        supportsTools: false,
    },
    {
        id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
        name: 'Phi 3.5 Mini',
        description: 'Microsoft, good reasoning',
        size: '~2GB',
        vram: '~2.5GB',
        requiredRamGB: 4,
        requiredVramGB: 2.5,
        supportsTools: false,
    },
    {
        id: 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC',
        name: 'Hermes 3 8B (Advanced)',
        description: 'Best quality, native tool calling',
        size: '~5GB',
        vram: '~6GB',
        requiredRamGB: 8,
        requiredVramGB: 6,
        supportsTools: true,
    },
] as const;

export type WebLLMModelId = typeof WEBLLM_MODELS[number]['id'];

export interface WebLLMStatus {
    isSupported: boolean;
    isLoaded: boolean;
    isLoading: boolean;
    loadingProgress: number;
    loadingStage: string;
    currentModel: string | null;
    error: string | null;
    downloadedModels: string[];
    backgroundDownload: {
        modelId: string;
        progress: number;
        stage: string;
    } | null;
}

export interface WebLLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface WebLLMToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface WebLLMResponse {
    content: string;
    toolCalls?: WebLLMToolCall[];
}

type StatusCallback = (status: WebLLMStatus) => void;

class WebLLMManager {
    private engine: webllm.MLCEngine | null = null;
    private backgroundEngine: webllm.MLCEngine | null = null; // For downloading without unloading current
    private currentModelId: string | null = null;
    private status: WebLLMStatus = {
        isSupported: false,
        isLoaded: false,
        isLoading: false,
        loadingProgress: 0,
        loadingStage: '',
        currentModel: null,
        error: null,
        downloadedModels: [],
        backgroundDownload: null,
    };

    // Separate status for background downloads
    private downloadingStatus = {
        isDownloading: false,
        progress: 0,
        modelId: null as string | null,
    };

    private statusCallbacks: Set<StatusCallback> = new Set();

    constructor() {
        this.checkWebGPUSupport();
        this.checkDownloadedModels();
    }

    public async checkDownloadedModels(): Promise<void> {
        try {
            const downloaded: string[] = [];
            for (const model of WEBLLM_MODELS) {
                const isInCache = await webllm.hasModelInCache(model.id);
                if (isInCache) {
                    downloaded.push(model.id);
                }
            }
            this.status.downloadedModels = downloaded;
            this.notifyStatusChange();
        } catch (error) {
            console.warn('[WebLLM] Failed to check downloaded models:', error);
        }
    }

    public async checkModelCompatibility(modelId: string): Promise<{
        compatible: boolean;
        reasons: string[];
    }> {
        const model = WEBLLM_MODELS.find(m => m.id === modelId);
        if (!model) return { compatible: false, reasons: ['Model not found'] };

        const reasons: string[] = [];

        // Check RAM
        const ram = (navigator as any).deviceMemory || 8; // Default to 8 if not available
        if (ram < model.requiredRamGB) {
            reasons.push(`Insufficient RAM: ${ram}GB available, ${model.requiredRamGB}GB required`);
        }

        // Check WebGPU availability (already done in checkWebGPUSupport, but let's be explicit)
        if (!this.status.isSupported) {
            reasons.push('WebGPU is not supported');
        }

        // Note: Disk space and precise VRAM are harder to check reliably without IPC or specific permissions
        // but we can provide a warning based on what we know.

        try {
            const estimate = await navigator.storage.estimate();
            const availableGB = (estimate.quota! - estimate.usage!) / (1024 * 1024 * 1024);
            // Most models are 1.5 - 5GB. We should aim for at least 6GB free for the larger ones.
            const requiredDisk = parseFloat(model.size.replace('~', '').replace('GB', '')) + 1; // 1GB buffer
            if (availableGB < requiredDisk) {
                reasons.push(`Low Disk Space: ~${availableGB.toFixed(1)}GB free, ~${requiredDisk}GB needed`);
            }
        } catch (e) {
            // Ignore storage estimate errors
        }

        return {
            compatible: reasons.length === 0,
            reasons
        };
    }

    private async checkWebGPUSupport(): Promise<void> {
        try {
            if (!navigator.gpu) {
                this.status.isSupported = false;
                this.status.error = 'WebGPU is not supported in this browser/environment';
                return;
            }

            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                this.status.isSupported = false;
                this.status.error = 'No WebGPU adapter found. Please ensure your GPU drivers are up to date.';
                return;
            }

            this.status.isSupported = true;
            this.status.error = null;
        } catch (error) {
            this.status.isSupported = false;
            this.status.error = error instanceof Error ? error.message : 'WebGPU check failed';
        }
        this.notifyStatusChange();
    }

    private notifyStatusChange(): void {
        const backgroundDownload = this.downloadingStatus.isDownloading && this.downloadingStatus.modelId ? {
            modelId: this.downloadingStatus.modelId,
            progress: this.downloadingStatus.progress,
            stage: this.status.loadingStage, // Use general stage or add specific one
        } : null;

        this.statusCallbacks.forEach(cb => cb({
            ...this.status,
            backgroundDownload
        }));
    }

    public subscribe(callback: StatusCallback): () => void {
        this.statusCallbacks.add(callback);
        this.notifyStatusChange();
        return () => this.statusCallbacks.delete(callback);
    }

    public getStatus(): WebLLMStatus {
        return { ...this.status };
    }

    public getDownloadStatus() {
        return { ...this.downloadingStatus };
    }

    public async downloadModel(modelId: string): Promise<void> {
        // If a model is loaded, use background engine to avoid unloading
        if (this.status.isLoaded) {
            console.log('[WebLLM] Starting background download for:', modelId);
            this.downloadingStatus.isDownloading = true;
            this.downloadingStatus.modelId = modelId;
            this.downloadingStatus.progress = 0;

            try {
                this.backgroundEngine = new webllm.MLCEngine();
                this.backgroundEngine.setInitProgressCallback((progress: webllm.InitProgressReport) => {
                    this.downloadingStatus.progress = progress.progress * 100;
                    this.notifyStatusChange();
                });

                await this.backgroundEngine.reload(modelId);

                // Once loaded, immediately unload to free VRAM, but it remains in cache
                await this.backgroundEngine.unload();
                this.backgroundEngine = null;

                console.log('[WebLLM] Background download complete:', modelId);
                this.checkDownloadedModels();
            } catch (error) {
                console.error('[WebLLM] Background download failed:', error);
                throw error;
            } finally {
                this.downloadingStatus.isDownloading = false;
                this.downloadingStatus.modelId = null;
                this.downloadingStatus.progress = 0;
                this.backgroundEngine = null;
                this.notifyStatusChange();
            }
        } else {
            // No model loaded, just use regular load which effectively downloads
            // But we want to "download only" (i.e. not keep it loaded)?
            // If the user clicked "Download", they probably want it cached.
            // But standard behavior for "Load" is to make it active.
            // We'll trust the caller. If they want to "Use", they call loadModel.
            // If they call downloadModel, and nothing is loaded, we can use the main engine temporarily.
            await this.loadModel(modelId);
            await this.unloadModel(); // Since it's just "download"
        }
    }

    public async loadModel(modelId: string = WEBLLM_MODELS[0].id): Promise<void> {
        if (!this.status.isSupported) {
            throw new Error(this.status.error || 'WebGPU not supported');
        }

        if (this.currentModelId === modelId && this.status.isLoaded) {
            console.log('[WebLLM] Model already loaded:', modelId);
            return;
        }

        // Unload previous model if different
        if (this.engine && this.currentModelId !== modelId) {
            await this.unloadModel();
        }

        this.status.isLoading = true;
        this.status.loadingProgress = 0;
        this.status.loadingStage = 'Initializing...';
        this.status.error = null;
        this.notifyStatusChange();

        try {
            console.log('[WebLLM] Loading model:', modelId);

            this.engine = new webllm.MLCEngine();

            // Set progress callback
            this.engine.setInitProgressCallback((progress: webllm.InitProgressReport) => {
                this.status.loadingProgress = progress.progress * 100;
                this.status.loadingStage = progress.text;
                this.notifyStatusChange();
            });

            await this.engine.reload(modelId);

            this.currentModelId = modelId;
            this.status.isLoaded = true;
            this.status.isLoading = false;
            this.status.currentModel = modelId;
            this.status.loadingProgress = 100;
            this.status.loadingStage = 'Ready';
            console.log('[WebLLM] Model loaded successfully:', modelId);
            // Refresh downloaded models list
            this.checkDownloadedModels();
        } catch (error) {
            console.error('[WebLLM] Failed to load model:', error);
            this.status.isLoading = false;
            this.status.error = error instanceof Error ? error.message : 'Failed to load model';
            this.engine = null;
            this.currentModelId = null;
        }
        this.notifyStatusChange();
    }

    public async unloadModel(): Promise<void> {
        if (this.engine) {
            try {
                await this.engine.unload();
            } catch (e) {
                console.warn('[WebLLM] Error unloading model:', e);
            }
            this.engine = null;
        }
        this.currentModelId = null;
        this.status.isLoaded = false;
        this.status.currentModel = null;
        this.status.loadingProgress = 0;
        this.status.loadingStage = '';
        this.notifyStatusChange();
    }

    public async deleteModel(modelId: string): Promise<void> {
        try {
            // First unload if it's the current model
            if (this.currentModelId === modelId && this.status.isLoaded) {
                await this.unloadModel();
            }
            // Delete from cache
            await webllm.deleteChatConfigInCache(modelId);
            await webllm.deleteModelInCache(modelId);
            // Wait a bit and refresh list
            setTimeout(() => this.checkDownloadedModels(), 500);
            console.log('[WebLLM] Deleted model:', modelId);
        } catch (error) {
            console.error('[WebLLM] Error deleting model:', error);
            throw new Error(`Failed to delete model: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async chat(
        messages: WebLLMMessage[],
        tools?: { name: string; description: string; parameters: Record<string, unknown> }[]
    ): Promise<WebLLMResponse> {
        if (!this.engine || !this.status.isLoaded) {
            throw new Error('Model not loaded. Please load a model first.');
        }

        try {
            // Check if current model supports native tool calling
            const currentModelInfo = WEBLLM_MODELS.find(m => m.id === this.currentModelId);
            const supportsNativeTools = currentModelInfo?.supportsTools ?? false;

            // Only pass tools if model supports them
            let openAITools: any[] | undefined;
            if (supportsNativeTools && tools && tools.length > 0) {
                openAITools = tools.map(t => ({
                    type: 'function' as const,
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                    },
                }));
            }

            const finalMessages = messages.map(m => ({
                role: m.role,
                content: m.content || '',
            }));

            // Handle models like Hermes-2-Pro that forbid custom system prompts when tools are used
            if (openAITools && supportsNativeTools) {
                const systemIdx = finalMessages.findIndex(m => m.role === 'system');
                if (systemIdx !== -1) {
                    const systemContent = finalMessages[systemIdx].content;
                    // Remove the system message
                    finalMessages.splice(systemIdx, 1);

                    // Prefix the first user message with the system instructions
                    const userIdx = finalMessages.findIndex(m => m.role === 'user');
                    if (userIdx !== -1) {
                        finalMessages[userIdx].content = `[SYSTEM INSTRUCTIONS]\n${systemContent}\n[END SYSTEM INSTRUCTIONS]\n\n${finalMessages[userIdx].content}`;
                    } else {
                        // If no user message (unlikely), add one
                        finalMessages.unshift({ role: 'user', content: systemContent });
                    }
                    console.log('[WebLLM] Merged system prompt into user message to support Hermes tool calling');
                }
            }

            const response = await this.engine.chat.completions.create({
                messages: finalMessages as any,
                ...(openAITools ? { tools: openAITools } : {}),
                temperature: 0.7,
                max_tokens: 2048,
            });

            const choice = response.choices[0];
            const message = choice.message;

            // Parse tool calls if present (native tool calling)
            let toolCalls: WebLLMToolCall[] | undefined;
            if (message.tool_calls && message.tool_calls.length > 0) {
                toolCalls = message.tool_calls.map((tc, idx) => ({
                    id: tc.id || `call_${Date.now()}_${idx}`,
                    name: tc.function.name,
                    arguments: typeof tc.function.arguments === 'string'
                        ? JSON.parse(tc.function.arguments)
                        : tc.function.arguments,
                }));
            }

            // For models without native tool calling (or as fallback), try to parse JSON from content
            if (!toolCalls && tools && tools.length > 0 && message.content) {
                toolCalls = this.parseToolCallsFromContent(message.content);
            }

            return {
                content: message.content || '',
                toolCalls,
            };
        } catch (error) {
            console.error('[WebLLM] Chat error:', error);
            throw error;
        }
    }

    /**
     * Try to parse tool calls from JSON in the response content
     * Used as fallback for models without native tool calling
     */
    private parseToolCallsFromContent(content: string): WebLLMToolCall[] | undefined {
        try {
            // Look for JSON in the content
            let jsonStr = content.trim();

            // Remove markdown code blocks if present
            jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

            // Try to find JSON object
            const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
                    return parsed.tool_calls.map((tc: any, idx: number) => ({
                        id: `json_call_${Date.now()}_${idx}`,
                        name: tc.name,
                        arguments: tc.arguments || {},
                    }));
                }
            }
        } catch (e) {
            // Failed to parse, return undefined
            console.debug('[WebLLM] Could not parse tool calls from content');
        }
        return undefined;
    }

    /**
     * Quick inference for task complexity analysis
     * Returns a simple classification without tool calling
     */
    public async analyzeTaskComplexity(userMessage: string): Promise<{
        complexity: 'simple' | 'moderate' | 'complex';
        needsExternalModel: boolean;
        reason: string;
    }> {
        if (!this.engine || !this.status.isLoaded) {
            throw new Error('Model not loaded');
        }

        const systemPrompt = `You are a task complexity analyzer. Given a user request, classify it as:
- "simple": Basic questions, greetings, simple lookups
- "moderate": Requires some reasoning or tool use
- "complex": Requires deep reasoning, multiple steps, or specialized knowledge

Respond in JSON format: {"complexity": "simple|moderate|complex", "needsExternalModel": true|false, "reason": "brief explanation"}

Set needsExternalModel to true if the task requires:
- Complex reasoning or math
- Specialized domain knowledge
- Long-form content generation
- Code generation or debugging`;

        const response = await this.engine.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: 0.3,
            max_tokens: 150,
            response_format: { type: 'json_object' },
        });

        const content = response.choices[0].message.content || '';

        try {
            return JSON.parse(content);
        } catch {
            // Default to moderate if parsing fails
            return {
                complexity: 'moderate',
                needsExternalModel: false,
                reason: 'Could not parse complexity analysis',
            };
        }
    }
}

// Singleton instance
export const webLLMManager = new WebLLMManager();

// Export convenience functions
export const checkWebGPUSupport = async (): Promise<boolean> => {
    const status = webLLMManager.getStatus();
    return status.isSupported;
};

export const getWebLLMStatus = (): WebLLMStatus => {
    return webLLMManager.getStatus();
};

export const loadWebLLMModel = async (modelId?: string): Promise<void> => {
    return webLLMManager.loadModel(modelId);
};

export const unloadWebLLMModel = async (): Promise<void> => {
    return webLLMManager.unloadModel();
};

export const chatWithWebLLM = async (
    messages: WebLLMMessage[],
    tools?: { name: string; description: string; parameters: Record<string, unknown> }[]
): Promise<WebLLMResponse> => {
    return webLLMManager.chat(messages, tools);
};

export const subscribeToWebLLMStatus = (callback: StatusCallback): (() => void) => {
    return webLLMManager.subscribe(callback);
};

export const analyzeComplexity = async (message: string) => {
    return webLLMManager.analyzeTaskComplexity(message);
};

export const checkDownloadedWebLLMModels = async (): Promise<void> => {
    return webLLMManager.checkDownloadedModels();
};

export const deleteWebLLMModel = async (modelId: string): Promise<void> => {
    return webLLMManager.deleteModel(modelId);
};

export const downloadWebLLMModelOnly = async (modelId: string): Promise<void> => {
    return webLLMManager.downloadModel(modelId);
};

export const getWebLLMDownloadStatus = () => {
    return webLLMManager.getDownloadStatus();
};

export const checkWebLLMModelCompatibility = (modelId: string) => {
    return webLLMManager.checkModelCompatibility(modelId);
};
