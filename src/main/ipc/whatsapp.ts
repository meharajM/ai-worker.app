/**
 * whatsapp.ts — IPC handlers for WhatsApp operations.
 *
 * Thin router: validate args → call whatsappService → return result.
 * All business logic lives in WhatsAppService.ts.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { whatsappService } from '../services/WhatsAppService'

export function registerWhatsAppHandlers(): void {
    // Attempt auto-restore of saved session credentials
    whatsappService.init().catch(e => console.error('[whatsapp.ts] Init failed', e))

    // ── One-way state push: main → renderer ─────────────────────────────────
    // When connection state changes, push it to all renderer windows.
    whatsappService.on('connectionChange', (state) => {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send('whatsapp:connection-change', state)
            }
        }
    })

    // When a new WhatsApp message arrives, push it to all renderer windows.
    whatsappService.on('message', (message) => {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send('whatsapp:message', message)
            }
        }
    })

    // ── Request/response handlers ────────────────────────────────────────────

    ipcMain.handle('whatsapp:get-state', async () => {
        return whatsappService.getConnectionState()
    })

    ipcMain.handle('whatsapp:connect', async (_event, phoneNumber: unknown) => {
        if (typeof phoneNumber !== 'string' || phoneNumber.trim() === '') {
            throw new Error('Invalid phone number argument')
        }
        try {
            await whatsappService.connect(phoneNumber.trim())
            return { success: true }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    ipcMain.handle('whatsapp:disconnect', async (_event, clearAuth: unknown) => {
        try {
            await whatsappService.disconnect(clearAuth !== false)
            return { success: true }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    ipcMain.handle('whatsapp:send-message', async (_event, to: unknown, content: unknown) => {
        if (typeof to !== 'string' || to.trim() === '') {
            throw new Error('Invalid "to" argument')
        }
        if (typeof content !== 'string' || content.trim() === '') {
            throw new Error('Invalid "content" argument')
        }
        return whatsappService.sendMessage(to.trim(), content.trim())
    })

    ipcMain.handle('whatsapp:send-presence', async (_event, to: unknown, state: unknown) => {
        if (typeof to !== 'string' || to.trim() === '') {
            throw new Error('Invalid "to" argument')
        }
        if (typeof state !== 'string' || !['unavailable', 'available', 'composing', 'recording', 'paused'].includes(state)) {
            throw new Error('Invalid "state" argument')
        }
        return whatsappService.sendPresence(to.trim(), state as 'unavailable' | 'available' | 'composing' | 'recording' | 'paused')
    })
}
