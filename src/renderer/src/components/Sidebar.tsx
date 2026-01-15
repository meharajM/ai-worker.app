import React from 'react'
import { Settings, MessageSquare, Database, Activity } from 'lucide-react'

export type View = 'chat' | 'connections' | 'settings' | 'timeline'

interface SidebarProps {
    currentView: View
    onViewChange: (view: View) => void
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
    return (
        <div className="w-16 flex-shrink-0 bg-[#1a1d23] flex flex-col items-center py-6 border-r border-white/5">
            <div className="flex-1 flex flex-col gap-4">
                {/* Chat Tab */}
                <SidebarItem
                    active={currentView === 'chat'}
                    onClick={() => onViewChange('chat')}
                    icon={<MessageSquare size={24} />}
                    title="Chat"
                />

                {/* Connections Tab */}
                <SidebarItem
                    active={currentView === 'connections'}
                    onClick={() => onViewChange('connections')}
                    icon={<Database size={24} />}
                    title="MCP Connections"
                />

                {/* Timeline Tab */}
                <SidebarItem
                    active={currentView === 'timeline'}
                    onClick={() => onViewChange('timeline')}
                    icon={<Activity size={24} />}
                    title="Technical Timeline"
                />
            </div>

            {/* Settings Tab */}
            <SidebarItem
                active={currentView === 'settings'}
                onClick={() => onViewChange('settings')}
                icon={<Settings size={24} />}
                title="Settings"
            />
        </div>
    )
}

interface SidebarItemProps {
    active: boolean
    onClick: () => void
    icon: React.ReactNode
    title: string
}

function SidebarItem({ active, onClick, icon, title }: SidebarItemProps) {
    return (
        <button
            onClick={onClick}
            className={`p-3 rounded-lg transition-colors ${active
                ? 'bg-white/10 text-[#4fd1c5]'
                : 'text-white/40 hover:text-white hover:bg-white/5'
                }`}
            title={title}
        >
            {icon}
        </button>
    )
}
