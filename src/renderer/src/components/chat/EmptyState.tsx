import React from 'react'
import { WorkflowTiles } from '../WorkflowTiles'
import { useWhatsAppStore } from '../../stores/whatsappStore'
import { MessageCircle, Loader2 } from 'lucide-react'

/**
 * Co-Worker Hub Welcome Screen
 */
export function EmptyState() {
  const { connectionState, openDialog, whatsappEnabled, setWhatsAppEnabled } = useWhatsAppStore()
  const isConnected = connectionState.status === 'connected'
  const isConnecting = connectionState.status === 'connecting'
  
  const handleWhatsAppClick = () => {
    if (isConnecting) return // Prevent clicks while connecting
    
    if (isConnected) {
      setWhatsAppEnabled(!whatsappEnabled)
    } else {
      openDialog()
    }
  }
  
  // Fix stale state: if we're not connected but whatsappEnabled is true, reset it
  React.useEffect(() => {
    if (!isConnected && whatsappEnabled) {
      setWhatsAppEnabled(false)
    }
  }, [isConnected, whatsappEnabled, setWhatsAppEnabled])
  
  return (
    <div className="flex flex-col items-center justify-center min-h-full max-w-4xl mx-auto w-full pt-8 pb-32">
      
      {/* System Active Badge */}
      <div className="mb-8 px-3 py-1 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-[10px] font-bold tracking-widest uppercase">
        System Active
      </div>

      {/* Greeting */}
      <div className="text-center mb-6">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-[var(--color-text-primary)] mb-2">
          Hey!
        </h1>
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-[image:var(--gradient-text)]">
          What's on your mind?
        </h2>
      </div>

      {/* Subtitle */}
      <p className="text-[var(--color-text-secondary)] text-md text-center max-w-2xl mb-8">
        Your Co-Worker is ready. Delegate tasks across connected systems right here or press <span className="font-mono bg-[var(--color-surface)] px-1 py-0.5 rounded text-[var(--color-text-primary)] text-sm">Cmd+K</span> to quickly search.
      </p>

      {/* Agent Cards Grid */}
      <div className="w-full">
        <WorkflowTiles />
      </div>

      {/* WhatsApp CTA */}
      <div className="mt-8 w-full max-w-sm">
        <button
          id="empty-state-whatsapp-btn"
          onClick={handleWhatsAppClick}
          disabled={isConnecting}
          className={`
            w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all group
            ${isConnecting ? 'opacity-50 cursor-wait' : ''}
            ${isConnected
              ? 'border-[#25D366]/40 bg-[#25D366]/5 hover:bg-[#25D366]/10'
              : 'border-white/10 bg-white/3 hover:bg-white/5 hover:border-white/20'
            }
          `}
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            isConnected ? 'bg-[#25D366]/20' : 'bg-white/5'
          }`}>
            {isConnecting ? (
              <Loader2 size={16} className="text-white/50 animate-spin" />
            ) : (
              <MessageCircle
                size={16}
                className={isConnected ? 'text-[#25D366]' : 'text-white/30 group-hover:text-white/50 transition-colors'}
              />
            )}
          </div>
          <div className="text-left">
            <p className={`text-sm font-medium ${
              isConnected ? 'text-[#25D366]' : 'text-white/60 group-hover:text-white/80 transition-colors'
            }`}>
              {isConnecting
                ? 'Connecting...'
                : isConnected
                  ? whatsappEnabled ? 'WhatsApp Mode Active' : 'Enable WhatsApp Mode'
                  : 'Connect WhatsApp'}
            </p>
            <p className="text-xs text-white/30 mt-0.5">
              {isConnecting
                ? 'Please wait...'
                : isConnected
                  ? 'Remote control your AI Worker via WhatsApp'
                  : 'Get AI responses directly on your phone'}
            </p>
          </div>
          {isConnected && (
            <span className="ml-auto w-2 h-2 rounded-full bg-[#25D366] animate-pulse flex-shrink-0" />
          )}
        </button>
      </div>

    </div>
  )
}
