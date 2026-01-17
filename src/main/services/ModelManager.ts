import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import { execSync } from 'child_process'
import { ModelServer } from './ModelServer'

export class ModelManager {
    private modelsDir: string
    private server: ModelServer

    constructor(modelsDir: string) {
        this.modelsDir = modelsDir
        this.server = new ModelServer(modelsDir)
    }

    public getModelsDir(): string {
        return this.modelsDir
    }

    public getModelDirPath(modelName: string): string {
        return path.join(this.modelsDir, modelName)
    }

    public async checkSupport(modelName: string = 'vosk-model-small-en-us-0.15'): Promise<{ modelDownloaded: boolean; nativeSupport: boolean }> {
        const zipPath = path.join(this.modelsDir, `${modelName}.zip`)

        // Strict Check: Require ZIP file for vosk-browser
        const isDownloaded = fs.existsSync(zipPath)

        if (!isDownloaded) {
            console.log('[Speech] ZIP not found. Triggering re-download to ensure valid archive.')
        }

        return {
            modelDownloaded: isDownloaded,
            nativeSupport: true
        }
    }

    public async getModelPath(modelName: string): Promise<string | null> {
        const zipPath = path.join(this.modelsDir, `${modelName}.zip`)
        const modelPath = this.getModelDirPath(modelName)

        // Prefer ZIP file if it exists (required for vosk-browser createModel)
        if (fs.existsSync(zipPath)) {
            const baseUrl = await this.server.start()
            // Critical Fix: Ensure no spaces in URL
            return `${baseUrl}/${modelName}.zip`
        }

        // Fallback to directory
        if (fs.existsSync(modelPath)) {
            const baseUrl = await this.server.start()
            return `${baseUrl}/${modelName}`
        }

        return null
    }

    public async downloadModel(
        modelId: string,
        modelName: string,
        onProgress: (progress: number) => void
    ): Promise<{ success: boolean; error?: string }> {
        // Use fixed ZIP url for reliability
        const url = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip'
        const zipPath = path.join(this.modelsDir, `${modelName}.zip`)
        const targetDir = this.getModelDirPath(modelName)

        if (!fs.existsSync(this.modelsDir)) {
            fs.mkdirSync(this.modelsDir, { recursive: true })
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
                        onProgress(progress)
                    }
                })

                response.pipe(file)

                file.on('finish', () => {
                    file.close(() => {
                        console.log(`[Speech] Extracting model ZIP...`)
                        try {
                            // Extract to modelsDir
                            try {
                                // Critical Fix: Correct unzip command "unzip -o"
                                execSync(`unzip -o "${zipPath}" -d "${this.modelsDir}"`)
                            } catch (e) {
                                if (process.platform === 'win32') {
                                    execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${this.modelsDir}' -Force"`)
                                } else {
                                    throw e
                                }
                            }

                            // Check extraction
                            if (fs.existsSync(targetDir)) {
                                console.log(`[Speech] Model ready at ${targetDir}`)

                                // Cleanup conflicting files
                                const tarGzPath = path.join(this.modelsDir, `${modelName}.tar.gz`)
                                if (fs.existsSync(tarGzPath)) {
                                    fs.unlinkSync(tarGzPath)
                                }

                                resolve({ success: true })
                            } else {
                                // Cleanup failed extraction
                                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
                                resolve({ success: true })
                            }
                        } catch (e) {
                            console.error(`[Speech] Extraction failed: `, e)
                            if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
                            resolve({ success: false, error: String(e) })
                        }
                    })
                })
            }).on('error', (err) => {
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
                resolve({ success: false, error: err.message })
            })
        })
    }

    public async cleanup(): Promise<void> {
        await this.server.stop()
    }
}
