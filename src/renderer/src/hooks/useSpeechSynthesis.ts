import { useState, useCallback, useRef, useEffect } from 'react'
import { VOICE_CONFIG, FEATURE_FLAGS } from '../lib/constants'

interface UseSpeechSynthesisReturn {
    isSpeaking: boolean
    isMuted: boolean
    isSupported: boolean
    speak: (text: string) => void
    stop: () => void
    toggleMute: () => void
    setMuted: (muted: boolean) => void
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
    const [isSpeaking, setIsSpeaking] = useState(false)
    const [isMuted, setIsMuted] = useState(!FEATURE_FLAGS.TTS_ENABLED)
    const [isSupported, setIsSupported] = useState(false)

    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

    useEffect(() => {
        if ('speechSynthesis' in window) {
            setIsSupported(true)
        }
    }, [])

    const speak = useCallback((text: string) => {
        if (!isSupported || isMuted || !text.trim()) {
            return
        }

        // Cancel any ongoing speech
        window.speechSynthesis.cancel()

        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = VOICE_CONFIG.SPEECH_LANG
        utterance.rate = VOICE_CONFIG.TTS_RATE
        utterance.pitch = VOICE_CONFIG.TTS_PITCH

        utterance.onstart = () => {
            setIsSpeaking(true)
        }

        utterance.onend = () => {
            setIsSpeaking(false)
        }

        utterance.onerror = (event) => {
            console.error('Speech synthesis error:', event.error)
            setIsSpeaking(false)
        }

        utteranceRef.current = utterance
        window.speechSynthesis.speak(utterance)
    }, [isSupported, isMuted])

    const stop = useCallback(() => {
        if (isSupported) {
            window.speechSynthesis.cancel()
            setIsSpeaking(false)
        }
    }, [isSupported])

    const toggleMute = useCallback(() => {
        setIsMuted((prev) => {
            if (!prev) {
                // Muting - stop any current speech
                window.speechSynthesis.cancel()
                setIsSpeaking(false)
            }
            return !prev
        })
    }, [])

    const setMutedState = useCallback((muted: boolean) => {
        setIsMuted(muted)
        if (muted) {
            window.speechSynthesis.cancel()
            setIsSpeaking(false)
        }
    }, [])

    return {
        isSpeaking,
        isMuted,
        isSupported,
        speak,
        stop,
        toggleMute,
        setMuted: setMutedState,
    }
}
