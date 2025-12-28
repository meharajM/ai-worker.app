import React, { useState, useCallback, useEffect } from 'react'
import { Mic, MicOff, Send, Volume2, VolumeX } from 'lucide-react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'

interface VoiceInputProps {
    onSubmit: (message: string) => void
    disabled?: boolean
}

export function VoiceInput({ onSubmit, disabled = false }: VoiceInputProps) {
    const [textInput, setTextInput] = useState('')
    const {
        isListening,
        transcript,
        interimTranscript,
        isSupported: sttSupported,
        startListening,
        stopListening,
        resetTranscript,
    } = useSpeechRecognition()

    const {
        isSpeaking,
        isMuted,
        isSupported: ttsSupported,
        toggleMute,
    } = useSpeechSynthesis()

    // Handle mic button click (push-to-talk)
    const handleMicClick = useCallback(() => {
        if (disabled) return

        if (isListening) {
            stopListening()
            // Submit the transcript when stopping
            const finalTranscript = transcript.trim()
            if (finalTranscript) {
                onSubmit(finalTranscript)
                resetTranscript()
            }
        } else {
            startListening()
        }
    }, [isListening, disabled, transcript, startListening, stopListening, onSubmit, resetTranscript])

    // Handle text input submission
    const handleTextSubmit = useCallback(() => {
        const message = textInput.trim()
        if (message && !disabled) {
            onSubmit(message)
            setTextInput('')
        }
    }, [textInput, disabled, onSubmit])

    // Handle Enter key in text input
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleTextSubmit()
        }
    }, [handleTextSubmit])

    // Display text (transcript or interim)
    const displayText = isListening
        ? (transcript + ' ' + interimTranscript).trim() || 'Listening...'
        : transcript || ''

    // Status text
    const getStatusText = () => {
        if (disabled) return 'Processing...'
        if (isListening) return 'LISTENING'
        if (isSpeaking) return 'SPEAKING'
        return 'READY'
    }

    const getHelperText = () => {
        if (disabled) return 'Please wait...'
        if (isListening) return 'Click mic to stop and send'
        if (!sttSupported) return 'Voice not supported - use text input'
        return 'Click mic to speak or type below'
    }

    return (
        <div className="bg-[#1a1d23]/80 backdrop-blur-md border border-white/10 rounded-2xl p-4 space-y-4">
            {/* Voice Input Area */}
            <div className="flex items-center gap-4">
                {/* Mic Button */}
                <button
                    onClick={handleMicClick}
                    disabled={disabled || !sttSupported}
                    className={`
            w-14 h-14 rounded-xl flex items-center justify-center 
            transition-all active:scale-95 shadow-lg group
            ${isListening
                            ? 'bg-red-500 shadow-red-500/30 animate-pulse'
                            : 'bg-[#ee5d5d] shadow-[#ee5d5d]/20 hover:bg-[#ff6e6e]'
                        }
            ${(disabled || !sttSupported) ? 'opacity-50 cursor-not-allowed' : ''}
          `}
                >
                    {isListening ? (
                        <MicOff size={28} className="text-white" />
                    ) : (
                        <Mic size={28} className="text-white group-hover:scale-110 transition-transform" />
                    )}
                </button>

                {/* Status & Transcript */}
                <div className="flex-1 min-w-0">
                    <div className={`text-[10px] uppercase tracking-widest font-bold mb-1 ${isListening ? 'text-red-500' : 'text-[#ee5d5d]'
                        }`}>
                        {getStatusText()}
                    </div>
                    <div className="text-lg text-white/80 font-medium truncate">
                        {displayText || getHelperText()}
                    </div>
                </div>

                {/* Mute Toggle */}
                {ttsSupported && (
                    <button
                        onClick={toggleMute}
                        className={`
              p-3 rounded-lg transition-colors
              ${isMuted
                                ? 'bg-white/5 text-white/40'
                                : 'bg-white/10 text-white/80 hover:bg-white/15'
                            }
            `}
                        title={isMuted ? 'Unmute voice responses' : 'Mute voice responses'}
                    >
                        {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                    </button>
                )}
            </div>

            {/* Text Input Area */}
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    placeholder="Or type your message here..."
                    className="
            flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3
            text-white placeholder-white/40 outline-none
            focus:border-white/20 focus:bg-white/10 transition-all
            disabled:opacity-50 disabled:cursor-not-allowed
          "
                />
                <button
                    onClick={handleTextSubmit}
                    disabled={disabled || !textInput.trim()}
                    className={`
            p-3 rounded-xl transition-all
            ${textInput.trim() && !disabled
                            ? 'bg-[#4fd1c5] text-white hover:bg-[#5fe0d4] shadow-lg shadow-[#4fd1c5]/20'
                            : 'bg-white/5 text-white/30 cursor-not-allowed'
                        }
          `}
                >
                    <Send size={20} />
                </button>
            </div>
        </div>
    )
}
