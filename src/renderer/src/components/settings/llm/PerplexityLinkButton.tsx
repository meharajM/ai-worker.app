import React from 'react'
import { LogIn, LogOut, Loader2 } from 'lucide-react'
import { useAuthStore } from '../../../stores/authStore'

interface PerplexityLinkButtonProps {
    variant?: 'compact' | 'full'
}

export function PerplexityLinkButton({ variant = 'compact' }: PerplexityLinkButtonProps) {
    const { perplexitySignedIn, perplexityLoading, signInWithPerplexity, signOutFromPerplexity } = useAuthStore()

    if (variant === 'compact') {
        return perplexitySignedIn ? (
            <button
                onClick={() => signOutFromPerplexity()}
                className="px-2 py-1 text-[10px] bg-red-500/10 text-red-400 rounded border border-red-500/20 hover:bg-red-500/20 transition-colors flex items-center gap-1"
                title="Signed in to Perplexity"
            >
                <LogOut size={10} /> Unlink Perplexity
            </button>
        ) : (
            <button
                onClick={() => signInWithPerplexity()}
                disabled={perplexityLoading}
                className="px-2 py-1 text-[10px] bg-[#4fd1c5]/10 text-[#4fd1c5] rounded border border-[#4fd1c5]/20 hover:bg-[#4fd1c5]/20 transition-colors flex items-center gap-1 disabled:opacity-50"
            >
                {perplexityLoading ? <Loader2 size={10} className="animate-spin" /> : <LogIn size={10} />}
                Link Perplexity
            </button>
        )
    }

    // 'full' variant — used in AccountSettings
    return perplexitySignedIn ? (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#4fd1c5]/10 flex items-center justify-center text-[#4fd1c5] text-sm font-bold">
                    P
                </div>
                <div>
                    <p className="text-sm font-medium text-white">Perplexity Account</p>
                    <p className="text-[10px] text-green-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                        Linked and Active
                    </p>
                </div>
            </div>
            <button
                onClick={() => signOutFromPerplexity()}
                className="px-3 py-1.5 bg-white/5 hover:bg-red-500/10 text-white/60 hover:text-red-400 rounded-lg border border-white/5 hover:border-red-500/20 transition-all text-xs flex items-center gap-2"
            >
                <LogOut size={14} /> Unlink
            </button>
        </div>
    ) : (
        <div className="flex items-center justify-between">
            <div>
                <p className="text-sm text-white/60 mb-1">Perplexity not linked</p>
                <p className="text-[11px] text-white/30">Connect your Perplexity account to use it as an LLM provider</p>
            </div>
            <button
                onClick={() => signInWithPerplexity()}
                disabled={perplexityLoading}
                className="flex items-center gap-2 px-4 py-2 bg-[#4fd1c5]/10 text-[#4fd1c5] rounded-lg hover:bg-[#4fd1c5]/20 border border-[#4fd1c5]/20 transition-all text-xs font-bold"
            >
                {perplexityLoading ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
                Link Account
            </button>
        </div>
    )
}
