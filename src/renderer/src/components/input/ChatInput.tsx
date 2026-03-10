/**
 * ChatInput.tsx — Slim orchestrator for the chat input bar.
 *
 * Composes:
 *   - VoiceButton — mic toggle with download progress
 *   - TextArea — auto-resizing text input
 *   - AttachmentBar — file attachment chips
 *   - InputToolbar — workspace picker + headless toggle
 *   - SendButton — submit / stop generation
 *
 * All state management and hooks remain here (useSpeechRecognition,
 * useFileDragDrop). Sub-components are purely presentational.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { useFileDragDrop } from '../../hooks/useFileDragDrop'
import { useLogStore } from '../../stores/logStore'
import { useChatStore } from '../../stores/chatStore'
import electron from '../../lib/electron'

import { VoiceButton } from './VoiceButton'
import { TextArea } from './TextArea'
import { AttachmentBar } from './AttachmentBar'
import { InputToolbar } from './InputToolbar'
import { SendButton } from './SendButton'

interface ChatInputProps {
  onSubmit: (message: string, attachments?: File[], isHeadless?: boolean) => void
  disabled?: boolean
  onAbort?: () => void
}

export function ChatInput({ onSubmit, disabled = false, onAbort }: ChatInputProps) {
  const [textInput, setTextInput] = useState('')
  const [isHeadless, setIsHeadless] = useState(false)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<File[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { addLog } = useLogStore()
  const { activeSessionId, getActiveSession } = useChatStore()

  // Load workspace from active session
  useEffect(() => {
    const session = getActiveSession()
    setWorkspacePath(session?.workspacePath || null)
  }, [activeSessionId, getActiveSession])

  // Speech recognition hook
  const {
    isListening,
    transcript,
    interimTranscript,
    isSupported: sttSupported,
    startListening,
    stopListening,
    resetTranscript,
    setText,
    isInitializing,
    audioLevel,
    isFirstSetup,
    setupProgress,
    notification,
  } = useSpeechRecognition()

  // Sync input with transcript
  useEffect(() => {
    const speechText =
      transcript + (interimTranscript ? ' ' + interimTranscript : '')
    if (
      speechText !== textInput &&
      (isListening || speechText.length > textInput.length)
    ) {
      setTextInput(speechText)
    }
  }, [transcript, interimTranscript, isListening])

  // Handle manual input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setTextInput(newValue)
    setText(newValue)
  }

  // Handle mic toggle
  const handleMicClick = useCallback(() => {
    if (disabled) return
    if (isListening || isInitializing) {
      addLog({
        eventType: 'STATE_CHANGE',
        sessionId: activeSessionId || 'unknown',
        component: 'ChatInput',
        details: { metadata: { action: 'mic_toggle', intent: 'stop' } },
      })
      stopListening()
    } else {
      addLog({
        eventType: 'STATE_CHANGE',
        sessionId: activeSessionId || 'unknown',
        component: 'ChatInput',
        details: { metadata: { action: 'mic_toggle', intent: 'start' } },
      })
      if (transcript !== textInput) setText(textInput)
      startListening()
    }
  }, [
    isListening,
    isInitializing,
    disabled,
    startListening,
    stopListening,
    textInput,
    transcript,
    setText,
    addLog,
    activeSessionId,
  ])

  // Handle folder selection
  const handleSelectFolder = useCallback(async () => {
    try {
      const selectedPath = await electron.selectFolder()
      if (selectedPath) {
        setWorkspacePath(selectedPath)
        const {
          createSession,
          activeSessionId: currentSessionId,
          updateSessionWorkspace,
        } = useChatStore.getState()
        if (!currentSessionId) {
          createSession(selectedPath)
        } else {
          updateSessionWorkspace(currentSessionId, selectedPath)
        }
        addLog({
          eventType: 'STATE_CHANGE',
          sessionId: currentSessionId || 'unknown',
          component: 'ChatInput',
          details: {
            metadata: { action: 'workspace_selected', path: selectedPath },
          },
        })
      }
    } catch (error) {
      console.error('Failed to select folder:', error)
    }
  }, [addLog])

  // Handle file drops
  const handleFilesDropped = useCallback(
    (files: File[]) => {
      setAttachments(prev => [...prev, ...files])
      textareaRef.current?.focus()
      addLog({
        eventType: 'STATE_CHANGE',
        sessionId: activeSessionId || 'unknown',
        component: 'ChatInput',
        details: { metadata: { action: 'files_dropped', count: files.length } },
      })
    },
    [addLog, activeSessionId]
  )

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }, [])

  const { isDragging, dragHandlers } = useFileDragDrop({
    onFilesDropped: handleFilesDropped,
  })

  // Handle submission
  const handleTextSubmit = useCallback(() => {
    const message = textInput.trim()
    const hasAttachments = attachments.length > 0
    if ((message || hasAttachments) && !disabled) {
      onSubmit(message, attachments, isHeadless)
      setTextInput('')
      setAttachments([])
      resetTranscript()
    }
  }, [textInput, attachments, disabled, onSubmit, resetTranscript, isHeadless])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleTextSubmit()
      }
    },
    [handleTextSubmit]
  )

  // Listen for external population events (from WorkflowTiles)
  useEffect(() => {
    const handlePopulate = (e: CustomEvent) => {
      const { prompt } = e.detail
      if (prompt) {
        setTextInput(prompt)
        setText(prompt)

        if (textareaRef.current) {
          textareaRef.current.focus()
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.scrollTop = textareaRef.current.scrollHeight
            }
          }, 0)
        }
      }
    }
    window.addEventListener(
      'populate-chat-input',
      handlePopulate as EventListener
    )
    return () =>
      window.removeEventListener(
        'populate-chat-input',
        handlePopulate as EventListener
      )
  }, [setText, disabled, isHeadless, onSubmit, resetTranscript])

  const hasContent = textInput.trim().length > 0 || attachments.length > 0

  return (
    <div className="bg-[var(--color-surface)]/90 backdrop-blur-xl border border-[var(--color-border)] rounded-[24px] p-3 shadow-2xl shadow-black/50 transition-all duration-300 relative group hover:border-[var(--color-border-hover)]">
      {/* Notification Toast */}
      {notification && (
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-emerald-500/90 text-white text-xs px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap animate-in fade-in slide-in-from-bottom-2 duration-300 pointer-events-none border border-emerald-400/50 backdrop-blur-sm">
          {notification}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {/* Attachment chips */}
        <AttachmentBar attachments={attachments} onRemove={removeAttachment} />

        <div
          className={`relative min-h-[44px] flex items-center transition-all duration-200 rounded-lg ${
            isDragging ? 'ring-2 ring-emerald-500/50 bg-emerald-500/10' : ''
          }`}
          {...dragHandlers}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="bg-emerald-500/20 backdrop-blur-sm border border-emerald-500/50 rounded-lg px-4 py-2 text-emerald-400 text-sm font-medium shadow-lg">
                📄 Drop file to convert
              </div>
            </div>
          )}

          <TextArea
            value={textInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={disabled && !onAbort}
            isListening={isListening}
            isFirstSetup={isFirstSetup}
            textareaRef={textareaRef}
          />
        </div>

        {/* Action Row */}
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-2">
            {/* Voice controls */}
            <VoiceButton
              isListening={isListening}
              isInitializing={isInitializing}
              isFirstSetup={isFirstSetup}
              setupProgress={setupProgress}
              sttSupported={sttSupported}
              disabled={disabled}
              onClick={handleMicClick}
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Toolbar buttons */}
            <InputToolbar
              workspacePath={workspacePath}
              isHeadless={isHeadless}
              onToggleHeadless={() => setIsHeadless(!isHeadless)}
              onSelectFolder={handleSelectFolder}
              disabled={disabled}
            />

            {/* Send / Stop button */}
            <SendButton
              disabled={disabled}
              onAbort={onAbort}
              onSubmit={handleTextSubmit}
              hasContent={hasContent}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
