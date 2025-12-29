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
}
