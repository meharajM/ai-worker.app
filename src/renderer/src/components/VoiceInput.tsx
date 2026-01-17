import React, { useState, useCallback, useEffect } from 'react'
import { Mic, MicOff, Send, Volume2, VolumeX, X, Maximize2, Minimize2, Square } from 'lucide-react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'
import { VoiceVisualizer } from './VoiceVisualizer'

interface VoiceInputProps {
    onSubmit: (message: string) => void
    disabled?: boolean
    onAbort?: () => void
}

export function VoiceInput({ onSubmit, disabled = false, onAbort }: VoiceInputProps) {
    const [textInput, setTextInput] = useState('')
    const {
        isListening,
        transcript,
        interimTranscript,
        isSupported: sttSupported,
        startListening,
        stopListening,
        resetTranscript,
        isInitializing,
        audioLevel,
        isFirstSetup,
        setupProgress,
        notification
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

        if (isListening || isInitializing) {
            stopListening()
        } else {
            startListening()
        }
    }, [isListening, isInitializing, disabled, startListening, stopListening])

    // Update text input as we get transcript results
    useEffect(() => {
        const fullText = (transcript + ' ' + interimTranscript).trim()
        if (fullText) {
            setTextInput(fullText)
        }
    }, [transcript, interimTranscript])

    // Handle text input submission
    const handleTextSubmit = useCallback(() => {
        const message = textInput.trim()
        if (message && !disabled) {
            onSubmit(message)
            setTextInput('')
            resetTranscript()
        }
    }, [textInput, disabled, onSubmit, resetTranscript])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleTextSubmit()
        }
    }, [handleTextSubmit])

    return (
        <div className="bg-[#1a1d23]/80 backdrop-blur-md border border-white/10 rounded-2xl p-4 transition-all duration-300 relative">

            {/* Notification Toast (e.g. Download Complete) */}
            {notification && (
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-emerald-500/90 text-white text-xs px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap animate-in fade-in slide-in-from-bottom-2 duration-300 pointer-events-none border border-emerald-400/50 backdrop-blur-sm">
                    {notification}
                </div>
            )}

            <div className="flex items-center gap-3">
                {/* Left Button: Voice Controls ONLY */}
                {isFirstSetup ? (
                    /* Downloading Progress */
                    <div className="p-2 flex items-center justify-center" title="Downloading Speech Model...">
                        <div className="relative w-8 h-8">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle
                                    cx="16" cy="16" r="14"
                                    stroke="currentColor" strokeWidth="3"
                                    fill="transparent"
                                    className="text-white/10"
                                />
                                <circle
                                    cx="16" cy="16" r="14"
                                    stroke="currentColor" strokeWidth="3"
                                    fill="transparent"
                                    className="text-emerald-500 transition-all duration-300 ease-out"
                                    strokeDasharray={88}
                                    strokeDashoffset={88 - (88 * (setupProgress || 0) / 100)}
                                    strokeLinecap="round"
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-emerald-400">
                                {Math.round(setupProgress || 0)}%
                            </div>
                        </div>
                    </div>
                ) : isListening || isInitializing ? (
                    /* Active Listening (Stop Recording) */
                    <button
                        onClick={handleMicClick}
                        className="p-3 rounded-xl flex items-center justify-center transition-all active:scale-95 bg-red-500/20 hover:bg-red-500/30 text-red-400 animate-pulse ring-1 ring-red-500/50"
                        title={isInitializing ? "Initializing... Click to Cancel" : "Stop Recording"}
                    >
                        <Square size={16} className="fill-current" />
                    </button>
                ) : (
                    /* Idle Mic */
                    <button
                        onClick={handleMicClick}
                        disabled={disabled || !sttSupported} // Disabled if generating text? Maybe user wants to talk while generating? Usually disabled.
                        className={`
                            p-3 rounded-xl flex items-center justify-center 
                            transition-all active:scale-95 shadow-lg group
                            bg-white/5 hover:bg-white/10 text-white/80 hover:text-white
                            ${(disabled || !sttSupported) ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                        title="Start Voice Mode"
                    >
                        <Mic size={20} />
                    </button>
                )}

                {/* Text Input */}
                <div className="flex-1 relative">
                    <input
                        type="text"
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={disabled && !onAbort} // Disable if processing but no abort (rare)
                        placeholder={isListening ? "Listening..." : isFirstSetup ? "Downloading model..." : "Message..."}
                        className={`
                            w-full bg-transparent border-none outline-none
                            text-base py-2 transition-colors
                            ${isListening ? 'text-white/90 placeholder-white/50' : 'text-white placeholder-white/30'}
                        `}
                    />
                </div>

                {/* Right Button: Send OR Stop Generation */}
                {disabled && onAbort ? (
                    <button
                        onClick={onAbort}
                        className="p-2 rounded-lg transition-all bg-red-500/20 hover:bg-red-500/30 text-red-400"
                        title="Stop Generation"
                    >
                        <Square size={18} className="fill-current" />
                    </button>
                ) : (
                    <button
                        onClick={handleTextSubmit}
                        disabled={disabled || !textInput.trim()}
                        className={`
                            p-2 rounded-lg transition-all
                            ${textInput.trim() && !disabled
                                ? 'bg-white text-black hover:bg-gray-200'
                                : 'bg-transparent text-white/20 cursor-not-allowed'
                            }
                        `}
                    >
                        <Send size={18} />
                    </button>
                )}
            </div>
        </div>
    )
}
