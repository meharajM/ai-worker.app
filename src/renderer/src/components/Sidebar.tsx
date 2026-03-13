import React from 'react'
import { SidebarHeader } from './sidebar/SidebarHeader'
// import { ActiveAgentsList } from './sidebar/ActiveAgentsList'
import { RecentSessionsList } from './sidebar/RecentSessionsList'
import { SidebarFooter } from './sidebar/SidebarFooter'
import { useChatStore } from '../stores/chatStore'

export type View = 'chat' | 'connections' | 'settings'

interface SidebarProps {
  currentView: View
  onViewChange: (view: View) => void
}

/**
 * Unified Sidebar Orchestrator for the Co-Worker Hub.
 * Composes the header, active agents, recent sessions, and footer.
 */
export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const { sidebarOpen } = useChatStore()

  if (!sidebarOpen) return null

  return (
    <div className="w-64 flex-shrink-0 bg-[var(--color-card-dark)] hidden md:flex flex-col h-full border-r border-[var(--color-border)] transition-all duration-300">
      {/* 1. Header with Logo */}
      <SidebarHeader />

      {/* 2. Scrollable Body containing Agents & Sessions */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* ActiveAgentsList removed as per user request to simplify sidebar */}

        {/* Divider */}
        <div className="mx-5 my-2 border-t border-white/5" />

        <RecentSessionsList onViewChange={onViewChange} />
      </div>

      {/* 3. Footer with quick settings link */}
      <SidebarFooter currentView={currentView} onViewChange={onViewChange} />
    </div>
  )
}
