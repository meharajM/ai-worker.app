// LLM Orchestrator - Manages different LLM providers
// Priority: Browser LLM > Ollama > OpenAI-compatible

import { FEATURE_FLAGS, LLM_CONFIG } from './constants'

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

export interface LLMTool {
    name: string
    description: string
    parameters: Record<string, unknown>
}

export interface LLMResponse {
    content: string
    toolCalls?: {
        id: string
        name: string
        arguments: Record<string, unknown>
    }[]
    provider: string
    model: string
}

export type LLMProvider = 'browser' | 'ollama' | 'openai'

export interface LLMSettings {
    preferredProvider?: 'auto' | 'ollama' | 'openai' | 'browser'
    ollamaModel?: string
    ollamaBaseUrl?: string
    openaiApiKey?: string
    openaiBaseUrl?: string
    openaiModel?: string
}

interface ProviderStatus {
    available: boolean
    model?: string
    error?: string
    models?: string[] // Available models list
    modelsEndpointAvailable?: boolean // Whether /models endpoint exists
}

// Get Ollama settings from store or use defaults
function getOllamaSettings(settings?: LLMSettings) {
    const baseUrl = settings?.ollamaBaseUrl || LLM_CONFIG.OLLAMA.BASE_URL
    const model = settings?.ollamaModel || LLM_CONFIG.OLLAMA.DEFAULT_MODEL
    return { baseUrl, model }
}

// Get OpenAI settings from store or use defaults
function getOpenAISettings(settings?: LLMSettings) {
    const apiKey = settings?.openaiApiKey || localStorage.getItem('openai_api_key') || ''
    const baseUrl = settings?.openaiBaseUrl || localStorage.getItem('openai_base_url') || 'https://api.openai.com/v1'
    const model = settings?.openaiModel || LLM_CONFIG.OPENAI_COMPATIBLE.DEFAULT_MODEL
    return { apiKey, baseUrl, model }
}

// Check if Ollama is running and list available models
export async function checkOllama(settings?: LLMSettings): Promise<ProviderStatus> {
    if (!FEATURE_FLAGS.OLLAMA_ENABLED) {
        return { available: false, error: 'Ollama disabled' }
    }

    const { baseUrl } = getOllamaSettings(settings)

    try {
        const response = await fetch(`${baseUrl}/api/tags`)
        if (response.ok) {
            const data = await response.json()
            const models = (data.models || []).map((m: { name: string }) => m.name)
            const { model: preferredModel } = getOllamaSettings(settings)
            const defaultModel = models.find((m: string) => m.startsWith(preferredModel)) || models[0] || preferredModel
            return {
                available: true,
                model: defaultModel,
                models: models,
            }
        }
        return { available: false, error: 'Ollama not responding' }
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : 'Ollama not running' }
    }
}

// Test Ollama connection with a specific model
export async function testOllamaConnection(baseUrl: string, model: string): Promise<{ success: boolean; error?: string }> {
    try {
        const response = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt: 'test',
                stream: false,
            }),
        })
        if (response.ok) {
            return { success: true }
        }
        const error = await response.json().catch(() => ({}))
        return { success: false, error: error.error || 'Connection failed' }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
}

