import { registerAppHandlers } from './app'
import { registerMcpHandlers } from './mcp'
import { registerLlmHandlers } from './llm'
import { registerStoreHandlers } from './store'
import { registerLogsHandlers } from './logs'

export function setupIpcHandlers(): void {
    registerAppHandlers()
    registerMcpHandlers()
    registerLlmHandlers()
    registerStoreHandlers()
    registerLogsHandlers()
}
