import { app, shell, ipcMain, dialog } from 'electron'

export function registerAppHandlers(): void {
    // Shell operations
    ipcMain.handle('shell:open-external', async (_event, url: string) => {
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
        return result.canceled ? null : result.filePaths[0]
    })

    // Dependencies
    ipcMain.handle('app:get-missing-dependencies', async () => {
        const { DependencyService } = await import('../services/DependencyService')
        const depService = DependencyService.getInstance()
        return await depService.getMissingDependencies()
    })

    ipcMain.handle('app:get-all-dependencies', async () => {
        const { DependencyService } = await import('../services/DependencyService')
        const depService = DependencyService.getInstance()
        return await depService.getAllDependencies()
    })

    ipcMain.handle('app:run-setup-script', async () => {
        const { DependencyService } = await import('../services/DependencyService')
        const depService = DependencyService.getInstance()
        return await depService.runSetupScript()
    })
}
