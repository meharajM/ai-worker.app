// Firebase Firestore wrappers
import { initializeFirebase, firebaseModules } from './init'

/**
 * Initialize Firestore
 * (Legacy helper, mostly internal now, but kept for compatibility if needed)
 */
export async function getFirestoreInstance() {
    const firebase = await initializeFirebase()
    if (!firebase) return null
    return firebase.firestore
}

/**
 * Save user settings to Firestore
 */
export async function saveUserSettings(uid: string, settings: any): Promise<void> {
    const firestore = await getFirestoreInstance()
    if (!firestore) {
        console.warn('saveUserSettings: Firestore instance not found (auth disabled or config missing)')
        return
    }
    if (!firebaseModules?.doc || !firebaseModules?.setDoc) {
        console.warn('saveUserSettings: Firebase modules not fully loaded')
        return
    }

    try {
        const userRef = firebaseModules.doc(firestore, 'users', uid)
        // Merge true to avoid overwriting other fields like createdAt
        // settings object passed here presumably contains { settings: {...}, mcpServers: [...] }
        // We valid that useSettingsSync passes exactly that structure.
        await firebaseModules.setDoc(userRef, settings, { merge: true })
    } catch (error) {
        console.error('Error saving user settings:', error)
    }
}

/**
 * Get user profile/settings from Firestore
 */
export async function getUserProfile(uid: string): Promise<any | null> {
    const firestore = await getFirestoreInstance()
    if (!firestore || !firebaseModules?.doc || !firebaseModules?.getDoc) return null

    try {
        const userRef = firebaseModules.doc(firestore, 'users', uid)
        const docSnap = await firebaseModules.getDoc(userRef)
        
        if (docSnap.exists()) {
            return docSnap.data()
        }
        return null
    } catch (error) {
        console.error('Error fetching user profile:', error)
        return null
    }
}
