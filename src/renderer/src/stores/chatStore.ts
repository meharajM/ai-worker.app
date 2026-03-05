import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ExecutionPlan } from '../lib/agent-protocol'

export interface MessageAction {
    type: 'continue' | 'cancel' | 'custom';
    label: string;
    payload?: Record<string, unknown>;
}

export interface Message {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: number
    toolCalls?: ToolCall[]
    actions?: MessageAction[]
    attachments?: { name: string; path: string; type: string }[]
    thought?: string
    thought_signature?: string
    progress?: number        // 0–100 representation of task completion
    eta?: number             // Estimated time remaining in seconds
    plan?: ExecutionPlan     // Current ExecutionPlan state for the UI
    findings?: string[]      // Summarised findings to show in the UI bubble
}

export interface ToolCall {
    id: string
    name: string
    arguments: Record<string, unknown>
    result?: string
    isPresentable?: boolean  // Whether the tool output was summarised/reported as a finding
    finding?: string         // The summarised finding text for this specific tool call
}

export interface ChatSession {
    id: string
    title: string
    messages: Message[]
    createdAt: number
    updatedAt: number
    workspacePath?: string   // Optional workspace folder for this chat session
    progress?: number
    eta?: number
    plan?: ExecutionPlan
}

/**
 * Per-session runtime entry stored in the `_processingSessions` Map.
 * Never persisted — always ephemeral.
 */
interface SessionProcessingEntry {
    abortController: AbortController;
}

interface ChatState {
    sessions: ChatSession[]
    activeSessionId: string | null

    /**
     * Per-session processing state.
     * Map<sessionId, SessionProcessingEntry> — allows multiple sessions to run
     * concurrently without clobbering each other's abort controllers.
     * NOT persisted (excluded from partialize).
     */
    _processingSessions: Map<string, SessionProcessingEntry>

    // ── Legacy scalar getters (derived from the Map) ─────────────────────────
    // Kept so existing components that read `isProcessing` / `processingSessionId`
    // continue to work without changes.
    /** True if the currently-active session is processing. */
    isProcessing: boolean
    /** ID of the currently-active session if it is processing, else null. */
    processingSessionId: string | null
    /** AbortController for the currently-active session (if processing). */
    abortController: AbortController | null

    offlineSpeech: boolean

    // ── Per-session processing actions ────────────────────────────────────────
    /** Start processing for a specific session. Returns the AbortSignal to pass to the agent. */
    startProcessing: (sessionId: string) => AbortSignal
    /** Stop processing for a specific session (agent finished or errored). */
    stopProcessing: (sessionId: string) => void
    /** Returns true if the given session is actively processing. */
    isSessionProcessing: (sessionId: string) => boolean
    /** Abort a specific session without affecting any other running session. */
    abortSession: (sessionId: string) => void

    // ── Legacy compat actions (operate on the currently-active session) ───────
    setProcessing: (processing: boolean) => void
    abortProcessing: () => void
    getAbortSignal: () => AbortSignal | null

    // Session Actions
    createSession: (workspacePath?: string) => string
    deleteSession: (id: string) => void
    setActiveSession: (id: string) => void
    updateSessionTitle: (id: string, title: string) => void
    updateSessionWorkspace: (id: string, workspacePath: string) => void
    updateSessionProgress: (id: string, progress?: number, eta?: number, plan?: unknown) => void
    setOfflineSpeech: (enabled: boolean) => void

    // Message Actions (primarily target a specific session by ID)
    addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => Message
    addSessionMessage: (sessionId: string, message: Omit<Message, 'id' | 'timestamp'>) => Message
    updateMessage: (id: string, updates: Partial<Message>) => void
    updateSessionMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void
    removeMessage: (id: string) => void
    clearMessages: () => void

    // UI State
    sidebarOpen: boolean
    toggleSidebar: () => void

    // Helpers
    getActiveSession: () => ChatSession | undefined
}

