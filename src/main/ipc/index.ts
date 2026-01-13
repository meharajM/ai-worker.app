import { registerAppHandlers } from './app'
import { registerMcpHandlers } from './mcp'
import { registerLlmHandlers } from './llm'
import { registerStoreHandlers } from './store'
import { registerFileHandlers } from './files'

export function setupIpcHandlers(): void {
    registerAppHandlers()
    registerMcpHandlers()
    registerLlmHandlers()
    registerStoreHandlers()
    registerFileHandlers()
}
