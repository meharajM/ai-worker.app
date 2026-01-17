import { createModel, type KaldiRecognizer, type Model } from 'vosk-browser'
import { startTransition } from 'react'

interface VoskServiceState {
    model: Model | null
    recognizer: KaldiRecognizer | null
    isReady: boolean
    isLoading: boolean
    error: string | null
}

class VoskService {
    private static instance: VoskService
    private state: VoskServiceState = {
        model: null,
        recognizer: null,
        isReady: false,
        isLoading: false,
        error: null
    }

    // Config
    private sampleRate = 16000

    private constructor() { }

    static getInstance(): VoskService {
        if (!VoskService.instance) {
            VoskService.instance = new VoskService()
        }
        return VoskService.instance
    }

    async loadModel(modelUrl: string): Promise<void> {
        if (this.state.model) return

        try {
            console.log('[Vosk WASM] Loading model from:', modelUrl)
            this.state.isLoading = true

            // vosk-browser creates a model from a URL (zip or folder structure)
            // It uses fetch internally.
            const model = await createModel(modelUrl)

            this.state.model = model
            this.state.recognizer = new model.KaldiRecognizer(this.sampleRate)

            this.state.isReady = true
            this.state.isLoading = false
            console.log('[Vosk WASM] Model loaded successfully')
        } catch (error) {
            console.error('[Vosk WASM] Failed to load model:', error)
            this.state.error = String(error)
            this.state.isLoading = false
            throw error
        }
    }

    public getRecognizer(): KaldiRecognizer | null {
        return this.state.recognizer
    }

    public free(): void {
        if (this.state.recognizer) {
            this.state.recognizer.remove()
            this.state.recognizer = null
        }
        if (this.state.model) {
            this.state.model.terminate()
            this.state.model = null
        }
        this.state.isReady = false
    }

    public isReady(): boolean {
        return this.state.isReady
    }
}

export const voskService = VoskService.getInstance()
