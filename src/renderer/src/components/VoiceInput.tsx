import React, { useState, useCallback, useEffect } from 'react'
import { Mic, MicOff, Send, Volume2, VolumeX, X, Maximize2, Minimize2 } from 'lucide-react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'
import { VoiceVisualizer } from './VoiceVisualizer'
import { Square } from 'lucide-react'

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
        setupProgress
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
            // Submit the full transcript (including interim) when stopping
            const finalTranscript = (transcript + ' ' + interimTranscript).trim()
            if (finalTranscript) {
                onSubmit(finalTranscript)
                resetTranscript()
                setTextInput('') // Clear manual input after submission
            }
        } else {
            // Before starting, if we have text in the input box, maybe we want to keep it?
            // For now, let's just start fresh or append.
            // If user explicitly started voice, they likely want to talk.
            startListening()
        }
    }, [isListening, disabled, transcript, interimTranscript, startListening, stopListening, onSubmit, resetTranscript])

    // Update text input as we get transcript results so it's ready for editing
    useEffect(() => {
        if (isListening && transcript) {
            setTextInput(transcript.trim())
        }
    }, [transcript, isListening])

    // Manual stop without sending
    const handleCancel = useCallback(() => {
        // Sync one last time before resetting
        const finalTranscript = (transcript + ' ' + interimTranscript).trim()
        if (finalTranscript) {
            setTextInput(finalTranscript)
        }
        stopListening()
        resetTranscript()
    }, [stopListening, resetTranscript, transcript, interimTranscript])

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
    const displayText = (transcript + ' ' + interimTranscript).trim()

    // Status text
    const getStatusText = () => {
        if (disabled) return 'Processing...'
        if (isFirstSetup) return 'Setting up Voice...'
        if (isInitializing) return 'Starting...'
        if (isListening) return 'Listening...'
        if (isSpeaking) return 'Speaking...'
        return 'Ready'
    }

    // New "Voice Mode" UI when listening
    if (isListening || isInitializing) {
        return (
            <div className="bg-[#1a1d23]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-6 relative overflow-hidden transition-all duration-300 min-h-[160px] flex flex-col items-center justify-center">
                {/* Close Button */}
                <button
                    onClick={handleCancel}
                    className="absolute top-4 right-4 p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                >
                    <X size={20} />
                </button>

                {/* Status Indicator */}
                <div className="absolute top-4 left-4 text-xs font-bold tracking-widest text-white/50 uppercase">
                    {getStatusText()}
                </div>

                {/* Main Visualizer Area */}
                <div className="w-full flex-1 flex flex-col items-center justify-center relative my-2">
                    {isFirstSetup ? (
                        <div className="flex flex-col items-center gap-3 w-full max-w-[240px]">
                            <div className="text-white/80 text-sm font-medium">Setting up voice options for you...</div>
                            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${setupProgress || 0}%` }}
                                />
                            </div>
                            <div className="text-xs text-white/40">Ensuring native engine dependencies...</div>
                        </div>
                    ) : isInitializing ? (
                        <div className="text-white/60 animate-pulse text-sm">Initializing native engine...</div>
                    ) : (
                        <div className="w-full h-24 flex items-center justify-center">
                            <VoiceVisualizer audioLevel={audioLevel} isListening={isListening} />
                        </div>
                    )}
                </div>

                {/* Live Transcript */}
                {displayText && (
                    <div className="text-white/80 text-center font-medium text-lg max-w-xl animate-fade-in mt-4 mb-8 min-h-[1.5em]">
                        "{displayText}"
                    </div>
                )}

                {/* Controls */}
                <div className="flex items-center gap-6 mt-auto">
                    {/* Mute output */}
                    {ttsSupported && (
                        <button
                            onClick={toggleMute}
                            className={`p-3 rounded-full transition-colors ${isMuted ? 'text-red-400 bg-red-400/10' : 'text-white/50 hover:bg-white/10'}`}
                        >
                            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                        </button>
                    )}

                    {/* Stop/Send Button */}
                    <button
                        onClick={handleMicClick}
                        className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:scale-105 active:scale-95 transition-all"
                    >
                        <div className="w-4 h-4 bg-black rounded-[2px]" />
                    </button>
                </div>
            </div>
        )
    }

    // Standard "Text Mode" UI
    return (
        <div className="bg-[#1a1d23]/80 backdrop-blur-md border border-white/10 rounded-2xl p-4 transition-all duration-300">
            <div className="flex items-center gap-3">
                {/* Mic Trigger or Stop Button */}
                {disabled && onAbort ? (
                    <button
                        onClick={onAbort}
                        className="p-3 rounded-xl flex items-center justify-center transition-all active:scale-95 bg-red-500/20 hover:bg-red-500/30 text-red-400"
                        title="Stop Generation"
                    >
                        <Square size={16} className="fill-current" />
                    </button>
                ) : (
                    <button
                        onClick={handleMicClick}
                        disabled={disabled || !sttSupported}
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
                        disabled={disabled}
                        placeholder="Message..."
                        className="
                            w-full bg-transparent border-none outline-none
                            text-white placeholder-white/30 text-base
                            py-2
                        "
                    />
                </div>

                {/* Send Button */}
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
            </div>
        </div>
    )
}
