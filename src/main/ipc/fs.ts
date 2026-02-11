import { ipcMain } from 'electron'
import { FileSystemService } from '../services/FileSystemService'
import { sanitizeError } from '../utils/error-handler'

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
            if (typeof changeId !== 'string' || changeId.length === 0 || changeId.length > 100) {
                return { success: false, error: 'Invalid changeId' }
            }
            const fsService = FileSystemService.getInstance()
            await fsService.commitChange(changeId)
            return { success: true }
        } catch (error) {
            // L-01: Sanitize error messages
            return { success: false, error: sanitizeError(error, 'fs:approve-change') }
        }
    })

    // Reject a change
    ipcMain.handle('fs:reject-change', async (_event, changeId: string) => {
        try {
            if (typeof changeId !== 'string' || changeId.length === 0 || changeId.length > 100) {
                return { success: false, error: 'Invalid changeId' }
            }
            const fsService = FileSystemService.getInstance()
            await fsService.discardChange(changeId)
            return { success: true }
        } catch (error) {
            // L-01: Sanitize error messages
            return { success: false, error: sanitizeError(error, 'fs:reject-change') }
        }
    })
}
