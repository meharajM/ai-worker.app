import { registerAppHandlers } from './app'
import { registerMcpHandlers } from './mcp'
import { registerLlmHandlers } from './llm'
import { registerStoreHandlers } from './store'

export function setupIpcHandlers(): void {
    registerAppHandlers()
    registerMcpHandlers()
    registerLlmHandlers()
    registerStoreHandlers()
}
