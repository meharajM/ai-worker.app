import { ipcMain } from 'electron'
import { FileSystemService } from '../services/FileSystemService'

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
}
