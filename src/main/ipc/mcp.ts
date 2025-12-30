import { ipcMain } from 'electron'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Store active MCP clients
const activeConnections = new Map<string, Client>()

export function registerMcpHandlers(): void {
    ipcMain.handle('mcp:connect', async (event, serverConfig) => {
        console.log('MCP connect requested:', serverConfig)
        const { id, type, command, args, url } = serverConfig

        const reportStatus = (status: string) => {
            event.sender.send('mcp:status-update', { serverId: id, status })
        }

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
                } else if (command) {
                    reportStatus(`Checking for ${command}...`)
                    // Check if command exists and try to install if missing (Mac/Win)
                    const exists = await commandExists(command)
                    if (!exists) {
                        reportStatus(`Installing ${command}...`)
                        const installResult = await attemptInstall(command, reportStatus)
                        if (!installResult.success) {
                            return {
                                success: false,
                                error: getInstallInstructions(command, args, installResult.message)
                            }
                        }

                        // After success, wait a moment and refresh PATH to see the new tool
                        reportStatus('Refreshing environment...')
                        await new Promise(r => setTimeout(r, 2000))
                        await refreshEnv()
                    }
                }

                reportStatus(`Starting ${command}...`)
                console.log(`Starting STDIO transport: ${finalCommand} ${args?.join(' ')}`)

                transport = new StdioClientTransport({
                    command: finalCommand,
                    args: args || [],
                    env: finalEnv,
                    stderr: 'inherit'
                })
            } else if (type === 'sse' && url) {
                reportStatus(`Connecting to ${url}...`)
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
            reportStatus('') // Clear status on success

            activeConnections.set(id, client)
            return { success: true, serverId: id }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            console.error(`MCP connection error for ${id}:`, error)
            reportStatus('') // Clear status on error

            let detailedError = errorMessage
            if (errorMessage.includes('ENOENT')) {
                detailedError = getInstallInstructions(command, args)
            } else if (type === 'sse' && (errorMessage.includes('fetch') || errorMessage.includes('404') || errorMessage.includes('500'))) {
                detailedError = `### 🌐 Connection Failed\n\nFailed to connect to the SSE server at \`${url}\`.\n\n**Troubleshooting:**\n1. Check if the server is actually running.\n2. Verify the URL is correct.\n3. Check your network or VPN settings.`
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
        const client = activeConnections.get(serverId)
        if (client) {
            try {
                await client.close()
                activeConnections.delete(serverId)
                return { success: true }
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) }
            }
        }
        return { success: true }
    })

    ipcMain.handle('mcp:list-tools', async (_event, serverId: string) => {
        const client = activeConnections.get(serverId)
        if (!client) return { tools: [], error: 'Server not connected' }

        try {
            const result = await client.listTools()
            return { tools: result.tools }
        } catch (error) {
            return { tools: [], error: error instanceof Error ? error.message : String(error) }
        }
    })

    ipcMain.handle('mcp:call-tool', async (_event, serverId: string, toolName: string, args: unknown) => {
        const client = activeConnections.get(serverId)
        if (!client) return { result: null, error: 'Server not connected' }

        try {
            const result = await client.callTool({
                name: toolName,
                arguments: args as Record<string, unknown>
            })
            return { result }
        } catch (error) {
            return { result: null, error: error instanceof Error ? error.message : String(error) }
        }
    })
}

