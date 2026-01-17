import { ipcMain } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import { spawn, ChildProcess, execSync } from 'child_process'
import { is } from '@electron-toolkit/utils'

let voskProcess: ChildProcess | null = null
let isInitialized = false
let isListening = false

// Get the models directory path
function getModelsPath(modelId: string = 'en-us'): string {
    const folderName = `vosk-model-${modelId}`
    // In development, the model is in the public folder
    if (is.dev) {
        return path.join(process.cwd(), 'public', 'models', folderName)
    }
    // In production, it will be in the resources folder
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'public', 'models', folderName)
}

function getBaseModelsDir(): string {
    if (is.dev) {
        return path.join(process.cwd(), 'public', 'models')
    }
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'public', 'models')
}

function getPythonPath(): string {
    // On Windows, it's often 'python', on Mac/Linux 'python3'
    return process.platform === 'win32' ? 'python' : 'python3'
}

export function registerSpeechHandlers(): void {
    ipcMain.handle('speech:check-support', async (_event, modelId: string = 'en-us') => {
        const modelPath = getModelsPath(modelId)
        const exists = fs.existsSync(modelPath) && fs.readdirSync(modelPath).length > 0
        return {
            supported: true,
            modelDownloaded: exists,
            modelsPath: modelPath,
            error: null,
        }
    })

    ipcMain.handle('speech:initialize', async (_event, options?: { modelId?: string }) => {
        const modelId = options?.modelId || 'en-us'

        // If already initialized with DIFFERENT model, kill it first
        // (For now, we just check if it's the same. If different, we'll need to re-init)
        // Optimization: track currentModelId
        if (isInitialized && voskProcess) {
            // Check if we need to restart with a different model
            // For simplicity, we restart if any re-init is requested for now
            // voskProcess.kill()
        }

        const modelPath = getModelsPath(modelId)
        if (!fs.existsSync(modelPath)) {
            return { success: false, error: `Model ${modelId} not found at ${modelPath}` }
        }
        const bridgePath = is.dev
            ? path.join(process.cwd(), 'src', 'main', 'vosk_bridge.py')
            : path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'vosk_bridge.py')

        try {
            voskProcess = spawn(getPythonPath(), [bridgePath, modelPath])

            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({ success: false, error: 'Initialization timeout after 30s' })
                }, 30000)

                voskProcess?.stdout?.on('data', (data) => {
                    const str = data.toString()
                    // Log raw output for debugging
                    console.log(`[Vosk Bridge STDOUT]: ${str}`)

                    try {
                        const lines = str.split('\n')
                        for (const line of lines) {
                            if (!line.trim()) continue

                            try {
                                const response = JSON.parse(line)

                                // 1. Handle Initialization
                                if (response.status === 'ready') {
                                    isInitialized = true
                                    clearTimeout(timeout)
                                    resolve({ success: true })
                                } else if (response.error) {
                                    // Only reject if we are still initializing
                                    if (!isInitialized) {
                                        clearTimeout(timeout)
                                        resolve({ success: false, error: response.error })
                                    } else {
                                        console.error('[Vosk Bridge Error]:', response.error)
                                    }
                                }

                                // 2. Handle Speech Results (only if we are actively listening)
                                if (isListening && (response.text !== undefined || response.partial !== undefined)) {
                                    // Note: bridge now sends { text: "...", final: true/false }
                                    const { BrowserWindow } = require('electron')
                                    const windows = BrowserWindow.getAllWindows()
                                    // console.log(`[Speech Debug] Sending result to ${windows.length} windows. isListening=${isListening}`)
                                    for (const win of windows) {
                                        try {
                                            win.webContents.send('speech:result', response)
                                        } catch (err) {
                                            console.error('[Speech Debug] Failed to send to window:', err)
                                        }
                                    }
                                } else if (!isListening && (response.text !== undefined)) {
                                    console.log('[Speech Debug] Received result but isListening is false. Ignoring.', response)
                                }
                            } catch (e) {
                                // JSON parse error for a single line? ignore
                            }
                        }
                    } catch (e) {
                        // General parsing error
                    }
                })

                voskProcess?.stderr?.on('data', (data) => {
                    console.error(`[Vosk Bridge STDERR]: ${data.toString()}`)
                })

                voskProcess?.on('error', (err) => {
                    clearTimeout(timeout)
                    console.error('[Vosk Bridge Process Error]:', err)
                    if (!isInitialized) resolve({ success: false, error: err.message })
                })

                voskProcess?.on('exit', (code) => {
                    console.log(`[Vosk Bridge] Process exited with code ${code}`)
                    isInitialized = false
                    isListening = false
                })
            })
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    ipcMain.handle('speech:start-listening', async () => {
        if (!isInitialized || !voskProcess) {
            return { success: false, error: 'Speech engine not initialized' }
        }
        isListening = true
        return { success: true }
    })

    ipcMain.handle('speech:stop-listening', async () => {
        isListening = false
        return { success: true }
    })

    ipcMain.on('speech:process-audio', (_event, audioData: Uint8Array) => {
        if (!isListening || !voskProcess || !voskProcess.stdin) {
            return
        }

        try {
            voskProcess.stdin.write(Buffer.from(audioData))
        } catch (error) {
            console.error('[Speech] Failed to write audio to stdin:', error)
        }
    })

    ipcMain.handle('speech:get-status', async (_event, modelId: string = 'en-us') => {
        const modelPath = getModelsPath(modelId)
        return {
            isInitialized,
            isListening,
            error: null,
            modelsPath: modelPath,
            modelDownloaded: fs.existsSync(modelPath) && fs.readdirSync(modelPath).length > 0,
        }
    })

    ipcMain.handle('speech:download-model', async (event, options: { modelId: string, url: string, modelName: string }) => {
        const { modelId, url, modelName } = options
        const modelsDir = getBaseModelsDir()
        const targetDir = getModelsPath(modelId)
        const zipPath = path.join(modelsDir, `${modelId}.zip`)

        if (!fs.existsSync(modelsDir)) {
            fs.mkdirSync(modelsDir, { recursive: true })
        }

        return new Promise((resolve) => {
            console.log(`[Speech] Downloading model ${modelId} from ${url}...`)
            const file = fs.createWriteStream(zipPath)

            https.get(url, (response) => {
                const totalSize = parseInt(response.headers['content-length'] || '0', 10)
                let downloadedSize = 0

                response.on('data', (chunk) => {
                    downloadedSize += chunk.length
                    if (totalSize > 0) {
                        const progress = (downloadedSize / totalSize) * 100
                        event.sender.send('speech:download-progress', { modelId, progress })
                    }
                })

                response.pipe(file)

                file.on('finish', () => {
                    file.close(() => {
                        console.log(`[Speech] Extracting model ${modelId}...`)
                        try {
                            // Mac/Linux: unzip is usually available
                            execSync(`unzip -o "${zipPath}" -d "${modelsDir}"`)

                            const extractedPath = path.join(modelsDir, modelName)
                            if (fs.existsSync(extractedPath)) {
                                if (fs.existsSync(targetDir)) {
                                    fs.rmSync(targetDir, { recursive: true, force: true })
                                }
                                fs.renameSync(extractedPath, targetDir)
                            }

                            fs.unlinkSync(zipPath)
                            console.log(`[Speech] Model ${modelId} downloaded and extracted successfully.`)
                            resolve({ success: true })
                        } catch (e) {
                            console.error(`[Speech] Extraction failed for ${modelId}:`, e)
                            resolve({ success: false, error: String(e) })
                        }
                    })
                })
            }).on('error', (err) => {
                fs.unlink(zipPath, () => { })
                console.error(`[Speech] Download failed for ${modelId}:`, err)
                resolve({ success: false, error: err.message })
            })
        })
    })

    ipcMain.handle('speech:cleanup', async () => {
        if (voskProcess) {
            voskProcess.kill()
            voskProcess = null
        }
        isInitialized = false
        isListening = false
        return { success: true }
    })
}
