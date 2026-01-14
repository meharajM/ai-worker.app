import { ipcMain, app } from 'electron'
import { join } from 'path'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'

const LOGS_DIR = join(app.getPath('userData'), 'logs')
const SESSIONS_DIR = join(LOGS_DIR, 'sessions')

// Ensure log directories exist
async function ensureDirs() {
    if (!existsSync(LOGS_DIR)) await fs.mkdir(LOGS_DIR, { recursive: true })
    if (!existsSync(SESSIONS_DIR)) await fs.mkdir(SESSIONS_DIR, { recursive: true })
}

export function registerLogsHandlers() {
    // Add a log entry
    ipcMain.handle('logs:add', async (_event, entry) => {
        await ensureDirs()
        const sessionFile = join(SESSIONS_DIR, `${entry.sessionId}.jsonl`)
        const line = JSON.stringify(entry) + '\n'
        await fs.appendFile(sessionFile, line, 'utf8')
        return { success: true }
    })

    // Get logs for a session
    ipcMain.handle('logs:get-session', async (_event, sessionId) => {
        const sessionFile = join(SESSIONS_DIR, `${sessionId}.jsonl`)
        if (!existsSync(sessionFile)) return []

        try {
            const content = await fs.readFile(sessionFile, 'utf8')
            return content
                .split('\n')
                .filter(line => line.trim())
                .map(line => JSON.parse(line))
        } catch (error) {
            console.error('Error reading logs for session:', sessionId, error)
            return []
        }
    })

    // Clear logs
    ipcMain.handle('logs:clear', async (_event, sessionId?: string) => {
        if (sessionId) {
            const sessionFile = join(SESSIONS_DIR, `${sessionId}.jsonl`)
            if (existsSync(sessionFile)) await fs.unlink(sessionFile)
        } else {
            if (existsSync(SESSIONS_DIR)) {
                const files = await fs.readdir(SESSIONS_DIR)
                for (const file of files) {
                    await fs.unlink(join(SESSIONS_DIR, file))
                }
            }
        }
        return { success: true }
    })
}
