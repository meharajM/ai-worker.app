/**
 * WakeLockService.ts — Main-process wake lock management.
 *
 * Keeps the system awake while WhatsApp is connected so the app
 * can receive incoming messages from the user's phone without interruption.
 *
 * Usage:
 *   import { wakeLockService } from './WakeLockService'
 *   wakeLockService.acquire()
 *   wakeLockService.release()
 */

import { powerSaveBlocker } from 'electron'

class WakeLockService {
    private lockId: number | null = null

    /** Acquire a wake lock. No-op if already held. */
    acquire(): void {
        if (this.lockId !== null) return
        try {
            this.lockId = powerSaveBlocker.start('prevent-app-suspension')
            console.log('[WakeLockService] Acquired (ID:', this.lockId, ')')
        } catch (e) {
            console.error('[WakeLockService] Failed to acquire:', e)
        }
    }

    /** Release the wake lock. No-op if not held. */
    release(): void {
        if (this.lockId === null) return
        try {
            powerSaveBlocker.stop(this.lockId)
            console.log('[WakeLockService] Released (ID:', this.lockId, ')')
        } catch (e) {
            console.error('[WakeLockService] Failed to release:', e)
        }
        this.lockId = null
    }

    get isActive(): boolean {
        return this.lockId !== null
    }
}

/** Singleton — one wake lock service per main process. */
export const wakeLockService = new WakeLockService()
