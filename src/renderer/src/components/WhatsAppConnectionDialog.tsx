import React, { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Smartphone } from 'lucide-react'
import { useMcpStore } from '../stores/mcpStore'

interface WhatsAppConnectionDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function WhatsAppConnectionDialog({ open, onOpenChange }: WhatsAppConnectionDialogProps) {
    const { servers, connectServer, updateServer } = useMcpStore()
    const whatsappServer = servers.find(s => s.name === 'whatsapp-mcp')
    const [targetNumber, setTargetNumber] = useState('')

    useEffect(() => {
        if (open && whatsappServer?.env?.WHATSAPP_TARGET_NUMBER) {
            setTargetNumber(whatsappServer.env.WHATSAPP_TARGET_NUMBER)
        }
    }, [open, whatsappServer])

    const proceedWithConnection = async (envToSave?: Record<string, string>) => {
        if (whatsappServer) {
            if (envToSave) {
                await updateServer(whatsappServer.id, { env: envToSave });
            }
            connectServer(whatsappServer.id).catch(console.error)

            // Keep the prompt simple — the whatsapp-mcp tool descriptions are self-explanatory.
            // The only critical constraint: do NOT use the browser/Playwright for this.
            const event = new CustomEvent('submit-chat-input', {
                detail: { prompt: "Connect to WhatsApp using the whatsapp-mcp tools and check the connection status." }
            })
            window.dispatchEvent(event)
        }
    }

    const submitPhoneNumber = () => {
        if (targetNumber && targetNumber.trim().length > 0 && whatsappServer) {
            // Keep only numbers and '+' sign
            const formattedNumber = targetNumber.replace(/[^0-9+]/g, '');
            const targetEnv = { ...(whatsappServer.env || {}), WHATSAPP_TARGET_NUMBER: formattedNumber };

            onOpenChange(false);
            proceedWithConnection(targetEnv);
        }
    }

    if (!whatsappServer) return null

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in" />
                <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md bg-[#1a1d23] border border-[#2d323b] rounded-2xl shadow-2xl z-50 p-6 animate-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95">
                    <Dialog.Title className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <Smartphone size={20} className="text-[#4fd1c5]" />
                        WhatsApp Setup
                    </Dialog.Title>
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
                        >
                            Connect Device
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
