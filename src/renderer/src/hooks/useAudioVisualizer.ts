import { useRef, useEffect, useState } from 'react'

interface UseAudioVisualizerReturn {
    start: (onAudioProcess: (buffer: AudioBuffer) => void) => Promise<void>
    stop: () => void
    audioLevel: number
    error: string | null
}

export function useAudioVisualizer(isActive: boolean): UseAudioVisualizerReturn {
    const [audioLevel, setAudioLevel] = useState(0)
    const [error, setError] = useState<string | null>(null)

    const visMediaStreamRef = useRef<MediaStream | null>(null)
    const visAudioContextRef = useRef<AudioContext | null>(null)
    const visAnimationFrameRef = useRef<number | null>(null)
    const visProcessorRef = useRef<ScriptProcessorNode | null>(null)

    useEffect(() => {
        return () => {
            stop()
        }
    }, [])

    const start = async (onAudioProcess: (buffer: AudioBuffer) => void) => {
        try {
            setError(null)
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000,
                    channelCount: 1,
                }
            })
            visMediaStreamRef.current = stream

            const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext)
            const audioContext = new AudioContextClass({ sampleRate: 16000 })
            visAudioContextRef.current = audioContext

            if (audioContext.state === 'suspended') {
                await audioContext.resume()
            }

            const source = audioContext.createMediaStreamSource(stream)
            const processor = audioContext.createScriptProcessor(4096, 1, 1)
            visProcessorRef.current = processor

            processor.onaudioprocess = (event) => {
                try {
                    // Forward buffer to callback (WASM Recognizer matches)
                    onAudioProcess(event.inputBuffer)
                } catch (e) {
                    console.error('Audio processing callback failed:', e)
                }
            }

            source.connect(processor)

            // CRITICAL: Processor connection to destination (Muted)
            // Required for Chrome/Electron to trigger `onaudioprocess`
            const muteNode = audioContext.createGain()
            muteNode.gain.value = 0
            processor.connect(muteNode)
            muteNode.connect(audioContext.destination)

            // Analyzer for visualization
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
            console.error('[AudioVisualizer] Setup failed', e)
            setError(String(e))
        }
    }

    const stop = () => {
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

    return {
        start,
        stop,
        audioLevel,
        error
    }
}
