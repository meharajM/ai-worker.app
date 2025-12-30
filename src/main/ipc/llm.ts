import { ipcMain } from 'electron'

export function registerLlmHandlers(): void {
    // LLM operations (placeholder - renderer handles this via fetch for now)
    ipcMain.handle('llm:chat', async (_event, messages, tools) => {
        console.log('LLM chat requested via IPC:', { messageCount: messages?.length, toolCount: tools?.length })
        return { error: 'Main process LLM not implemented yet. Use renderer LLM.' }
    })

    ipcMain.handle('llm:get-providers', async () => {
        return {
            ollama: { available: false },
            openai: { available: false },
            browser: { available: false },
        }
    })

    // Fetch OpenAI models from main process (bypasses CORS)
    ipcMain.handle('llm:fetch-openai-models', async (_event, baseUrl: string, apiKey: string) => {
        try {
            const response = await fetch(`${baseUrl}/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
            })

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }

            const data = await response.json()
            // Filter models that support chat completions
            const models = (data.data || [])
                .filter((m: { id: string }) => {
                    const id = m.id.toLowerCase()
                    // Include GPT models and other chat models
                    return id.includes('gpt') || id.includes('chat') || id.includes('claude') || id.includes('llama') || id.includes('perplexity')
                })
                .map((m: { id: string }) => m.id)
                .sort()

            return { success: true, models }
        } catch (error) {
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error',
                models: [] 
            }
        }
    })
}
