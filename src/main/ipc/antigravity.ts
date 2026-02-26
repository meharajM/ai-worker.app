/**
 * IPC handlers for the Antigravity OAuth service.
 *
 * Exposes sign-in, sign-out, token retrieval, and status to the renderer.
 * All business logic lives in AntigravityAuthService — handlers are thin routers.
 */

import { ipcMain, safeStorage } from 'electron'
import Store from 'electron-store'
import { AntigravityAuthService } from '../services/AntigravityAuthService'

// Dedicated store for Antigravity auth tokens (same pattern as secure.ts)
const antigravityStore = new Store<Record<string, string>>({
    name: 'antigravity-auth',
    defaults: {},
}) as Store<Record<string, string>> & {
    get: (key: string) => string | undefined
    set: (key: string, value: string) => void
    delete: (key: string) => void
}

let service: AntigravityAuthService | null = null

/** Lazy-initialize the service (only when first IPC call arrives). */
function getService(): AntigravityAuthService {
    if (!service) {
        service = new AntigravityAuthService({
            secureGet: async (key: string) => {
                try {
                    const stored = antigravityStore.get(key)
                    if (!stored) return { value: null }
                    if (safeStorage.isEncryptionAvailable()) {
                        const decrypted = safeStorage.decryptString(Buffer.from(stored, 'base64'))
                        return { value: decrypted }
                    }
                    return { value: stored }
                } catch {
                    return { value: null }
                }
            },
            secureSet: async (key: string, value: string) => {
                if (safeStorage.isEncryptionAvailable()) {
                    const encrypted = safeStorage.encryptString(value).toString('base64')
                    antigravityStore.set(key, encrypted)
                } else {
                    antigravityStore.set(key, value)
                }
            },
            secureDelete: async (key: string) => {
                antigravityStore.delete(key)
            },
        })
    }
    return service
}

export function registerAntigravityHandlers(): void {
    // Initialize — restore tokens from storage on app start
    ipcMain.handle('antigravity:initialize', async () => {
        const svc = getService()
        await svc.initialize()
        return svc.getStatus()
    })

    // Sign in — opens OAuth consent screen, returns status on completion
    ipcMain.handle('antigravity:sign-in', async () => {
        const svc = getService()
        return svc.signIn()
    })

    // Get access token — refreshes if expired, used by renderer's callGemini
    ipcMain.handle('antigravity:get-token', async () => {
        const svc = getService()
        const token = await svc.getToken()
        const headers = token ? svc.getHeaders() : null
        return { token, headers }
    })

    // Sign out — clears tokens
    ipcMain.handle('antigravity:sign-out', async () => {
        const svc = getService()
        await svc.signOut()
        return { success: true }
    })

    // Get status — returns sign-in state without exposing tokens
    ipcMain.handle('antigravity:get-status', async () => {
        const svc = getService()
        return svc.getStatus()
    })

    // Proxy request — performs fetch from main process to bypass header restrictions
    ipcMain.handle('antigravity:call-gateway', async (_event, url: string, headers: Record<string, string>, body: string) => {
        const svc = getService()
        return await svc.callGateway(url, headers, body)
    })
}

