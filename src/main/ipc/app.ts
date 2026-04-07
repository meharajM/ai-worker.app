import { app, shell, ipcMain, dialog } from 'electron'
import * as path from 'path'

function normalizePathForCompare(value: string): string {
    return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
    const normalizedRoot = normalizePathForCompare(rootPath)
    const normalizedTarget = normalizePathForCompare(targetPath)
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
}

export function registerAppHandlers(): void {
    // Shell operations
    ipcMain.handle('shell:open-external', async (_event, url: string) => {
        await shell.openExternal(url)
    })

    // App info
    ipcMain.handle('app:get-version', () => app.getVersion())
    ipcMain.handle('app:get-name', () => app.getName())
    ipcMain.handle('app:get-home-path', () => app.getPath('home'))

    // Folder selection
    ipcMain.handle('app:select-folder', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select Workspace Folder',
            buttonLabel: 'Select Workspace',
            defaultPath: app.getPath('home'),
        })
        if (result.canceled || result.filePaths.length === 0) return null
        const selectedPath = result.filePaths[0]
        const userHomePath = app.getPath('home')

        if (!isPathWithin(userHomePath, selectedPath)) {
            await dialog.showMessageBox({
                type: 'warning',
                title: 'Invalid Workspace Location',
                message: 'Workspace must be inside your user home folder.',
                detail: `Select a folder under: ${userHomePath}`,
            })
            return null
        }

        return selectedPath
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
