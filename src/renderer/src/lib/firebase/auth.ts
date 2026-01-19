// Firebase Auth wrappers
import type { User, UserCredential } from 'firebase/auth'
import { initializeFirebase, firebaseModules } from './init'

/**
 * Sign in with Google
 */
export async function signInWithGoogle(): Promise<User> {
    const firebase = await initializeFirebase()
    if (!firebase || !firebaseModules) {
        throw new Error('Firebase is not configured')
    }

    const provider = new firebaseModules.GoogleAuthProvider()
    provider.addScope('profile')
    provider.addScope('email')
    
    provider.setCustomParameters({
        prompt: 'select_account'
    })

    try {
        const result: UserCredential = await firebaseModules.signInWithPopup(
            firebase.auth, 
            provider,
            firebaseModules.browserPopupRedirectResolver
        )
        return result.user
    } catch (popupError) {
        console.error('Popup sign-in failed:', popupError)
        throw popupError
    }
}

/**
 * Sign out the current user
 */
export async function signOutFromFirebase(): Promise<void> {
    const firebase = await initializeFirebase()
    if (!firebase || !firebaseModules) return

    await firebaseModules.signOut(firebase.auth)
}

/**
 * Subscribe to auth state changes
 */
export async function onAuthChange(callback: (user: User | null) => void): Promise<() => void> {
    const firebase = await initializeFirebase()
    if (!firebase || !firebaseModules) {
        return () => {}
    }

    return firebaseModules.onAuthStateChanged(firebase.auth, callback)
}

/**
 * Get the current authenticated user (if any)
 */
export async function getCurrentUser(): Promise<User | null> {
    const firebase = await initializeFirebase()
    if (!firebase) return null
    return firebase.auth.currentUser
}

/**
 * Sign Up with Email and Password
 */
export async function signUpWithEmail(email: string, password: string): Promise<User> {
    const firebase = await initializeFirebase()
    if (!firebase || !firebaseModules?.createUserWithEmailAndPassword) throw new Error('Firebase not configured')

    const result = await firebaseModules.createUserWithEmailAndPassword(firebase.auth, email, password)
    return result.user
}

/**
 * Sign In with Email and Password
 */
export async function signInWithEmail(email: string, password: string): Promise<User> {
    const firebase = await initializeFirebase()
    if (!firebase || !firebaseModules?.signInWithEmailAndPassword) throw new Error('Firebase not configured')

    const result = await firebaseModules.signInWithEmailAndPassword(firebase.auth, email, password)
    return result.user
}

/**
 * Update User Profile
 */
export async function updateUserProfile(user: User, profileUpdates: { displayName?: string; photoURL?: string }): Promise<void> {
    if (!firebaseModules?.updateProfile) throw new Error('Firebase not configured')
    await firebaseModules.updateProfile(user, profileUpdates)
}
