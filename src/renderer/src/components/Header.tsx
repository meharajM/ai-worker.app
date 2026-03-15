import React, { useState } from 'react'
import { Wifi, WifiOff, User as UserIcon, LogOut } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { AuthModal } from './AuthModal'
import { FEATURE_FLAGS } from '../lib/constants'

interface HeaderProps {
    status: { provider: string | null; available: boolean }
}

export function Header({ status }: HeaderProps) {
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
    const { user, signOut } = useAuthStore()

    return (
        <header className="h-12 flex items-center justify-between px-4 border-b border-[var(--color-border)] flex-shrink-0 bg-[var(--color-bg-elevated)]">
            <div className="flex items-center gap-4">
                {/* User Auth Section */}
                {FEATURE_FLAGS.AUTH_ENABLED && (
                    <>
                        {user ? (
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                                    <div className="w-6 h-6 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold text-[var(--color-bg-dark)] uppercase">
                                        {user.displayName ? user.displayName[0] : user.email?.[0] || 'U'}
                                    </div>
                                    <span className="hidden sm:inline">{user.displayName || user.email?.split('@')[0]}</span>
                                </div>
                                <button
                                    onClick={() => signOut()}
                                    className="p-1.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] rounded-lg transition-colors"
                                    title="Sign Out"
                                >
                                    <LogOut size={14} />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsAuthModalOpen(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-accent-muted)] text-[var(--color-accent)] rounded-lg text-xs font-medium hover:bg-[var(--color-accent)]/20 transition-colors"
                            >
                                <UserIcon size={14} />
                                <span>Sign In</span>
                            </button>
                        )}
                        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
                    </>
                )}
            </div>

            <div className="text-[10px] uppercase tracking-widest text-[var(--color-text-disabled)] hidden sm:flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
                local-session: active
            </div>

            {/* LLM Status */}
            <div className={`flex items-center gap-1.5 text-[10px] font-medium ${status.available ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'
                }`}>
                {status.available ? <Wifi size={12} /> : <WifiOff size={12} />}
                <span className="uppercase tracking-wide">
                    {status.provider || 'No LLM'}
                </span>
            </div>
        </header>
    )
}
