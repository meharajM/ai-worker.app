import React from 'react'
import { Network } from 'lucide-react'

export function SidebarHeader() {
  return (
    <div className="flex items-center gap-3 px-5 py-6">
      <div className="w-8 h-8 rounded-lg bg-[#1a2133] flex items-center justify-center flex-shrink-0 text-[var(--color-primary)]">
        <Network size={18} />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-bold tracking-tight text-white/90">
          CO-WORKER HUB
        </span>
        <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">
          MCP Orchestrator
        </span>
      </div>
    </div>
  )
}
