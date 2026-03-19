/**
 * WhatsAppConnectionDialog.tsx — Connection setup dialog for WhatsApp.
 *
 * Flow:
 *   Step 1: Intro → Explain connection process
 *   Step 2: QR Code → User scans to link device
 *   Step 3: Enter Phone → User enters their WhatsApp number
 *   Step 4: Verify → App sends confirmation message to that number
 *   Step 5: Connected → All set
 *
 * Per react-components.md: no direct IPC calls — everything goes through
 * the whatsappStore and the electron wrapper.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Phone, CheckCircle, AlertCircle, Loader2, MessageCircle, Smartphone, ArrowRight, Send } from 'lucide-react'
import { useWhatsAppStore } from '../stores/whatsappStore'
import electron from '../lib/electron'

type DialogStep = 
    | 'intro'         // Step 1: Welcome + explain the flow
    | 'qr'            // Step 2: Show QR code to scan
    | 'connecting'    // While waiting for QR scan
    | 'verify'        // Step 3: Enter phone number to verify
    | 'sending'       // Step 4: Sending confirmation message
    | 'connected'     // Step 5: Success
    | 'manage'        // Already connected - show options
    | 'error'         // Error state

export function WhatsAppConnectionDialog(): React.JSX.Element | null {
    const { 
        isDialogOpen, 
        closeDialog, 
        connectionState, 
        setConnectionState, 
        setTargetPhoneNumber, 
        setWhatsAppEnabled, 
        targetPhoneNumber 
    } = useWhatsAppStore()
    
    const [phoneInput, setPhoneInput] = useState('')
    const [step, setStep] = useState<DialogStep>('intro')
    const [errorMessage, setErrorMessage] = useState('')

    // Pre-fill phone number from stored target when dialog opens
    useEffect(() => {
        if (isDialogOpen && targetPhoneNumber && !phoneInput) {
            setPhoneInput(targetPhoneNumber)
        }
    }, [isDialogOpen, targetPhoneNumber])

    // Phone number validation function
    const validatePhoneNumber = useCallback((phone: string): string | null => {
        const digits = phone.replace(/\D/g, '')
        
        if (digits.length < 7) {
            return null
        }
        
        let normalized = phone.trim()
        if (!normalized.startsWith('+') && digits.length === 10) {
            normalized = '+1' + digits
        } else if (!normalized.startsWith('+')) {
            normalized = '+' + digits
        }
        
        return normalized
    }, [])

    // Start connection - show QR code first
    const handleStartConnection = useCallback(async () => {
        setStep('connecting')
        setErrorMessage('')

        try {
            // Start connection without phone number first - just show QR
            const result = await electron.whatsapp.connect(null)
            if (!result.success && 'error' in result) {
                setErrorMessage((result as { success: false; error: string }).error)
                setStep('error')
            }
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : 'Failed to start connection')
            setStep('error')
        }
    }, [])

    // Verify phone number and send confirmation message
    const handleVerifyPhone = useCallback(async () => {
        const phone = phoneInput.trim()
        if (!phone) return

        const normalizedPhone = validatePhoneNumber(phone)
        if (!normalizedPhone) {
            setErrorMessage('Please enter a valid phone number')
            return
        }

        // Check if the connected phone from QR scan is the same as entered number
        const connectedNum = connectionState.connectedPhoneNumber
        const userEnteredDigits = normalizedPhone.replace(/\D/g, '')
        
        // Block if same number (cannot use same number for Worker and Personal)
        if (connectedNum) {
            const connectedDigits = connectedNum.replace(/\D/g, '')
            const userSuffix = userEnteredDigits.slice(-10)
            const connectedSuffix = connectedDigits.slice(-10)
            
            console.log('[WhatsAppDialog] Verification check:', {
                entered: normalizedPhone,
                enteredDigits: userEnteredDigits,
                connected: connectedNum,
                connectedDigits: connectedDigits,
                userSuffix,
                connectedSuffix
            })

            if (userSuffix === connectedSuffix && userSuffix.length >= 7) {
                setErrorMessage('Cannot use the same number for both Worker and Personal. Please enter a different personal phone number.')
                return
            }
        }
        
        setTargetPhoneNumber(normalizedPhone)
        setStep('sending')
        setErrorMessage('')

        try {
            // First save the target number
            await electron.whatsapp.setTargetNumber(normalizedPhone)
            
            // Send a clearer confirmation message with usage instructions
            const workerPhone = connectionState.connectedPhoneNumber ? `+${connectionState.connectedPhoneNumber}` : 'this device'

            const confirmationMessage = 
                `✅ WhatsApp Connected to AI Worker!\n\n` +
                `Your number ${normalizedPhone} has been verified.\n\n` +
                `📱 How to use:\n` +
                `• Send a message from this number to control AI Worker\n` +
                `• The AI will respond to your messages\n` +
                `• Your chats will appear in the AI Worker app\n\n` +
                `Note: Your AI Worker is running on ${workerPhone}\n\n` +
                `💡 Reply to this message to start chatting!`
            
            // Then send a confirmation message to verify the connection
            const result = await electron.whatsapp.sendMessage(normalizedPhone, confirmationMessage)
            
            if (result.success) {
                setWhatsAppEnabled(true)
                setStep('connected')
            } else {
                setErrorMessage(result.error || 'Failed to send confirmation message')
                setStep('verify')
            }
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : 'Failed to verify phone number')
            setStep('verify')
        }
    }, [phoneInput, validatePhoneNumber, setTargetPhoneNumber, connectionState.connectedPhoneNumber])

    // Sync dialog step with connection state from main process
    useEffect(() => {
        if (!isDialogOpen) return

        if (connectionState.status === 'connected') {
            // If we just got connected (were in qr or connecting step), go to verify step
            if (step === 'connecting' || step === 'qr') {
                setStep('verify')
            } else if (step === 'intro' || step === 'verify' || step === 'sending') {
                // If opened while already connected, show manage state
                if (connectionState.isVerified) {
                    setStep('manage')
                } else {
                    setStep('verify')
                }
            }
        }

        if (connectionState.status === 'connecting' && connectionState.qrCode) {
            setStep('qr')
        }

        if (connectionState.status === 'connecting' && !connectionState.qrCode && step !== 'qr') {
            setStep('connecting')
        }

        if (connectionState.status === 'error') {
            setErrorMessage(connectionState.error ?? 'Connection failed')
            setStep('error')
        }
    }, [connectionState, isDialogOpen, step])

    // QR code timeout - show error if QR not scanned within 2 minutes
    useEffect(() => {
        if (step === 'qr') {
            const timeout = setTimeout(() => {
                setErrorMessage('QR code expired. Please try again.')
                setStep('intro')
                electron.whatsapp.disconnect(false).catch(() => {})
            }, 120000)
            
            return () => clearTimeout(timeout)
        }
    }, [step])

    // Reset when dialog opens
    useEffect(() => {
        if (isDialogOpen) {
            if (connectionState.status === 'disconnected') {
                setStep('intro')
                setErrorMessage('')
            } else if (connectionState.status === 'connected') {
                if (connectionState.isVerified) {
                    setStep('manage')
                } else {
                    setStep('verify')
                }
            }
        }
    }, [isDialogOpen, connectionState.status, connectionState.isVerified])

    const handleDisconnect = useCallback(async (clearAuth = true) => {
        if (clearAuth && !window.confirm('Are you sure you want to logout from WhatsApp? You will need to scan the QR code again to reconnect.')) {
            return
        }
        
        try {
            await electron.whatsapp.disconnect(clearAuth)
            
            if (clearAuth) {
                setStep('intro')
                setPhoneInput('')
                setTargetPhoneNumber(null)
                setWhatsAppEnabled(false)
                setConnectionState({
                    status: 'disconnected',
                    qrCode: null,
                    error: null,
                    phoneNumber: null,
                    isVerified: false,
                    connectedPhoneNumber: null,
                })
            } else {
                setStep('intro')
            }
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : 'Failed to disconnect')
            setStep('error')
        }
    }, [setConnectionState, setTargetPhoneNumber, setWhatsAppEnabled])

    const handleClose = useCallback(() => {
        if (step !== 'connecting' && step !== 'qr') {
            closeDialog()
        }
    }, [step, closeDialog])

    const handleRetry = useCallback(() => {
        setStep('intro')
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

                        {step !== 'connecting' && step !== 'qr' && step !== 'sending' && (
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

                            {/* ─── Step 1: Intro ────────────────────────────────────── */}
                            {step === 'intro' && (
                                <motion.div
                                    key="intro"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className="space-y-4"
                                >
                                    <div className="text-center space-y-3 py-2">
                                        <div className="w-16 h-16 mx-auto rounded-full bg-[#25D366]/10 flex items-center justify-center">
                                            <Smartphone size={28} className="text-[#25D366]" />
                                        </div>
                                        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                                            Connect Your WhatsApp
                                        </h3>
                                    </div>

                                    <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
                                        <div className="flex gap-3 items-start">
                                            <div className="w-5 h-5 rounded-full bg-[#25D366]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                <span className="text-[10px] font-bold text-[#25D366]">1</span>
                                            </div>
                                            <p><b>Scan QR Code</b> — Link your WhatsApp account by scanning the QR code with your phone.</p>
                                        </div>
                                        <div className="flex gap-3 items-start">
                                            <div className="w-5 h-5 rounded-full bg-[#25D366]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                <span className="text-[10px] font-bold text-[#25D366]">2</span>
                                            </div>
                                            <p><b>Enter Your Number</b> — Enter your WhatsApp number. We'll send a confirmation message to verify.</p>
                                        </div>
                                    </div>

                                    <button
                                        id="whatsapp-start-btn"
                                        onClick={handleStartConnection}
                                        className="w-full py-3 bg-[#25D366] hover:bg-[#22c55e] text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                                    >
                                        Connect WhatsApp
                                        <ArrowRight size={16} />
                                    </button>
                                </motion.div>
                            )}

                            {/* ─── Step 2: QR Code ───────────────────────────────────── */}
                            {(step === 'connecting' || step === 'qr') && connectionState.qrCode && (
                                <motion.div
                                    key="qr"
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex flex-col items-center gap-4"
                                >
                                    <div className="text-center space-y-1">
                                        <p className="text-sm text-[var(--color-text-secondary)]">
                                            Scan this QR code with your <b>WhatsApp phone app</b>
                                        </p>
                                        <p className="text-xs text-[var(--color-text-muted)]">
                                            Open WhatsApp → Settings → Linked Devices → Link a Device
                                        </p>
                                    </div>

                                    <div className="p-3 bg-white rounded-xl shadow-inner">
                                        <QRCodeDisplay qrString={connectionState.qrCode} />
                                    </div>

                                    {step === 'connecting' && (
                                        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                                            <Loader2 size={16} className="animate-spin" />
                                            Waiting for scan...
                                        </div>
                                    )}

                                    <button
                                        id="whatsapp-cancel-qr-btn"
                                        onClick={() => { electron.whatsapp.disconnect(false); setStep('intro') }}
                                        className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] underline transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </motion.div>
                            )}

                            {/* ─── Step 3: Enter Phone Number ────────────────────────── */}
                            {step === 'verify' && (
                                <motion.div
                                    key="verify"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className="space-y-4"
                                >
                                    <div className="text-center space-y-2">
                                        <div className="w-12 h-12 mx-auto rounded-full bg-[#25D366]/20 flex items-center justify-center">
                                            <CheckCircle size={24} className="text-[#25D366]" />
                                        </div>
                                        <p className="text-sm text-[var(--color-text-secondary)]">
                                            <b>Device Linked!</b>
                                        </p>
                                        {connectionState.connectedPhoneNumber && (
                                            <p className="text-xs text-[var(--color-text-muted)]">
                                                Worker: +{connectionState.connectedPhoneNumber}
                                            </p>
                                        )}
                                    </div>

                                    <div className="text-left p-3 bg-white/5 rounded-xl border border-white/5 space-y-2">
                                        <p className="text-xs text-[var(--color-text-secondary)] font-medium">
                                            Final Step: Enter Your Personal Number
                                        </p>
                                        <p className="text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                                            Enter your <b>personal WhatsApp number</b>. Only messages from this number will control the AI Worker (running on the Worker number above).
                                        </p>
                                        <p className="text-[10px] text-amber-400">
                                            Note: Cannot be the same as the Worker number.
                                        </p>
                                    </div>

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
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyPhone() }}
                                            placeholder="+1234567890"
                                            className="w-full pl-9 pr-4 py-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-dim)] outline-none focus:border-[#25D366]/50 transition-colors"
                                        />
                                    </div>

                                    {errorMessage && (
                                        <p className="text-xs text-red-400 text-center">{errorMessage}</p>
                                    )}

                                    <button
                                        id="whatsapp-verify-btn"
                                        onClick={handleVerifyPhone}
                                        disabled={!phoneInput.trim()}
                                        className="w-full py-2.5 bg-[#25D366] hover:bg-[#22c55e] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                                    >
                                        <Send size={16} />
                                        Verify & Send Confirmation
                                    </button>

                                    <button
                                        id="whatsapp-back-to-qr-btn"
                                        onClick={() => { setStep('intro'); electron.whatsapp.disconnect(false) }}
                                        className="w-full py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                                    >
                                        ← Start Over
                                    </button>
                                </motion.div>
                            )}

                            {/* ─── Step 4: Sending Confirmation ──────────────────────── */}
                            {step === 'sending' && (
                                <motion.div
                                    key="sending"
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="flex flex-col items-center gap-4 py-4"
                                >
                                    <Loader2 size={36} className="text-[#25D366] animate-spin" />
                                    <div className="text-center">
                                        <p className="text-base font-semibold text-[var(--color-text-primary)]">
                                            Sending Confirmation
                                        </p>
                                        <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                            Sending a confirmation message to {phoneInput}...
                                        </p>
                                    </div>
                                </motion.div>
                            )}

                            {/* ─── Step 5: Connected ─────────────────────────────────── */}
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
                                        All Set! 🎉
                                    </p>
                                    <p className="text-xs text-[var(--color-text-muted)] text-center">
                                        WhatsApp is connected and verified.<br/>
                                        {targetPhoneNumber && <span className="text-[#25D366]">Receiving messages from: {targetPhoneNumber}</span>}
                                    </p>
                                    
                                    <button
                                        id="whatsapp-done-btn"
                                        onClick={closeDialog}
                                        className="mt-2 px-8 py-2 bg-[#25D366] hover:bg-[#22c55e] text-white text-sm font-medium rounded-xl transition-all"
                                    >
                                        Done
                                    </button>
                                </motion.div>
                            )}

                            {/* ─── Manage (Already Connected) ──────────────────────── */}
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
                                                {targetPhoneNumber 
                                                    ? `Receiving from: ${targetPhoneNumber}`
                                                    : 'No verified number set'}
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

                            {/* ─── Error ──────────────────────────────────────────── */}
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
                    {connectionState.status === 'connecting' && step !== 'manage' && step !== 'sending' && (
                        <div className="px-6 pb-4 border-t border-white/5 pt-4">
                            <button
                                id="whatsapp-disconnect-btn"
                                onClick={() => { electron.whatsapp.disconnect(false); setStep('intro') }}
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
                width: 200,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' },
            }).catch(console.error)
        }).catch(() => {
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
