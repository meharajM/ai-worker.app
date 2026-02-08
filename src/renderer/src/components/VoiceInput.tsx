import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Mic, MicOff, Send, X, Maximize2, Minimize2, Square, Folder } from 'lucide-react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useFileDragDrop, generateFileConversionPrompt } from '../hooks/useFileDragDrop'
import { VoiceVisualizer } from './VoiceVisualizer'
import { useLogStore } from '../stores/logStore'
import { useChatStore } from '../stores/chatStore'
import electron from '../lib/electron'

interface VoiceInputProps {
    onSubmit: (message: string) => void
    disabled?: boolean
    onAbort?: () => void
}

export function VoiceInput({ onSubmit, disabled = false, onAbort }: VoiceInputProps) {
    const [textInput, setTextInput] = useState('')
    const [workspacePath, setWorkspacePath] = useState<string | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const { addLog } = useLogStore()
    const { activeSessionId, getActiveSession } = useChatStore()

    // Load workspace from active session
    useEffect(() => {
        const session = getActiveSession()
        setWorkspacePath(session?.workspacePath || null)
    }, [activeSessionId, getActiveSession])

    // Use hook's setText to update transcript manually
    const {
        isListening,
        transcript,
        interimTranscript,
        isSupported: sttSupported,
        startListening,
        stopListening,
        resetTranscript,
        setText, // New function from hook
        isInitializing,
        audioLevel,
        isFirstSetup,
        setupProgress,
        notification
    } = useSpeechRecognition()

    // Sync input with transcript + interim
    useEffect(() => {
        const fullText = (transcript + (interimTranscript ? ' ' + interimTranscript : '')).trim()
        if (fullText !== textInput) {
            // Only update if different to avoid cursor jumping (though React handles this mostly ok)
            // But actually, we SHOULD allow the hook to drive the input value IF we want append to work nicely.
            // Strategy: We rely on `transcript` being the source of truth.
        }
    }, [transcript, interimTranscript])

    // Handle Manual Input
    // When user types, we update local state AND the hook's transcript state
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value
        setTextInput(newValue)
        // Sync back to hook so if we stop/start, we resume from here
        // Note: interimTranscript is usually cleared on stop, but we just update 'transcript'
        setText(newValue)
    }

    // Effect to drive local state from hook (for speech updates)
    useEffect(() => {
        // Construct display text: finalized part + ephemeral part
        // We only overwrite input if the speech engine has something to say
        // OR if it's the initial load.
        // A tricky case: Use types "A", speech says "B" -> "AB"?
        // Current logic: Textarea value = transcript + interim.
        // If user edits, we update 'transcript'.

        const speechText = (transcript + (interimTranscript ? ' ' + interimTranscript : '')) //.trim() - don't trim or we lose trailing spaces user might type?

        // If the hook state changed and it's different from local, sync it.
        // This allows speech to update the box.
        // And since handleInputChange updates the hook, it cycles back but value is same, so no re-render loop.
        if (speechText !== textInput && (isListening || speechText.length > textInput.length)) {
            setTextInput(speechText)
        }
    }, [transcript, interimTranscript, isListening])

    // Auto-resize effect
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
        }
    }, [textInput])


    // Handle mic button click (push-to-talk)
    const handleMicClick = useCallback(() => {
        if (disabled) return

        if (isListening || isInitializing) {
            addLog({
                eventType: 'STATE_CHANGE',
                sessionId: activeSessionId || 'unknown',
                component: 'VoiceInput',
                details: { metadata: { action: 'mic_toggle', intent: 'stop' } }
            })
            stopListening()
        } else {
            addLog({
                eventType: 'STATE_CHANGE',
                sessionId: activeSessionId || 'unknown',
                component: 'VoiceInput',
                details: { metadata: { action: 'mic_toggle', intent: 'start' } }
            })
            // When starting, we ensure the hook has our current text so we append to it
            // (handled by handleInputChange, but good to ensure)
            if (transcript !== textInput) setText(textInput)
            startListening()
        }
    }, [isListening, isInitializing, disabled, startListening, stopListening, textInput, transcript, setText, addLog, activeSessionId])

    // Handle folder selection
    const handleSelectFolder = useCallback(async () => {
        try {
            const selectedPath = await electron.selectFolder()
            if (selectedPath) {
                setWorkspacePath(selectedPath)

                // If no active session, create one with workspace
                const { createSession, activeSessionId: currentSessionId, updateSessionWorkspace } = useChatStore.getState()
                if (!currentSessionId) {
                    createSession(selectedPath)
                } else {
                    // Update existing session's workspace
                    updateSessionWorkspace(currentSessionId, selectedPath)
                }

                addLog({
                    eventType: 'STATE_CHANGE',
                    sessionId: currentSessionId || 'unknown',
                    component: 'VoiceInput',
                    details: { metadata: { action: 'workspace_selected', path: selectedPath } }
                })
            }
        } catch (error) {
            console.error('Failed to select folder:', error)
        }
    }, [addLog])

    // Handle file drag-and-drop
    const handleFilesDropped = useCallback((files: File[]) => {
        const prompt = generateFileConversionPrompt(files)
        setTextInput(prompt)
        setText(prompt)
        
        // Focus textarea for user to edit/send
        textareaRef.current?.focus()
        
        addLog({
            eventType: 'STATE_CHANGE',
            sessionId: activeSessionId || 'unknown',
            component: 'VoiceInput',
            details: { metadata: { action: 'files_dropped', count: files.length } }
        })
    }, [setText, addLog, activeSessionId])

    const { isDragging, dragHandlers } = useFileDragDrop({
        onFilesDropped: handleFilesDropped
    })

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

    // Listen for external population events
    useEffect(() => {
        const handlePopulate = (e: CustomEvent) => {
            const { prompt } = e.detail
            if (prompt) {
                setTextInput(prompt)
                setText(prompt) // Sync with speech hook

                // Focus textarea
                if (textareaRef.current) {
                    textareaRef.current.focus()
                    // Set cursor at the end
                    setTimeout(() => {
                        if (textareaRef.current) {
                            textareaRef.current.scrollTop = textareaRef.current.scrollHeight
                        }
                    }, 0)
                }
            }
        }

        window.addEventListener('populate-chat-input', handlePopulate as EventListener)
        return () => window.removeEventListener('populate-chat-input', handlePopulate as EventListener)
    }, [setText])

    return (
        <div className="bg-[#1a1d23]/80 backdrop-blur-md border border-white/10 rounded-2xl p-4 transition-all duration-300 relative">

            {/* Notification Toast (e.g. Download Complete) */}
            {notification && (
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-emerald-500/90 text-white text-xs px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap animate-in fade-in slide-in-from-bottom-2 duration-300 pointer-events-none border border-emerald-400/50 backdrop-blur-sm">
                    {notification}
                </div>
            )}

            <div className="flex items-end gap-3">
                {/* Left Button: Voice Controls ONLY */}
                {isFirstSetup ? (
                    <div className="p-2 flex items-center justify-center h-[44px]" title="Downloading Speech Model...">
                        <div className="relative w-8 h-8">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-white/10" />
                                <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-emerald-500 transition-all duration-300 ease-out" strokeDasharray={88} strokeDashoffset={88 - (88 * (setupProgress || 0) / 100)} strokeLinecap="round" />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-emerald-400">{Math.round(setupProgress || 0)}%</div>
                        </div>
                    </div>
                ) : isListening || isInitializing ? (
                    <button onClick={handleMicClick} className="p-3 mb-[1px] rounded-xl flex items-center justify-center transition-all active:scale-95 bg-red-500/20 hover:bg-red-500/30 text-red-400 animate-pulse ring-1 ring-red-500/50 h-[44px] w-[44px]" title="Stop Recording">
                        <Square size={16} className="fill-current" />
                    </button>
                ) : (
                    <button onClick={handleMicClick} disabled={disabled || !sttSupported} className={`p-3 mb-[1px] rounded-xl flex items-center justify-center transition-all active:scale-95 shadow-lg group bg-white/5 hover:bg-white/10 text-white/80 hover:text-white h-[44px] w-[44px] ${(disabled || !sttSupported) ? 'opacity-50 cursor-not-allowed' : ''}`} title="Start Voice Mode">
                        <Mic size={20} />
                    </button>
                )}

                {/* Text Input - Auto-expanding Textarea with Drag-and-Drop */}
                <div 
                    className={`flex-1 relative min-h-[44px] flex items-center transition-all duration-200 rounded-lg ${
                        isDragging ? 'ring-2 ring-emerald-500/50 bg-emerald-500/10' : ''
                    }`}
                    {...dragHandlers}
                >
                    {/* Drag Overlay */}
                    {isDragging && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                            <div className="bg-emerald-500/20 backdrop-blur-sm border border-emerald-500/50 rounded-lg px-4 py-2 text-emerald-400 text-sm font-medium shadow-lg">
                                📄 Drop file to convert
                            </div>
                        </div>
                    )}
                    
                    <textarea
                        ref={textareaRef}
                        value={textInput}
                        data-testid="chat-textarea"
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        disabled={disabled && !onAbort}
                        placeholder={isListening ? "Listening..." : isFirstSetup ? "Downloading model..." : "Message... (Shift+Enter for new line, or drag files here)"}
                        rows={1}
                        style={{
                            resize: 'none',
                            minHeight: '24px',
                            maxHeight: '200px'
                        }}
                        className={`
                            w-full bg-transparent border-none outline-none
                            text-base py-2 transition-colors scrollbar-hide
                            ${isListening ? 'text-white/90 placeholder-white/50' : 'text-white placeholder-white/30'}
                        `}
                    />
                </div>

                {/* Workspace Folder Button */}
                <button
                    onClick={handleSelectFolder}
                    disabled={disabled}
                    className={`p-2 mb-[1px] rounded-lg transition-all h-[44px] w-[36px] flex items-center justify-center ${workspacePath
                        ? 'bg-[#00a896]/20 text-[#00a896] hover:bg-[#00a896]/30'
                        : 'bg-transparent text-white/40 hover:text-white/60 hover:bg-white/5'
                        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={workspacePath ? `Workspace: ${workspacePath}` : 'Select workspace folder'}
                >
                    <Folder size={18} />
                </button>

                {/* Right Button: Send OR Stop Generation */}
                {disabled && onAbort ? (
                    <button onClick={onAbort} className="p-2 mb-[1px] rounded-lg transition-all bg-red-500/20 hover:bg-red-500/30 text-red-400 h-[44px] w-[36px] flex items-center justify-center" title="Stop Generation">
                        <Square size={18} className="fill-current" />
                    </button>
                ) : (
                    <button
                        onClick={handleTextSubmit}
                        disabled={disabled || !textInput.trim()}
                        data-testid="send-button"
                        className={`p-2 mb-[1px] rounded-lg transition-all h-[44px] w-[36px] flex items-center justify-center ${textInput.trim() && !disabled ? 'bg-white text-black hover:bg-gray-200' : 'bg-transparent text-white/20 cursor-not-allowed'}`}>
                        <Send size={18} />
                    </button>
                )}
            </div>
        </div>
    )
}
