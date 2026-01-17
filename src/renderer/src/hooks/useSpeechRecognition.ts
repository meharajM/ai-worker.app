import { useState, useCallback, useRef, useEffect } from 'react'
import { VOICE_CONFIG } from '../lib/constants'
import { useSettingsStore } from '../stores/settingsStore'
import { voskService } from '../lib/vosk'
import { isElectron } from '../lib/electron'

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
    isFirstSetup?: boolean
    setupProgress?: number
}

// Audio processing configuration
const AUDIO_CONFIG = {
    sampleRate: 16000,
    channelCount: 1,
    bufferSize: 4096,
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
    const settings = useSettingsStore()
    const { offlineSpeech: storedOfflineSpeech } = settings
    // Force offline speech in Electron (Vosk), otherwise use settings (Web Speech API vs Vosk)
    const offlineSpeech = isElectron() ? true : storedOfflineSpeech
    const [isListening, setIsListening] = useState(false)
    const [transcript, setTranscript] = useState('')
    const [interimTranscript, setInterimTranscript] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [isSupported, setIsSupported] = useState(false)
    const [audioLevel, setAudioLevel] = useState(0)
    const [isVoskLoading, setIsVoskLoading] = useState(false)

    // Refs for Web Speech API
    const recognitionRef = useRef<SpeechRecognition | null>(null)

    // Refs for Audio Visualization
    const visMediaStreamRef = useRef<MediaStream | null>(null)
    const visAudioContextRef = useRef<AudioContext | null>(null)
    const visAnimationFrameRef = useRef<number | null>(null)

    // Initialize Web Speech API (always init if supported, as fallback)
    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
        if (SpeechRecognition) {
            setIsSupported(true)
            recognitionRef.current = new SpeechRecognition()

            const recognition = recognitionRef.current
            recognition.continuous = true
            recognition.interimResults = true
            recognition.lang = VOICE_CONFIG.SPEECH_LANG

            recognition.onresult = (event: SpeechRecognitionEvent) => {
                if (offlineSpeech) return // Ignore web speech results in offline mode

                let interim = ''
                let final = ''

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i]
                    if (result.isFinal) {
                        final += result[0].transcript
                    } else {
                        interim += result[0].transcript
                    }
                }

                if (final) {
                    setTranscript((prev) => prev + final)
                }
                setInterimTranscript(interim)
            }

            recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
                if (offlineSpeech) return

                // Ignore 'no-speech' error
                if (event.error === 'no-speech') return

                // If aborted, it's intentional
                if (event.error === 'aborted') {
                    setIsListening(false)
                    return
                }

                // Network error is common in Electron
                if (event.error === 'network') {
                    console.error('[Speech] Network error - Web Speech API requires internet connection')
                    setError('Speech recognition requires internet connection')
                    stopListening()
                    return
                }

                // Not allowed
                if (event.error === 'not-allowed') {
                    console.error('[Speech] Microphone access denied')
                    setError('Microphone access denied. Please allow microphone access.')
                    stopListening()
                    return
                }

                console.error('Speech recognition error:', event.error)
                setError(`Error: ${event.error}`)
                stopListening()
            }

            recognition.onend = () => {
                // Only update state if we were using Web Speech
                if (!offlineSpeech) {
                    setIsListening(false)
                    stopVisualization()
                }
            }
        } else {
            // Even if Web Speech is not supported, Offline might be
            // So we don't necessarily set isSupported = false globally yet,
            // but for now we assume modern browser features.
            // Vosk requires WebAssembly.
        }

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.abort()
            }
            stopVisualization()
        }
    }, [offlineSpeech])

    // Setup states
    const [isFirstSetup, setIsFirstSetup] = useState(false)
    const [setupProgress, setSetupProgress] = useState(0)
    const [isInitialized, setIsInitialized] = useState(false)
    const [currentModelId, setCurrentModelId] = useState<string | null>(null)

    // Initialize WASM Vosk if in browser and offline mode is enabled
    useEffect(() => {
        if (!isElectron() && offlineSpeech && !voskService.isLoaded() && !isVoskLoading) {
            const loadVosk = async () => {
                setIsVoskLoading(true)
                try {
                    await voskService.loadModel('/models/vosk-model.zip')
                } catch (e) {
                    console.error('Failed to load Vosk WASM model:', e)
                    setError('Failed to load browser speech model.')
                } finally {
                    setIsVoskLoading(false)
                }
            }
            loadVosk()
        }
    }, [offlineSpeech, isVoskLoading])

    // Update Vosk callbacks (WASM and Native)
    useEffect(() => {
        if (offlineSpeech) {
            if (!isElectron()) {
                voskService.setCallbacks(
                    (text, isFinal) => {
                        if (isFinal) setTranscript(prev => prev + text + ' ')
                        else setInterimTranscript(text)
                    },
                    (err) => {
                        setError(err)
                        stopListening()
                        setIsListening(false)
                    }
                )
            } else {
                // Native Vosk results come via IPC
                const removeResultListener = (window as any).electron.speech.onResult((result: { text: string, final: boolean }) => {
                    console.log('[Speech Hook] Received result:', result)
                    if (result.final) {
                        setTranscript(prev => prev + result.text + ' ')
                        setInterimTranscript('')
                    } else {
                        setInterimTranscript(result.text)
                    }
                })

                // Listen for download progress
                const removeProgressListener = (window as any).electron.speech.onDownloadProgress((data: { modelId: string, progress: number }) => {
                    if (data.modelId === settings.voskModel) {
                        setSetupProgress(data.progress)
                    }
                })

                return () => {
                    removeResultListener()
                    removeProgressListener()
                }
            }
        }
    }, [offlineSpeech, settings.voskModel])

    const visProcessorRef = useRef<ScriptProcessorNode | null>(null)

    // Start Audio Visualization and Processing
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

            // Ensure context is running (sometimes it starts suspended)
            if (audioContext.state === 'suspended') {
                await audioContext.resume()
            }

            const source = audioContext.createMediaStreamSource(stream)

            // For native Vosk, we need to process audio in the renderer and send to Main
            if (isElectron() && offlineSpeech) {
                // Note: ScriptProcessor is deprecated but AudioWorklet requires a separate file/loader setup
                // that is complex in this bundler environment. Using ScriptProcessor for now.
                const processor = audioContext.createScriptProcessor(4096, 1, 1)
                visProcessorRef.current = processor // Keep reference to prevent GC

                processor.onaudioprocess = (event) => {
                    const inputData = event.inputBuffer.getChannelData(0)
                    // Convert Float32Array to Int16Array for Vosk
                    const pcmData = new Int16Array(inputData.length)
                    for (let i = 0; i < inputData.length; i++) {
                        pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF
                    }
                    // Send the underlying ArrayBuffer
                    (window as any).electron.speech.processAudio(pcmData.buffer)
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
        setError(null)
        setTranscript('')
        setInterimTranscript('')

        if (offlineSpeech) {
            if (isListening) return
            try {
                if (isElectron()) {
                    // Lazy Initialization Logic
                    const targetModelId = settings.voskModel
                    const needsReinit = !isInitialized || currentModelId !== targetModelId

                    if (needsReinit) {
                        console.log(`[Speech Hook] Setup initiated for model: ${targetModelId}`)
                        setIsFirstSetup(true)
                        setSetupProgress(0)

                        // 1. Check if model is downloaded
                        const status = await (window as any).electron.speech.checkSupport(targetModelId)

                        if (!status.modelDownloaded) {
                            console.log(`[Speech Hook] Model ${targetModelId} not found locally. Starting download...`)
                            const modelInfo = (VOICE_CONFIG as any).VOSK_MODELS?.find((m: any) => m.id === targetModelId)
                            if (!modelInfo) {
                                throw new Error(`Model configuration not found for ${targetModelId}`)
                            }

                            const result = await (window as any).electron.speech.downloadModel({
                                modelId: targetModelId,
                                url: modelInfo.url,
                                modelName: modelInfo.modelName
                            })

                            if (!result.success) {
                                throw new Error(`Download failed: ${result.error}`)
                            }
                        }

                        setSetupProgress(90)

                        // 2. Initializing engine
                        const initResult = await (window as any).electron.speech.initialize({
                            modelId: targetModelId
                        })
                        if (!initResult.success) {
                            throw new Error(initResult.error)
                        }

                        setSetupProgress(100)
                        await new Promise(r => setTimeout(r, 400))

                        setIsInitialized(true)
                        setCurrentModelId(targetModelId)
                        setIsFirstSetup(false)
                        console.log(`[Speech Hook] Setup complete for ${targetModelId}.`)
                    }

                    await (window as any).electron.speech.startListening()
                    setIsListening(true)
                    startVisualization()
                } else {
                    await voskService.start()
                    setIsListening(true)
                    startVisualization()
                }
            } catch (e) {
                setError(`Offline speech failed to start: ${e}`)
                setIsFirstSetup(false)
            }
        } else {
            // Web Speech
            if (!recognitionRef.current) return
            if (isListening) return

            try {
                recognitionRef.current.start()
                setIsListening(true)
                startVisualization()
            } catch (e) {
                console.error('Error starting recognition:', e)
                setError('Failed to start speech recognition')
                setIsListening(false)
            }
        }
    }, [isListening, offlineSpeech, settings.voskModel, currentModelId, isInitialized])

    const stopListening = useCallback(async () => {
        if (offlineSpeech) {
            if (isElectron()) {
                await (window as any).electron.speech.stopListening()
            } else {
                voskService.stop()
            }
            setIsListening(false)
            stopVisualization()
        } else {
            if (!recognitionRef.current) return
            recognitionRef.current.stop()
            setIsListening(false)
            stopVisualization()
        }
    }, [offlineSpeech])

    const resetTranscript = useCallback(() => {
        setTranscript('')
        setInterimTranscript('')
    }, [])

    return {
        isListening,
        transcript,
        interimTranscript,
        error,
        isSupported: true, // Assuming support if either is available
        isNativeSupported: false,
        isInitializing: isFirstSetup, // Map internal setup state to exposed prop
        startListening,
        stopListening,
        resetTranscript,
        audioLevel,
        isFirstSetup,
        setupProgress
    }
}
