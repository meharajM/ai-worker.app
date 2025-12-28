// Firebase Configuration
// This file contains placeholder config - replace with your actual Firebase config

import { FEATURE_FLAGS } from './constants'

// Firebase config from environment variables or placeholder
export const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'placeholder-api-key',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'placeholder.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'placeholder-project',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'placeholder.appspot.com',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:placeholder',
}

// Check if Firebase is properly configured
export const isFirebaseConfigured = (): boolean => {
    return (
        FEATURE_FLAGS.AUTH_ENABLED &&
        firebaseConfig.apiKey !== 'placeholder-api-key' &&
        !!import.meta.env.VITE_FIREBASE_API_KEY
    )
}

// Initialize Firebase (lazy loading)
let firebaseApp: unknown = null
let firebaseAuth: unknown = null

export async function initializeFirebase() {
    if (!FEATURE_FLAGS.AUTH_ENABLED) {
        console.log('Firebase auth is disabled via feature flag')
        return null
    }

    if (!isFirebaseConfigured()) {
        console.warn('Firebase is not configured. Set VITE_FIREBASE_* environment variables.')
        return null
    }

    if (firebaseApp) return firebaseApp

    try {
        // Dynamic import to avoid bundling Firebase when not needed
        const { initializeApp } = await import('firebase/app')
        const { getAuth, GoogleAuthProvider, signInWithPopup, signOut } = await import('firebase/auth')

        firebaseApp = initializeApp(firebaseConfig)
        firebaseAuth = getAuth(firebaseApp)

        return {
            app: firebaseApp,
            auth: firebaseAuth,
            GoogleAuthProvider,
            signInWithPopup,
            signOut,
        }
    } catch (error) {
        console.error('Failed to initialize Firebase:', error)
        return null
    }
}

// Sign in with Google
export async function signInWithGoogle() {
    const firebase = await initializeFirebase()
    if (!firebase) {
        throw new Error('Firebase is not configured')
    }

    const { auth, GoogleAuthProvider, signInWithPopup } = firebase as {
        auth: unknown
        GoogleAuthProvider: { new(): unknown }
        signInWithPopup: (auth: unknown, provider: unknown) => Promise<{ user: unknown }>
    }

    const provider = new GoogleAuthProvider()
    const result = await signInWithPopup(auth, provider)
    return result.user
}

// Sign out
export async function signOutFromFirebase() {
    const firebase = await initializeFirebase()
    if (!firebase) return

    const { auth, signOut } = firebase as {
        auth: unknown
        signOut: (auth: unknown) => Promise<void>
    }

    await signOut(auth)
}
