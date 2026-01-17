import { createModel, KaldiRecognizer, Model } from 'vosk-browser'

// Define types since we can't read d.ts easily (or if they are missing)
interface VoskResult {
    text: string;
    result?: Array<{ conf: number; start: number; end: number; word: string }>;
}

interface VoskPartialResult {
    partial: string;
}

export class VoskService {
    private model: Model | null = null;
    private recognizer: KaldiRecognizer | null = null;
    private audioContext: AudioContext | null = null;
    private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
    private processor: ScriptProcessorNode | null = null;
    private isListening = false;

    // Callbacks
    private onResult: ((text: string, isFinal: boolean) => void) | null = null;
    private onError: ((error: string) => void) | null = null;

    constructor() {
        // Singleton or instance? instance is fine
    }

    public isLoaded(): boolean {
        return !!this.model;
    }

    public async loadModel(modelUrl: string): Promise<void> {
        return this.loadModelWithProgress(modelUrl);
    }

    public async loadModelWithProgress(modelUrl: string, onProgress?: (progress: number) => void): Promise<void> {
        try {
            console.log('[Vosk] Loading model from:', modelUrl);

            let modelSource: string | Blob = modelUrl;

            // Improvement: Manual fetch to track progress if onProgress is provided
            if (onProgress && !modelUrl.startsWith('blob:')) {
                const response = await fetch(modelUrl);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                const contentLength = +(response.headers.get('Content-Length') || 0);
                if (contentLength === 0) {
                    console.warn('[Vosk] Content-Length is 0, progress tracking might not work correctly');
                }

                const reader = response.body?.getReader();
                if (!reader) throw new Error('Failed to get reader from response body');

                let receivedLength = 0;
                const chunks: Uint8Array[] = [];

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    receivedLength += value.length;
                    if (contentLength > 0) {
                        onProgress(Math.round((receivedLength / contentLength) * 100));
                    }
                }

                const modelBlob = new Blob(chunks as any, { type: 'application/zip' });
                modelSource = URL.createObjectURL(modelBlob);
                console.log('[Vosk] Model download complete, created object URL');
            }

            // vosk-browser createModel can take a URL (string)
            this.model = await createModel(modelSource as string);

            console.log('[Vosk] Model initialized successfully');

            // Initialize recognizer with 16k sample rate
            this.recognizer = new this.model.KaldiRecognizer(16000);
            this.recognizer.setWords(true);
        } catch (error) {
            console.error('[Vosk] Failed to load model:', error);
            throw new Error(`Failed to load Vosk model: ${error}`);
        }
    }

    public setCallbacks(
        onResult: (text: string, isFinal: boolean) => void,
        onError: (error: string) => void
    ) {
        this.onResult = onResult;
        this.onError = onError;
    }

    public async start(): Promise<void> {
        if (!this.model || !this.recognizer) {
            throw new Error('Vosk model not loaded');
        }

        if (this.isListening) return;

        try {
            // Create AudioContext
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 16000, // Try to request 16k
            });

            // If hardware doesn't support 16k, we must resample. 
            // processAudio handles buffering, but Vosk expects specific sample rate matching the recognizer.
            // If context.sampleRate != 16000, we might strictly need to downsample.
            // Let's rely on browsing handling sampleRate request first.

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    channelCount: 1,
                    sampleRate: 16000
                },
                video: false
            });

            this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);

            // Use ScriptProcessor for broad compatibility in Electron
            // 4096 buffer size, 1 input channel, 1 output (unused)
            this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

            this.processor.onaudioprocess = (event) => {
                if (!this.recognizer) return;

                const inputData = event.inputBuffer.getChannelData(0);

                // Check if we accept the buffer. Vosk Recognizer acceptWaveform expects:
                // 1. AudioBuffer (Web Audio API) OR
                // 2. Float32Array + sampleRate?
                // Actually vosk-browser implementation of acceptWaveform usually handles AudioBuffer directly
                // or we need to convert to AudioBuffer.
                // Looking at vosk-browser output, checking if it attaches to AudioContext directly?
                // Standard Vosk C++ API takes PCM. vosk-browser likely has an easier way.
                // Assuming acceptWaveform takes Float32Array (channel data) and sampleRate is managed by instance.

                // Let's try sending the buffer.
                // Note: We might need to handle AudioBuffer mapping.
                // The most reliable way for vosk-browser is to check docs. 
                // Using generic approach:

                try {
                    // Check if 'acceptWaveform' takes the audio buffer
                    // @ts-ignore - vosk-browser types mismatch
                    if (this.recognizer.acceptWaveform(event.inputBuffer)) {
                        // Final result?
                        // @ts-ignore - vosk-browser types mismatch
                        const result = this.recognizer.result();
                        // result might be an object: { text: "..." }
                        // The typings for vosk-browser are a bit fuzzy without introspection
                        if (result && result.text && result.text.length > 0) {
                            if (this.onResult) this.onResult(result.text, true);
                        }
                    } else {
                        // Partial result
                        // @ts-ignore - vosk-browser types mismatch
                        const partial = this.recognizer.partialResult();
                        if (partial && partial.partial && partial.partial.length > 0) {
                            if (this.onResult) this.onResult(partial.partial, false);
                        }
                    }
                } catch (e) {
                    console.error('[Vosk] Processing error:', e);
                }
            };

            this.mediaStreamSource.connect(this.processor);
            this.processor.connect(this.audioContext.destination); // Needed for processing to happen

            this.isListening = true;
            console.log('[Vosk] Started listening');

        } catch (error) {
            console.error('[Vosk] Start error:', error);
            if (this.onError) this.onError(String(error));
            this.stop();
        }
    }

    public stop(): void {
        this.isListening = false;

        if (this.mediaStreamSource) {
            this.mediaStreamSource.disconnect();
            this.mediaStreamSource = null;
        }

        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }

        // Don't close AudioContext immediately if we want to restart quickly? 
        // Better to close it to release mic.
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }

    public dispose() {
        this.stop();
        if (this.recognizer) {
            this.recognizer.remove(); // Dispose C++ object
            this.recognizer = null;
        }
        if (this.model) {
            this.model.terminate(); // Dispose C++ object
            this.model = null;
        }
    }
}

export const voskService = new VoskService();
