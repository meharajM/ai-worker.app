import { app, shell, ipcMain, dialog } from 'electron'

export function registerAppHandlers(): void {
    // Shell operations
    ipcMain.handle('shell:open-external', async (_event, url: string) => {
        if (typeof url !== 'string') return
        try {
            const parsed = new URL(url)
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                console.warn(`[App] Blocked shell:open-external with protocol: ${parsed.protocol}`)
                return
            }
        } catch {
            console.warn(`[App] Blocked shell:open-external with invalid URL: ${url}`)
            return
        }
        await shell.openExternal(url)
    })

    // App info
    ipcMain.handle('app:get-version', () => app.getVersion())
    ipcMain.handle('app:get-name', () => app.getName())

    // Folder selection
    ipcMain.handle('app:select-folder', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select Workspace Folder',
            buttonLabel: 'Select Workspace'
        })
        
        // C-03 Security Fix: Set workspace on FileSystemService when user selects folder
        if (!result.canceled && result.filePaths[0]) {
            const { FileSystemService } = await import('../services/FileSystemService')
            const fsService = FileSystemService.getInstance()
            fsService.setWorkspace(result.filePaths[0])
            console.log(`[App] Workspace set to: ${result.filePaths[0]}`)
        }
        
        return result.canceled ? null : result.filePaths[0]
    })
}
