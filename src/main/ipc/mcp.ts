import { ipcMain } from 'electron'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { PlaywrightService } from '../services/PlaywrightService'
import { MemoryService } from '../services/MemoryService'
import { FileSystemService } from '../services/FileSystemService'
import { McpProcessManager } from '../services/McpProcessManager'

// --- State ---
const activeConnections = new Map<string, Client>()
const inProcessPlaywrightConnections = new Set<string>()
const inProcessMemoryConnections = new Set<string>()
const inProcessFilesystemConnections = new Set<string>()

// --- Helpers ---

function isPlaywrightServer(serverConfig: { id?: string; name?: string; command?: string; args?: string[] }): boolean {
    const { id, name, command, args } = serverConfig
    const idOrName = (id || name || '').toLowerCase()
    const argsStr = (args || []).join(' ').toLowerCase()
    return idOrName.includes('playwright') || argsStr.includes('@playwright/mcp') || command === 'internal'
}

function logMcpOperation(level: 'info' | 'warn' | 'error', message: string, context: any): void {
    const timestamp = new Date().toISOString()
    const logMessage = `[MCP ${level.toUpperCase()}] ${timestamp} - ${message}`
    const contextStr = JSON.stringify(context, null, 2)

    switch (level) {
        case 'error': console.error(logMessage, '\nContext:', contextStr); break
        case 'warn': console.warn(logMessage, '\nContext:', contextStr); break
        default: console.log(logMessage, '\nContext:', contextStr); break
    }
}

function isConnectionClosedError(error: string | Error): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return errorMessage.includes('-32000') ||
        errorMessage.toLowerCase().includes('connection closed') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('EPIPE')
}

function cleanupClosedConnection(serverId: string): void {
    const client = activeConnections.get(serverId)
    if (client) {
        client.close().catch(() => {})
        activeConnections.delete(serverId)
    }
    McpProcessManager.getInstance().unregisterProcess(serverId)
}

function sanitizeArgs(args: unknown): unknown {
    if (!args || typeof args !== 'object') return args
    const sanitized = { ...args as Record<string, unknown> }
    const sensitiveKeys = ['password', 'apiKey', 'token', 'secret', 'key', 'auth']

    for (const key in sanitized) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
            sanitized[key] = '***REDACTED***'
        } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitizeArgs(sanitized[key])
        }
    }
    return sanitized
}

/**
 * In-process tool handlers can return objects/arrays/numbers.
 * MCP payloads should carry a stable text representation (JSON for objects).
 */
function toMcpText(result: unknown): string {
    if (typeof result === 'string') return result
    if (result === null || result === undefined) return ''
    try {
        return JSON.stringify(result)
    } catch {
        return String(result)
    }
}

// --- IPC Register ---

