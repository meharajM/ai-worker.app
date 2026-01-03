import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('chatStore', () => {
    let useChatStore: any

    beforeEach(async () => {
        // Reset modules to get fresh store
        vi.resetModules()

        // Import the store
        const module = await import('../../../src/renderer/src/stores/chatStore')
        useChatStore = module.useChatStore

        // Reset store state
        useChatStore.setState({
            sessions: [],
            activeSessionId: null,
            isProcessing: false,
        })
    })

    describe('createSession', () => {
        it('should create a new session and set it as active', () => {
            const sessionId = useChatStore.getState().createSession()

            const state = useChatStore.getState()
            expect(state.sessions).toHaveLength(1)
            expect(state.activeSessionId).toBe(sessionId)
            expect(state.sessions[0].title).toBe('New Chat')
        })

        it('should add new session at the beginning of the list', () => {
            useChatStore.getState().createSession()
            const secondId = useChatStore.getState().createSession()

            const state = useChatStore.getState()
            expect(state.sessions).toHaveLength(2)
            expect(state.sessions[0].id).toBe(secondId)
        })
    })

    describe('deleteSession', () => {
        it('should delete a session', () => {
            const sessionId = useChatStore.getState().createSession()
            useChatStore.getState().deleteSession(sessionId)

            const state = useChatStore.getState()
            expect(state.sessions).toHaveLength(0)
        })

        it('should switch active session when deleting current one', () => {
            const firstId = useChatStore.getState().createSession()
            useChatStore.getState().createSession()
            useChatStore.getState().setActiveSession(firstId)

            useChatStore.getState().deleteSession(firstId)

            const state = useChatStore.getState()
            expect(state.activeSessionId).not.toBe(firstId)
            expect(state.sessions).toHaveLength(1)
        })
    })

    describe('addMessage', () => {
        it('should add a message to the active session', () => {
            useChatStore.getState().createSession()

            const message = useChatStore.getState().addMessage({
                role: 'user',
                content: 'Hello, AI!',
            })

            const session = useChatStore.getState().getActiveSession()
            expect(session?.messages).toHaveLength(1)
            expect(session?.messages[0].content).toBe('Hello, AI!')
            expect(message.id).toBeDefined()
        })

        it('should auto-create session if none exists', () => {
            const message = useChatStore.getState().addMessage({
                role: 'user',
                content: 'Test message',
            })

            const state = useChatStore.getState()
            expect(state.sessions).toHaveLength(1)
            expect(state.activeSessionId).toBeDefined()
        })

        it('should update session title from first user message', () => {
            useChatStore.getState().createSession()
            useChatStore.getState().addMessage({
                role: 'user',
                content: 'This is a very long message that should be truncated in the title',
            })

            const session = useChatStore.getState().getActiveSession()
            expect(session?.title).toBe('This is a very long message th...')
        })
    })

    describe('updateMessage', () => {
        it('should update an existing message', () => {
            useChatStore.getState().createSession()
            const message = useChatStore.getState().addMessage({
                role: 'user',
                content: 'Original content',
            })

            useChatStore.getState().updateMessage(message.id, {
                content: 'Updated content',
            })

            const session = useChatStore.getState().getActiveSession()
            expect(session?.messages[0].content).toBe('Updated content')
        })
    })

    describe('clearMessages', () => {
        it('should clear all messages in active session', () => {
            useChatStore.getState().createSession()
            useChatStore.getState().addMessage({ role: 'user', content: 'Message 1' })
            useChatStore.getState().addMessage({ role: 'assistant', content: 'Response 1' })

            useChatStore.getState().clearMessages()

            const session = useChatStore.getState().getActiveSession()
            expect(session?.messages).toHaveLength(0)
        })
    })

    describe('setProcessing', () => {
        it('should toggle processing state', () => {
            useChatStore.getState().setProcessing(true)
            expect(useChatStore.getState().isProcessing).toBe(true)

            useChatStore.getState().setProcessing(false)
            expect(useChatStore.getState().isProcessing).toBe(false)
        })
    })
})
