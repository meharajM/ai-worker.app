/**
 * Manages smart auto-scroll behaviour for a scrollable message container.
 *
 * Tracks whether the user is at the bottom of the scroll area, detects
 * unread messages that arrive while the user has scrolled up, and provides
 * an imperative `scrollToBottom` helper.
 *
 * Why a hook? — The IntersectionObserver, scroll listener, and conditional
 * auto-scroll effects are side-effects that belong outside the component
 * body per project conventions (react-hooks.md / react-components.md).
 */

import { useRef, useEffect, useState, useCallback } from 'react'

/** Shape of a message — only the fields we inspect. */
interface ScrollMessage {
  role: string
}

/** Explicit return type per react-hooks.md */
interface UseAutoScrollReturn {
  /** Attach to the scrollable container element */
  scrollContainerRef: React.RefObject<HTMLDivElement>
  /** Attach to the invisible anchor element at the end of the list */
  messagesEndRef: React.RefObject<HTMLDivElement>
  /** Bind as the `onScroll` handler of the scroll container */
  handleScroll: () => void
  /** Whether the user is currently at the bottom of the list */
  isAtBottom: boolean
  /** Whether new assistant messages arrived while the user was scrolled up */
  hasUnread: boolean
  /** Imperatively scroll to the bottom and reset unread state */
  scrollToBottom: () => void
}

/**
 * @param messages  The current list of chat messages (used to trigger auto-scroll).
 * @param isProcessing  Whether the agent is currently streaming a response.
 */
export function useAutoScroll(
  messages: ScrollMessage[],
  isProcessing: boolean
): UseAutoScrollReturn {
  // null! initializer ensures RefObject<HTMLDivElement> (not RefObject<HTMLDivElement | null>)
  // which is required by the JSX ref attribute in React 18.
  const scrollContainerRef = useRef<HTMLDivElement>(null!)
  const messagesEndRef = useRef<HTMLDivElement>(null!)

  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasUnread, setHasUnread] = useState(false)

  // ── Scroll position tracking ──────────────────────────────────────────
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    // 50 px threshold accounts for rounding errors and fast scrolling
    const atBottom = scrollHeight - scrollTop - clientHeight < 50

    setIsAtBottom(atBottom)
    if (atBottom) {
      setHasUnread(false)
    }
  }, [])

  // ── IntersectionObserver on the bottom anchor ─────────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsAtBottom(true)
          setHasUnread(false)
        }
      },
      { root: scrollContainerRef.current, threshold: 0.1 }
    )

    if (messagesEndRef.current) {
      observer.observe(messagesEndRef.current)
    }

    return () => observer.disconnect()
  }, [])

  // ── Conditional auto-scroll on new messages ───────────────────────────
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1]
      // User messages always force-scroll so the sender sees their own text
      if (lastMsg.role === 'user') {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      } else {
        setHasUnread(true)
      }
    }
  }, [messages, isProcessing, isAtBottom])

  // ── Imperative scroll-to-bottom ───────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setIsAtBottom(true)
    setHasUnread(false)
  }, [])

  return {
    scrollContainerRef,
    messagesEndRef,
    handleScroll,
    isAtBottom,
    hasUnread,
    scrollToBottom
  }
}