export function registerMcpHandlers(): void {
    ipcMain.handle('mcp:connect', async (_event, serverConfig) => {
        const startTime = Date.now()
        const { id, type, command, args, url, env } = serverConfig

        logMcpOperation('info', 'MCP connection requested', {
            operation: 'connect',
            serverId: id,
            type, command, args: args?.join(' '),
            url: type === 'sse' ? url : undefined,
            hasEnv: !!env,
        })

        try {
            if (activeConnections.has(id)) {
                return { success: true, serverId: id }
            }

            // In-process Playwright
            if (isPlaywrightServer(serverConfig)) {
                try {
                    await PlaywrightService.getInstance().initialize()
                    inProcessPlaywrightConnections.add(id)
                    logMcpOperation('info', 'In-process Playwright connection established', { operation: 'connect', serverId: id, inProcess: true })
                    return { success: true, serverId: id, inProcess: true }
                } catch (playwrightError: unknown) {
                    logMcpOperation('warn', 'In-process Playwright failed, falling back to external MCP', { operation: 'connect', serverId: id, error: String(playwrightError) })
                }
            }

            // In-process Memory
            if (command === 'internal-memory' || (args && args.includes('memory-service'))) {
                MemoryService.getInstance().initialize()
                inProcessMemoryConnections.add(id)
                logMcpOperation('info', 'In-process Memory connection established', { operation: 'connect', serverId: id, inProcess: true })
                return { success: true, serverId: id, inProcess: true }
            }

            // In-process Filesystem
            if (command === 'internal-filesystem' || (args && args.includes('filesystem-service'))) {
                inProcessFilesystemConnections.add(id)
                logMcpOperation('info', 'In-process Filesystem connection established', { operation: 'connect', serverId: id, inProcess: true })
                return { success: true, serverId: id, inProcess: true }
            }

            let transport: StdioClientTransport | SSEClientTransport

            if (type === 'stdio') {
                let finalCommand = command
                const finalEnv = { ...process.env, ...(env || {}) } as Record<string, string>

                if (command === 'node' || command === 'node.exe') {
                    finalCommand = process.execPath
                    finalEnv.ELECTRON_RUN_AS_NODE = '1'
                }

                transport = new StdioClientTransport({
                    command: finalCommand,
                    args: args || [],
                    env: finalEnv,
                    stderr: 'pipe'
                })

                // MODULAR CHANGE: Track process via Manager
                const transportAny = transport as any
                if (transportAny._process) {
                    McpProcessManager.getInstance().registerProcess(id, transportAny._process)
                }

                // Old-style process monitoring logic (Kept for compatibility/logs)
                if (transportAny._process) {
                    const proc = transportAny._process
                    proc.on('exit', (code) => {
                        if (code !== 0 && code !== null) {
                            cleanupClosedConnection(id)
                        }
                    })
                    proc.on('error', (err) => {
                        logMcpOperation('error', 'MCP process error', { operation: 'monitor', serverId: id, error: err.message })
                        cleanupClosedConnection(id)
                    })
                    if (proc.stderr) {
                        proc.stderr.on('data', (d: Buffer) => {
                            const s = d.toString().trim()
                            if (s) logMcpOperation('info', 'MCP stderr', { operation: 'stderr', serverId: id, stderr: s })
                        })
                    }
                }
            } else if (type === 'sse' && url) {
                transport = new SSEClientTransport(new URL(url))
            } else {
                throw new Error(`Unsupported transport type: ${type}`)
            }

            const client = new Client({ name: "AI-Worker-Client", version: "0.1.0" }, { capabilities: { sampling: {} } })
            await client.connect(transport)
            
            const duration = Date.now() - startTime
            logMcpOperation('info', 'MCP server connected', { operation: 'connect', serverId: id, duration })
            activeConnections.set(id, client)
            return { success: true, serverId: id }
        } catch (error: unknown) {
            const duration = Date.now() - startTime
            const msg = error instanceof Error ? error.message : String(error)
            logMcpOperation('error', 'MCP connection failed', { operation: 'connect', serverId: id, error: msg, duration })

            let det = msg
            if (msg.includes('ENOENT')) det = getInstallInstructions(command, args)
            cleanupClosedConnection(id)
            return { success: false, error: det }
        }
    })

    ipcMain.handle('mcp:disconnect', async (_event, id: string) => {
        const startTime = Date.now()
        if (inProcessPlaywrightConnections.has(id)) {
            inProcessPlaywrightConnections.delete(id)
            return { success: true }
        }
        if (inProcessMemoryConnections.has(id)) {
            inProcessMemoryConnections.delete(id)
            return { success: true }
        }
        if (inProcessFilesystemConnections.has(id)) {
            inProcessFilesystemConnections.delete(id)
            return { success: true }
        }

        const client = activeConnections.get(id)
        if (client) {
            try {
                await client.close()
                cleanupClosedConnection(id)
                logMcpOperation('info', 'MCP disconnected', { operation: 'disconnect', serverId: id, duration: Date.now() - startTime })
                return { success: true }
            } catch (err) {
                cleanupClosedConnection(id)
                return { success: false, error: err instanceof Error ? err.message : String(err) }
            }
        }
        return { success: true }
    })

    ipcMain.handle('mcp:list-tools', async (_event, id: string) => {
        if (inProcessPlaywrightConnections.has(id)) return { tools: PlaywrightService.getInstance().listTools().tools }
        if (inProcessMemoryConnections.has(id)) return { tools: MemoryService.getInstance().listTools().tools }
        if (inProcessFilesystemConnections.has(id)) return { tools: FileSystemService.getInstance().listTools().tools }

        const client = activeConnections.get(id)
        if (!client) return { tools: [], error: 'Server not connected' }

        try {
            const res = await client.listTools()
            logMcpOperation('info', 'MCP tools listed', { operation: 'list-tools', serverId: id, count: res.tools?.length })
            return { tools: res.tools || [] }
        } catch (err: any) {
            if (isConnectionClosedError(err)) cleanupClosedConnection(id)
            return { tools: [], error: err.message }
        }
    })

    ipcMain.handle('mcp:call-tool', async (_event, id, toolName, args) => {
        // In-process calls (Simplified content return as per original)
        if (inProcessPlaywrightConnections.has(id)) {
            const res = await PlaywrightService.getInstance().callTool(toolName, args)
            if (res.error) return { result: null, error: res.error }
            return { result: { content: [{ type: 'text', text: toMcpText(res.result) }] } }
        }
        if (inProcessMemoryConnections.has(id)) {
            const res = await MemoryService.getInstance().callTool(toolName, args)
            if (res.error) return { result: null, error: res.error }
            return { result: { content: [{ type: 'text', text: toMcpText(res.result) }] } }
        }
        if (inProcessFilesystemConnections.has(id)) {
            const res = await FileSystemService.getInstance().callTool(toolName, args)
            if (res.error) return { result: null, error: res.error }
            return { result: { content: [{ type: 'text', text: toMcpText(res.result) }] } }
        }

        const client = activeConnections.get(id)
        if (!client) return { result: null, error: 'Server not connected' }

        try {
            const finalArgs = (args && typeof args === 'object' && !Array.isArray(args)) ? args : { input: args }
            logMcpOperation('info', `Calling tool: ${toolName}`, { operation: 'call-tool', serverId: id, toolName, args: sanitizeArgs(finalArgs) })
            const res = await client.callTool({ name: toolName, arguments: finalArgs || {} })
            return { result: res }
        } catch (err: any) {
            if (isConnectionClosedError(err)) cleanupClosedConnection(id)
            return { result: null, error: err.message }
        }
    })
}

