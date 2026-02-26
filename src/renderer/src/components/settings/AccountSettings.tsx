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
                                className="w-12 h-12 rounded-full border border-white/10"
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
                                     rounded-lg hover:bg-red-500/20 transition-colors text-sm"
                    >
                        <LogOut size={16} />
                        Sign Out
                    </button>
                </div>
            ) : (
                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-6 text-center">
                    <p className="text-white/60 mb-6 font-medium">Authentication</p>

                    <div className="flex flex-col gap-3 max-w-xs mx-auto">
                        <button
                            onClick={() => setIsAuthModalOpen(true)}
                            className="flex items-center justify-center gap-2 px-6 py-3 bg-[#4fd1c5] text-black 
                                         rounded-xl hover:bg-[#4fd1c5]/90 transition-colors font-medium border border-white/10 shadow-lg"
                        >
                            <Mail size={18} />
                            Sign in with Email
                        </button>

                        <button
                            onClick={() => auth.signInWithGoogle()}
                            disabled={auth.loading}
                            className="flex items-center justify-center gap-2 px-6 py-3 bg-white text-black 
                                         rounded-xl hover:bg-white/90 transition-colors border border-black/10 shadow-lg"
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

            {/* Antigravity (Gemini Access) Section */}
            <div className="mt-8">
                <hr className="border-white/5 mb-8" />
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h4 className="font-bold text-lg">Gemini Pro Access</h4>
                        <p className="text-xs text-white/40">Higher rate limits via Google IDE gateway</p>
                    </div>
                    <div className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-[#4fd1c5]/10 text-[#4fd1c5] border border-[#4fd1c5]/20">
                        Antigravity
                    </div>
                </div>

                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-5">
                    {auth.antigravitySignedIn ? (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-[#4fd1c5]/10 flex items-center justify-center text-[#4fd1c5]">
                                    <Mail size={20} />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-white">{auth.antigravityEmail}</p>
                                    <p className="text-[10px] text-green-400 flex items-center gap-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                        Linked and Active
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => auth.signOutFromAntigravity()}
                                className="px-3 py-1.5 bg-white/5 hover:bg-red-500/10 text-white/60 hover:text-red-400 
                                            rounded-lg border border-white/5 hover:border-red-500/20 transition-all text-xs flex items-center gap-2"
                            >
                                <LogOut size={14} />
                                Unlink
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-white/60 mb-1">Account not linked</p>
                                <p className="text-[11px] text-white/30">Connect your Google account for higher rate limits</p>
                            </div>
                            <button
                                onClick={() => auth.signInWithAntigravity()}
                                disabled={auth.antigravityLoading}
                                className="flex items-center gap-2 px-4 py-2 bg-[#4fd1c5]/10 text-[#4fd1c5] 
                                             rounded-lg hover:bg-[#4fd1c5]/20 border border-[#4fd1c5]/20 transition-all text-xs font-bold"
                            >
                                {auth.antigravityLoading ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <LogIn size={14} />
                                )}
                                Link Account
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
