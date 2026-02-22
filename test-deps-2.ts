import { exec } from 'child_process'
import { promisify } from 'util'
import fixPath from 'fix-path'

fixPath()

const execAsync = promisify(exec)

async function checkCommand(cmd: string, versionFlag: string) {
    try {
        const { stdout } = await execAsync(`${cmd} ${versionFlag}`)
        const version = stdout.split('\n')[0].trim()
        console.log(`✅ ${cmd} is installed`)
    } catch (error: any) {
        console.log(`❌ ${cmd} is missing: ${error.message}`)
    }
}

async function run() {
    await checkCommand('ffmpeg', '-version')
    await checkCommand('python3', '--version')
    await checkCommand('uv', '--version')
}

run()
