import * as http from 'http'
import * as path from 'path'
import * as fs from 'fs'

export class ModelServer {
    private server: http.Server | null = null
    private port: number | null = null
    private modelsDir: string

    constructor(modelsDir: string) {
        this.modelsDir = modelsDir
    }

    public async start(): Promise<string> {
        if (this.server && this.port) {
            return `http://127.0.0.1:${this.port}/models`
        }

        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => this.handleRequest(req, res))

            this.server.listen(0, '127.0.0.1', () => {
                const address = this.server!.address()
                if (address && typeof address === 'object') {
                    this.port = address.port
                    resolve(`http://127.0.0.1:${this.port}/models`)
                } else {
                    reject(new Error('Failed to start model server'))
                }
            })

            this.server.on('error', (e) => reject(e))
        })
    }

    public getBaseUrl(): string | null {
        if (this.port) return `http://127.0.0.1:${this.port}/models`
        return null
    }

    public async stop(): Promise<void> {
        if (this.server) {
            await new Promise<void>((resolve) => this.server!.close(() => resolve()))
            this.server = null
            this.port = null
        }
    }

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        // CORS Headers
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', '*')

        if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
        }

        if (!req.url) {
            res.statusCode = 400
            res.end('Bad Request')
            return
        }

        // Critical Fix: Ensure no accidental spaces in URL parsing
        const requestUrl = new URL(req.url, 'http://127.0.0.1')
        const pathname = decodeURIComponent(requestUrl.pathname)

        if (!pathname.startsWith('/models/')) {
            res.statusCode = 404
            res.end('Not Found')
            return
        }

        const relativePath = pathname.replace(/^\/models\//, '')
        const filePath = path.join(this.modelsDir, relativePath)
        const resolvedModelsDir = path.resolve(this.modelsDir)
        const resolvedFilePath = path.resolve(filePath)

        // Security check
        if (!resolvedFilePath.startsWith(resolvedModelsDir)) {
            res.statusCode = 403
            res.end('Forbidden')
            return
        }

        fs.stat(resolvedFilePath, (err, stats) => {
            if (err) {
                res.statusCode = 404
                res.end('Not Found')
                return
            }

            if (stats.isDirectory()) {
                res.statusCode = 200
                res.end('Directory Exists')
                return
            }

            if (!stats.isFile()) {
                res.statusCode = 404
                res.end('Not Found')
                return
            }

            const ext = path.extname(resolvedFilePath).toLowerCase()
            let contentType = 'application/octet-stream'
            if (ext === '.json') contentType = 'application/json'
            else if (ext === '.txt' || ext === '.conf') contentType = 'text/plain; charset=utf-8'
            else if (ext === '.wav') contentType = 'audio/wav'
            else if (ext === '.js') contentType = 'application/javascript'
            else if (ext === '.wasm') contentType = 'application/wasm'
            else if (ext === '.zip') contentType = 'application/zip'

            res.setHeader('Content-Type', contentType)
            const stream = fs.createReadStream(resolvedFilePath)
            stream.on('error', () => {
                res.statusCode = 500
                res.end('Internal Server Error')
            })
            stream.pipe(res)
        })
    }
}