async function commandExists(cmd: string): Promise<boolean> {
    try {
        const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`
        await execAsync(checkCmd)
        return true
    } catch {
        return false
    }
}

async function refreshEnv(): Promise<void> {
    const { initEnv } = await import('../utils/env')
    initEnv()
}

async function attemptInstall(cmd: string, reportStatus?: (s: string) => void): Promise<{ success: boolean; message?: string }> {
    const platform = process.platform
    const isMac = platform === 'darwin'
    const isWin = platform === 'win32'

    // Only attempt auto-install on Mac, Windows, and Linux
    if (!isMac && !isWin && process.platform !== 'linux') return { success: false }

    console.log(`Attempting to auto-install ${cmd}...`)

    try {
        if (isMac) {
            reportStatus?.('Checking for Homebrew...')
            // Check for Homebrew
            try { await execAsync('which brew') } catch { return { success: false, message: "Homebrew is required for automatic installation." } }

            const installCmd = (pkg: string) => `brew install ${pkg}`

            if (cmd === 'node' || cmd === 'npx' || cmd === 'npm') {
                reportStatus?.('Installing Node.js via Homebrew...')
                await execAsync(installCmd('node'))
                return { success: true }
            }
            if (cmd === 'python' || cmd === 'python3' || cmd === 'pip') {
                reportStatus?.('Installing Python via Homebrew...')
                await execAsync(installCmd('python'))
                return { success: true }
            }
            if (cmd === 'uv' || cmd === 'uvx') {
                reportStatus?.('Installing UV via Homebrew...')
                await execAsync(installCmd('uv'))
                return { success: true }
            }
            if (cmd === 'docker') {
                reportStatus?.('Installing Docker Desktop (Cask)...')
                await execAsync('brew install --cask docker')
                return { success: true, message: "Docker Desktop installed. Please open it from Applications to start the engine." }
            }
        } else if (isWin) {
            reportStatus?.('Checking for winget...')
            // Check for winget
            try { await execAsync('winget --version') } catch { return { success: false, message: "winget is required for automatic installation." } }

            let packageId = ""
            if (cmd === 'node' || cmd === 'npx' || cmd === 'npm') packageId = 'OpenJS.NodeJS'
            else if (cmd === 'python' || cmd === 'python3' || cmd === 'pip') packageId = 'Python.Python.3'
            else if (cmd === 'uv' || cmd === 'uvx') packageId = 'astral-sh.uv'
            else if (cmd === 'docker') packageId = 'Docker.DockerDesktop'

            if (packageId) {
                reportStatus?.(`Installing ${packageId} via winget...`)
                await execAsync(`winget install --id ${packageId} --silent --accept-source-agreements --accept-package-agreements`)
                return { success: true }
            }
        } else if (process.platform === 'linux') {
            reportStatus?.('Checking package manager...')

            // Detect package manager
            let pkgManager = ''
            let installCmd = ''

            try {
                await execAsync('which apt-get')
                pkgManager = 'apt-get'
                installCmd = 'pkexec apt-get install -y'
            } catch {
                try {
                    await execAsync('which dnf')
                    pkgManager = 'dnf'
                    installCmd = 'pkexec dnf install -y'
                } catch {
                    try {
                        await execAsync('which pacman')
                        pkgManager = 'pacman'
                        installCmd = 'pkexec pacman -S --noconfirm'
                    } catch {
                        return { success: false, message: "No supported package manager found (apt, dnf, pacman)." }
                    }
                }
            }

            // Note: pkexec is used to prompt for password graphically if needed

            if (cmd === 'node' || cmd === 'npx' || cmd === 'npm') {
                reportStatus?.(`Installing Node.js via ${pkgManager}...`)
                await execAsync(`${installCmd} nodejs npm`)
                return { success: true }
            }
            if (cmd === 'python' || cmd === 'python3' || cmd === 'pip') {
                reportStatus?.(`Installing Python via ${pkgManager}...`)
                await execAsync(`${installCmd} python3 python3-pip`)
                return { success: true }
            }
            if (cmd === 'uv' || cmd === 'uvx') {
                reportStatus?.('Installing UV via script...')
                // UV is best installed via script on Linux too
                await execAsync('curl -LsSf https://astral.sh/uv/install.sh | sh')
                return { success: true }
            }
            if (cmd === 'docker') {
                // Docker is complex on Linux, best to stick to manual instructions or simple package
                if (pkgManager === 'apt-get') {
                    reportStatus?.('Installing Docker via apt...')
                    await execAsync(`${installCmd} docker.io`)
                    // Attempt to add user to docker group (might fail if no sudo)
                    try { await execAsync('pkexec usermod -aG docker $USER') } catch { }
                    return { success: true, message: "Docker installed. You may need to log out and back in for group changes to take effect." }
                }
                return { success: false, message: "Automatic Docker installation is only supported on Debian/Ubuntu via apt-get currently." }
            }
        }
    } catch (error) {
        console.error(`Failed to install ${cmd}:`, error)
        return { success: false, message: error instanceof Error ? error.message : String(error) }
    }

    return { success: false }
}

function getInstallInstructions(cmd: string, args?: string[], autoInstallError?: string): string {
    const isMac = process.platform === 'darwin'
    const isWin = process.platform === 'win32'

    let errorContext = ""
    if (autoInstallError) {
        errorContext = `\n\n> **Note:** We tried to install this for you automatically, but it failed: *${autoInstallError}*`

        if (isWin) {
            errorContext += `\n> **Tip:** Try restarting the app as **Administrator** and connecting again.`
        } else if (isMac) {
            errorContext += `\n> **Tip:** Homebrew cannot be run as root (sudo). Please run the manual installation command in your Terminal.`
        }
    }

    const header = `### 🛠️ Environment Setup Needed\n\nIt looks like \`${cmd}\` isn't available on your system.${errorContext}\n\nPlease follow these steps to set it up:`

    // Node.js / npx
    if (cmd.includes('node') || cmd.includes('npx') || cmd.includes('npm')) {
        let steps = ""
        if (isMac) steps = "1. Open **Terminal**.\n2. Run \`brew install node\`.\n3. Or download from [nodejs.org](https://nodejs.org)."
        else if (isWin) steps = "1. Download the installer from [nodejs.org](https://nodejs.org).\n2. Run it and ensure 'Add to PATH' is checked.\n3. Restart the app."
        else steps = "1. Install Node.js via your package manager (e.g., \`sudo apt install nodejs npm\`)."

        return `${header}\n\n${steps}`
    }

    // Python
    if (cmd.includes('python') || cmd.includes('pip')) {
        let steps = ""
        if (isMac) steps = "1. Open **Terminal**.\n2. Run \`brew install python\`.\n3. Try using \`python3\` as the command if \`python\` fails."
        else if (isWin) steps = "1. Download from [python.org](https://www.python.org/downloads/).\n2. **Important:** Check 'Add Python to PATH' during installation."
        else steps = "1. Install Python 3 (e.g., \`sudo apt install python3 python3-pip\`)."

        if (args?.some(a => a.includes('mcp-server-git'))) {
            steps += `\n4. Then run: \`pip install mcp-server-git\``
        }
        return `${header}\n\n${steps}`
    }

    // UV / UVX
    if (cmd.includes('uv')) {
        let steps = ""
        if (isWin) steps = "1. Run in PowerShell:\n\`powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\"\`"
        else steps = "1. Run in Terminal:\n\`curl -LsSf https://astral.sh/uv/install.sh | sh\`"

        steps += "\n2. Restart the app to apply changes."
        return `${header}\n\n${steps}`
    }

    // Docker
    if (cmd.includes('docker')) {
        let steps = ""
        if (isMac || isWin) steps = "1. Download and install **Docker Desktop** from [docker.com](https://www.docker.com/products/docker-desktop/).\n2. Ensure Docker is running before connecting."
        else steps = "1. Install Docker: \`sudo apt install docker.io\`\n2. Add your user to the docker group: \`sudo usermod -aG docker $USER\`"

        return `${header}\n\n${steps}`
    }

    return `${header}\n\nEnsure that \`${cmd}\` is installed and added to your system's PATH. If you just installed it, you may need to restart this application.`
}
