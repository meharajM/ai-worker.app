import React, { useState } from 'react'
import { LogOut, LogIn, Loader2, Mail } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { AuthModal } from '../AuthModal'

export function AccountSettings() {
    const auth = useAuthStore()
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)

    return (
        <div>
            <h3 className="text-xl font-bold mb-6 text-[var(--color-text-primary)]">Account</h3>

            {auth.user ? (
                <div className="bg-[var(--color-card-elevated)] border border-[var(--color-border)] rounded-xl p-4">
                    <div className="flex items-center gap-4 mb-4">
                        {auth.user.photoURL && (
                            <img
                                src={auth.user.photoURL}
                                alt="Profile"
                                className="w-12 h-12 rounded-full border border-[var(--color-border)]"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                    console.error('[Profile] Image load error:', e)
                                    e.currentTarget.style.display = 'none'
                                }}
                            />
                        )}
                        <div>
                            <p className="font-medium text-[var(--color-text-primary)]">{auth.user.displayName}</p>
                            <p className="text-sm text-[var(--color-text-secondary)]">{auth.user.email}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => auth.signOut()}
                        className="flex items-center gap-2 px-4 py-2 bg-[var(--color-error)]/10 text-[var(--color-error)] 
                                     rounded-lg hover:bg-[var(--color-error)]/20 transition-colors text-sm"
                    >
                        <LogOut size={16} />
                        Sign Out
                    </button>
                </div>
            ) : (
                <div className="bg-[var(--color-card-elevated)] border border-[var(--color-border)] rounded-xl p-6 text-center">
                    <p className="text-[var(--color-text-secondary)] mb-6 font-medium">Authentication</p>

                    <div className="flex flex-col gap-3 max-w-xs mx-auto">
                        <button
                            onClick={() => setIsAuthModalOpen(true)}
                            className="flex items-center justify-center gap-2 px-6 py-3 bg-[var(--color-brand-teal)] text-white 
                                         rounded-xl hover:bg-[var(--color-brand-teal)]/90 transition-colors font-medium border border-transparent shadow-md"
                        >
                            <Mail size={18} />
                            Sign in with Email
                        </button>

                        <button
                            onClick={() => auth.signInWithGoogle()}
                            disabled={auth.loading}
                            className="flex items-center justify-center gap-2 px-6 py-3 bg-[var(--color-surface)] text-[var(--color-text-primary)] 
                                         rounded-xl hover:bg-[var(--color-border)] transition-colors border border-[var(--color-border)] shadow-sm"
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

            {/* Antigravity account linking temporarily disabled. */}
        </div>
    )
}
