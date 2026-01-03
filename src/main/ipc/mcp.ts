import { ipcMain } from 'electron'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { ChildProcess } from 'child_process'

// Store active MCP clients and their process info
const activeConnections = new Map<string, Client>()
const activeProcesses = new Map<string, ChildProcess>()

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
    const logEntry = {
        timestamp,
        level,
        message,
        ...context,
    }
    
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
        const { id, type, command, args, url } = serverConfig

        logMcpOperation('info', 'MCP connection requested', {
            operation: 'connect',
            serverId: id,
            type,
            command,
            args: args?.join(' '),
            url: type === 'sse' ? url : undefined,
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

            let transport: StdioClientTransport | SSEClientTransport

            if (type === 'stdio') {
                let finalCommand = command
                const finalEnv = { ...process.env } as Record<string, string>

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
            const result = await client.callTool({
                name: toolName,
                arguments: args as Record<string, unknown>
            })
            
            const duration = Date.now() - startTime
            const resultSize = JSON.stringify(result).length
            const resultPreview = typeof result === 'string' 
                ? result.substring(0, 200) 
                : JSON.stringify(result).substring(0, 200)
            
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
        let steps = `1. Run this command in your terminal:\n\`${installCmd}\`\n2. Restart the app.`

        if (args?.some(a => a.includes('mcp-server-git') || a.includes('mcp_server_git'))) {
            steps += `\n3. **Quick Fix:** Use \`uvx mcp-server-git /path/to/your/repo\` to run without installing.`
        }

        return `${header}\n\n${steps}`
    }

    return `${header}\n\nEnsure that \`${cmd}\` is installed and added to your system's environmental paths (PATH).`
}
