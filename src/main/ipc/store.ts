import { ipcMain } from 'electron'

// Storage operations using simple file storage or electron-store
// For now, keeping the in-memory Map as a placeholder, but in a real app 
// this would be replaced with electron-store
const storage: Map<string, unknown> = new Map()

export function registerStoreHandlers(): void {
    ipcMain.handle('store:get', (_event, key: string) => {
        return storage.get(key)
    })

    ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
        storage.set(key, value)
        return true
    })

    ipcMain.handle('store:delete', (_event, key: string) => {
        return storage.delete(key)
    })
}
