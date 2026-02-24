import { exec } from 'child_process'
import { promisify } from 'util'
import { app, shell } from 'electron'

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
        results.push(await this.checkCommand('python3', '--version', true))

        // Check uv (Required for uvx)
        results.push(await this.checkCommand('uv', '--version', true))

        return results
    }

    private async checkCommand(cmd: string, versionFlag: string, required: boolean): Promise<DependencyCheckResult> {
        try {
            const { stdout } = await execAsync(`${cmd} ${versionFlag}`)
            // Parse version simplistically
            const version = stdout.split('\n')[0].trim()
            const { stdout: path } = await execAsync(`which ${cmd}`)

            return {
                name: cmd,
                installed: true,
                version,
                path: path.trim(),
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
            const psScriptPath = scriptPath.replace('.sh', '.ps1')
            require('child_process').exec(`start powershell.exe -ExecutionPolicy Bypass -File "${psScriptPath}"`)
        } else {
            // Linux fallback 
            shell.showItemInFolder(scriptPath)
        }
    }
}
import * as path from 'path'
