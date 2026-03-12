import React from 'react'
import { WorkflowTiles } from '../WorkflowTiles'
import { MessageCircle, Smartphone, ExternalLink, Zap, ShieldCheck } from 'lucide-react'
import { useMcpStore } from '../../stores/mcpStore'
import { useState } from 'react';
import { WhatsAppConnectionDialog } from '../WhatsAppConnectionDialog';

/**
 * Co-Worker Hub Welcome Screen
 */
export function EmptyState() {
  const { servers, connectServer } = useMcpStore()
  const whatsappServer = servers.find(s => s.name === 'whatsapp-mcp')
  const isWhatsAppConnected = whatsappServer?.connected || false


  const [showPhoneDialog, setShowPhoneDialog] = useState(false);

  const handleConnectWhatsApp = async () => {
    if (whatsappServer) {
      const targetEnv = whatsappServer.env || {};

      // If the user hasn't configured a target number, prompt them with the custom dialog
      if (!targetEnv.WHATSAPP_TARGET_NUMBER) {
        setShowPhoneDialog(true);
        return; // Halt here. The dialog's submit button will call proceedWithConnection if successful.
      }

      // If already configured, proceed immediately
      connectServer(whatsappServer.id).catch(console.error)

      const event = new CustomEvent('submit-chat-input', {
        detail: { prompt: "Connect to WhatsApp using the whatsapp-mcp tools and check the connection status." }
      })
      window.dispatchEvent(event)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-full max-w-4xl mx-auto w-full pt-8 pb-32">

      {/* System Active Badge */}
      <div className="mb-8 px-3 py-1 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-[10px] font-bold tracking-widest uppercase flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] animate-pulse" />
        System Active
      </div>

      {/* Greeting */}
      <div className="text-center mb-6">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-2">
          Hey!
        </h1>
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-[image:var(--gradient-text)]">
          What's on your mind?
        </h2>
      </div>

      {/* Subtitle */}
      <p className="text-[var(--color-text-secondary)] text-md text-center max-w-2xl mb-8">
        Your Co-Worker is ready. Delegate tasks across connected systems right here or press <span className="font-mono bg-white/10 px-1 py-0.5 rounded text-white/90 text-sm">Cmd+K</span> to quickly search.
      </p>

      {/* WhatsApp Human-in-the-Loop Prompt */}
      {!isWhatsAppConnected && (
        <div className="w-full mb-12 animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-200">
          <div className="bg-gradient-to-br from-[#1a1d23] to-[#121418] border border-[var(--color-primary)]/20 rounded-3xl p-6 relative overflow-hidden group shadow-2xl shadow-black/40">
            {/* Background Decor */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--color-primary)]/5 rounded-full blur-3xl -mr-32 -mt-32 group-hover:bg-[var(--color-primary)]/10 transition-colors duration-700" />

            <div className="flex flex-col md:flex-row items-center gap-6 relative z-10">
              <div className="p-4 rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)] shadow-inner">
                <MessageCircle size={32} />
              </div>

              <div className="flex-1 text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-2 mb-1">
                  <h3 className="text-xl font-bold text-white">Remote "Auto-Pilot" via WhatsApp</h3>
                  <span className="px-2 py-0.5 rounded-md bg-[var(--color-primary)] text-black text-[10px] font-black uppercase">Alpha</span>
                </div>
                <p className="text-white/50 text-sm max-w-xl leading-relaxed">
                  Beam logical decision points directly to your phone.
                  Step away from your desk while your agent handles complex tasks autonomously,
                  asking for your permission only when critical.
                </p>
              </div>

              <button
                onClick={handleConnectWhatsApp}
                className="px-6 py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90 text-black font-bold rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 shadow-lg shadow-[var(--color-primary)]/20"
              >
                <Zap size={18} />
                Connect WhatsApp
              </button>
            </div>

            {/* Features Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/5">
              <div className="flex items-center gap-2 text-[11px] text-white/40">
                <ShieldCheck size={14} className="text-emerald-400" />
                <span>Security: Human-in-the-loop</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-white/40">
                <Smartphone size={14} className="text-blue-400" />
                <span>Real-time logical permissions</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-white/40">
                <ExternalLink size={14} className="text-purple-400" />
                <span>Fully autonomous workflows</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agent Cards Grid */}
      <div className="w-full">
        <WorkflowTiles />
      </div>

      {/* WhatsApp Number Dialog Prompt */}
      <WhatsAppConnectionDialog open={showPhoneDialog} onOpenChange={setShowPhoneDialog} />

    </div>
  )
}
