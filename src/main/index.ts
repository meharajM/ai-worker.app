import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import fixPath from 'fix-path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Fix PATH for macOS/Linux GUI apps so they can find node/npx/python
fixPath()

// Store active MCP clients
// Map<serverId, Client>
const activeConnections = new Map<string, Client>()

// IPC Handlers
function setupIpcHandlers(): void {
    // Shell operations
    ipcMain.handle('shell:open-external', async (_event, url: string) => {
        await shell.openExternal(url)
    })

    // App info
    ipcMain.handle('app:get-version', () => app.getVersion())
    ipcMain.handle('app:get-name', () => app.getName())

    // MCP operations
    ipcMain.handle('mcp:connect', async (_event, serverConfig) => {
        console.log('MCP connect requested:', serverConfig)
        const { id, type, command, args, url } = serverConfig

        try {
            if (activeConnections.has(id)) {
                console.log(`MCP server ${id} already connected`)
                return { success: true, serverId: id }
            }

            let transport: StdioClientTransport | SSEClientTransport

            if (type === 'stdio') {
                let finalCommand = command
                const finalEnv = { ...process.env } as Record<string, string>

                // Fallback to internal Node.js if 'node' is requested
                if (command === 'node' || command === 'node.exe') {
                    console.log('Using Electron internal Node.js runtime')
                    finalCommand = process.execPath
                    finalEnv.ELECTRON_RUN_AS_NODE = '1'
                }

                console.log(`Starting STDIO transport: ${finalCommand} ${args?.join(' ')}`)

                transport = new StdioClientTransport({
                    command: finalCommand,
                    args: args || [],
                    env: finalEnv,
                    stderr: 'inherit'
                })
            } else if (type === 'sse' && url) {
                console.log(`Starting SSE transport: ${url}`)
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
            console.log(`MCP server ${id} connected successfully`)

            activeConnections.set(id, client)
            return { success: true, serverId: id }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            console.error(`MCP connection error for ${id}:`, error)

            let detailedError = errorMessage
            if (errorMessage.includes('ENOENT')) {
                const getInstallInstructions = (cmd: string) => {
                    const isMac = process.platform === 'darwin'
                    const isWin = process.platform === 'win32'

                    const header = `### 🛠️ Environment Setup Needed\n\nIt looks like the command \`${cmd}\` isn't available on your system yet. Don't worry, you can fix this in a few steps:`
                    const internalNodeTip = "\n\n💡 **Pro Tip:** This app has a built-in Node.js runtime. If you have a local script, you can simply use `node` as the command and it will work immediately!"

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

                detailedError = getInstallInstructions(command)
            }

            // Clean up if connection failed
            if (activeConnections.has(id)) {
                try {
                    await activeConnections.get(id)?.close()
                    activeConnections.delete(id)
                } catch (e) { /* ignore */ }
            }
            return { success: false, error: detailedError }
        }
    })

    ipcMain.handle('mcp:disconnect', async (_event, serverId: string) => {
        console.log('MCP disconnect requested:', serverId)
        const client = activeConnections.get(serverId)
        if (client) {
            try {
                await client.close()
                activeConnections.delete(serverId)
                console.log(`MCP server ${serverId} disconnected`)
                return { success: true }
            } catch (error) {
                console.error(`Error disconnecting ${serverId}:`, error)
                return { success: false, error: error instanceof Error ? error.message : String(error) }
            }
        }
        return { success: true } // Already disconnected
    })

    ipcMain.handle('mcp:list-tools', async (_event, serverId: string) => {
        console.log('MCP list tools requested:', serverId)
        const client = activeConnections.get(serverId)
        if (!client) {
            return { tools: [], error: 'Server not connected' }
        }

        try {
            const result = await client.listTools()
            return { tools: result.tools }
        } catch (error) {
            console.error(`Error listing tools for ${serverId}:`, error)
            return { tools: [], error: error instanceof Error ? error.message : String(error) }
        }
    })

    ipcMain.handle('mcp:call-tool', async (_event, serverId: string, toolName: string, args: unknown) => {
        console.log('MCP call tool requested:', { serverId, toolName })
        const client = activeConnections.get(serverId)
        if (!client) {
            return { result: null, error: 'Server not connected' }
        }

        try {
            const result = await client.callTool({
                name: toolName,
                arguments: args as Record<string, unknown>
            })
            return { result }
        } catch (error) {
            console.error(`Error calling tool ${toolName} on ${serverId}:`, error)
            return { result: null, error: error instanceof Error ? error.message : String(error) }
        }
    })

    // LLM operations (placeholder - renderer handles this via fetch for now)
    ipcMain.handle('llm:chat', async (_event, messages, tools) => {
        console.log('LLM chat requested:', { messageCount: messages?.length, toolCount: tools?.length })
        // TODO: Add main process LLM handling if needed
        return { error: 'Use renderer LLM for now' }
    })

    ipcMain.handle('llm:get-providers', async () => {
        // TODO: Check providers from main process
        return {
            ollama: { available: false },
            openai: { available: false },
            browser: { available: false },
        }
    })

    // Storage operations using simple file storage
    const storage: Map<string, unknown> = new Map()

    ipcMain.handle('store:get', (_event, key: string) => {
        return storage.get(key)
    })

    ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
        storage.set(key, value)
        return true
    })

    ipcMain.handle('store:delete', (_event, key: string) => {
        return storage.delete(key)
    })
}

function createWindow(): void {
    const mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 15, y: 15 },
        backgroundColor: '#0f1115',
        webPreferences: {
            preload: join(__dirname, '../preload/index.mjs'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            // Allow web audio for TTS
            webSecurity: true,
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
        if (is.dev) {
            mainWindow.webContents.openDevTools()
        }
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // Enable audio permissions for TTS/STT
    mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications', 'midi', 'midiSysex']
        if (allowedPermissions.includes(permission)) {
            callback(true)
        } else {
            callback(false)
        }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.aiworker.app')

    // Setup IPC handlers before creating window
    setupIpcHandlers()

    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// Handle certificate errors for local development
app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
    if (is.dev) {
        event.preventDefault()
        callback(true)
    } else {
        callback(false)
    }
})
