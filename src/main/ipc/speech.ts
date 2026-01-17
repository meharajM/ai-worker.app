import { ipcMain } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import { execSync } from 'child_process'
import { is } from '@electron-toolkit/utils'

function getBaseModelsDir(): string {
    if (is.dev) {
        return path.join(process.cwd(), 'public', 'models')
    }
    return path.join(process.resourcesPath, 'models')
}

// Function to get the path to the model DIRECTORY
function getModelDirPath(modelName: string): string {
    return path.join(getBaseModelsDir(), modelName)
}

export function registerSpeechHandlers(): void {
    ipcMain.handle('speech:check-support', async (_event, modelId: string = 'en-us') => {
        const modelName = 'vosk-model-small-en-us-0.15'
        const modelPath = getModelDirPath(modelName)

        // Debug logs
        console.log(`[Speech Debug] Checking support for: ${modelPath}`)

        let isDownloaded = false
        if (fs.existsSync(modelPath)) {
            try {
                // If folder exists and has files, assume it's valid
                const files = fs.readdirSync(modelPath)
                if (files.length > 0) {
                    isDownloaded = true
                }
            } catch (e) {
                console.error('[Speech] Error checking directory:', e)
            }
        }

        return {
            modelDownloaded: isDownloaded,
            nativeSupport: true
        }
    })

    ipcMain.handle('speech:initialize', async () => ({ success: true }))
    ipcMain.handle('speech:start-listening', async () => ({ success: true }))
    ipcMain.handle('speech:stop-listening', async () => ({ success: true }))

    ipcMain.handle('speech:download-model', async (event, options: { modelId: string, url?: string, modelName: string }) => {
        const { modelId, modelName } = options
        // Use ZIP url
        const url = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip'

        const modelsDir = getBaseModelsDir()
        const targetDir = getModelDirPath(modelName)
        const zipPath = path.join(modelsDir, `${modelName}.zip`)

        if (!fs.existsSync(modelsDir)) {
            fs.mkdirSync(modelsDir, { recursive: true })
        }

        return new Promise((resolve) => {
            console.log(`[Speech] Downloading model ZIP from ${url}...`)
            const file = fs.createWriteStream(zipPath)

            https.get(url, (response) => {
                const totalSize = parseInt(response.headers['content-length'] || '0', 10)
                let downloadedSize = 0

                response.on('data', (chunk) => {
                    downloadedSize += chunk.length
                    if (totalSize > 0) {
                        const progress = (downloadedSize / totalSize) * 100
                        try {
                            event.sender.send('speech:download-progress', { modelId, progress })
                        } catch (e) { /* ignore */ }
                    }
                })

                response.pipe(file)

                file.on('finish', () => {
                    file.close(() => {
                        console.log(`[Speech] Extracting model ZIP...`)
                        try {
                            // Extract to modelsDir
                            try {
                                execSync(`unzip -o "${zipPath}" -d "${modelsDir}"`)
                            } catch (e) {
                                if (process.platform === 'win32') {
                                    execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${modelsDir}' -Force"`)
                                } else {
                                    throw e
                                }
                            }

                            // Check if extraction created the folder
                            if (fs.existsSync(targetDir)) {
                                console.log(`[Speech] Model ready at ${targetDir}`)
                                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
                                resolve({ success: true })
                            } else {
                                resolve({ success: true })
                            }
                        } catch (e) {
                            console.error(`[Speech] Extraction failed:`, e)
                            resolve({ success: false, error: String(e) })
                        }
                    })
                })
            }).on('error', (err) => {
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
                resolve({ success: false, error: err.message })
            })
        })
    })

    ipcMain.handle('speech:cleanup', async () => ({ success: true }))
}