function getInstallInstructions(cmd: string, args?: string[]): string {
    const isMac = process.platform === 'darwin'
    const isWin = process.platform === 'win32'

    const header = "### 🛠️ Environment Setup Needed\n\nIt looks like the command `" + cmd + "` isn't available on your system yet. Don't worry, you can fix this in a few steps:"
    const internalNodeTip = "\n\n💡 **Pro Tip:** This app has a built-in Node.js runtime. If you have a local script, you can simply use \`node\` as the command and it will work immediately!"

    if (cmd.includes('node') || cmd.includes('npx') || cmd.includes('npm')) {
        let steps = ""
        if (isMac) steps = "1. Open your **Terminal** app.\n2. Type \`brew install node\` and press Enter.\n3. *If you don't have Homebrew, download Node.js from [nodejs.org](https://nodejs.org).* "
        else if (isWin) steps = "1. Download and run the installer from [nodejs.org](https://nodejs.org).\n2. Follow the setup wizard and make sure 'Add to PATH' is checked.\n3. Restart the AI-Worker app once finished."
        else steps = "1. Install Node.js using your system's package manager (e.g., \`sudo apt install nodejs\`)."

        return header + "\n\n" + steps + internalNodeTip
    }
    if (cmd.includes('python') || cmd.includes('pip')) {
        let steps = ""
        if (isMac) steps = "1. Open your **Terminal** app.\n2. Type \`brew install python\` and press Enter.\n3. **Note:** Try using \`python3\` as the command in settings if \`python\` fails."
        else if (isWin) steps = "1. Download Python from [python.org](https://www.python.org/downloads/).\n2. **Important:** Check the box that says 'Add Python to PATH' during installation."
        else steps = "1. Install Python 3 using your system's package manager (e.g., \`sudo apt install python3\`)."

        if (args?.some(a => a.includes('mcp-server-git') || a.includes('mcp_server_git'))) {
            steps += `\n\n4. Finally, install the Git tool by running: \`pip install mcp-server-git\``
        }

        return header + "\n\n" + steps
    }
    if (cmd.includes('uv')) {
        const installCmd = isWin ? 'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"' : 'curl -LsSf https://astral.sh/uv/install.sh | sh'
        let steps = `1. **Install Python 3** (required):\n`

        if (isMac) steps += `   \`brew install python\`\n`
        else if (isWin) steps += `   Download from [python.org](https://www.python.org/downloads/) and check 'Add to PATH'\n`
        else steps += `   \`sudo apt install python3\`\n`

        steps += `\n2. **Install uv** (Python package runner):\n   \`${installCmd}\`\n\n3. **Restart the AI-Worker app**`

        if (args?.some(a => a.includes('mcp-server-git') || a.includes('mcp_server_git'))) {
            steps += `\n\n💡 **Quick Fix:** Use \`uvx mcp-server-git /path/to/your/repo\` to run without installing.`
        }

        if (args?.some(a => a.includes('markitdown'))) {
            steps += `\n\n📄 **MarkItDown** will be automatically available once uv is installed. It converts PDFs, Word docs, Excel, images, and audio files to Markdown!`
        }

        return `${header}\n\n${steps}`
    }

    return `${header}\n\nEnsure that \`${cmd}\` is installed and added to your system's environmental paths (PATH).`
}
