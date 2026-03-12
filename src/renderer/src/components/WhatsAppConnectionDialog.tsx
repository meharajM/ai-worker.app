import React, { useState, useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Smartphone, Loader2, CheckCircle2 } from 'lucide-react'
import { useMcpStore } from '../stores/mcpStore'
import { executeToolCall } from '../lib/mcp'

interface WhatsAppConnectionDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

type ConnectionState = 'idle' | 'connecting' | 'qr' | 'connected'

export function WhatsAppConnectionDialog({ open, onOpenChange }: WhatsAppConnectionDialogProps) {
    const { servers, connectServer, updateServer } = useMcpStore()
    const whatsappServer = servers.find(s => s.name === 'whatsapp-mcp')
    const [targetNumber, setTargetNumber] = useState('')
    const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
    const [qrCodeData, setQrCodeData] = useState<string | null>(null)
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

    // Reset state & clear polling on unmount/close
    useEffect(() => {
        if (!open) {
            setConnectionState('idle')
            setQrCodeData(null)
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
        } else if (whatsappServer?.env?.WHATSAPP_TARGET_NUMBER) {
            setTargetNumber(whatsappServer.env.WHATSAPP_TARGET_NUMBER)
        }

        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
        }
    }, [open, whatsappServer])

    const startPolling = () => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
        let attempts = 0
        const MAX_POLLS = 120 // 6 minutes max

        pollIntervalRef.current = setInterval(async () => {
            if (!whatsappServer) return
            attempts++
            
            if (attempts > MAX_POLLS) {
                if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
                setConnectionState('idle')
                return
            }

            try {
                // Mute logging since this happens rapidly
                const res = await executeToolCall('get_status', {})
                // Example expected structure: { result: { content: [{ type: 'text', text: 'connected' }] } }
                const resString = JSON.stringify(res).toLowerCase()
                
                if (resString.includes('connected') && !resString.includes('not connected') && !resString.includes('disconnected')) {
                    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
                    setConnectionState('connected')
                    setTimeout(() => {
                        onOpenChange(false)
                    }, 2500)
                }
            } catch (e) {
                console.error('Polling get_status error:', e)
            }
        }, 3000)
    }

    const fetchQrCode = async () => {
        try {
            const res = await executeToolCall('connect', null) as { result: { content?: Array<{ type: string, data?: string, mimeType?: string, text?: string }> }, error?: string }
            if (res.error) throw new Error(res.error)

            let base64 = null
            let mime = 'image/png'
            
            if (res.result?.content && Array.isArray(res.result.content)) {
                for (const c of res.result.content) {
                    if (c.type === 'image' && c.data) {
                        base64 = c.data
                        if (c.mimeType) mime = c.mimeType
                    } else if (c.type === 'text' && c.text) {
                        const txt = c.text.toLowerCase()
                        if (txt.includes('connected') && !txt.includes('not connected')) {
                            setConnectionState('connected')
                            setTimeout(() => {
                                onOpenChange(false)
                            }, 2500)
                            return
                        }
                    }
                }
            }

            setConnectionState('qr')
            if (base64) {
                setQrCodeData(`data:${mime};base64,${base64}`)
            }
            startPolling()
            
        } catch (e) {
            console.error('Connection tool error:', e)
            setConnectionState('idle')
        }
    }

    const proceedWithConnection = async (envToSave?: Record<string, string>) => {
        if (!whatsappServer) return

        setConnectionState('connecting')
        
        try {
            if (envToSave) {
                // When autoConnect: true is set, updateServer automatically calls connectServer.
                // updateServer does not return the internal promise of connectServer, so we 
                // must explicitly await connectServer ourselves right after to guarantee tools are loaded.
                await updateServer(whatsappServer.id, { env: envToSave, autoConnect: true });
            }
            // Always explicitly call connectServer (it's safe if already connected, mcpStore handles it)
            // and actually await it so the tools array gets populated.
            await connectServer(whatsappServer.id)

            // Let the state settle 
            await new Promise(res => setTimeout(res, 500))
            
            await fetchQrCode()
        } catch (e) {
            console.error('Failed to connect server:', e)
            setConnectionState('idle')
        }
    }

    const submitPhoneNumber = () => {
        if (targetNumber && targetNumber.trim().length > 0 && whatsappServer) {
            const formattedNumber = targetNumber.replace(/[^0-9+]/g, '');
            const targetEnv = { ...(whatsappServer.env || {}), WHATSAPP_TARGET_NUMBER: formattedNumber };
            proceedWithConnection(targetEnv);
        }
    }

    if (!whatsappServer) return null

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in" />
                <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md bg-[#1a1d23] border border-[#2d323b] rounded-2xl shadow-2xl z-50 p-6 animate-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95">
                    
                    <Dialog.Title className={`text-xl font-bold text-white flex items-center gap-2 ${connectionState === 'idle' ? 'mb-2' : 'mb-6 justify-center'}`}>
                        <Smartphone size={20} className="text-[#4fd1c5]" />
                        WhatsApp Setup
                    </Dialog.Title>
                    
                    {connectionState === 'idle' && (
                        <>
                            <Dialog.Description className="text-white/60 text-sm mb-6 leading-relaxed">
                                To securely beam Agent notifications and review approvals straight to your phone, please enter your target WhatsApp number.
                            </Dialog.Description>

                            <div className="mb-6">
                                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 ml-1">
                                    Phone Number (incl. country code)
                                </label>
                                <input
                                    type="text"
                                    placeholder="+1234567890"
                                    value={targetNumber}
                                    onChange={(e) => setTargetNumber(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') submitPhoneNumber()
                                    }}
                                    className="w-full bg-[#121418] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-[#4fd1c5] focus:ring-1 focus:ring-[#4fd1c5] transition-all font-mono"
                                    autoFocus
                                    disabled={connectionState !== 'idle'}
                                />
                            </div>

                            <div className="flex justify-end gap-3 mt-4">
                                <Dialog.Close asChild>
                                    <button className="px-4 py-2 hover:bg-white/10 text-white/60 font-medium rounded-lg transition-colors">
                                        Cancel
                                    </button>
                                </Dialog.Close>
                                <button
                                    onClick={submitPhoneNumber}
                                    className="px-5 py-2 bg-[#4fd1c5] hover:bg-[#5fe0d4] text-black font-bold rounded-lg transition-colors"
                                    disabled={!targetNumber}
                                >
                                    Connect Device
                                </button>
                            </div>
                        </>
                    )}

                    {connectionState === 'connecting' && (
                        <div className="flex flex-col items-center justify-center py-8 animate-in fade-in duration-300">
                            <Loader2 size={32} className="text-[#4fd1c5] animate-spin mb-4" />
                            <p className="text-white/70 font-medium">Starting server & generating QR code...</p>
                            <p className="text-white/40 text-xs mt-2 text-center max-w-xs">This may take up to 15 seconds as a new isolated connection is established.</p>
                        </div>
                    )}

                    {connectionState === 'qr' && (
                        <div className="flex flex-col items-center justify-center py-2 animate-in fade-in duration-300">
                            {qrCodeData ? (
                                <div className="bg-white p-4 rounded-xl mb-6 shadow-xl shadow-black/50">
                                    <img src={qrCodeData} alt="WhatsApp QR Code" className="w-64 h-64 object-contain" />
                                </div>
                            ) : (
                                <div className="w-64 h-64 bg-[#121418] rounded-xl mb-6 flex flex-col items-center justify-center border border-white/10">
                                    <Loader2 size={24} className="text-[#4fd1c5] animate-spin mb-3" />
                                    <p className="text-white/40 text-xs">Awaiting QR Code from device...</p>
                                </div>
                            )}
                            <p className="text-white/90 font-bold mb-1">Scan QR Code</p>
                            <p className="text-white/50 text-xs text-center max-w-[280px]">Open WhatsApp on your phone &gt; Settings &gt; Linked Devices &gt; Link a Device.</p>
                        </div>
                    )}

                    {connectionState === 'connected' && (
                        <div className="flex flex-col items-center justify-center py-8 animate-in zoom-in duration-300">
                            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-5">
                                <CheckCircle2 size={40} className="text-emerald-400" />
                            </div>
                            <p className="text-white font-bold text-xl">Connected Successfully</p>
                            <p className="text-white/50 text-sm mt-2 text-center">Your agent is now securely connected to your mobile device.</p>
                        </div>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
