import { ipcMain } from 'electron'
import * as path from 'path'
import { is } from '@electron-toolkit/utils'
import { ModelManager } from '../services/ModelManager'

function getBaseModelsDir(): string {
    if (is.dev) {
        return path.join(process.cwd(), 'public', 'models')
    }
    return path.join(process.resourcesPath, 'models')
}

let modelManager: ModelManager | null = null

export function registerSpeechHandlers(): void {
    // Initialize manager
    modelManager = new ModelManager(getBaseModelsDir())

    ipcMain.handle('speech:check-support', async (_event, modelName: string) => {
        // modelName passed from renderer (dynamic now)
        return await modelManager!.checkSupport(modelName)
    })

    ipcMain.handle('speech:initialize', async () => ({ success: true }))
    ipcMain.handle('speech:start-listening', async () => ({ success: true }))
    ipcMain.handle('speech:stop-listening', async () => ({ success: true }))

    ipcMain.handle('speech:download-model', async (event, options: { modelId: string, url: string, modelName: string }) => {
        return await modelManager!.downloadModel(
            options.modelName,
            options.url, // Pass dynamic URL
            (progress) => {
                try {
                    event.sender.send('speech:download-progress', { modelId: options.modelId, progress })
                } catch (e) { /* ignore */ }
            }
        )
    })

    ipcMain.handle('speech:get-model-path', async (_event, modelName: string) => {
        return await modelManager!.getModelPath(modelName)
    })

    ipcMain.handle('speech:cleanup', async () => {
        if (modelManager) {
            await modelManager.cleanup()
        }
        return { success: true }
    })

    // Cleanup when app quits
    ipcMain.handle('speech:cleanup-server', async () => {
        if (modelManager) {
            await modelManager.cleanup()
        }
        return { success: true }
    })
}
