import { ipcMain } from 'electron'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { ChildProcess } from 'child_process'
import { PlaywrightService } from '../services/PlaywrightService'
import { MemoryService } from '../services/MemoryService'
import { FileSystemService } from '../services/FileSystemService'

// Store active MCP clients and their process info
const activeConnections = new Map<string, Client>()
const activeProcesses = new Map<string, ChildProcess>()

// Track in-process Playwright connections (not using external MCP client)
const inProcessPlaywrightConnections = new Set<string>()
const inProcessMemoryConnections = new Set<string>()
const inProcessFilesystemConnections = new Set<string>()

// Helper to detect if a server config is for Playwright
function isPlaywrightServer(serverConfig: { id?: string; name?: string; command?: string; args?: string[] }): boolean {
    const { id, name, command, args } = serverConfig
    const idOrName = (id || name || '').toLowerCase()
    const argsStr = (args || []).join(' ').toLowerCase()

    // Match by:
    // 1. ID/name containing 'playwright', OR
    // 2. Args containing '@playwright/mcp' (legacy external), OR
    // 3. Command is 'internal' (new internal service marker)
    return idOrName.includes('playwright') || argsStr.includes('@playwright/mcp') || command === 'internal'
}

// Logging utility for MCP operations
interface McpLogContext {
    serverId?: string
    serverName?: string
    toolName?: string
    operation: string
    [key: string]: unknown
}

function logMcpOperation(level: 'info' | 'warn' | 'error', message: string, context: McpLogContext): void {
    const timestamp = new Date().toISOString()
    const logMessage = `[MCP ${level.toUpperCase()}] ${timestamp} - ${message}`
    const contextStr = JSON.stringify(context, null, 2)

    switch (level) {
        case 'error':
            console.error(logMessage)
            console.error('Context:', contextStr)
            break
        case 'warn':
            console.warn(logMessage)
            console.warn('Context:', contextStr)
            break
        default:
            console.log(logMessage)
            console.log('Context:', contextStr)
    }
}

// Check if error indicates connection was closed
function isConnectionClosedError(error: string | Error): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return errorMessage.includes('-32000') ||
        errorMessage.includes('Connection closed') ||
        errorMessage.includes('connection closed') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('EPIPE')
}

// Clean up a closed connection
function cleanupClosedConnection(serverId: string): void {
    try {
        // Close client if it exists
        const client = activeConnections.get(serverId)
        if (client) {
            client.close().catch(() => {
                // Ignore close errors
            })
            activeConnections.delete(serverId)
        }

        // Clean up process reference
        const process = activeProcesses.get(serverId)
        if (process) {
            activeProcesses.delete(serverId)
        }

        logMcpOperation('info', 'Cleaned up closed connection', {
            operation: 'cleanup',
            serverId,
        })
    } catch (error) {
        // Ignore cleanup errors
        logMcpOperation('warn', 'Error during connection cleanup', {
            operation: 'cleanup',
            serverId,
            error: error instanceof Error ? error.message : String(error),
        })
    }
}

// Sanitize arguments for logging (remove sensitive data)
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

