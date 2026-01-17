
import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'

/**
 * Hook to handle Firebase Auth state persistence
 * Ensures the auth listener is initialized exactly once on app mount
 */
export function useAuthPersistence() {
    const { initializeAuthListener } = useAuthStore()

    useEffect(() => {
        const initAuth = async () => {
             // initializeAuthListener handles FEATURE_FLAGS check internally
            const unsubscribe = await initializeAuthListener()
            return unsubscribe
        }

        const unsubscribePromise = initAuth()

        return () => {
            // Cleanup subscription on unmount
            unsubscribePromise.then(unsub => unsub && unsub())
        }
    }, [initializeAuthListener])
}
