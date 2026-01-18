import { useState, useCallback, useRef, useEffect } from 'react'
import { VOICE_CONFIG, VoskModel } from '../lib/constants'
import { useSettingsStore } from '../stores/settingsStore'
import { isElectron } from '../lib/electron'
import { voskService } from '../lib/vosk'
import { useLogStore } from '../stores/logStore'
import { useChatStore } from '../stores/chatStore'

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
    setText: (text: string) => void
    currentModel: VoskModel | null
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
    const settings = useSettingsStore()
    const useNativeSpeech = isElectron()
    const { addLog } = useLogStore()

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
    const [currentModel, setCurrentModel] = useState<VoskModel | null>(null)

    // Track intent to prevent race conditions during async setup
    const shouldListenRef = useRef(false)

    // Refs for Web Speech API
    const recognitionRef = useRef<SpeechRecognition | null>(null)

    // Refs for WASM / Audio
    const visMediaStreamRef = useRef<MediaStream | null>(null)
    const visAudioContextRef = useRef<AudioContext | null>(null)
    const visAnimationFrameRef = useRef<number | null>(null)
    const visProcessorRef = useRef<ScriptProcessorNode | null>(null)

    // Initialize: Select Model based on settings
    useEffect(() => {
        if (useNativeSpeech) {
            const preferredModelId = settings.voskModel || 'auto'

            if (preferredModelId === 'auto') {
                // Auto-detect: Use default model for now (in future could detect system locale)
                const defaultModel = VOICE_CONFIG.VOSK_MODELS.find(m => m.id === VOICE_CONFIG.DEFAULT_MODEL_ID)
                    || VOICE_CONFIG.VOSK_MODELS[0]
                console.log('[Speech] Using default model (Auto):', defaultModel)
                setCurrentModel(defaultModel)
            } else {
                // Manual selection - Find in VOICE_CONFIG
                const selected = VOICE_CONFIG.VOSK_MODELS.find(m => m.id === preferredModelId)

                if (selected) {
                    console.log('[Speech] Using selected model:', selected)
                    setCurrentModel(selected)
                } else {
                    console.warn('[Speech] Selected model not found, falling back to default')
                    const defaultModel = VOICE_CONFIG.VOSK_MODELS[0]
                    setCurrentModel(defaultModel)
                }
            }
        }
    }, [useNativeSpeech, settings.voskModel])

    // Check Web Speech API support in browser
    useEffect(() => {
        if (!useNativeSpeech) {
            const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
            if (SpeechRecognitionAPI) {
                setIsSupported(true)
                console.log('[Speech] Web Speech API supported')
            } else {
                setIsSupported(false)
                console.warn('[Speech] Web Speech API not supported in this browser')
            }
        } else {
            // Native speech is always "supported" (we download model if needed)
            setIsSupported(true)
        }
    }, [useNativeSpeech])

    // Initialize Web Speech API recognition instance
    useEffect(() => {
        if (useNativeSpeech) return // Skip for Electron

        const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        if (!SpeechRecognitionAPI) return

        const recognition = new SpeechRecognitionAPI()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = VOICE_CONFIG.SPEECH_LANG // 'en-US'

        recognition.onresult = (event: any) => {
            let finalTranscript = ''
            let interimResult = ''

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i]
                if (result.isFinal) {
                    finalTranscript += result[0].transcript
                } else {
                    interimResult += result[0].transcript
                }
            }

            if (finalTranscript) {
                setTranscript((prev) => prev + finalTranscript + ' ')
            }
            setInterimTranscript(interimResult)
        }

        recognition.onerror = (event: any) => {
            console.error('[Speech] Web Speech API error:', event.error)
            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                setError(`Speech recognition error: ${event.error}`)
            }
            setIsListening(false)
        }

        recognition.onend = () => {
            // Only update if we didn't manually stop
            if (shouldListenRef.current) {
                // Auto-restart for continuous recognition
                try {
                    recognition.start()
                } catch (e) {
                    console.log('[Speech] Recognition ended')
                    setIsListening(false)
                }
            } else {
                setIsListening(false)
            }
        }

        recognitionRef.current = recognition

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.abort()
                recognitionRef.current = null
            }
        }
    }, [useNativeSpeech])


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
                // Reset recognizer to clear any previous listeners from prior toggle
                voskService.resetRecognizer()
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
                        const buffer = event.inputBuffer
                        if (buffer.numberOfChannels > 0) {
                            recognizer.acceptWaveform(event.inputBuffer)
                        }
                    } catch (e) {
                        console.error('WASM processing error:', e)
                    }
                }

                source.connect(processor)

                // CRITICAL: Processor MUST be connected to destination for the audio clock to run in Chrome/Electron
                // We connect via a GainNode with 0 gain to prevent feedback (hearing yourself)
                const muteNode = audioContext.createGain()
                muteNode.gain.value = 0
                processor.connect(muteNode)
                muteNode.connect(audioContext.destination)
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
        // Do NOT clear transcript here - allows appending to manual edits
        setInterimTranscript('')

        const sessionId = useChatStore.getState().activeSessionId || 'unknown'

        addLog({
            eventType: 'STATE_CHANGE',
            sessionId,
            component: 'useSpeechRecognition',
            details: { metadata: { state: 'initializing', useNativeSpeech, model: currentModel?.name } }
        })

        if (useNativeSpeech) {
            setIsInitializing(true)
            // ... rest of native logic
            try {
                const electron = (window as any).electron

                // Wait for model config if not yet loaded (though useEffect should have fired)
                let targetModel = currentModel
                if (!targetModel) {
                    console.warn('[Speech] currentModel is null in startListening, resolving fallback...')
                    const preferredModelId = settings.voskModel || 'auto'
                    if (preferredModelId === 'auto') {
                        targetModel = VOICE_CONFIG.VOSK_MODELS.find(m => m.id === VOICE_CONFIG.DEFAULT_MODEL_ID)
                            || VOICE_CONFIG.VOSK_MODELS[0]
                    } else {
                        targetModel = VOICE_CONFIG.VOSK_MODELS.find(m => m.id === preferredModelId)
                            || VOICE_CONFIG.VOSK_MODELS[0]
                    }
                    setCurrentModel(targetModel)
                }

                if (!targetModel) throw new Error("Could not determine speech model")

                const modelId = targetModel.id
                const modelName = targetModel.modelName // Use modelName (slug) instead of human-readable name

                // 1. Ensure Model is Downloaded
                const check = await electron.speech.checkSupport(modelName)

                if (!shouldListenRef.current) return

                if (!check.modelDownloaded) {
                    setIsFirstSetup(true)
                    setSetupProgress(0)
                    console.log(`[Speech] Downloading model ${modelName}...`)
                    addLog({ eventType: 'SYSTEM_INIT', sessionId, component: 'useSpeechRecognition', details: { metadata: { action: 'download_model_start', model: modelName } } })

                    const result = await electron.speech.downloadModel({
                        modelId: modelId,
                        modelName: modelName,
                        url: targetModel.url
                    })

                    if (!result.success) throw new Error(result.error)

                    addLog({ eventType: 'SYSTEM_INIT', sessionId, component: 'useSpeechRecognition', details: { metadata: { action: 'download_model_complete', success: true } } })

                    // STOP after initial download (Do not auto-record)
                    setIsFirstSetup(false)
                    setIsInitializing(false)
                    shouldListenRef.current = false
                    setNotification(`Voice model (${targetModel.name}) ready! Click Mic to start.`)
                    return
                }

                if (!shouldListenRef.current) return

                // 2. Load Model into WASM (if not ready)
                if (!voskService.isReady()) {
                    // Get the correct model path from main process
                    const modelPath = await electron.speech.getModelPath(modelName)
                    if (!modelPath) {
                        throw new Error('Model path not available')
                    }
                    await voskService.loadModel(modelPath)
                }

                if (!shouldListenRef.current) return

                // 3. Start Audio
                setIsListening(true)
                addLog({ eventType: 'STATE_CHANGE', sessionId, component: 'useSpeechRecognition', details: { metadata: { state: 'listening_started', method: 'native', model: modelName } } })
                await startVisualization()

            } catch (e: any) {
                if (shouldListenRef.current) {
                    console.error('[Speech] Start failed:', e)
                    setError(`Setup failed: \${e}`)
                    setIsListening(false)
                    addLog({ eventType: 'ERROR', sessionId, component: 'useSpeechRecognition', details: { error: e.message || String(e) } })
                }
                setIsFirstSetup(false)
            } finally {
                // If we aborted early (download case), this might already be false.
                if (shouldListenRef.current) setIsInitializing(false)
            }
        } else {
            // Web Speech API fallback
            if (!recognitionRef.current) {
                setError('Speech recognition not available')
                return
            }
            try {
                recognitionRef.current.start()
                setIsListening(true)
                await startVisualization()
                addLog({
                    eventType: 'STATE_CHANGE',
                    sessionId,
                    component: 'useSpeechRecognition',
                    details: { metadata: { state: 'listening_started', method: 'web_speech' } }
                })
            } catch (e: any) {
                console.error('[Speech] Failed to start Web Speech API:', e)
                setError(`Failed to start: ${e.message}`)
            }
        }
    }, [isListening, isInitializing, useNativeSpeech, addLog, currentModel])

    const stopListening = useCallback(async () => {
        const sessionId = useChatStore.getState().activeSessionId || 'unknown'
        addLog({ eventType: 'STATE_CHANGE', sessionId, component: 'useSpeechRecognition', details: { metadata: { state: 'listening_stopped' } } })

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
    }, [useNativeSpeech, addLog])

    const resetTranscript = useCallback(() => {
        setTranscript('')
        setInterimTranscript('')
    }, [])

    const setText = useCallback((text: string) => {
        setTranscript(text)
        setInterimTranscript('')
    }, [])

    return {
        isListening,
        transcript,
        interimTranscript,
        error,
        notification,
        isSupported,
        isNativeSupported: useNativeSpeech,
        isInitializing,
        startListening,
        stopListening,
        resetTranscript,
        setText, // Exported
        audioLevel,
        isFirstSetup,
        setupProgress,
        currentModel
    }
}
