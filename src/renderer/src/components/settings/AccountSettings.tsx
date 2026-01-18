import React, { useState } from 'react'
import { LogOut, LogIn, Loader2, Mail } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { AuthModal } from '../AuthModal'

export function AccountSettings() {
    const auth = useAuthStore()
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)

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
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                    console.error('[Profile] Image load error:', e)
                                    e.currentTarget.style.display = 'none'
                                }}
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
                    <p className="text-white/60 mb-6">Sign in to unlock unlimited usage</p>
                    
                    <div className="flex flex-col gap-3 max-w-xs mx-auto">
                        <button
                            onClick={() => setIsAuthModalOpen(true)}
                            className="flex items-center justify-center gap-2 px-6 py-3 bg-[#4fd1c5] text-black 
                                         rounded-xl hover:bg-[#4fd1c5]/90 transition-colors font-medium"
                        >
                            <Mail size={18} />
                            Sign in with Email
                        </button>

                        <button
                            onClick={() => auth.signInWithGoogle()}
                            disabled={auth.loading}
                            className="flex items-center justify-center gap-2 px-6 py-3 bg-white text-black 
                                         rounded-xl hover:bg-white/90 transition-colors"
                        >
                            {auth.loading ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                <LogIn size={18} />
                            )}
                            Sign in with Google
                        </button>
                    </div>

                    <AuthModal 
                        isOpen={isAuthModalOpen} 
                        onClose={() => setIsAuthModalOpen(false)} 
                    />
                </div>
            )}
        </div>
    )
}
