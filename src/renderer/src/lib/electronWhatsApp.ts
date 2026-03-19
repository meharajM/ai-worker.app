/**
 * electronWhatsApp.ts — Renderer-side IPC bridge for WhatsApp operations.
 *
 * This module is the ONLY place in the renderer that touches
 * `window.electron.whatsapp`. All other code imports from here.
 *
 * Each method gracefully degrades to a no-op / error result when running
 * outside of Electron (e.g., during unit tests or browser-only builds).
 */

import type { WhatsAppConnectionState } from '../stores/whatsappStore'

const isElectron = (): boolean => !!(window.electron && typeof window.electron === 'object')

export interface WhatsAppMessage {
    id: string
    from: string
    content: string
    timestamp: number
    isFromMe: boolean
}

export const electronWhatsApp = {
    getState: async (): Promise<WhatsAppConnectionState> => {
        if (isElectron() && window.electron?.whatsapp) {
            return window.electron.whatsapp.getState()
        }
        return {
            status: 'disconnected',
            qrCode: null,
            error: null,
            phoneNumber: null,
            isVerified: false,
            connectedPhoneNumber: null,
        }
    },

    connect: async (phoneNumber: string | null): Promise<{ success: boolean; error?: string }> => {
        if (isElectron() && window.electron?.whatsapp) {
            return window.electron.whatsapp.connect(phoneNumber ?? '')
        }
        console.warn('[Browser] WhatsApp not supported in browser mode')
        return { success: false, error: 'Not supported in browser mode' }
    },

    disconnect: async (clearAuth?: boolean): Promise<{ success: boolean; error?: string }> => {
        if (isElectron() && window.electron?.whatsapp) {
            return window.electron.whatsapp.disconnect(clearAuth)
        }
        return { success: true }
    },

    setTargetNumber: async (phoneNumber: string): Promise<{ success: boolean; error?: string }> => {
        if (isElectron() && window.electron?.whatsapp) {
            return window.electron.whatsapp.setTargetNumber(phoneNumber)
        }
        return { success: true }
    },

    sendMessage: async (to: string, content: string): Promise<{ success: boolean; error?: string }> => {
        if (isElectron() && window.electron?.whatsapp) {
            return window.electron.whatsapp.sendMessage(to, content)
        }
        console.warn('[Browser] WhatsApp sendMessage not supported')
        return { success: false, error: 'Not supported in browser mode' }
    },

    sendPresence: async (
        to: string,
        state: 'unavailable' | 'available' | 'composing' | 'recording' | 'paused'
    ): Promise<{ success: boolean; error?: string }> => {
        if (isElectron() && window.electron?.whatsapp) {
            return window.electron.whatsapp.sendPresence(to, state)
        }
        console.warn('[Browser] WhatsApp sendPresence not supported')
        return { success: false, error: 'Not supported in browser mode' }
    },

    onConnectionChange: (callback: (state: WhatsAppConnectionState) => void): (() => void) => {
        if (isElectron() && window.electron?.whatsapp) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return window.electron.whatsapp.onConnectionChange(callback as any)
        }
        return () => {}
    },

    onMessage: (callback: (message: WhatsAppMessage) => void): (() => void) => {
        if (isElectron() && window.electron?.whatsapp) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return window.electron.whatsapp.onMessage(callback as any)
        }
        return () => {}
    },
}
