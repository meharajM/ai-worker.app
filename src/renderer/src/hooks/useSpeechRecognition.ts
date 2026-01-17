import { useState, useCallback, useRef, useEffect } from 'react'
import { VOICE_CONFIG } from '../lib/constants'
import { useSettingsStore } from '../stores/settingsStore'
import { isElectron } from '../lib/electron'
import { voskService } from '../lib/vosk'

interface UseSpeechRecognitionReturn {
    isListening: boolean
    transcript: string
    interimTranscript: string
    error: string | null
    isSupported: boolean
    isNativeSupported: boolean
    isInitializing: boolean
    startListening: () => void
    stopListening: () => void
    resetTranscript: () => void
    audioLevel: number
    isFirstSetup: boolean
    setupProgress: number
    notification: string | null
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
    const settings = useSettingsStore()
    const useNativeSpeech = isElectron()

    const [isListening, setIsListening] = useState(false)
    const [transcript, setTranscript] = useState('')
    const [interimTranscript, setInterimTranscript] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [isSupported, setIsSupported] = useState(false)
    const [audioLevel, setAudioLevel] = useState(0)
    const [isInitializing, setIsInitializing] = useState(false)
    const [isFirstSetup, setIsFirstSetup] = useState(false)
    const [setupProgress, setSetupProgress] = useState(0)
    const [notification, setNotification] = useState<string | null>(null)

    // Track intent to prevent race conditions during async setup
    const shouldListenRef = useRef(false)

    // Refs for Web Speech API
    const recognitionRef = useRef<SpeechRecognition | null>(null)

    // Refs for WASM / Audio
    const visMediaStreamRef = useRef<MediaStream | null>(null)
    const visAudioContextRef = useRef<AudioContext | null>(null)
    const visAnimationFrameRef = useRef<number | null>(null)
    const visProcessorRef = useRef<ScriptProcessorNode | null>(null)

    // Setup IPC listeners for Download Progress
    useEffect(() => {
        if (useNativeSpeech) {
            const electron = (window as any).electron
            if (!electron) return

            const removeProgressListener = electron.speech.onDownloadProgress((data: { modelId: string, progress: number }) => {
                setSetupProgress(data.progress)
            })
            return () => {
                removeProgressListener?.()
            }
        }
    }, [useNativeSpeech])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopVisualization()
        }
    }, [])

    // Auto-clear notification
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 3000)
            return () => clearTimeout(timer)
        }
    }, [notification])

    const startVisualization = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000,
                    channelCount: 1,
                }
            })
            visMediaStreamRef.current = stream

            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 16000
            })
            visAudioContextRef.current = audioContext

            if (audioContext.state === 'suspended') {
                await audioContext.resume()
            }

            const source = audioContext.createMediaStreamSource(stream)

            if (useNativeSpeech) {
                const recognizer = voskService.getRecognizer()
                if (!recognizer) {
                    console.error('Recognizer not ready')
                    return
                }

                recognizer.on('result', (message: any) => {
                    const text = message.result?.text
                    if (text) {
                        setTranscript((prev) => prev + text + ' ')
                        setInterimTranscript('')
                    }
                })

                recognizer.on('partialresult', (message: any) => {
                    const partial = message.result?.partial
                    if (partial) {
                        setInterimTranscript(partial)
                    }
                })

                const processor = audioContext.createScriptProcessor(4096, 1, 1)
                visProcessorRef.current = processor

                processor.onaudioprocess = (event) => {
                    try {
                        recognizer.acceptWaveform(event.inputBuffer)
                    } catch (e) {
                        console.error('WASM processing error:', e)
                    }
                }

                source.connect(processor)
                processor.connect(audioContext.destination)
            }

            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 256
            source.connect(analyser)

            const dataArray = new Uint8Array(analyser.frequencyBinCount)
            const updateVolume = () => {
                if (!visAudioContextRef.current) return
                analyser.getByteFrequencyData(dataArray)
                let sum = 0
                for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
                const average = sum / dataArray.length
                setAudioLevel(Math.min(1, average / 40))
                visAnimationFrameRef.current = requestAnimationFrame(updateVolume)
            }
            updateVolume()
        } catch (e) {
            console.warn('[Speech] Audio setup failed:', e)
            setError('Microphone initialization failed')
            setIsListening(false)
        }
    }

    const stopVisualization = () => {
        if (visProcessorRef.current) {
            visProcessorRef.current.disconnect()
            visProcessorRef.current = null
        }
        if (visAnimationFrameRef.current) {
            cancelAnimationFrame(visAnimationFrameRef.current)
            visAnimationFrameRef.current = null
        }
        if (visMediaStreamRef.current) {
            visMediaStreamRef.current.getTracks().forEach(track => track.stop())
            visMediaStreamRef.current = null
        }
        if (visAudioContextRef.current) {
            visAudioContextRef.current.close().catch(console.error)
            visAudioContextRef.current = null
        }
        setAudioLevel(0)
    }

    const startListening = useCallback(async () => {
        if (isListening || isInitializing) return

        shouldListenRef.current = true
        setError(null)
        setNotification(null)
        setTranscript('')
        setInterimTranscript('')

        if (useNativeSpeech) {
            setIsInitializing(true)

            try {
                const electron = (window as any).electron

                // 1. Ensure Model is Downloaded
                const modelId = 'en-us'
                const check = await electron.speech.checkSupport(modelId)

                if (!shouldListenRef.current) return

                if (!check.modelDownloaded) {
                    setIsFirstSetup(true)
                    setSetupProgress(0)
                    console.log('[Speech] Downloading model...')

                    const result = await electron.speech.downloadModel({
                        modelId: 'en-us',
                        modelName: 'vosk-model-small-en-us-0.15'
                    })

                    if (!result.success) throw new Error(result.error)

                    // STOP after initial download (Do not auto-record)
                    setIsFirstSetup(false)
                    setIsInitializing(false)
                    shouldListenRef.current = false
                    setNotification("Voice model ready! Click Mic to start.")
                    return
                }

                if (!shouldListenRef.current) return

                // 2. Load Model into WASM (if not ready)
                if (!voskService.isReady()) {
                    const modelUrl = '/models/vosk-model-small-en-us-0.15'
                    await voskService.loadModel(modelUrl)
                }

                if (!shouldListenRef.current) return

                // 3. Start Audio
                setIsListening(true)
                await startVisualization()

            } catch (e) {
                if (shouldListenRef.current) {
                    console.error('[Speech] Start failed:', e)
                    setError(`Setup failed: \${e}`)
                    setIsListening(false)
                }
                setIsFirstSetup(false)
            } finally {
                // If we aborted early (download case), this might already be false.
                if (shouldListenRef.current) setIsInitializing(false)
            }
        } else {
            // Web Speech API Fallback
        }
    }, [isListening, isInitializing, useNativeSpeech])

    const stopListening = useCallback(async () => {
        shouldListenRef.current = false
        if (useNativeSpeech) {
            setIsListening(false)
            setIsInitializing(false)
            stopVisualization()
        } else {
            if (!recognitionRef.current) return
            recognitionRef.current.stop()
            setIsListening(false)
            stopVisualization()
        }
    }, [useNativeSpeech])

    const resetTranscript = useCallback(() => {
        setTranscript('')
        setInterimTranscript('')
    }, [])

    return {
        isListening,
        transcript,
        interimTranscript,
        error,
        notification,
        isSupported: true,
        isNativeSupported: useNativeSpeech,
        isInitializing,
        startListening,
        stopListening,
        resetTranscript,
        audioLevel,
        isFirstSetup,
        setupProgress
    }
}
