/**
 * WhatsAppConnectionDialog.tsx — Connection setup dialog for WhatsApp.
 *
 * Handles the full connection flow:
 *   idle → entering phone number
 *   connecting → QR code displayed
 *   connected → success + dialog close
 *   error → error message + retry
 *
 * Per react-components.md: no direct IPC calls — everything goes through
 * the whatsappStore and the electron wrapper.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Phone, CheckCircle, AlertCircle, Loader2, MessageCircle } from 'lucide-react'
import { useWhatsAppStore } from '../stores/whatsappStore'
import electron from '../lib/electron'

type DialogStep = 'idle' | 'connecting' | 'qr' | 'connected' | 'manage' | 'error'

export function WhatsAppConnectionDialog(): React.JSX.Element | null {
    const { isDialogOpen, closeDialog, connectionState, setConnectionState, setTargetPhoneNumber, setWhatsAppEnabled, targetPhoneNumber } = useWhatsAppStore()
    const [phoneInput, setPhoneInput] = useState('')
    const [step, setStep] = useState<DialogStep>('idle')
    const [errorMessage, setErrorMessage] = useState('')

    // Pre-fill phone number from stored target when dialog opens
    useEffect(() => {
        if (isDialogOpen && targetPhoneNumber && !phoneInput) {
            setPhoneInput(targetPhoneNumber)
        }
    }, [isDialogOpen, targetPhoneNumber])

    // Phone number validation function
    const validatePhoneNumber = useCallback((phone: string): string | null => {
        // Remove all non-digit characters
        const digits = phone.replace(/\D/g, '')
        
        // Check if we have at least 7 digits (minimum for a phone number)
        if (digits.length < 7) {
            return null
        }
        
        // If it doesn't start with country code, assume +1 (US) if 10 digits
        let normalized = phone.trim()
        if (!normalized.startsWith('+') && digits.length === 10) {
            normalized = '+1' + digits
        } else if (!normalized.startsWith('+')) {
            normalized = '+' + digits
        }
        
        return normalized
    }, [])

    // Save target phone number when connecting
    const handleConnect = useCallback(async () => {
        const phone = phoneInput.trim()
        if (!phone) return

        const normalizedPhone = validatePhoneNumber(phone)
        if (!normalizedPhone) {
            setErrorMessage('Please enter a valid phone number')
            return
        }

        // Save target phone for future sessions
        setTargetPhoneNumber(normalizedPhone)
        
        setStep('connecting')
        setErrorMessage('')

        try {
            const result = await electron.whatsapp.connect(normalizedPhone)
            if (!result.success && 'error' in result) {
                setErrorMessage((result as { success: false; error: string }).error)
                setStep('error')
            }
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : 'Failed to connect')
            setStep('error')
        }
    }, [phoneInput, validatePhoneNumber, setTargetPhoneNumber])

    // Sync dialog step with connection state from main process
    useEffect(() => {
        if (!isDialogOpen) return

        if (connectionState.status === 'connected') {
            // If we just got connected (were in a previous step), show success and auto-close
            if (step === 'connecting' || step === 'qr') {
                setStep('connected')
                const timer = setTimeout(() => {
                    closeDialog()
                    // Reset to manage state for next opening
                    setStep('manage')
                }, 2000)
                return () => clearTimeout(timer)
            } else if (step === 'idle') {
                // If opened while already connected, show manage state immediately
                setStep('manage')
            }
        }

        if (connectionState.status === 'connecting' && connectionState.qrCode) {
            setStep('qr')
        }

        if (connectionState.status === 'connecting' && !connectionState.qrCode) {
            setStep('connecting')
        }

        if (connectionState.status === 'error') {
            setErrorMessage(connectionState.error ?? 'Connection failed')
            setStep('error')
        }
    }, [connectionState, isDialogOpen, closeDialog, step])

    // QR code timeout - show error if QR not scanned within 2 minutes
    useEffect(() => {
        if (step === 'qr') {
            const timeout = setTimeout(() => {
                setErrorMessage('QR code expired. Please try again.')
                setStep('idle')
                // Notify main process to restart connection flow
                electron.whatsapp.disconnect().catch(() => {})
            }, 120000) // 2 minutes
            
            return () => clearTimeout(timeout)
        }
    }, [step])

    // Reset when dialog opens
    useEffect(() => {
        if (isDialogOpen) {
            if (connectionState.status === 'disconnected') {
                setStep('idle')
                setErrorMessage('')
            } else if (connectionState.status === 'connected') {
                setStep('manage')
            }
        }
    }, [isDialogOpen, connectionState.status])

    const handleDisconnect = useCallback(async (clearAuth = true) => {
        if (clearAuth && !window.confirm('Are you sure you want to logout from WhatsApp? You will need to scan the QR code again to reconnect.')) {
            return
        }
        
        try {
            await electron.whatsapp.disconnect(clearAuth)
            
            if (clearAuth) {
                setStep('idle')
                setPhoneInput('')
                setTargetPhoneNumber(null)
                setWhatsAppEnabled(false)
                setConnectionState({
                    status: 'disconnected',
                    qrCode: null,
                    error: null,
                    phoneNumber: null,
                })
            } else {
                setStep('idle')
            }
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : 'Failed to disconnect')
            setStep('error')
        }
    }, [setConnectionState, setTargetPhoneNumber, setWhatsAppEnabled])

    const handleClose = useCallback(() => {
        // Only allow closing if we're not mid-connection
        if (step !== 'connecting') {
            closeDialog()
        }
    }, [step, closeDialog])

    const handleRetry = useCallback(() => {
        setStep('idle')
        setErrorMessage('')
    }, [])

    if (!isDialogOpen) return null

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={handleClose}
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm"
                />

                {/* Dialog */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="relative z-50 w-full max-w-sm bg-[var(--color-bg-dark)] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 pt-6 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-[#25D366]/20 flex items-center justify-center">
                                <MessageCircle size={20} className="text-[#25D366]" />
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
                                    WhatsApp
                                </h2>
                                <p className="text-xs text-[var(--color-text-muted)]">
                                    {step === 'connected' || step === 'manage' ? 'Connected' : 'Connect your account'}
                                </p>
                            </div>
                        </div>

                        {step !== 'connecting' && (
                            <button
                                id="whatsapp-dialog-close"
                                onClick={handleClose}
                                className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>

                    {/* Content Area */}
                    <div className="px-6 pb-6">
                        <AnimatePresence mode="wait">

                            {/* ─── Idle: Phone Input ─────────────────────────────── */}
                            {step === 'idle' && (
                                <motion.div
                                    key="idle"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className="space-y-4"
                                >
                                    <p className="text-sm text-[var(--color-text-secondary)]">
                                        Enter the phone number you want the AI to chat with <b>(the contact you will message from).</b><br /><br />
                                        You will need a <b>second phone</b> with WhatsApp installed to scan the QR code to log the AI worker in.
                                    </p>

                                    <div className="relative">
                                        <Phone
                                            size={16}
                                            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                                        />
                                        <input
                                            id="whatsapp-phone-input"
                                            type="tel"
                                            value={phoneInput}
                                            onChange={(e) => setPhoneInput(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleConnect() }}
                                            placeholder="+1234567890"
                                            className="w-full pl-9 pr-4 py-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-dim)] outline-none focus:border-[#25D366]/50 transition-colors"
                                        />
                                    </div>

                                    <button
                                        id="whatsapp-connect-btn"
                                        onClick={handleConnect}
                                        disabled={!phoneInput.trim()}
                                        className="w-full py-2.5 bg-[#25D366] hover:bg-[#22c55e] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all"
                                    >
                                        Connect WhatsApp
                                    </button>
                                </motion.div>
                            )}

                            {/* ─── Connecting: Spinner ───────────────────────────── */}
                            {step === 'connecting' && (
                                <motion.div
                                    key="connecting"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className="flex flex-col items-center gap-4 py-4"
                                >
                                    <Loader2
                                        size={36}
                                        className="text-[#25D366] animate-spin"
                                    />
                                    <p className="text-sm text-[var(--color-text-secondary)] text-center">
                                        Connecting to WhatsApp…<br />
                                        <span className="text-xs text-[var(--color-text-muted)]">
                                            Generating QR code
                                        </span>
                                    </p>
                                </motion.div>
                            )}

                            {/* ─── QR Code ──────────────────────────────────────── */}
                            {step === 'qr' && connectionState.qrCode && (
                                <motion.div
                                    key="qr"
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex flex-col items-center gap-4"
                                >
                                    <p className="text-sm text-[var(--color-text-secondary)] text-center">
                                        Scan this QR code with your WhatsApp phone app
                                    </p>

                                    {/* QR Code Display using native img with data URI */}
                                    <div className="p-3 bg-white rounded-xl shadow-inner">
                                        <QRCodeDisplay qrString={connectionState.qrCode} />
                                    </div>

                                    <p className="text-xs text-[var(--color-text-muted)] text-center">
                                        Open WhatsApp → Settings → Linked Devices → Link a Device
                                    </p>

                                    <button
                                        id="whatsapp-disconnect-qr-btn"
                                        onClick={() => handleDisconnect(true)}
                                        className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] underline transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </motion.div>
                            )}

                            {/* ─── Connected ────────────────────────────────────── */}
                            {step === 'connected' && (
                                <motion.div
                                    key="connected"
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="flex flex-col items-center gap-3 py-4"
                                >
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: 'spring', damping: 12 }}
                                    >
                                        <CheckCircle size={48} className="text-[#25D366]" />
                                    </motion.div>
                                    <p className="text-base font-semibold text-[var(--color-text-primary)]">
                                        Connected!
                                    </p>
                                    <p className="text-xs text-[var(--color-text-muted)] text-center">
                                        WhatsApp is ready. Closing in a moment…
                                    </p>
                                </motion.div>
                            )}

                            {/* ─── Manage (Already Connected) ───────────────────── */}
                            {step === 'manage' && (
                                <motion.div
                                    key="manage"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex flex-col items-center gap-6 py-4"
                                >
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-16 h-16 rounded-full bg-[#25D366]/20 flex items-center justify-center">
                                            <CheckCircle size={32} className="text-[#25D366]" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-base font-semibold text-[var(--color-text-primary)]">
                                                WhatsApp is Active
                                            </p>
                                            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                                                {connectionState.phoneNumber 
                                                    ? `Connected as ${connectionState.phoneNumber}`
                                                    : 'Connected via Baileys Web'}
                                            </p>
                                        </div>
                                    </div>
                                    
                                    <div className="w-full pt-4 border-t border-white/10 space-y-2">
                                        <button
                                            id="whatsapp-manage-stop-btn"
                                            onClick={() => handleDisconnect(false)}
                                            className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-[var(--color-text-secondary)] text-sm font-medium rounded-xl transition-colors border border-white/10"
                                        >
                                            Stop Connection (Keep Login)
                                        </button>
                                        <button
                                            id="whatsapp-manage-disconnect-btn"
                                            onClick={() => handleDisconnect(true)}
                                            className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-xl transition-colors border border-red-500/20"
                                        >
                                            Logout from WhatsApp
                                        </button>
                                    </div>
                                </motion.div>
                            )}

                            {/* ─── Error ────────────────────────────────────────── */}
                            {step === 'error' && (
                                <motion.div
                                    key="error"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className="flex flex-col items-center gap-4 py-2"
                                >
                                    <AlertCircle size={36} className="text-red-400" />
                                    <div className="text-center">
                                        <p className="text-sm font-medium text-[var(--color-text-primary)]">
                                            Connection Failed
                                        </p>
                                        <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                            {errorMessage}
                                        </p>
                                    </div>
                                    <button
                                        id="whatsapp-retry-btn"
                                        onClick={handleRetry}
                                        className="px-6 py-2 bg-[#25D366]/20 hover:bg-[#25D366]/30 text-[#25D366] text-sm font-medium rounded-xl transition-colors"
                                    >
                                        Try Again
                                    </button>
                                </motion.div>
                            )}

                        </AnimatePresence>
                    </div>

                    {/* Footer — only shown when QR testing/connecting */}
                    {connectionState.status === 'connecting' && step !== 'manage' && (
                        <div className="px-6 pb-4 border-t border-white/5 pt-4">
                            <button
                                id="whatsapp-disconnect-btn"
                                onClick={() => handleDisconnect(true)}
                                className="w-full py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-colors"
                            >
                                Cancel Connection
                            </button>
                        </div>
                    )}
                </motion.div>
            </div>
        </AnimatePresence>
    )
}

// ── Inline QR Code Renderer ──────────────────────────────────────────────────
// Renders the QR string as a canvas-based pixel grid — no extra dependencies.

interface QRCodeDisplayProps {
    qrString: string
}

function QRCodeDisplay({ qrString }: QRCodeDisplayProps): React.JSX.Element {
    const canvasRef = React.useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !qrString) return

        // Dynamically import qrcode for rendering
        import('qrcode').then((QRCode) => {
            QRCode.toCanvas(canvas, qrString, {
                width: 200,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' },
            }).catch(console.error)
        }).catch(() => {
            // Fallback: show the raw string if qrcode module is not available
            const ctx = canvas.getContext('2d')
            if (ctx) {
                ctx.fillStyle = '#fff'
                ctx.fillRect(0, 0, canvas.width, canvas.height)
                ctx.fillStyle = '#000'
                ctx.font = '8px monospace'
                ctx.fillText('QR data received', 10, 20)
                ctx.fillText('(install qrcode pkg)', 10, 35)
            }
        })
    }, [qrString])

    return <canvas ref={canvasRef} width={200} height={200} className="rounded" />
}