export function registerMcpHandlers(): void {
    ipcMain.handle('mcp:connect', async (_event, serverConfig) => {
        const startTime = Date.now()
        const { id, type, command, args, url, env } = serverConfig

        logMcpOperation('info', 'MCP connection requested', {
            operation: 'connect',
            serverId: id,
            type,
            command,
            args: args?.join(' '),
            url: type === 'sse' ? url : undefined,
            hasEnv: !!env,
        })

        try {
            if (activeConnections.has(id)) {
                logMcpOperation('warn', 'MCP server already connected', {
                    operation: 'connect',
                    serverId: id,
                    duration: Date.now() - startTime,
                })
                return { success: true, serverId: id }
            }

            // === PLAYWRIGHT IN-PROCESS INTERCEPTION ===
            // Route Playwright connections to the in-process service for zero-latency automation
            if (isPlaywrightServer(serverConfig)) {
                logMcpOperation('info', '🚀 Using in-process Playwright service (zero latency)', {
                    operation: 'connect',
                    serverId: id,
                    inProcess: true,
                })

                try {
                    const playwrightService = PlaywrightService.getInstance()
                    try {
                        await playwrightService.initialize()
                    } catch (initError) {
                        console.error('[MCP] Failed to initialize PlaywrightService:', initError)
                        throw initError
                    }

                    // Track this as an in-process connection
                    inProcessPlaywrightConnections.add(id)

                    logMcpOperation('info', 'In-process Playwright connected successfully', {
                        operation: 'connect',
                        serverId: id,
                        duration: Date.now() - startTime,
                        inProcess: true,
                    })

                    return { success: true, serverId: id, inProcess: true }
                } catch (playwrightError) {
                    const errorMsg = playwrightError instanceof Error ? playwrightError.message : String(playwrightError)
                    logMcpOperation('warn', 'In-process Playwright failed, falling back to external process', {
                        operation: 'connect',
                        serverId: id,
                        error: errorMsg,
                    })
                    // Fall through to standard MCP connection as backup
                }
            }

            // === MEMORY IN-PROCESS INTERCEPTION ===
            if (command === 'internal-memory' || (args && args.includes('memory-service'))) {
                 logMcpOperation('info', '🧠 Using in-process Memory service', {
                    operation: 'connect',
                    serverId: id,
                    inProcess: true,
                })

                try {
                    const memoryService = MemoryService.getInstance()
                    memoryService.initialize()

                    inProcessMemoryConnections.add(id)

                    logMcpOperation('info', 'In-process Memory connected successfully', {
                        operation: 'connect',
                        serverId: id,
                        duration: Date.now() - startTime,
                        inProcess: true,
                    })

                    return { success: true, serverId: id, inProcess: true }
                } catch (error) {
                     logMcpOperation('error', 'In-process Memory failed to initialize', {
                        operation: 'connect',
                        serverId: id,
                        error: error instanceof Error ? error.message : String(error),
                    })
                    return { success: false, error: 'Failed to initialize Memory Service' }
                }
            }

            // === FILESYSTEM IN-PROCESS INTERCEPTION ===
            if (command === 'internal-filesystem' || (args && args.includes('filesystem-service'))) {
                 logMcpOperation('info', '📁 Using in-process Filesystem service', {
                    operation: 'connect',
                    serverId: id,
                    inProcess: true,
                })

                inProcessFilesystemConnections.add(id)

                logMcpOperation('info', 'In-process Filesystem connected successfully', {
                    operation: 'connect',
                    serverId: id,
                    duration: Date.now() - startTime,
                    inProcess: true,
                })

                return { success: true, serverId: id, inProcess: true }
            }

            let transport: StdioClientTransport | SSEClientTransport

            if (type === 'stdio') {
                let finalCommand = command
                
                // Validate MCP command (warn about non-standard commands)
                const KNOWN_MCP_COMMANDS = ['node', 'node.exe', 'npx', 'npx.exe', 'python', 'python3',
                    'python.exe', 'uvx', 'uv', 'deno', 'bun', 'docker']
                const basename = require('path').basename(command)
                if (!KNOWN_MCP_COMMANDS.includes(basename)) {
                    logMcpOperation('warn', `Non-standard MCP command: "${command}". If this is intentional, consider adding it to the known commands list.`, {
                        operation: 'connect',
                        serverId: id,
                        command: basename,
                    })
                }
                
                // C-04 Security Fix: Only pass safe environment variables to MCP servers
                // This prevents leakage of sensitive credentials (API keys, tokens, secrets)
                // that may be stored in environment variables like:
                // - AWS_SECRET_ACCESS_KEY, AWS_ACCESS_KEY_ID
                // - OPENAI_API_KEY, ANTHROPIC_API_KEY
                // - DATABASE_URL, DATABASE_PASSWORD
                // - SSH keys, auth tokens, etc.
                // 
                // We only pass system-level variables needed for basic functionality.
                // User-provided env vars from MCP config are still passed via the 'env' parameter.
                const SAFE_ENV_KEYS = [
                    'PATH',              // Required for command execution
                    'HOME', 'USER',      // User context
                    'LANG', 'LC_ALL',    // Locale settings
                    'NODE_ENV',          // Development/production flag
                    'TMPDIR', 'TEMP', 'TMP',  // Temporary directories
                    'SHELL',             // Shell executable
                    'ELECTRON_RUN_AS_NODE',   // Electron internal
                    'XDG_DATA_HOME', 'XDG_CONFIG_HOME'  // Linux config paths
                ]
                
                const safeEnv: Record<string, string> = {}
                for (const key of SAFE_ENV_KEYS) {
                    if (process.env[key]) safeEnv[key] = process.env[key]!
                }
                const finalEnv = { ...safeEnv, ...(env || {}) } as Record<string, string>

                // Fallback to internal Node.js if 'node' is requested
                if (command === 'node' || command === 'node.exe') {
                    logMcpOperation('info', 'Using Electron internal Node.js runtime', {
                        operation: 'connect',
                        serverId: id,
                        originalCommand: command,
                    })
                    finalCommand = process.execPath
                    finalEnv.ELECTRON_RUN_AS_NODE = '1'
                }

                logMcpOperation('info', 'Starting STDIO transport', {
                    operation: 'connect',
                    serverId: id,
                    command: finalCommand,
                    args: args?.join(' '),
                })

                // Create transport with better error handling
                transport = new StdioClientTransport({
                    command: finalCommand,
                    args: args || [],
                    env: finalEnv,
                    stderr: 'pipe' // Capture stderr to monitor for errors
                })

                // Monitor the underlying process for crashes
                const transportAny = transport as any
                if (transportAny.process) {
                    const process = transportAny.process as ChildProcess
                    activeProcesses.set(id, process)

                    // Monitor process exit
                    process.on('exit', (code, signal) => {
                        logMcpOperation('warn', 'MCP server process exited', {
                            operation: 'process-monitor',
                            serverId: id,
                            exitCode: code,
                            signal: signal || undefined,
                        })

                        // Clean up connection if process exits unexpectedly
                        if (code !== 0 && code !== null) {
                            cleanupClosedConnection(id)
                        }
                    })

                    // Monitor process errors
                    process.on('error', (error) => {
                        logMcpOperation('error', 'MCP server process error', {
                            operation: 'process-monitor',
                            serverId: id,
                            error: error.message,
                        })
                        cleanupClosedConnection(id)
                    })

                    // Monitor stderr for server errors
                    if (process.stderr) {
                        let stderrBuffer = ''
                        process.stderr.on('data', (data: Buffer) => {
                            stderrBuffer += data.toString()
                            // Log stderr for debugging
                            const stderrStr = data.toString().trim()
                            if (stderrStr) {
                                logMcpOperation('info', 'MCP server stderr', {
                                    operation: 'process-monitor',
                                    serverId: id,
                                    stderr: stderrStr,
                                })
                            }
                        })
                    }
                }
            } else if (type === 'sse' && url) {
                logMcpOperation('info', 'Starting SSE transport', {
                    operation: 'connect',
                    serverId: id,
                    url,
                })
                transport = new SSEClientTransport(new URL(url))
            } else {
                throw new Error(`Unsupported transport type: ${type}`)
            }

            const client = new Client({
                name: "AI-Worker-Client",
                version: "0.1.0",
            }, {
                capabilities: {
                    sampling: {},
                }
            })

            await client.connect(transport)
            const duration = Date.now() - startTime

            logMcpOperation('info', 'MCP server connected successfully', {
                operation: 'connect',
                serverId: id,
                type,
                duration,
            })

            activeConnections.set(id, client)
            return { success: true, serverId: id }
        } catch (error) {
            const duration = Date.now() - startTime
            const errorMessage = error instanceof Error ? error.message : String(error)

            logMcpOperation('error', 'MCP connection failed', {
                operation: 'connect',
                serverId: id,
                type,
                error: errorMessage,
                duration,
                command,
                args: args?.join(' '),
            })

            let detailedError = errorMessage
            if (errorMessage.includes('ENOENT')) {
                detailedError = getInstallInstructions(command, args)
            }

            // Clean up if connection failed
            cleanupClosedConnection(id)
            return { success: false, error: detailedError }
        }
    })

    ipcMain.handle('mcp:disconnect', async (_event, serverId: string) => {
        const startTime = Date.now()

        logMcpOperation('info', 'MCP disconnection requested', {
            operation: 'disconnect',
            serverId,
        })

        // Handle in-process Playwright disconnections
        if (inProcessPlaywrightConnections.has(serverId)) {
            inProcessPlaywrightConnections.delete(serverId)
            // Note: We don't close the PlaywrightService here - it's a singleton that persists
            // across connections for performance. It will be closed on app shutdown.
            logMcpOperation('info', 'In-process Playwright disconnected', {
                operation: 'disconnect',
                serverId,
                duration: Date.now() - startTime,
                inProcess: true,
            })
            return { success: true }
        }

        // Handle in-process Memory disconnections
        if (inProcessMemoryConnections.has(serverId)) {
            inProcessMemoryConnections.delete(serverId)
            logMcpOperation('info', 'In-process Memory disconnected', {
                operation: 'disconnect',
                serverId,
                duration: Date.now() - startTime,
                inProcess: true,
            })
            return { success: true }
        }

        // Handle in-process Filesystem disconnections
        if (inProcessFilesystemConnections.has(serverId)) {
            inProcessFilesystemConnections.delete(serverId)
            logMcpOperation('info', 'In-process Filesystem disconnected', {
                operation: 'disconnect',
                serverId,
                duration: Date.now() - startTime,
                inProcess: true,
            })
            return { success: true }
        }

        const client = activeConnections.get(serverId)
        if (client) {
            try {
                await client.close()
                cleanupClosedConnection(serverId)
                const duration = Date.now() - startTime

                logMcpOperation('info', 'MCP server disconnected successfully', {
                    operation: 'disconnect',
                    serverId,
                    duration,
                })

                return { success: true }
            } catch (error) {
                const duration = Date.now() - startTime
                const errorMessage = error instanceof Error ? error.message : String(error)

                logMcpOperation('error', 'MCP disconnection failed', {
                    operation: 'disconnect',
                    serverId,
                    error: errorMessage,
                    duration,
                })

                // Still clean up even if close failed
                cleanupClosedConnection(serverId)

                return { success: false, error: errorMessage }
            }
        }

        logMcpOperation('warn', 'MCP server not found for disconnection', {
            operation: 'disconnect',
            serverId,
            duration: Date.now() - startTime,
        })

        return { success: true }
    })

    ipcMain.handle('mcp:list-tools', async (_event, serverId: string) => {
        const startTime = Date.now()

        logMcpOperation('info', 'MCP list tools requested', {
            operation: 'list-tools',
            serverId,
        })

        // Handle in-process Playwright connections
        if (inProcessPlaywrightConnections.has(serverId)) {
            const playwrightService = PlaywrightService.getInstance()
            const result = playwrightService.listTools()
            logMcpOperation('info', 'In-process Playwright tools listed', {
                operation: 'list-tools',
                serverId,
                toolCount: result.tools.length,
                inProcess: true,
            })
            return { tools: result.tools }
        }

        // Handle in-process Memory connections
        if (inProcessMemoryConnections.has(serverId)) {
            const memoryService = MemoryService.getInstance()
            const result = memoryService.listTools()
            logMcpOperation('info', 'In-process Memory tools listed', {
                operation: 'list-tools',
                serverId,
                toolCount: result.tools.length,
                inProcess: true,
            })
            return { tools: result.tools }
        }

        // Handle in-process Filesystem connections
        if (inProcessFilesystemConnections.has(serverId)) {
            const fsService = FileSystemService.getInstance()
            const result = fsService.listTools()
            logMcpOperation('info', 'In-process Filesystem tools listed', {
                operation: 'list-tools',
                serverId,
                toolCount: result.tools.length,
                inProcess: true,
            })
            return { tools: result.tools }
        }

        const client = activeConnections.get(serverId)
        if (!client) {
            logMcpOperation('warn', 'MCP server not connected for list-tools', {
                operation: 'list-tools',
                serverId,
                duration: Date.now() - startTime,
            })
            return { tools: [], error: 'Server not connected' }
        }

        try {
            const result = await client.listTools()
            const duration = Date.now() - startTime
            const toolCount = result.tools?.length || 0
            const toolNames = result.tools?.map((t: { name: string }) => t.name) || []

            // Some servers (like sequential-thinking) may not expose traditional tools
            // but still function as reasoning/prompting servers
            if (toolCount === 0) {
                logMcpOperation('info', 'MCP server has no tools (may be a reasoning server)', {
                    operation: 'list-tools',
                    serverId,
                    toolCount: 0,
                    note: 'Some MCP servers work differently and may not expose tools',
                    duration,
                })
            } else {
                logMcpOperation('info', 'MCP tools listed successfully', {
                    operation: 'list-tools',
                    serverId,
                    toolCount,
                    toolNames,
                    duration,
                })
            }

            return { tools: result.tools || [] }
        } catch (error) {
            const duration = Date.now() - startTime
            const errorMessage = error instanceof Error ? error.message : String(error)

            // Check for connection closed error
            if (isConnectionClosedError(errorMessage)) {
                logMcpOperation('warn', 'MCP connection closed unexpectedly, cleaning up', {
                    operation: 'list-tools',
                    serverId,
                    error: errorMessage,
                    duration,
                })

                cleanupClosedConnection(serverId)
            } else {
                logMcpOperation('error', 'MCP list tools failed', {
                    operation: 'list-tools',
                    serverId,
                    error: errorMessage,
                    duration,
                })
            }

            return { tools: [], error: errorMessage }
        }
    })

    ipcMain.handle('mcp:call-tool', async (_event, serverId: string, toolName: string, args: unknown) => {
        const startTime = Date.now()
        const sanitizedArgs = sanitizeArgs(args)

        logMcpOperation('info', 'MCP tool call initiated', {
            operation: 'call-tool',
            serverId,
            toolName,
            args: sanitizedArgs,
            argsSize: JSON.stringify(args).length,
        })

        // Handle in-process Playwright connections
        if (inProcessPlaywrightConnections.has(serverId)) {
            const playwrightService = PlaywrightService.getInstance()
            const result = await playwrightService.callTool(toolName, args)
            const duration = Date.now() - startTime

            logMcpOperation('info', 'In-process Playwright tool call completed', {
                operation: 'call-tool',
                serverId,
                toolName,
                duration,
                hasError: !!result.error,
                inProcess: true,
            })

            if (result.error) {
                return { result: null, error: result.error }
            }

            // Format result to match MCP response structure
            return {
                result: {
                    content: [{ type: 'text', text: typeof result.result === 'string' ? result.result : JSON.stringify(result.result) }]
                }
            }
        }

        // Handle in-process Memory connections
        if (inProcessMemoryConnections.has(serverId)) {
             const memoryService = MemoryService.getInstance()
             const result = await memoryService.callTool(toolName, args)
             const duration = Date.now() - startTime

            logMcpOperation('info', 'In-process Memory tool call completed', {
                operation: 'call-tool',
                serverId,
                toolName,
                duration,
                hasError: !!result.error,
                inProcess: true,
            })

            if (result.error) {
                return { result: null, error: result.error }
            }

            return {
                result: {
                    content: [{ type: 'text', text: typeof result.result === 'string' ? result.result : JSON.stringify(result.result) }]
                }
            }
        }

        // Handle in-process Filesystem connections
        if (inProcessFilesystemConnections.has(serverId)) {
             const fsService = FileSystemService.getInstance()
             const result = await fsService.callTool(toolName, args)
             const duration = Date.now() - startTime

            logMcpOperation('info', 'In-process Filesystem tool call completed', {
                operation: 'call-tool',
                serverId,
                toolName,
                duration,
                hasError: !!result.error,
                inProcess: true,
            })

            if (result.error) {
                return { result: null, error: result.error }
            }

            return {
                result: {
                    content: [{ type: 'text', text: typeof result.result === 'string' ? result.result : JSON.stringify(result.result) }]
                }
            }
        }

        const client = activeConnections.get(serverId)
        if (!client) {
            logMcpOperation('error', 'MCP server not connected for tool call', {
                operation: 'call-tool',
                serverId,
                toolName,
                duration: Date.now() - startTime,
            })
            return { result: null, error: 'Server not connected' }
        }

        try {
            // Final defensive check to ensure arguments are a record
            const finalArgs = (args && typeof args === 'object' && !Array.isArray(args)) 
                ? (args as Record<string, unknown>) 
                : (typeof args === 'string' ? { input: args } : { value: args });

            const result = await client.callTool({
                name: toolName,
                arguments: finalArgs || {}
            })

            const duration = Date.now() - startTime
            const resultStr = JSON.stringify(result)
            const resultSize = resultStr.length
            const resultPreview = resultStr.substring(0, 200)

            logMcpOperation('info', 'MCP tool call completed successfully', {
                operation: 'call-tool',
                serverId,
                toolName,
                duration,
                resultSize,
                resultPreview: resultPreview + (resultSize > 200 ? '...' : ''),
                hasError: false,
            })

            return { result }
        } catch (error) {
            const duration = Date.now() - startTime
            const errorMessage = error instanceof Error ? error.message : String(error)

            // Check for connection closed error
            if (isConnectionClosedError(errorMessage)) {
                logMcpOperation('warn', 'MCP connection closed unexpectedly during tool call, cleaning up', {
                    operation: 'call-tool',
                    serverId,
                    toolName,
                    error: errorMessage,
                    duration,
                    hasError: true,
                })

                cleanupClosedConnection(serverId)
            } else {
                logMcpOperation('error', 'MCP tool call failed', {
                    operation: 'call-tool',
                    serverId,
                    toolName,
                    args: sanitizedArgs,
                    error: errorMessage,
                    duration,
                    hasError: true,
                })
            }

            return { result: null, error: errorMessage }
        }
    })
}

