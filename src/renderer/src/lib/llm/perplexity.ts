import { ProviderStatus } from './types'
import { LLMSettings, LLMMessage, LLMResponse, LLMTool } from '../types'
import electron from '../electron'

export async function checkPerplexity(settings?: LLMSettings): Promise<ProviderStatus> {
    try {
        const isAvailable = await electron.perplexity?.getStatus()
        if (isAvailable?.signedIn) {
            return {
                available: true,
                models: ['concise', 'copilot']
            }
        }
        return {
            available: false,
            error: 'Not linked to a Perplexity account'
        }
    } catch (e) {
        return { available: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
}

export async function testPerplexityConnection(): Promise<{ success: boolean; error?: string }> {
    try {
        const isAvailable = await electron.perplexity?.getStatus()
        if (isAvailable?.signedIn) {
            await electron.perplexity?.ask('Hello')
            return { success: true }
        }
        return { success: false, error: 'Not linked' }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

export async function callPerplexity(
    messages: LLMMessage[],
    settings?: LLMSettings,
    abortSignal?: AbortSignal
): Promise<LLMResponse> {
    const isAvailable = await electron.perplexity?.getStatus()
    if (!isAvailable?.signedIn) {
        throw new Error('Please link your Perplexity account first to use Perplexity as an LLM provider.')
    }

    const modelName = settings?.perplexityModel || 'concise'

    // unlock-perplexity expects a single prompt or conversation logic. Currently we just send the last message
    // or maybe stringify the entire context to keep it simple, since perplexity handles conversation via memory implicitly in web UI?
    // Actually perplexity has "new thread". Let's stringify context.
    const systemInstruction = messages.find(m => m.role === 'system')?.content || ''

    // Formatting conversation manually since unlock-perplexity just takes a string prompt
    let prompt = ''
    if (systemInstruction) {
        prompt += `System: ${systemInstruction}\n\n`
    }

    for (const msg of messages) {
        if (msg.role !== 'system') {
            const textContent = Array.isArray(msg.content)
                ? msg.content.map(c => c.type === 'text' ? c.text : '').join('\n')
                : msg.content;

            prompt += `${msg.role.toUpperCase()}:\n${textContent}\n\n`
        }
    }

    prompt += `Please reply as the ASSISTANT to the conversation above. Respond with plain text/markdown.`

    let aborted = false
    if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
            aborted = true
        })
    }

    if (aborted) {
        throw new Error('Request aborted')
    }

    // Call perplexity using electron API (which bridges to unlock-perplexity)
    const result = await electron.perplexity?.ask(prompt, { mode: modelName })

    if (aborted) {
        throw new Error('Request aborted')
    }

    // The result from unlock-perplexity's "ask" is typically the bot's raw text response.
    // Or it might be an object depending on version. Let's assume it's a string or has a .text property
    const responseText = typeof result === 'string' ? result : (result?.text ?? JSON.stringify(result))

    return {
        content: responseText,
        provider: 'perplexity',
        model: modelName
    }
}
