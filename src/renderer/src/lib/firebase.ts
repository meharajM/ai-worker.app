// Firebase Configuration with App Check
// API keys are safe to bundle - security is handled via Firebase Security Rules

import { FEATURE_FLAGS } from './constants'
import type { FirebaseApp } from 'firebase/app'
import type { Auth, User, UserCredential } from 'firebase/auth'
import type { AppCheck } from 'firebase/app-check'

// Firebase config from environment variables
// Safe to expose - security enforced by Firebase Security Rules & App Check
export const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'placeholder-api-key',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'placeholder.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'placeholder-project',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'placeholder.appspot.com',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:placeholder',
}

// App Check reCAPTCHA site key (optional, for enhanced security)
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || ''

// Check if Firebase is properly configured
export const isFirebaseConfigured = (): boolean => {
    return (
        FEATURE_FLAGS.AUTH_ENABLED &&
        firebaseConfig.apiKey !== 'placeholder-api-key' &&
        !!import.meta.env.VITE_FIREBASE_API_KEY
    )
}

// Singleton instances
let firebaseApp: FirebaseApp | null = null
let firebaseAuth: Auth | null = null
let appCheck: AppCheck | null = null

// Firebase module references (lazy loaded)
let firebaseModules: {
    initializeApp: typeof import('firebase/app').initializeApp
    getAuth: typeof import('firebase/auth').getAuth
    GoogleAuthProvider: typeof import('firebase/auth').GoogleAuthProvider
    signInWithPopup: typeof import('firebase/auth').signInWithPopup
    signInWithCredential: typeof import('firebase/auth').signInWithCredential
    OAuthCredential: typeof import('firebase/auth').OAuthCredential
    signOut: typeof import('firebase/auth').signOut
    onAuthStateChanged: typeof import('firebase/auth').onAuthStateChanged
    browserPopupRedirectResolver: typeof import('firebase/auth').browserPopupRedirectResolver
    initializeAppCheck?: typeof import('firebase/app-check').initializeAppCheck
    ReCaptchaEnterpriseProvider?: typeof import('firebase/app-check').ReCaptchaEnterpriseProvider
} | null = null

/**
 * Initialize Firebase with App Check support
 * Uses lazy loading to avoid bundling Firebase when auth is disabled
 */
export async function initializeFirebase(): Promise<{
    app: FirebaseApp
    auth: Auth
    appCheck: AppCheck | null
} | null> {
    if (!FEATURE_FLAGS.AUTH_ENABLED) {
        console.log('Firebase auth is disabled via feature flag')
        return null
    }

    if (!isFirebaseConfigured()) {
        console.warn('Firebase is not configured. Set VITE_FIREBASE_* environment variables.')
        return null
    }

    if (firebaseApp && firebaseAuth) {
        return { app: firebaseApp, auth: firebaseAuth, appCheck }
    }

    try {
        // Dynamic import to avoid bundling Firebase when not needed
        const [firebaseAppModule, firebaseAuthModule] = await Promise.all([
            import('firebase/app'),
            import('firebase/auth'),
        ])

        firebaseModules = {
            initializeApp: firebaseAppModule.initializeApp,
            getAuth: firebaseAuthModule.getAuth,
            GoogleAuthProvider: firebaseAuthModule.GoogleAuthProvider,
            signInWithPopup: firebaseAuthModule.signInWithPopup,
            signInWithCredential: firebaseAuthModule.signInWithCredential,
            OAuthCredential: firebaseAuthModule.OAuthCredential,
            signOut: firebaseAuthModule.signOut,
            onAuthStateChanged: firebaseAuthModule.onAuthStateChanged,
            browserPopupRedirectResolver: firebaseAuthModule.browserPopupRedirectResolver,
        }

        // Initialize Firebase App
        firebaseApp = firebaseModules.initializeApp(firebaseConfig)
        firebaseAuth = firebaseModules.getAuth(firebaseApp)

        // Set persistence to local (critical for Electron)
        try {
            // Using indexedDBLocalPersistence is often more robust for Electron
            const { indexedDBLocalPersistence, setPersistence } = await import('firebase/auth')
            await setPersistence(firebaseAuth, indexedDBLocalPersistence)
            console.log('Firebase auth persistence set to indexedDBLocalPersistence')
        } catch (persistenceError) {
            console.error('Failed to set auth persistence:', persistenceError)
        }

        // Initialize App Check if reCAPTCHA key is configured
        if (RECAPTCHA_SITE_KEY && typeof window !== 'undefined') {
            try {
                const appCheckModule = await import('firebase/app-check')
                firebaseModules.initializeAppCheck = appCheckModule.initializeAppCheck
                firebaseModules.ReCaptchaEnterpriseProvider = appCheckModule.ReCaptchaEnterpriseProvider

                appCheck = appCheckModule.initializeAppCheck(firebaseApp, {
                    provider: new appCheckModule.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
                    isTokenAutoRefreshEnabled: true,
                })
                console.log('Firebase App Check initialized')
            } catch (appCheckError) {
                console.warn('App Check initialization failed (optional):', appCheckError)
            }
        }

        console.log('Firebase initialized successfully')
        return { app: firebaseApp, auth: firebaseAuth, appCheck }
    } catch (error) {
        console.error('Failed to initialize Firebase:', error)
        return null
    }
}

/**
 * Sign in with Google
 * Uses popup with explicit resolver for better Electron compatibility
 */
export async function signInWithGoogle(): Promise<User> {
    const firebase = await initializeFirebase()
    if (!firebase || !firebaseModules) {
        throw new Error('Firebase is not configured')
    }

    const provider = new firebaseModules.GoogleAuthProvider()
    // Add scopes for profile info
    provider.addScope('profile')
    provider.addScope('email')
    
    // Set custom parameters for better popup handling
    provider.setCustomParameters({
        prompt: 'select_account'
    })

    try {
        // Try popup with explicit resolver
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
 * Returns an unsubscribe function
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
