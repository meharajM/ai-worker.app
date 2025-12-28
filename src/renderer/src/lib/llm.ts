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

interface ProviderStatus {
    available: boolean
    model?: string
    error?: string
}

// Check if Ollama is running
async function checkOllama(): Promise<ProviderStatus> {
    if (!FEATURE_FLAGS.OLLAMA_ENABLED) {
        return { available: false, error: 'Ollama disabled' }
    }

    try {
        const response = await fetch(`${LLM_CONFIG.OLLAMA.BASE_URL}/api/tags`)
        if (response.ok) {
            const data = await response.json()
            const models = data.models || []
            const defaultModel = models.find((m: { name: string }) =>
                m.name.startsWith(LLM_CONFIG.OLLAMA.DEFAULT_MODEL)
            )
            return {
                available: true,
                model: defaultModel?.name || models[0]?.name || LLM_CONFIG.OLLAMA.DEFAULT_MODEL,
            }
        }
        return { available: false, error: 'Ollama not responding' }
    } catch {
        return { available: false, error: 'Ollama not running' }
    }
}

// Check if OpenAI-compatible API is configured
function checkOpenAI(): ProviderStatus {
    if (!FEATURE_FLAGS.CLOUD_LLM_ENABLED) {
        return { available: false, error: 'Cloud LLM disabled' }
    }

    const apiKey = localStorage.getItem('openai_api_key')
    if (apiKey) {
        return {
            available: true,
            model: LLM_CONFIG.OPENAI_COMPATIBLE.DEFAULT_MODEL,
        }
    }
    return { available: false, error: 'No API key configured' }
}

// Get available providers
export async function getAvailableProviders(): Promise<Record<LLMProvider, ProviderStatus>> {
    const [ollama, openai] = await Promise.all([
        checkOllama(),
        Promise.resolve(checkOpenAI()),
    ])

    return {
        browser: { available: false, error: 'Not implemented yet' }, // TODO: Implement browser LLM detection
        ollama,
        openai,
    }
}

// Call Ollama API
async function callOllama(
    messages: LLMMessage[],
    tools?: LLMTool[]
): Promise<LLMResponse> {
    const response = await fetch(`${LLM_CONFIG.OLLAMA.BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: LLM_CONFIG.OLLAMA.DEFAULT_MODEL,
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
        throw new Error(`Ollama error: ${response.statusText}`)
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
        model: LLM_CONFIG.OLLAMA.DEFAULT_MODEL,
    }
}

// Call OpenAI-compatible API
async function callOpenAI(
    messages: LLMMessage[],
    tools?: LLMTool[]
): Promise<LLMResponse> {
    const apiKey = localStorage.getItem('openai_api_key')
    const baseUrl = localStorage.getItem('openai_base_url') || 'https://api.openai.com/v1'

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
            model: LLM_CONFIG.OPENAI_COMPATIBLE.DEFAULT_MODEL,
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
        model: LLM_CONFIG.OPENAI_COMPATIBLE.DEFAULT_MODEL,
    }
}

// Main chat function - automatically selects best provider
export async function chat(
    messages: LLMMessage[],
    tools?: LLMTool[],
    preferredProvider?: LLMProvider
): Promise<LLMResponse> {
    const providers = await getAvailableProviders()

    // Determine which provider to use
    let provider: LLMProvider | null = null

    if (preferredProvider && providers[preferredProvider].available) {
        provider = preferredProvider
    } else if (providers.ollama.available) {
        provider = 'ollama'
    } else if (providers.openai.available) {
        provider = 'openai'
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
            return callOllama(messagesWithSystem, tools)
        case 'openai':
            return callOpenAI(messagesWithSystem, tools)
        default:
            throw new Error(`Provider ${provider} not implemented`)
    }
}
