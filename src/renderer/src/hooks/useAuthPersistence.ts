
import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'

/**
 * Hook to handle Firebase Auth state persistence
 * Ensures the auth listener is initialized exactly once on app mount.
 * Also initializes the Antigravity OAuth session (restores tokens from storage).
 */
export function useAuthPersistence() {
    const { initializeAuthListener, initializeAntigravity } = useAuthStore()

    useEffect(() => {
        const initAuth = async () => {
            // initializeAuthListener handles FEATURE_FLAGS check internally
            const unsubscribe = await initializeAuthListener()

            // Initialize Antigravity OAuth session (restore tokens from storage)
            await initializeAntigravity()

            return unsubscribe
        }

        const unsubscribePromise = initAuth()

        return () => {
            // Cleanup subscription on unmount
            unsubscribePromise.then(unsub => unsub && unsub())
        }
    }, [initializeAuthListener, initializeAntigravity])
}
