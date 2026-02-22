import { exec } from 'child_process'
import { promisify } from 'util'
import fixPath from 'fix-path'

fixPath()

const execAsync = promisify(exec)

async function checkCommand(cmd: string, versionFlag: string) {
    try {
        const { stdout: whichOut } = await execAsync(`which ${cmd}`)
        console.log(`[which ${cmd}]: ${whichOut.trim()}`)
        const { stdout: verOut } = await execAsync(`${cmd} ${versionFlag}`)
        console.log(`✅ ${cmd} is installed: ${verOut.split('\n')[0].trim()}`)
    } catch (error: any) {
        console.log(`❌ ${cmd} is missing: ${error.message}`)
    }
}

async function run() {
    console.log("Checking PATH:", process.env.PATH);
    await checkCommand('ffmpeg', '-version')
    await checkCommand('python3', '--version')
    await checkCommand('uv', '--version')
}

run()
