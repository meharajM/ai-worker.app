import React, { useState } from 'react'
import { Wifi, WifiOff, User as UserIcon, LogOut, MessageCircle } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { AuthModal } from './AuthModal'
import { FEATURE_FLAGS } from '../lib/constants'
import { useWhatsAppStore } from '../stores/whatsappStore'
import { Button } from './primitives/Button'
import { StatusDot } from './primitives/StatusDot'

interface HeaderProps {
    status: { provider: string | null; available: boolean }
}

export function Header({ status }: HeaderProps) {
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
    const { user, signOut } = useAuthStore()
    const { connectionState, whatsappEnabled, openDialog } = useWhatsAppStore()
    const isWhatsAppConnected = connectionState.status === 'connected'

    return (
        <header className="h-[var(--space-12)] flex items-center justify-between px-[var(--space-4)] border-b border-[var(--color-border)] flex-shrink-0">
            <div className="flex items-center gap-4">
                {/* User Auth Section */}
                {FEATURE_FLAGS.AUTH_ENABLED && (
                    <>
                        {user ? (
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 text-[var(--text-sm)] text-[var(--color-text-primary)]">
                                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-[var(--color-brand-teal)] to-[var(--color-primary)] flex items-center justify-center text-[10px] font-[var(--font-weight-bold)] text-[var(--color-text-inverse)] uppercase">
                                        {user.displayName ? user.displayName[0] : user.email?.[0] || 'U'}
                                    </div>
                                    <span className="hidden sm:inline">{user.displayName || user.email?.split('@')[0]}</span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => signOut()}
                                    className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                                    title="Sign Out"
                                >
                                    <LogOut size={14} />
                                </Button>
                            </div>
                        ) : (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsAuthModalOpen(true)}
                                className="text-[var(--color-brand-teal)] hover:bg-[var(--color-brand-teal)]/10"
                            >
                                <UserIcon size={14} />
                                <span>Sign In</span>
                            </Button>
                        )}
                        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
                    </>
                )}
            </div>

            <div className="text-[10px] uppercase tracking-widest text-[var(--color-text-dim)] flex items-center gap-2">
                <StatusDot variant="success" size="sm" animated />
                <span className="hidden sm:inline">local-session: active</span>

                {/* WhatsApp status indicator */}
                {isWhatsAppConnected && (
                    <button
                        id="header-whatsapp-status"
                        onClick={openDialog}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#25D366]/15 hover:bg-[#25D366]/25 transition-colors cursor-pointer"
                        title="WhatsApp connected — click to manage"
                    >
                        <MessageCircle size={10} className="text-[#25D366]" />
                        <span className="text-[#25D366] text-[9px] font-bold tracking-widest">
                            {whatsappEnabled ? 'WHATSAPP ON' : 'WHATSAPP'}
                        </span>
                        <span className="w-1 h-1 rounded-full bg-[#25D366] animate-pulse" />
                    </button>
                )}
            </div>

            {/* LLM Status */}
            <div className={`flex items-center gap-1.5 text-[10px] font-[var(--font-weight-medium)] ${status.available ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'
                }`}>
                {status.available ? <Wifi size={12} /> : <WifiOff size={12} />}
                <span className="uppercase tracking-wide">
                    {status.provider || 'No LLM'}
                </span>
            </div>
        </header>
    )
}
