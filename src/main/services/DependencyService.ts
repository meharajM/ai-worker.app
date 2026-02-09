import { exec } from 'child_process'
import { promisify } from 'util'
import { app, dialog, shell } from 'electron'

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

    private constructor() {}

    static getInstance(): DependencyService {
        if (!DependencyService.instance) {
            DependencyService.instance = new DependencyService()
        }
        return DependencyService.instance
    }

    async checkDependencies(): Promise<DependencyCheckResult[]> {
        const results: DependencyCheckResult[] = []

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

    async showMissingDependencyDialog(missing: DependencyCheckResult[]) {
        if (missing.length === 0) return

        const missingNames = missing.map(d => d.name).join(', ')
        const { response } = await dialog.showMessageBox({
            type: 'warning',
            title: 'Missing Dependencies',
            message: `Some required tools are missing: ${missingNames}`,
            detail: 'These are needed for full functionality (e.g. converting audio, running local AI tools).\n\nWe have a setup script that can install them for you automatically.',
            buttons: ['Run Setup Script', 'Ignore'],
            defaultId: 0,
            cancelId: 1
        })

        if (response === 0) {
            // Determine script path
            // In dev: scripts/setup-dependencies.sh
            // In prod: likely bundled or need to instruct user to download
            const scriptPath = app.isPackaged 
                ? path.join(process.resourcesPath, 'scripts', 'setup-dependencies.sh')
                : path.join(app.getAppPath(), 'scripts', 'setup-dependencies.sh')

            
            // Open terminal with command
            // macOS
            if (process.platform === 'darwin') {
                shell.openExternal(`file://${scriptPath}`) // Simple way to open .sh but might not run it.
                // Better: Use AppleScript or Terminal.app
                 require('child_process').exec(`open -a Terminal "${scriptPath}"`)
            } else {
                 // Linux/Windows fallback - just open file location
                 shell.showItemInFolder(scriptPath)
            }
        }
    }
}
import * as path from 'path'
