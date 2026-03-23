/**
 * whatsappStore.ts — Zustand store for WhatsApp connection state.
 *
 * Owns: connection state, message mode toggle, and target phone number.
 * Subscribes to IPC push events (whatsapp:connection-change, whatsapp:message)
 * via the useWhatsAppBridge hook — NOT here directly.
 *
 * Per zustand-stores.md: stores do not import each other, no class instances
 * are persisted, and all async callbacks read state via getState().
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface WhatsAppConnectionState {
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    qrCode: string | null
    error: string | null
    phoneNumber: string | null
    workerNumber: string | null
    handshakeStatus: 'idle' | 'pending' | 'expired' | 'verified' | null
}

interface WhatsAppState {
    /** Remote connection state mirrored from main process */
    connectionState: WhatsAppConnectionState

    /** Whether "WhatsApp mode" is active for the current chat session */
    whatsappEnabled: boolean

    /** Phone number the user wants to send messages to */
    targetPhoneNumber: string | null

    /** Whether the connection dialog is open */
    isDialogOpen: boolean

    // ── Persisted actions ──────────────────────────────────────────────────
    setWhatsAppEnabled: (enabled: boolean) => void
    setTargetPhoneNumber: (number: string | null) => void
    openDialog: () => void
    closeDialog: () => void

    // ── Runtime-only actions (not persisted) ───────────────────────────────
    /** Called by useWhatsAppBridge when main pushes a new connection state */
    setConnectionState: (state: WhatsAppConnectionState) => void
}

export const useWhatsAppStore = create<WhatsAppState>()(
    persist(
        (set) => ({
            connectionState: {
                status: 'disconnected',
                qrCode: null,
                error: null,
                phoneNumber: null,
                workerNumber: null,
                handshakeStatus: 'idle',
            },
            whatsappEnabled: false,
            targetPhoneNumber: null,
            isDialogOpen: false,

            setWhatsAppEnabled: (enabled) => set({ whatsappEnabled: enabled }),
            setTargetPhoneNumber: (number) => set({ targetPhoneNumber: number }),
            openDialog: () => set({ isDialogOpen: true }),
            closeDialog: () => set({ isDialogOpen: false }),
            setConnectionState: (state) => set({ connectionState: state }),
        }),
        {
            name: 'ai-worker-whatsapp-v1',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                whatsappEnabled: state.whatsappEnabled,
                targetPhoneNumber: state.targetPhoneNumber,
                // connectionState is NOT persisted — always fresh from main on startup
                // isDialogOpen is NOT persisted — always start closed
            }),
        }
    )
)
