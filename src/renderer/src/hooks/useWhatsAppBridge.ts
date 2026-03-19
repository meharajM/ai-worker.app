/**
 * useWhatsAppBridge.ts — Subscribes to IPC push events from the main process
 * and syncs them into whatsappStore.
 *
 * Mount once at the top of the app (App.tsx). Components read from
 * useWhatsAppStore directly — they do NOT call IPC themselves.
 *
 * Per react-hooks.md: this hook encapsulates all IPC calls and side effects
 * so components remain testable without mocking Electron.
 */

import { useEffect, useCallback } from 'react'
import { useWhatsAppStore, WhatsAppConnectionState } from '../stores/whatsappStore'
import electron from '../lib/electron'

export function useWhatsAppBridge(): void {
    const setConnectionState = useWhatsAppStore((s) => s.setConnectionState)

    // On mount: fetch initial state from main process
    useEffect(() => {
        let cancelled = false
        electron.whatsapp.getState().then((state) => {
            if (!cancelled) setConnectionState(state as WhatsAppConnectionState)
        }).catch(console.error)
        return () => { cancelled = true }
    }, [setConnectionState])

    // Subscribe to connection state push events from main
    useEffect(() => {
        const unsub = electron.whatsapp.onConnectionChange((state: WhatsAppConnectionState) => {
            setConnectionState(state)

            // Auto-disable WhatsApp mode ONLY when permanently unauthenticated (logged out).
            // Do not disable on transient network errors, as Baileys auto-reconnects.
            if (!state.isVerified) {
                useWhatsAppStore.getState().setWhatsAppEnabled(false)
            }
        })
        return unsub
    }, [setConnectionState])

    // Subscribe to incoming WhatsApp messages — add them to active chat session
    const handleMessage = useCallback((message: {
        id: string
        from: string
        content: string
        timestamp: number
        isFromMe: boolean
    }) => {
        const { whatsappEnabled } = useWhatsAppStore.getState()
        if (!whatsappEnabled || message.isFromMe) return

        // Read state at execution time, not render time (prevents stale closures)
        // Trigger the AI agent execution pipeline via generic window event
        window.dispatchEvent(new CustomEvent('app:submit-message', {
            detail: { 
                content: `📱 **WhatsApp** (${message.from}): ${message.content}`,
                whatsappMetadata: {
                    from: message.from,
                    id: message.id,
                    timestamp: message.timestamp
                }
            }
        }))
    }, [])

    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unsub = electron.whatsapp.onMessage(handleMessage as any)
        return unsub
    }, [handleMessage])
}
