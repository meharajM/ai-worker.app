/**
 * WhatsAppConnectionDialog.tsx — Connection setup dialog for WhatsApp.
 *
 * Handles the full connection flow:
 *   1. Idle: click "Start Connection"
 *   2. Connecting/QR: scan QR code
 *   3. Verify: enter personal phone number (after scan)
 *   4. Connected: success + dialog close
 *
 * Per react-components.md: no direct IPC calls — everything goes through
 * the whatsappStore and the electron wrapper.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Phone, CheckCircle, AlertCircle, Loader2, MessageCircle, Link, ShieldCheck } from 'lucide-react'
import { useWhatsAppStore } from '../stores/whatsappStore'
import electron from '../lib/electron'

type DialogStep = 'idle' | 'connecting' | 'qr' | 'verify' | 'connected' | 'manage' | 'error'

export function WhatsAppConnectionDialog(): React.JSX.Element | null {
    const { 
        isDialogOpen, 
        closeDialog, 
        connectionState, 
        setConnectionState, 
        setTargetPhoneNumber, 
        setWhatsAppEnabled 
    } = useWhatsAppStore()
    
    const [phoneInput, setPhoneInput] = useState('')
    const [step, setStep] = useState<DialogStep>('idle')
    const [errorMessage, setErrorMessage] = useState('')
    const [isVerifying, setIsVerifying] = useState(false)

    // Sync dialog step with connection state from main process
    useEffect(() => {
        if (!isDialogOpen) return

        // 1. Handle errors
        if (connectionState.status === 'error') {
            setErrorMessage(connectionState.error ?? 'Connection failed')
            setStep('error')
            return
        }

        // 2. Handle Connected state transitions
        if (connectionState.status === 'connected') {
            // If they just scanned QR but we don't have a target phone, go to Verify
            if (!connectionState.phoneNumber) {
                setStep('verify')
            } else if (step === 'verify' || step === 'qr' || step === 'connecting') {
                // We just finished handshake or scanned QR with existing phone
                setStep('connected')
                
                // Automatically activate WhatsApp mode in the store
                setTargetPhoneNumber(connectionState.phoneNumber)
                setWhatsAppEnabled(true)
                
                const timer = setTimeout(() => {
                    closeDialog()
                    setStep('manage')
                }, 2000)
                return () => clearTimeout(timer)
            } else if (step === 'idle') {
                setStep('manage')
            }
            return
        }

        // 3. Handle Connecting state
        if (connectionState.status === 'connecting') {
            if (connectionState.qrCode) {
                setStep('qr')
            } else {
                setStep('connecting')
            }
        }
    }, [connectionState, isDialogOpen, closeDialog, step, setWhatsAppEnabled, setTargetPhoneNumber])

    // Reset when dialog opens
    useEffect(() => {
        if (isDialogOpen) {
            if (connectionState.status === 'disconnected') {
                setStep('idle')
                setErrorMessage('')
                setPhoneInput('')
            } else if (connectionState.status === 'connected') {
                setStep('manage')
            }
        }
    }, [isDialogOpen, connectionState.status])

    // Step 1 -> Step 2
    const handleStartConnection = useCallback(async () => {
        setStep('connecting')
        setErrorMessage('')
        try {
            const result = await electron.whatsapp.connect()
            if (!result.success && 'error' in result) {
                setErrorMessage((result as { success: false; error: string }).error)
                setStep('error')
            }
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : 'Failed to start connection')
            setStep('error')
        }
    }, [])

    // Step 3 -> Success
    const [handshakeCode, setHandshakeCode] = useState<string | null>(null)

    // Step 3 -> Success
    const handleVerifyPhone = useCallback(async () => {
        const phone = phoneInput.trim()
        if (!phone) return

        setIsVerifying(true)
        setErrorMessage('')
        try {
            const result = await electron.whatsapp.setTargetNumber(phone)
            if (result.success) {
                // Main process started handshake. We stay on this screen.
                setHandshakeCode(result.handshakeCode || null)
                setErrorMessage('')
            } else {
                setErrorMessage(result.error || 'Verification failed')
            }
        } catch (err: unknown) {
            setErrorMessage(err instanceof Error ? err.message : String(err))
        } finally {
            setIsVerifying(false)
        }
    }, [phoneInput])

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
                    workerNumber: null,
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
        if (step !== 'connecting' && step !== 'qr' && !isVerifying) {
            closeDialog()
        }
    }, [step, isVerifying, closeDialog])

    if (!isDialogOpen) return null

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={handleClose}
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm"
                />

                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
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
                                    {step === 'connected' || step === 'manage' ? 'Connected' : 'Connection Setup'}
                                </p>
                            </div>
                        </div>

                        {(step !== 'connecting' && step !== 'qr' && !isVerifying) && (
                            <button
                                onClick={handleClose}
                                className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>

                    <div className="px-6 pb-6">
                        <AnimatePresence mode="wait">

                            {/* ─── 1. Idle ─────────────────────────── */}
                            {step === 'idle' && (
                                <motion.div
                                    key="idle"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className="space-y-4"
                                >
                                    <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                                        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                                            Prepare to scan the QR code using a phone you want to use as your <b>Worker Account</b>. 
                                            This account will act as the AI Agent.
                                        </p>
                                    </div>

                                    <button
                                        onClick={handleStartConnection}
                                        className="w-full py-3 bg-[#25D366] hover:bg-[#22c55e] text-white text-sm font-semibold rounded-xl shadow-lg shadow-[#25D366]/20 transition-all flex items-center justify-center gap-2"
                                    >
                                        <Link size={16} />
                                        Start Connection
                                    </button>
                                </motion.div>
                            )}

                            {/* ─── 2. Connecting ─────────────────────── */}
                            {step === 'connecting' && (
                                <motion.div
                                    key="connecting"
                                    className="flex flex-col items-center gap-4 py-4"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                >
                                    <Loader2 size={36} className="text-[#25D366] animate-spin" />
                                    <p className="text-sm text-[var(--color-text-secondary)] text-center">
                                        Initializing WhatsApp Bridge…
                                    </p>
                                </motion.div>
                            )}

                            {/* ─── 3. QR code ────────────────────────── */}
                            {step === 'qr' && connectionState.qrCode && (
                                <motion.div
                                    key="qr"
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="flex flex-col items-center gap-4"
                                >
                                    <p className="text-sm text-[var(--color-text-secondary)] text-center font-medium">
                                        Scan QR with your Worker phone
                                    </p>

                                    <div className="p-4 bg-white rounded-2xl shadow-xl overflow-hidden">
                                        <QRCodeDisplay qrString={connectionState.qrCode} />
                                    </div>

                                    <div className="text-center space-y-1">
                                        <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
                                            Instructions
                                        </p>
                                        <p className="text-xs text-[var(--color-text-secondary)]">
                                            Settings → Linked Devices → Link a Device
                                        </p>
                                    </div>

                                    <button
                                        onClick={() => handleDisconnect(true)}
                                        className="text-xs text-red-400 hover:underline mt-2"
                                    >
                                        Cancel Connection
                                    </button>
                                </motion.div>
                            )}

                            {/* ─── 4. Verify (Personal Number) ───────── */}
                            {step === 'verify' && (
                                <motion.div
                                    key="verify"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="space-y-4"
                                >
                                    {!handshakeCode ? (
                                        <>
                                            <div className="flex flex-col items-center gap-2 mb-2">
                                                <div className="w-12 h-12 rounded-full bg-[#25D366]/10 flex items-center justify-center">
                                                    <ShieldCheck size={24} className="text-[#25D366]" />
                                                </div>
                                                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                                                    QR Scanned Successfully!
                                                </p>
                                                <p className="text-xs text-[var(--color-text-muted)] text-center">
                                                    Now enter your <b>Personal phone number</b> to verify ownership via handshake.
                                                    <br/>
                                                    <span className="text-[10px] text-amber-400/80 mt-1 block font-medium uppercase tracking-tight">
                                                        Include country code (e.g. +91...)
                                                    </span>
                                                </p>
                                            </div>

                                            <div className="relative">
                                                <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                                                <input
                                                    type="tel"
                                                    value={phoneInput}
                                                    onChange={(e) => setPhoneInput(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && phoneInput.trim() && !isVerifying && handleVerifyPhone()}
                                                    placeholder="+91 98765 43210"
                                                    className="w-full pl-11 pr-4 py-3 bg-[var(--color-surface)] border border-white/10 rounded-xl text-sm text-[var(--color-text-primary)] outline-none focus:border-[#25D366]/50 transition-colors"
                                                />
                                            </div>

                                            {errorMessage && (
                                                <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                                                    <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
                                                    <p className="text-[11px] text-red-400 leading-tight">{errorMessage}</p>
                                                </div>
                                            )}

                                            <button
                                                onClick={handleVerifyPhone}
                                                disabled={!phoneInput.trim() || isVerifying}
                                                className="w-full py-3 bg-white text-black text-sm font-bold rounded-xl hover:bg-white/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                                            >
                                                {isVerifying ? <Loader2 size={16} className="animate-spin" /> : 'Send Handshake Code'}
                                            </button>
                                        </>
                                    ) : (
                                        <div className="space-y-4 text-center py-2 animate-in fade-in zoom-in duration-300">
                                            <div className="p-5 bg-white/5 border border-[#25D366]/30 rounded-2xl">
                                                <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-widest font-bold mb-2">Verification Handshake</p>
                                                <div className="text-3xl font-mono font-black text-[#25D366] tracking-[0.2em] my-3">
                                                    {handshakeCode.slice(0, 3)}-{handshakeCode.slice(3)}
                                                </div>
                                                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed px-2">
                                                    We sent a message to your phone. <b>Reply with the code above</b> to finish linking.
                                                </p>
                                            </div>
                                            
                                            <div className="flex flex-col items-center gap-2 py-2">
                                                <Loader2 size={18} className="text-[#25D366] animate-spin" />
                                                <p className="text-[11px] text-[var(--color-text-muted)] italic">Waiting for your reply...</p>
                                            </div>

                                            <button 
                                                onClick={() => setHandshakeCode(null)}
                                                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:underline underline-offset-4 transition-colors"
                                            >
                                                Use different phone number
                                            </button>
                                        </div>
                                    )}
                                </motion.div>
                            )}

                            {/* ─── 5. Connected (Success) ───────────── */}
                            {step === 'connected' && (
                                <motion.div
                                    key="connected"
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="flex flex-col items-center gap-3 py-6"
                                >
                                    <div className="w-16 h-16 rounded-full bg-[#25D366] flex items-center justify-center shadow-lg shadow-[#25D366]/30">
                                        <CheckCircle size={32} className="text-white" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-lg font-bold text-[var(--color-text-primary)]">Verified!</p>
                                        <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                            Your Worker is now linked to your Personal account.
                                        </p>
                                    </div>
                                </motion.div>
                            )}

                            {/* ─── Manage ────────────────────────────── */}
                            {step === 'manage' && (
                                <motion.div
                                    key="manage"
                                    className="space-y-6 py-2"
                                >
                                    <div className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl border border-white/10">
                                        <div className="w-12 h-12 rounded-full bg-[#25D366]/20 flex items-center justify-center">
                                            <CheckCircle size={24} className="text-[#25D366]" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Status: Active</p>
                                            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                                                {connectionState.phoneNumber ? `Linked to ${connectionState.phoneNumber}` : 'Connected'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <button
                                            onClick={() => handleDisconnect(false)}
                                            className="w-full py-2.5 text-sm text-[var(--color-text-secondary)] border border-white/10 rounded-xl hover:bg-white/5 transition-colors"
                                        >
                                            Pause Connection
                                        </button>
                                        <button
                                            onClick={() => handleDisconnect(true)}
                                            className="w-full py-2.5 text-sm text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
                                        >
                                            Full Reset (Logout)
                                        </button>
                                    </div>
                                </motion.div>
                            )}

                            {/* ─── Error ─────────────────────────────── */}
                            {step === 'error' && (
                                <motion.div
                                    key="error"
                                    className="flex flex-col items-center gap-4 py-4"
                                >
                                    <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center">
                                        <AlertCircle size={28} className="text-red-400" />
                                    </div>
                                    <div className="text-center space-y-1">
                                        <p className="text-sm font-bold text-red-400">Connection Failed</p>
                                        <p className="text-xs text-[var(--color-text-muted)] px-4">
                                            {errorMessage}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setStep('idle')}
                                        className="px-8 py-2.5 bg-white/10 hover:bg-white/20 text-sm font-medium rounded-xl transition-colors"
                                    >
                                        Try Again
                                    </button>
                                </motion.div>
                            )}

                        </AnimatePresence>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    )
}

// ── Inline QR Code Renderer ─────────────────────────────
interface QRCodeDisplayProps {
    qrString: string
}

function QRCodeDisplay({ qrString }: QRCodeDisplayProps): React.JSX.Element {
    const canvasRef = React.useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !qrString) return

        import('qrcode').then((QRCode) => {
            QRCode.toCanvas(canvas, qrString, {
                width: 240,
                margin: 0,
                color: { dark: '#000000', light: '#ffffff' },
            }).catch(console.error)
        }).catch(() => {
            const ctx = canvas.getContext('2d')
            if (ctx) {
                ctx.fillStyle = '#000'
                ctx.textAlign = 'center'
                ctx.fillText('QR Generator Failed', 120, 100)
            }
        })
    }, [qrString])

    return <canvas ref={canvasRef} width={240} height={240} style={{ display: 'block' }} />
}
