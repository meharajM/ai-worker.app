import { exec } from 'child_process'
import { promisify } from 'util'
import { app, shell } from 'electron'
import * as path from 'path'

const execAsync = promisify(exec)

interface DependencyCheckResult {
    name: string
    installed: boolean
    version?: string
    path?: string
    error?: string
    required: boolean
}

export class DependencyService {
    private static instance: DependencyService

    private constructor() { }

    static getInstance(): DependencyService {
        if (!DependencyService.instance) {
            DependencyService.instance = new DependencyService()
        }
        return DependencyService.instance
    }

    async checkDependencies(): Promise<DependencyCheckResult[]> {
        const results: DependencyCheckResult[] = []

        // Check Node.js ecosystem (Required for Playwright and other npx-based MCPs)
        results.push(await this.checkCommand('node', '--version', true))
        results.push(await this.checkCommand('npm', '--version', true))
        results.push(await this.checkCommand('npx', '--version', true))

        // Check ffmpeg (Critical for MarkItDown audio)
        results.push(await this.checkCommand('ffmpeg', '-version', true))

        // Check Python (Required for local MCPs)
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
        results.push(await this.checkCommand(pythonCmd, '--version', true))

        // Check uv (Required for uvx)
        results.push(await this.checkCommand('uv', '--version', true))

        // Check Playwright browsers
        results.push(await this.checkPlaywrightBrowsers())

        return results
    }

    private async checkCommand(cmd: string, versionFlag: string, required: boolean): Promise<DependencyCheckResult> {
        // Expand PATH for GUI environments (like Electron) which might not inherit full shell profiles
        const delimiter = process.platform === 'win32' ? ';' : ':'
        const extraPaths = [
            '/usr/local/bin',
            '/opt/homebrew/bin',
            `${process.env.HOME || process.env.USERPROFILE}/.cargo/bin`,
            `${process.env.HOME || process.env.USERPROFILE}/.local/bin`
        ].join(delimiter)
        
        const expandedPath = `${process.env.PATH || ''}${delimiter}${extraPaths}`
        const env = { ...process.env, PATH: expandedPath }
        
        try {
            const { stdout } = await execAsync(`${cmd} ${versionFlag}`, { env })
            // Parse version simplistically
            const version = stdout.split('\n')[0].trim()
            // In Windows, 'which' is often absent but `where` is. Since we just want the path,
            // we catch error if 'which' fails and just log cmd name
            let pathOut = cmd
            try {
                const { stdout: whichOut } = await execAsync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { env })
                pathOut = whichOut
            } catch { /* ignore */ }

            return {
                name: cmd,
                installed: true,
                version,
                path: pathOut.trim(),
                required
            }
        } catch (error) {
            return {
                name: cmd,
                installed: false,
                error: (error as Error).message,
                required
            }
        }
    }

    private async checkPlaywrightBrowsers(): Promise<DependencyCheckResult> {
        try {
            // Import playwright to evaluate executable paths natively
            const playwright = require('playwright')
            const fs = require('fs')

            const checks = [
                { name: 'chromium', path: playwright.chromium.executablePath() },
                { name: 'firefox', path: playwright.firefox.executablePath() },
                { name: 'webkit', path: playwright.webkit.executablePath() }
            ]

            const missing = checks.filter(c => !fs.existsSync(c.path))

            if (missing.length > 0) {
                return {
                    name: 'playwright-browsers',
                    installed: false,
                    error: `Missing browser binaries: ${missing.map(m => m.name).join(', ')}`,
                    required: true
                }
            }

            return {
                name: 'playwright-browsers',
                installed: true,
                version: 'installed',
                path: 'managed by playwright',
                required: true
            }
        } catch (error) {
            return {
                name: 'playwright-browsers',
                installed: false,
                error: (error as Error).message,
                required: true
            }
        }
    }

    async getMissingDependencies(): Promise<DependencyCheckResult[]> {
        const deps = await this.checkDependencies()
        return deps.filter(d => !d.installed && d.required)
    }

    async getAllDependencies(): Promise<DependencyCheckResult[]> {
        return await this.checkDependencies()
    }

    async runSetupScript() {
        const scriptPath = app.isPackaged
            ? path.join(process.resourcesPath, 'scripts', 'setup-dependencies.sh')
            : path.join(app.getAppPath(), 'scripts', 'setup-dependencies.sh')

        // Open terminal with command
        if (process.platform === 'darwin') {
            require('child_process').exec(`open -a Terminal "${scriptPath}"`)
        } else if (process.platform === 'win32') {
            const psScriptPath = scriptPath.replace(/\.sh$/, '.ps1')
            // Using spawn to avoid the complex Shell-escaping issues in children processes.
            // We launch an intermediate PowerShell to trigger Start-Process with 'RunAs' to request elevation.
            // The inner path is wrapped in double quotes, and the argument list is wrapped in single quotes.
            const args = [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command', `Start-Process PowerShell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"' -Verb RunAs`
            ]
            
            const { spawn } = require('child_process')
            const child = spawn('powershell.exe', args, {
                detached: true,
                stdio: 'ignore'
            })
            child.unref()
        } else {
            // Linux fallback 
            shell.showItemInFolder(scriptPath)
        }
    }
}
