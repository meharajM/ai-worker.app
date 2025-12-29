import React from 'react'
import { Wifi, WifiOff } from 'lucide-react'

interface HeaderProps {
    status: { provider: string | null; available: boolean }
}

export function Header({ status }: HeaderProps) {
    return (
        <header className="h-12 flex items-center justify-between px-4 border-b border-white/5 flex-shrink-0">
            <div />
            <div className="text-[10px] uppercase tracking-widest text-white/20 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                local-session: active
            </div>

            {/* LLM Status */}
            <div className={`flex items-center gap-1.5 text-[10px] ${status.available ? 'text-green-400' : 'text-yellow-400'
                }`}>
                {status.available ? <Wifi size={12} /> : <WifiOff size={12} />}
                <span className="uppercase tracking-wide">
                    {status.provider || 'No LLM'}
                </span>
            </div>
        </header>
    )
}
