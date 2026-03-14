import React, { useState } from 'react'
import { Wifi, WifiOff, User as UserIcon, LogOut, Smartphone } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useMcpStore } from '../stores/mcpStore'
import { AuthModal } from './AuthModal'
import { FEATURE_FLAGS } from '../lib/constants'

interface HeaderProps {
    status: { provider: string | null; available: boolean }
}

export function Header({ status }: HeaderProps) {
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
    const { user, signOut } = useAuthStore()
    const { servers } = useMcpStore()
    const whatsappServer = servers.find(s => s.name === 'whatsapp-mcp')
    const isWhatsAppConnected = whatsappServer?.connected || false

    return (
        <header className="h-12 flex items-center justify-between px-4 border-b border-[var(--color-border)] flex-shrink-0">
            <div className="flex items-center gap-4">
                {/* User Auth Section */}
                {FEATURE_FLAGS.AUTH_ENABLED && (
                    <>
                        {user ? (
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
                                    <div className="w-6 h-6 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-[10px] font-bold text-white uppercase">
                                        {user.displayName ? user.displayName[0] : user.email?.[0] || 'U'}
                                    </div>
                                    <span className="hidden sm:inline">{user.displayName || user.email?.split('@')[0]}</span>
                                </div>
                                <button
                                    onClick={() => signOut()}
                                    className="p-1.5 hover:bg-[var(--color-bg-surface)] rounded-lg transition-colors"
                                    style={{ color: 'var(--color-text-tertiary)' }}
                                    title="Sign Out"
                                >
                                    <LogOut size={14} />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsAuthModalOpen(true)}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                                style={{ 
                                    backgroundColor: 'var(--color-primary-muted)', 
                                    color: 'var(--color-primary)' 
                                }}
                            >
                                <UserIcon size={14} />
                                <span>Sign In</span>
                            </button>
                        )}
                        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
                    </>
                )}
            </div>

            {/* Right Side Status Elements */}
            <div className="flex items-center gap-4">
                {/* Local Session Text */}
                <div className="text-[10px] uppercase tracking-widest hidden sm:flex items-center gap-2" style={{ color: 'var(--color-text-disabled)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
                    local-session: active
                </div>

                {/* WhatsApp Status */}
                {whatsappServer && (
                    <div className={`flex items-center gap-1.5 text-[10px] ${isWhatsAppConnected ? '' : ''}`}
                        style={{ color: isWhatsAppConnected ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
                        <Smartphone size={12} />
                        <span className="uppercase tracking-wide hidden sm:inline font-medium">
                            {isWhatsAppConnected ? 'WhatsApp Active' : 'WhatsApp Ready'}
                        </span>
                    </div>
                )}

                {/* LLM Status */}
                <div className="flex items-center gap-1.5 text-[10px]"
                    style={{ color: status.available ? 'var(--color-success)' : 'var(--color-warning)' }}>
                    {status.available ? <Wifi size={12} /> : <WifiOff size={12} />}
                    <span className="uppercase tracking-wide font-medium">
                        {status.provider || 'No LLM'}
                    </span>
                </div>
            </div>
        </header>
    )
}
