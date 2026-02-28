/**
 * IPC handlers for the Perplexity OAuth service.
 *
 * Exposes sign-in, sign-out, asking questions, and status to the renderer.
 * All business logic lives in PerplexityAuthService.
 */

import { ipcMain, safeStorage } from 'electron'
import Store from 'electron-store'
import { PerplexityAuthService } from '../services/PerplexityAuthService'

// Dedicated store for Perplexity auth tokens (same pattern as secure.ts)
const perplexityStore = new Store<Record<string, string>>({
    name: 'perplexity-auth',
    defaults: {},
}) as Store<Record<string, string>> & {
    get: (key: string) => string | undefined
    set: (key: string, value: string) => void
    delete: (key: string) => void
}

let service: PerplexityAuthService | null = null

/** Lazy-initialize the service (only when first IPC call arrives). */
function getService(): PerplexityAuthService {
    if (!service) {
        service = new PerplexityAuthService({
            secureGet: async (key: string) => {
                try {
                    const stored = perplexityStore.get(key)
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
                    perplexityStore.set(key, encrypted)
                } else {
                    perplexityStore.set(key, value)
                }
            },
            secureDelete: async (key: string) => {
                perplexityStore.delete(key)
            },
        })
    }
    return service
}

export function registerPerplexityHandlers(): void {
    // Initialize — restore tokens from storage on app start
    ipcMain.handle('perplexity:initialize', async () => {
        const svc = getService()
        await svc.initialize()
        return svc.getStatus()
    })

    // Sign in — opens Perplexity login window, returns status on completion
    ipcMain.handle('perplexity:sign-in', async () => {
        const svc = getService()
        return await svc.signIn()
    })

    // Sign out — clears tokens
    ipcMain.handle('perplexity:sign-out', async () => {
        const svc = getService()
        await svc.signOut()
        return { success: true }
    })

    // Get status — returns sign-in state without exposing tokens
    ipcMain.handle('perplexity:get-status', async () => {
        const svc = getService()
        return svc.getStatus()
    })

    // General question query leveraging perplexity wrapper
    ipcMain.handle('perplexity:ask', async (_event, prompt: string, opts?: any) => {
        const svc = getService()
        return await svc.ask(prompt, opts)
    })
}
