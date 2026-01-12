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

// SEQUENTIAL-TOOL PROMPT FOR SMALL CONTEXT LLMs
export const getSystemPrompt = (compactToolList: string) => `You are AI-Worker, an autonomous assistant with tool access.

## CRITICAL FORMATTING RULES:
1. ALWAYS start with <THINK>brief reasoning</THINK>
2. If tool needed: add <TOOL>{"name":"tool_name","args":{}}</TOOL>
3. If final answer: provide after </THINK> with no <TOOL> tag
4. ONE tool per response maximum
5. Keep reasoning under 2 sentences

## EXECUTION FLOW:
User: "Get weather in Tokyo then convert to Fahrenheit"
You: <THINK>First get Tokyo weather</THINK>
<TOOL>{"name":"get_weather","args":{"location":"Tokyo"}}</TOOL>

[Tool returns {"temp_c":22}]
You: <THINK>Now convert 22°C to Fahrenheit</THINK>
<TOOL>{"name":"convert_temp","args":{"celsius":22,"to":"F"}}</TOOL>

[Tool returns {"fahrenheit":71.6}]
You: <THINK>Both tools complete</THINK>It's 22°C (71.6°F) in Tokyo.

## AVAILABLE TOOLS (use exact names):
${compactToolList}

## REMEMBER:
- Wait for tool result before next step
- No multiple tools in one response
- Final answer: natural language after </THINK>
- Keep responses EXTREMELY concise`;
