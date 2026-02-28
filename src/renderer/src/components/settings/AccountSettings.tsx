import React, { useState } from 'react'
import { LogOut, LogIn, Loader2, Mail } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { AuthModal } from '../AuthModal'
import { AntigravityLinkButton } from './llm/AntigravityLinkButton'
import { PerplexityLinkButton } from './llm/PerplexityLinkButton'

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
                    <AntigravityLinkButton variant="full" />
                </div>
            </div>

            {/* Perplexity Access Section */}
            <div className="mt-8">
                <hr className="border-white/5 mb-8" />
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h4 className="font-bold text-lg">Perplexity AI Access</h4>
                        <p className="text-xs text-white/40">Connect your Perplexity account to use as an LLM provider</p>
                    </div>
                    <div className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-[#3ab795]/10 text-[#3ab795] border border-[#3ab795]/20">
                        Perplexity
                    </div>
                </div>

                <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-5">
                    <PerplexityLinkButton variant="full" />
                </div>
            </div>
        </div>
    )
}