export const useChatStore = create<ChatState>()(
    persist(
        (set, get) => ({
            sessions: [],
            activeSessionId: null,
            _processingSessions: new Map<string, SessionProcessingEntry>(),

            // ── Legacy derived scalars ─────────────────────────────────────────
            // These are getters that read from _processingSessions so existing
            // consumers don't need to change.
            get isProcessing(): boolean {
                const { activeSessionId, _processingSessions } = get();
                if (!activeSessionId) return false;
                return _processingSessions.has(activeSessionId);
            },
            get processingSessionId(): string | null {
                const { activeSessionId, _processingSessions } = get();
                if (activeSessionId && _processingSessions.has(activeSessionId)) {
                    return activeSessionId;
                }
                // Fallback: return the first processing session (for sidebar badge)
                return [..._processingSessions.keys()][0] ?? null;
            },
            get abortController(): AbortController | null {
                const { activeSessionId, _processingSessions } = get();
                if (!activeSessionId) return null;
                return _processingSessions.get(activeSessionId)?.abortController ?? null;
            },

            getActiveSession: () => {
                const { sessions, activeSessionId } = get()
                return sessions.find((s) => s.id === activeSessionId)
            },

            // ── Per-session processing ─────────────────────────────────────────

            startProcessing: (sessionId: string): AbortSignal => {
                const controller = new AbortController();
                // Use functional-updater form so we never read stale state.
                // A new Map is created to guarantee Zustand detects the change.
                set(state => {
                    const next = new Map(state._processingSessions);
                    next.set(sessionId, { abortController: controller });
                    return { _processingSessions: next };
                });
                return controller.signal;
            },

            stopProcessing: (sessionId: string): void => {
                set(state => {
                    const next = new Map(state._processingSessions);
                    next.delete(sessionId);
                    return { _processingSessions: next };
                });
            },

            isSessionProcessing: (sessionId: string): boolean => {
                return get()._processingSessions.has(sessionId);
            },

            abortSession: (sessionId: string): void => {
                // Abort the controller first, then remove from map
                const entry = get()._processingSessions.get(sessionId);
                if (entry) {
                    entry.abortController.abort();
                }
                set(state => {
                    const next = new Map(state._processingSessions);
                    next.delete(sessionId);
                    return { _processingSessions: next };
                });
            },

            // ── Legacy compat ──────────────────────────────────────────────────

            setProcessing: (processing: boolean): void => {
                const { activeSessionId, startProcessing, stopProcessing } = get();
                if (!activeSessionId) return;
                if (processing) {
                    startProcessing(activeSessionId);
                } else {
                    stopProcessing(activeSessionId);
                }
            },

            abortProcessing: (): void => {
                const { activeSessionId } = get();
                if (activeSessionId) {
                    get().abortSession(activeSessionId);
                }
            },

            getAbortSignal: (): AbortSignal | null => {
                const { activeSessionId, _processingSessions } = get();
                if (!activeSessionId) return null;
                return _processingSessions.get(activeSessionId)?.abortController.signal ?? null;
            },

            // ── Session CRUD ───────────────────────────────────────────────────

            createSession: (workspacePath?: string) => {
                const newSession: ChatSession = {
                    id: `chat_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                    title: 'New Chat',
                    messages: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    workspacePath,
                }
                set((state) => ({
                    sessions: [newSession, ...state.sessions],
                    activeSessionId: newSession.id,
                }))
                return newSession.id
            },

            deleteSession: (id: string) => {
                // Abort processing for this session before removing it
                const currentState = get();
                if (currentState._processingSessions.has(id)) {
                    currentState.abortSession(id);
                }

                set((state) => {
                    const newSessions = state.sessions.filter((s) => s.id !== id)
                    let newActiveId = state.activeSessionId
                    if (state.activeSessionId === id) {
                        newActiveId = newSessions.length > 0 ? newSessions[0].id : null
                    }
                    return {
                        sessions: newSessions,
                        activeSessionId: newActiveId,
                    }
                })
            },

            setActiveSession: (id: string) => {
                set({ activeSessionId: id })
            },

            updateSessionTitle: (id: string, title: string) => {
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === id ? { ...s, title, updatedAt: Date.now() } : s
                    ),
                }))
            },

            updateSessionWorkspace: (id: string, workspacePath: string) => {
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === id ? { ...s, workspacePath, updatedAt: Date.now() } : s
                    ),
                }))
            },

            updateSessionProgress: (id: string, progress?: number, eta?: number, plan?: unknown) => {
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === id
                            ? { ...s, progress, eta, plan: plan as ExecutionPlan | undefined, updatedAt: Date.now() }
                            : s
                    ),
                }))
            },

            // ── Message actions ────────────────────────────────────────────────

            addMessage: (message) => {
                const newMessage: Message = {
                    ...message,
                    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                    timestamp: Date.now(),
                }

                set((state) => {
                    let activeId = state.activeSessionId
                    let sessions = state.sessions

                    // Verify activeId is valid
                    if (activeId && !sessions.find(s => s.id === activeId)) {
                        activeId = null
                    }

                    // Auto-create session if none exists
                    if (!activeId) {
                        const newSession: ChatSession = {
                            id: `chat_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                            title: 'New Chat',
                            messages: [],
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                        }
                        sessions = [newSession, ...sessions]
                        activeId = newSession.id
                    }

                    // Update title based on first user message if it's "New Chat"
                    const activeSession = sessions.find(s => s.id === activeId)
                    let newTitle = activeSession?.title
                    if (activeSession && activeSession.messages.length === 0 && message.role === 'user') {
                        newTitle = message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '')
                    }

                    return {
                        sessions: sessions.map((s) =>
                            s.id === activeId
                                ? {
                                    ...s,
                                    messages: [...s.messages, newMessage],
                                    updatedAt: Date.now(),
                                    title: newTitle || s.title,
                                }
                                : s
                        ),
                        activeSessionId: activeId,
                    }
                })
                return newMessage
            },

            addSessionMessage: (sessionId: string, message) => {
                const newMessage: Message = {
                    ...message,
                    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
                    timestamp: Date.now(),
                }

                set((state) => {
                    const sessions = state.sessions.map((s) =>
                        s.id === sessionId
                            ? {
                                ...s,
                                messages: [...s.messages, newMessage],
                                updatedAt: Date.now(),
                            }
                            : s
                    )
                    return { sessions }
                })
                return newMessage
            },

            updateMessage: (id: string, updates: Partial<Message>) => {
                set((state) => {
                    if (!state.activeSessionId) return state
                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === state.activeSessionId
                                ? {
                                    ...s,
                                    messages: s.messages.map((msg) =>
                                        msg.id === id ? { ...msg, ...updates } : msg
                                    ),
                                    updatedAt: Date.now(),
                                }
                                : s
                        ),
                    }
                })
            },

            updateSessionMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => {
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === sessionId
                            ? {
                                ...s,
                                messages: s.messages.map((msg) => {
                                    if (msg.id !== messageId) return msg;
                                    const updatedMsg = { ...msg, ...updates };
                                    // Ensure toolCalls array is replaced correctly
                                    if (updates.toolCalls && Array.isArray(updates.toolCalls)) {
                                        updatedMsg.toolCalls = updates.toolCalls;
                                    }
                                    return updatedMsg;
                                }),
                                updatedAt: Date.now(),
                            }
                            : s
                    ),
                }))
            },

            removeMessage: (id: string) => {
                set((state) => {
                    if (!state.activeSessionId) return state
                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === state.activeSessionId
                                ? {
                                    ...s,
                                    messages: s.messages.filter((msg) => msg.id !== id),
                                    updatedAt: Date.now(),
                                }
                                : s
                        ),
                    }
                })
            },

            clearMessages: () => {
                // Only abort the ACTIVE session — not every running session
                const { activeSessionId, abortSession } = get()
                if (activeSessionId) {
                    abortSession(activeSessionId)
                }

                set((state) => {
                    if (!state.activeSessionId) return state
                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === state.activeSessionId
                                ? { ...s, messages: [], updatedAt: Date.now() }
                                : s
                        ),
                    }
                })
            },

            offlineSpeech: false,
            setOfflineSpeech: (enabled: boolean) => set({ offlineSpeech: enabled }),

            sidebarOpen: true,
            toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
        }),
        {
            // ── Version bump: v2 → v3 ─────────────────────────────────────────
            // WHY: The processing fields (isProcessing, abortController, processingSessionId)
            // are now derived from _processingSessions (a Map). Old persisted state with the
            // flat fields is incompatible and would hydrate incorrectly.
            name: 'ai-worker-chat-v3',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                sessions: state.sessions,
                activeSessionId: state.activeSessionId,
                offlineSpeech: state.offlineSpeech,
                sidebarOpen: state.sidebarOpen,
                // _processingSessions is intentionally excluded — Map is not JSON-serialisable
                // and processing state must always start fresh.
            }),
        }
    )
)