function getInstallInstructions(cmd: string, args?: string[]): string {
    const isMac = process.platform === 'darwin'
    const isWin = process.platform === 'win32'

    const header = `### 🛠️ Environment Setup Needed\n\nIt looks like the command \`${cmd}\` isn't available on your system yet. Don't worry, you can fix this in a few steps:`
    const internalNodeTip = "\n\n💡 **Pro Tip:** This app has a built-in Node.js runtime. If you have a local script, you can simply use \`node\` as the command and it will work immediately!"

    if (cmd.includes('node') || cmd.includes('npx') || cmd.includes('npm')) {
        let steps = ""
        if (isMac) steps = "1. Open your **Terminal** app.\n2. Type \`brew install node\` and press Enter.\n3. *If you don't have Homebrew, download Node.js from [nodejs.org](https://nodejs.org).* "
        else if (isWin) steps = "1. Download and run the installer from [nodejs.org](https://nodejs.org).\n2. Follow the setup wizard and make sure 'Add to PATH' is checked.\n3. Restart the AI-Worker app once finished."
        else steps = "1. Install Node.js using your system's package manager (e.g., \`sudo apt install nodejs\`)."

        return `${header}\n\n${steps}${internalNodeTip}`
    }
    if (cmd.includes('python') || cmd.includes('pip')) {
        let steps = ""
        if (isMac) steps = "1. Open your **Terminal** app.\n2. Type \`brew install python\` and press Enter.\n3. **Note:** Try using \`python3\` as the command in settings if \`python\` fails."
        else if (isWin) steps = "1. Download Python from [python.org](https://www.python.org/downloads/).\n2. **Important:** Check the box that says 'Add Python to PATH' during installation."
        else steps = "1. Install Python 3 using your system's package manager (e.g., \`sudo apt install python3\`)."

        if (args?.some(a => a.includes('mcp-server-git') || a.includes('mcp_server_git'))) {
            steps += `\n\n4. Finally, install the Git tool by running: \`pip install mcp-server-git\``
        }

        return `${header}\n\n${steps}`
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
