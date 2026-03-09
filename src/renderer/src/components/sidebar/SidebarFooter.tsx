import React from 'react'
import { Settings } from 'lucide-react'
import { View } from '../Sidebar' // old interface Location, we'll keep it there

interface SidebarFooterProps {
  currentView: View
  onViewChange: (view: View) => void
}

export function SidebarFooter({ currentView, onViewChange }: SidebarFooterProps) {
  return (
    <div className="px-5 py-4 border-t border-[var(--color-border)] flex flex-col gap-2">
      <button
        onClick={() => onViewChange('connections')}
        title="MCP Connections"
        className={`w-full flex items-center justify-between py-2 px-2 -mx-2 rounded-lg transition-colors group cursor-pointer
          ${currentView === 'connections' ? 'bg-[var(--color-surface)] text-white' : 'text-white/50 hover:bg-[var(--color-surface)] hover:text-white'}
        `}
      >
        <div className="flex items-center gap-3">
          <Settings size={16} className="opacity-70 group-hover:opacity-100" />
          <span className="text-xs font-medium">MCP Connections</span>
        </div>
      </button>

      <button
        onClick={() => onViewChange('settings')}
        title="Settings"
        className={`w-full flex items-center justify-between py-2 px-2 -mx-2 rounded-lg transition-colors group cursor-pointer
          ${currentView === 'settings' ? 'bg-[var(--color-surface)] text-white' : 'text-white/50 hover:bg-[var(--color-surface)] hover:text-white'}
        `}
      >
        <div className="flex items-center gap-3">
          <Settings size={16} className="opacity-70 group-hover:opacity-100" />
          <span className="text-xs font-medium">Hub Settings</span>
        </div>
      </button>
    </div>
  )
}
