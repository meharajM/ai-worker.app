import { registerAppHandlers } from './app'
import { registerMcpHandlers } from './mcp'
import { registerLlmHandlers } from './llm'
import { registerStoreHandlers } from './store'
import { registerLogsHandlers } from './logs'
import { registerSpeechHandlers } from './speech'
import { registerSecureHandlers } from './secure'
import { registerFsHandlers } from './fs'
import { registerMemoryHandlers } from './memory'
import { registerAntigravityHandlers } from './antigravity'
import { registerPerplexityHandlers } from './perplexity'

export function setupIpcHandlers(): void {
    registerAppHandlers()
    registerMcpHandlers()
    registerMemoryHandlers()
    registerLlmHandlers()
    registerStoreHandlers()
    registerLogsHandlers()
    registerSpeechHandlers()
    registerSecureHandlers()
    registerFsHandlers()
    registerAntigravityHandlers()
    registerPerplexityHandlers()
}

