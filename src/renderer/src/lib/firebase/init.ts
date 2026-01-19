// Firebase Initialization & Configuration
import { FEATURE_FLAGS } from '../constants'
import type { FirebaseApp } from 'firebase/app'
import type { Auth, User, UserCredential } from 'firebase/auth'
import type { AppCheck } from 'firebase/app-check'
import type { Firestore } from 'firebase/firestore'
import type { Analytics } from 'firebase/analytics'

export type { User, UserCredential, Auth, FirebaseApp, AppCheck, Firestore, Analytics }

// Config
export const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'placeholder-api-key',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'placeholder.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'placeholder-project',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'placeholder.appspot.com',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:placeholder',
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-XXXXXXXXXX',
}

const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || ''

export const isFirebaseConfigured = (): boolean => {
    return (
        FEATURE_FLAGS.AUTH_ENABLED &&
        firebaseConfig.apiKey !== 'placeholder-api-key' &&
        !!import.meta.env.VITE_FIREBASE_API_KEY
    )
}

// Singletons
let firebaseApp: FirebaseApp | null = null
let firebaseAuth: Auth | null = null
let firebaseFirestore: Firestore | null = null
let appCheck: AppCheck | null = null
let firebaseAnalytics: Analytics | null = null

// Module references (exported for other modules to use)
export let firebaseModules: {
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
    createUserWithEmailAndPassword: typeof import('firebase/auth').createUserWithEmailAndPassword
    signInWithEmailAndPassword: typeof import('firebase/auth').signInWithEmailAndPassword
    updateProfile: typeof import('firebase/auth').updateProfile
    getFirestore: typeof import('firebase/firestore').getFirestore
    doc: typeof import('firebase/firestore').doc
    setDoc: typeof import('firebase/firestore').setDoc
    getDoc: typeof import('firebase/firestore').getDoc
    getAnalytics?: typeof import('firebase/analytics').getAnalytics
    logEvent?: typeof import('firebase/analytics').logEvent
} | null = null

export async function initializeFirebase(): Promise<{
    app: FirebaseApp
    auth: Auth
    firestore: Firestore
    appCheck: AppCheck | null
    analytics: Analytics | null
} | null> {
    if (!FEATURE_FLAGS.AUTH_ENABLED) {
        console.log('Firebase auth is disabled via feature flag')
        return null
    }

    if (!isFirebaseConfigured()) {
        console.warn('Firebase is not configured. Set VITE_FIREBASE_* environment variables.')
        return null
    }

    if (firebaseApp && firebaseAuth && firebaseFirestore) {
        return { app: firebaseApp, auth: firebaseAuth, firestore: firebaseFirestore, appCheck, analytics: firebaseAnalytics }
    }

    try {
        const [firebaseAppModule, firebaseAuthModule, firebaseFirestoreModule, firebaseAnalyticsModule] = await Promise.all([
            import('firebase/app'),
            import('firebase/auth'),
            import('firebase/firestore'),
            import('firebase/analytics'),
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
            createUserWithEmailAndPassword: firebaseAuthModule.createUserWithEmailAndPassword,
            signInWithEmailAndPassword: firebaseAuthModule.signInWithEmailAndPassword,
            updateProfile: firebaseAuthModule.updateProfile,
            getFirestore: firebaseFirestoreModule.getFirestore,
            doc: firebaseFirestoreModule.doc,
            setDoc: firebaseFirestoreModule.setDoc,
            getDoc: firebaseFirestoreModule.getDoc,
            getAnalytics: firebaseAnalyticsModule.getAnalytics,
            logEvent: firebaseAnalyticsModule.logEvent,
        }

        firebaseApp = firebaseModules.initializeApp(firebaseConfig)
        firebaseAuth = firebaseModules.getAuth(firebaseApp)
        firebaseFirestore = firebaseModules.getFirestore(firebaseApp)
        if (typeof window !== 'undefined') {
             try {
                firebaseAnalytics = firebaseAnalyticsModule.getAnalytics(firebaseApp)
             } catch (e) {
                console.warn('Firebase analytics failed to init', e)
             }
        }

        try {
            const { indexedDBLocalPersistence, setPersistence } = await import('firebase/auth')
            await setPersistence(firebaseAuth, indexedDBLocalPersistence)
            console.log('Firebase auth persistence set to indexedDBLocalPersistence')
        } catch (persistenceError) {
            console.error('Failed to set auth persistence:', persistenceError)
        }

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
        return { app: firebaseApp, auth: firebaseAuth, firestore: firebaseFirestore, appCheck, analytics: firebaseAnalytics }
    } catch (error) {
        console.error('Failed to initialize Firebase:', error)
        return null
    }
}
