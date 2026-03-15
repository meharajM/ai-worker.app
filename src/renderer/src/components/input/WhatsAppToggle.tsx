/**
 * WhatsAppToggle.tsx — Compact toggle button for the ChatInput toolbar.
 *
 * Shows the WhatsApp status and toggles WhatsApp message mode.
 * When disconnected, clicking opens the connection dialog instead.
 *
 * Per react-components.md: purely presentational — reads from stores,
 * fires callbacks. No direct IPC.
 */

import React from 'react'
import { MessageCircle } from 'lucide-react'
import { useWhatsAppStore } from '../../stores/whatsappStore'

interface WhatsAppToggleProps {
    disabled?: boolean
}

export function WhatsAppToggle({ disabled = false }: WhatsAppToggleProps): React.JSX.Element {
    const {
        connectionState,
        whatsappEnabled,
        setWhatsAppEnabled,
        openDialog,
    } = useWhatsAppStore()

    const isConnected = connectionState.status === 'connected'

    const handleClick = () => {
        if (disabled) return

        if (!isConnected) {
            // Not connected — open setup dialog
            openDialog()
        } else {
            // Connected — toggle send mode
            setWhatsAppEnabled(!whatsappEnabled)
        }
    }

    const statusColor = isConnected
        ? whatsappEnabled
            ? '#25D366'
            : 'var(--color-text-muted)'
        : 'var(--color-text-dim)'

    const title = !isConnected
        ? 'Connect WhatsApp'
        : whatsappEnabled
            ? 'WhatsApp mode active — click to disable'
            : 'Click to send via WhatsApp'

    return (
        <button
            id="whatsapp-toggle-btn"
            onClick={handleClick}
            disabled={disabled}
            title={title}
            className={`
                relative p-2 rounded-lg transition-all duration-150
                ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-white/5'}
                ${isConnected && whatsappEnabled ? 'bg-[#25D366]/10' : ''}
            `}
            style={{ color: statusColor }}
        >
            <MessageCircle size={18} />

            {/* Connected status dot */}
            {isConnected && (
                <span
                    className={`
                        absolute top-1 right-1 w-2 h-2 rounded-full
                        ${whatsappEnabled ? 'bg-[#25D366] animate-pulse' : 'bg-[#25D366]/50'}
                    `}
                />
            )}
        </button>
    )
}
