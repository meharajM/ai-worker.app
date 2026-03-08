import { ipcMain, app } from 'electron'
import { FileSystemService } from '../services/FileSystemService'
import * as path from 'path'
import * as fs from 'fs/promises'

export function registerFsHandlers(): void {
    // Get pending changes for review
    ipcMain.handle('fs:get-pending-changes', async () => {
        try {
            const fsService = FileSystemService.getInstance()
            return fsService.getPendingChanges()
        } catch (error) {
            console.error('Failed to get pending changes:', error)
            return []
        }
    })

    // Approve a change
    ipcMain.handle('fs:approve-change', async (_event, changeId: string) => {
        try {
            const fsService = FileSystemService.getInstance()
            await fsService.commitChange(changeId)
            return { success: true }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    // Reject a change
    ipcMain.handle('fs:reject-change', async (_event, changeId: string) => {
        try {
            const fsService = FileSystemService.getInstance()
            await fsService.discardChange(changeId)
            return { success: true }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    // Secure internal file writer (Bypasses Safe Mode, restricted to .ai-worker folder)
    ipcMain.handle('fs:write-internal-file', async (_event, workspacePath: string | undefined | null, filename: string, content: string) => {
        try {
            if (!filename.match(/^[a-zA-Z0-9_.-]+$/)) throw new Error("Invalid filename");

            // Fallback: If no workspace is selected, save to the app's user data directory (e.g. ~/Library/Application Support/ai-worker)
            let internalDir: string;
            if (workspacePath && workspacePath.trim() !== '') {
                internalDir = path.join(workspacePath, '.ai-worker');
            } else {
                internalDir = path.join(app.getPath('userData'), 'tasks-fallback');
            }

            const targetPath = path.join(internalDir, filename);

            // Ensure directory exists
            await fs.mkdir(internalDir, { recursive: true });

            // Write file directly, bypassing Shadow Write
            await fs.writeFile(targetPath, content, 'utf8');
            return { success: true, path: targetPath };
        } catch (error) {
            console.error('[Internal FS] Failed to write internal file:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    })

    ipcMain.handle('fs:read-internal-file', async (_event, workspacePath: string | undefined | null, filename: string) => {
        try {
            if (!filename.match(/^[a-zA-Z0-9_.-]+$/)) throw new Error("Invalid filename");

            let internalDir: string;
            if (workspacePath && workspacePath.trim() !== '') {
                internalDir = path.join(workspacePath, '.ai-worker');
            } else {
                internalDir = path.join(app.getPath('userData'), 'tasks-fallback');
            }

            const targetPath = path.join(internalDir, filename);
            const content = await fs.readFile(targetPath, 'utf8');
            return { success: true, content };
        } catch (error) {
            // Silently fail if it doesn't exist yet
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    })
}
