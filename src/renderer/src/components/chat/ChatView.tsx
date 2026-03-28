/**
 * ChatView.tsx — Slim orchestrator for the main chat area.
 *
 * Composes:
 *   - EmptyState — welcome screen + workflow tiles
 *   - MessageBubble — individual message rendering (itself decomposed)
 *   - TypingIndicator — bouncing dots during processing
 *   - ProgressBanner — task progress bar + plan
 *   - JumpToBottom — scroll-to-bottom overlay
 *
 * Store subscriptions and auto-scroll hook remain here.
 */

import React from 'react'
import { Trash2, Eye, EyeOff } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { useDisplayMode } from '../../hooks/useDisplayMode'
import { JumpToBottom } from '../JumpToBottom'

import { MessageBubble } from './MessageBubble'
import { EmptyState } from './EmptyState'
import { TypingIndicator } from './TypingIndicator'
import { ProgressBanner } from './ProgressBanner'

interface ChatViewProps {
  onClearChat?: () => void
}

export function ChatView({ onClearChat }: ChatViewProps) {
  const {
    sessions,
    activeSessionId,
    removeMessage,
    clearMessages,
  } = useChatStore()

  const activeSession = sessions.find(s => s.id === activeSessionId)
  const messages = activeSession?.messages || []
  

  const isProcessing = useChatStore(s => 
    activeSessionId ? s._processingSessions.has(activeSessionId) : false
  )

  const { isDevMode, isPreviewingProd } = useDisplayMode()
  const setDevPreviewProd = useSettingsStore(s => s.setDevPreviewProd)

  const {
    scrollContainerRef,
    messagesEndRef,
    handleScroll,
    isAtBottom,
    hasUnread,
    scrollToBottom,
  } = useAutoScroll(messages, isProcessing)

  const handleClear = () => {
    if (window.confirm('Clear all messages? This cannot be undone.')) {
      clearMessages()
      onClearChat?.()
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Header with clear button + dev toggle */}
      {messages.length > 0 && (
        <div className="flex justify-between items-center px-4 py-2 border-b border-[var(--color-border)]">
          {/* Left side — dev-only prod preview toggle */}
          <div className="flex items-center">
            {isDevMode && (
              <button
                onClick={() => setDevPreviewProd(!isPreviewingProd)}
                className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full transition-all ${
                  isPreviewingProd
                    ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/30'
                    : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
                }`}
                title={isPreviewingProd ? 'Switch back to dev view' : 'Preview how this looks in prod mode'}
              >
                {isPreviewingProd ? (
                  <>
                    <Eye size={12} />
                    Prod Preview ON
                  </>
                ) : (
                  <>
                    <EyeOff size={12} />
                    Prod Preview
                  </>
                )}
              </button>
            )}
          </div>

          {/* Right side — clear chat */}
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/10 transition-all"
          >
            <Trash2 size={14} />
            Clear Chat
          </button>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-4 min-w-0"
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              onDelete={removeMessage}
              isLast={index === messages.length - 1}
            />
          ))
        )}

        {/* Typing indicator */}
        {isProcessing &&
          !messages[messages.length - 1]?.content.includes(
            'Parallel Execution'
          ) && <TypingIndicator />}

        {/* Progress banner */}
        {activeSession && (
          <ProgressBanner session={activeSession} />
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Jump to bottom overlay */}
      <JumpToBottom
        isAtBottom={isAtBottom}
        hasUnread={hasUnread}
        onScrollToBottom={scrollToBottom}
      />
    </div>
  )
}
