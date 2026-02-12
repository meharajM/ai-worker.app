import { ipcMain, app, shell } from 'electron'
import { join } from 'path'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import { sanitizeError } from '../utils/error-handler'

const LOGS_DIR = join(app.getPath('userData'), 'logs')
const SESSIONS_DIR = join(LOGS_DIR, 'sessions')

// Ensure log directories exist
async function ensureDirs() {
    if (!existsSync(LOGS_DIR)) await fs.mkdir(LOGS_DIR, { recursive: true })
    if (!existsSync(SESSIONS_DIR)) await fs.mkdir(SESSIONS_DIR, { recursive: true })
}

// Sanitize sessionId to prevent path traversal
function sanitizeSessionId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '')
}

export function registerLogsHandlers() {
    // Add a log entry (Append Only)
    ipcMain.handle('logs:add', async (_event, entry) => {
        try {
            if (!entry || typeof entry.sessionId !== 'string') {
                return { success: false, error: 'Invalid log entry' }
            }
            entry.sessionId = sanitizeSessionId(entry.sessionId)
            await ensureDirs()
            const sessionFile = join(SESSIONS_DIR, `${entry.sessionId}.jsonl`)
            const line = JSON.stringify(entry) + '\n'
            await fs.appendFile(sessionFile, line, 'utf8')
            return { success: true }
        } catch (error) {
            // L-01: Sanitize error messages
            console.error('Failed to write log:', error)
            return { success: false, error: sanitizeError(error, 'logs:add') }
        }
    })

    // Get the absolute path to the logs directory
    ipcMain.handle('logs:get-path', async () => {
        await ensureDirs()
        return SESSIONS_DIR
    })

    // Open logs directory in OS file explorer
    ipcMain.handle('logs:open-folder', async () => {
        await ensureDirs()
        await shell.openPath(SESSIONS_DIR)
        return { success: true }
    })
}
