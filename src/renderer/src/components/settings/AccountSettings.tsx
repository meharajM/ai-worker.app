import React from 'react'
import { LogIn, LogOut, Loader2 } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { FEATURE_FLAGS } from '../../lib/constants'

export function AccountSettings() {
    const auth = useAuthStore()

    if (!FEATURE_FLAGS.AUTH_ENABLED) {
        return null
    }

    return (
        <div>
            <h3 className="text-xl font-bold mb-6">Account</h3>

            {auth.user ? (
                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                    <div className="flex items-center gap-4 mb-4">
                        {auth.user.photoURL && (
                            <img
                                src={auth.user.photoURL}
                                alt="Profile"
                                className="w-12 h-12 rounded-full"
                            />
                        )}
                        <div>
                            <p className="font-medium">{auth.user.displayName}</p>
                            <p className="text-sm text-white/40">{auth.user.email}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => auth.signOut()}
                        className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 
                         rounded-lg hover:bg-red-500/20 transition-colors"
                    >
                        <LogOut size={18} />
                        Sign Out
                    </button>
                </div>
            ) : (
                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-6 text-center">
                    <p className="text-white/60 mb-4">Sign in to unlock unlimited usage</p>
                    <button
                        onClick={() => auth.signInWithGoogle()}
                        disabled={auth.loading}
                        className="flex items-center gap-2 px-6 py-3 bg-white text-black 
                         rounded-xl hover:bg-white/90 transition-colors mx-auto"
                    >
                        {auth.loading ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <LogIn size={18} />
                        )}
                        Sign in with Google
                    </button>
                </div>
            )}
        </div>
    )
}
