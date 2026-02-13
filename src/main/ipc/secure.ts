import { ipcMain, safeStorage } from 'electron'
import Store from 'electron-store'

// Dedicated store for encrypted secrets
const secretStore = new Store<Record<string, string>>({
    name: 'ai-worker-secrets',
    defaults: {},
}) as Store<Record<string, string>> & {
    get: (key: string) => string | undefined
    set: (key: string, value: string) => void
    delete: (key: string) => void
    store: Record<string, string>
}

// Keys that are allowed to be stored securely
const ALLOWED_SECRET_KEYS = [
    'openai_api_key',
    'gemini_api_key',
    'openrouter_api_key',
] as const

type SecretKey = typeof ALLOWED_SECRET_KEYS[number]

function isAllowedSecretKey(key: string): key is SecretKey {
    return ALLOWED_SECRET_KEYS.includes(key as SecretKey)
}

function getUserSecretKey(key: string, userId?: string): string {
    return userId ? `user_${userId}_${key}` : key
}

export function registerSecureHandlers(): void {
    // Check if encryption is available
    ipcMain.handle('secure:is-available', () => {
        return safeStorage.isEncryptionAvailable()
    })

    // Encrypt and store a secret
    ipcMain.handle('secure:set', async (_event, key: string, value: string, userId?: string) => {
        // Validate key is in allowlist
        if (!isAllowedSecretKey(key)) {
            console.warn(`[Secure] Rejected attempt to store non-whitelisted key: ${key}`)
            return { success: false, error: `Key '${key}' is not allowed in secure storage` }
        }

        if (!safeStorage.isEncryptionAvailable()) {
            // M-04 Security Fix: Strong warning when encryption unavailable
            const configPath = require('electron').app.getPath('userData')
            console.error('⚠️  SECURITY WARNING: OS encryption unavailable. Secrets will be stored in PLAINTEXT.')
            console.error('⚠️  Location:', `${configPath}/ai-worker-secrets.json`)
            console.error('⚠️  This is a security risk. Please ensure your system supports encryption.')
            console.error('⚠️  Affected keys:', ALLOWED_SECRET_KEYS.join(', '))
            
            // Fallback: store without encryption (better than nothing)
            const storeKey = getUserSecretKey(key, userId)
            secretStore.set(storeKey, value)
            return { success: true, encrypted: false }
        }

        try {
            const encrypted = safeStorage.encryptString(value)
            const storeKey = getUserSecretKey(key, userId)
            // Store as base64 string
            secretStore.set(storeKey, encrypted.toString('base64'))
            return { success: true, encrypted: true }
        } catch (error) {
            console.error('[Secure] Encryption failed:', error)
            return { success: false, error: String(error) }
        }
    })

    // Retrieve and decrypt a secret
    ipcMain.handle('secure:get', async (_event, key: string, userId?: string) => {
        if (!isAllowedSecretKey(key)) {
            console.warn(`[Secure] Rejected attempt to get non-whitelisted key: ${key}`)
            return { success: false, error: `Key '${key}' is not allowed` }
        }

        const storeKey = getUserSecretKey(key, userId)
        const stored = secretStore.get(storeKey)

        if (!stored) {
            return { success: true, value: null }
        }

        if (!safeStorage.isEncryptionAvailable()) {
            // Fallback: stored without encryption
            return { success: true, value: stored, encrypted: false }
        }

        try {
            const buffer = Buffer.from(stored, 'base64')
            const decrypted = safeStorage.decryptString(buffer)
            return { success: true, value: decrypted, encrypted: true }
        } catch (error) {
            console.error('[Secure] Decryption failed:', error)
            // Might be plaintext from before encryption was available
            return { success: true, value: stored, encrypted: false }
        }
    })

    // Delete a secret
    ipcMain.handle('secure:delete', async (_event, key: string, userId?: string) => {
        if (!isAllowedSecretKey(key)) {
            return { success: false, error: `Key '${key}' is not allowed` }
        }

        const storeKey = getUserSecretKey(key, userId)
        secretStore.delete(storeKey as any)
        return { success: true }
    })

    // List all secret keys for a user (returns keys only, not values)
    ipcMain.handle('secure:list-keys', async (_event, userId?: string) => {
        const allKeys = Object.keys(secretStore.store)
        const prefix = userId ? `user_${userId}_` : ''
        
        const userKeys = allKeys
            .filter(k => prefix ? k.startsWith(prefix) : !k.includes('user_'))
            .map(k => prefix ? k.replace(prefix, '') : k)
            .filter(k => isAllowedSecretKey(k))

        return { success: true, keys: userKeys }
    })

    console.log('[Secure] Registered secure storage handlers. Encryption available:', safeStorage.isEncryptionAvailable())
}
