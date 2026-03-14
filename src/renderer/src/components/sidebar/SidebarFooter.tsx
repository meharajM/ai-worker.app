import { Settings, Network, MessageSquare } from 'lucide-react'
import { View } from '../Sidebar' // old interface Location, we'll keep it there

interface SidebarFooterProps {
  currentView: View
  onViewChange: (view: View) => void
}

export function SidebarFooter({ currentView, onViewChange }: SidebarFooterProps) {
  return (
    <div className="px-5 py-4 border-t border-[var(--color-border)] flex flex-col gap-1">
      <button
        onClick={() => onViewChange('chat')}
        title="Chat"
        className={`w-full flex items-center justify-between py-2 px-2 -mx-2 rounded-lg transition-colors group cursor-pointer
          ${currentView === 'chat' ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]'}
        `}
      >
        <div className="flex items-center gap-3">
          <MessageSquare size={16} className="opacity-70 group-hover:opacity-100" />
          <span className="text-xs font-medium">Hub Chat</span>
        </div>
      </button>
      <button
        onClick={() => onViewChange('connections')}
        title="MCP Connections"
        className={`w-full flex items-center justify-between py-2 px-2 -mx-2 rounded-lg transition-colors group cursor-pointer
          ${currentView === 'connections' ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]'}
        `}
      >
        <div className="flex items-center gap-3">
          <Network size={16} className="opacity-70 group-hover:opacity-100" />
          <span className="text-xs font-medium">MCP Connections</span>
        </div>
      </button>

      <button
        onClick={() => onViewChange('settings')}
        title="Settings"
        className={`w-full flex items-center justify-between py-2 px-2 -mx-2 rounded-lg transition-colors group cursor-pointer
          ${currentView === 'settings' ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]'}
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