// Check if OpenAI-compatible API is configured and fetch available models
export async function checkOpenAI(settings?: LLMSettings): Promise<ProviderStatus> {
    if (!FEATURE_FLAGS.CLOUD_LLM_ENABLED) {
        return { available: false, error: 'Cloud LLM disabled' }
    }

    const { apiKey, baseUrl, model } = getOpenAISettings(settings)
    if (!apiKey) {
        return { available: false, error: 'No API key configured' }
    }

    try {
        // Use IPC to fetch models from main process (bypasses CORS)
        const electron = (window as any).electron
        if (electron?.llm?.fetchOpenAIModels) {
            const result = await electron.llm.fetchOpenAIModels(baseUrl, apiKey)
            
            if (result.success && result.models && result.models.length > 0) {
                const models = result.models
                // Find the preferred model or use default
                const preferredModel = model
                const defaultModel = models.find((m: string) => m === preferredModel) 
                    || models.find((m: string) => m.includes('gpt-4o')) 
                    || models.find((m: string) => m.includes('gpt-4')) 
                    || models[0] 
                    || preferredModel

                return {
                    available: true,
                    model: defaultModel,
                    models: models,
                    modelsEndpointAvailable: true,
                }
            } else {
                // If models endpoint fails, still mark as available if API key exists
                return {
                    available: true,
                    model: model,
                    models: [model], // Fallback to just the configured model
                    modelsEndpointAvailable: false,
                    error: result.error || 'Could not fetch models list',
                }
            }
        } else {
            // Fallback to direct fetch if IPC not available (for development/testing)
            const response = await fetch(`${baseUrl}/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
            })

            if (response.ok) {
                const data = await response.json()
                const models = (data.data || [])
                    .filter((m: { id: string }) => {
                        const id = m.id.toLowerCase()
                        return id.includes('gpt') || id.includes('chat') || id.includes('claude') || id.includes('llama') || id.includes('perplexity')
                    })
                    .map((m: { id: string }) => m.id)
                    .sort()

                const preferredModel = model
                const defaultModel = models.find((m: string) => m === preferredModel) 
                    || models.find((m: string) => m.includes('gpt-4o')) 
                    || models.find((m: string) => m.includes('gpt-4')) 
                    || models[0] 
                    || preferredModel

                return {
                    available: true,
                    model: defaultModel,
                    models: models,
                    modelsEndpointAvailable: true,
                }
            } else {
                return {
                    available: true,
                    model: model,
                    models: [model],
                    modelsEndpointAvailable: false,
                }
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
            error: error instanceof Error ? error.message : 'Could not fetch models list',
        }
    }
}

// Test OpenAI connection and fetch models
export async function testOpenAIConnection(baseUrl: string, apiKey: string, model: string): Promise<{ 
    success: boolean
    error?: string
    models?: string[]
    modelsEndpointAvailable?: boolean
}> {
    try {
        // Test connection with chat completions
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'test' }],
                max_tokens: 5,
            }),
        })
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            return { success: false, error: error.error?.message || 'Connection failed' }
        }

        // Try to fetch models if connection succeeds
        const electron = (window as any).electron
        if (electron?.llm?.fetchOpenAIModels) {
            try {
                const modelsResult = await electron.llm.fetchOpenAIModels(baseUrl, apiKey)
                if (modelsResult.success && modelsResult.models) {
                    return { 
                        success: true, 
                        models: modelsResult.models,
                        modelsEndpointAvailable: true
                    }
                } else {
                    return { 
                        success: true,
                        modelsEndpointAvailable: false,
                        error: modelsResult.error || 'Models endpoint not available'
                    }
                }
            } catch (modelsError) {
                // Connection works but models endpoint doesn't
                return { 
                    success: true,
                    modelsEndpointAvailable: false
                }
            }
        }

        return { success: true, modelsEndpointAvailable: false }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
}

// Get available providers
export async function getAvailableProviders(settings?: LLMSettings): Promise<Record<LLMProvider, ProviderStatus>> {
    const preferred = settings?.preferredProvider || 'auto'
    if (preferred === 'ollama') {
        const ollama = await checkOllama(settings)
        return {
            browser: { available: false, error: 'Not implemented yet' },
            ollama,
            openai: { available: false },
        }
    }
    if (preferred === 'openai') {
        const openai = await checkOpenAI(settings)
        return {
            browser: { available: false, error: 'Not implemented yet' },
            ollama: { available: false },
            openai,
        }
    }
    const [ollama, openai] = await Promise.all([
        checkOllama(settings),
        checkOpenAI(settings),
    ])
    return {
        browser: { available: false, error: 'Not implemented yet' },
        ollama,
        openai,
    }
}

// Call Ollama API
async function callOllama(
    messages: LLMMessage[],
    tools?: LLMTool[],
    settings?: LLMSettings
): Promise<LLMResponse> {
    const { baseUrl, model } = getOllamaSettings(settings)
    
    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model,
            messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
            })),
            stream: false,
            tools: tools?.map((t) => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            })),
        }),
    })

    if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || `Ollama error: ${response.statusText}`)
    }

    const data = await response.json()

    return {
        content: data.message?.content || '',
        toolCalls: data.message?.tool_calls?.map((tc: { function: { name: string; arguments: Record<string, unknown> } }) => ({
            id: `call_${Date.now()}`,
            name: tc.function.name,
            arguments: tc.function.arguments,
        })),
        provider: 'ollama',
        model: model,
    }
}

// Call OpenAI-compatible API
async function callOpenAI(
    messages: LLMMessage[],
    tools?: LLMTool[],
    settings?: LLMSettings
): Promise<LLMResponse> {
    const { apiKey, baseUrl, model } = getOpenAISettings(settings)

    if (!apiKey) {
        throw new Error('OpenAI API key not configured')
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: model,
            messages,
            tools: tools?.map((t) => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            })),
        }),
    })

    if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error?.message || `OpenAI error: ${response.statusText}`)
    }

    const data = await response.json()
    const choice = data.choices[0]

    return {
        content: choice.message?.content || '',
        toolCalls: choice.message?.tool_calls?.map((tc: { id: string; function: { name: string; arguments: string } }) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
        })),
        provider: 'openai',
        model: model,
    }
}

// Main chat function - automatically selects best provider
export async function chat(
    messages: LLMMessage[],
    tools?: LLMTool[],
    settings?: LLMSettings
): Promise<LLMResponse> {
    const providers = await getAvailableProviders(settings)

    // Determine which provider to use
    let provider: LLMProvider | null = null
    const preferredProvider = settings?.preferredProvider

    if (preferredProvider === 'auto' || !preferredProvider) {
        // Auto-select: try ollama first, then openai
        if (providers.ollama.available) {
            provider = 'ollama'
        } else if (providers.openai.available) {
            provider = 'openai'
        }
    } else if (preferredProvider === 'ollama' && providers.ollama.available) {
        provider = 'ollama'
    } else if (preferredProvider === 'openai' && providers.openai.available) {
        provider = 'openai'
    } else if (preferredProvider === 'browser' && providers.browser.available) {
        provider = 'browser'
    }

    if (!provider) {
        throw new Error('No LLM provider available. Please configure Ollama or add an OpenAI API key.')
    }

    // Add system message if not present
    const messagesWithSystem = messages[0]?.role === 'system'
        ? messages
        : [
            {
                role: 'system' as const,
                content: `You are AI-Worker, a helpful voice-first assistant designed to help users with productivity tasks. 
You can use tools when available to perform actions on the user's behalf.
Be concise and helpful. Format responses for voice output when possible.`,
            },
            ...messages,
        ]

    switch (provider) {
        case 'ollama':
            return callOllama(messagesWithSystem, tools, settings)
        case 'openai':
            return callOpenAI(messagesWithSystem, tools, settings)
        default:
            throw new Error(`Provider ${provider} not implemented`)
    }
}
