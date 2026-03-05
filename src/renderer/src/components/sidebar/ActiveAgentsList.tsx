import React from 'react'
import { Search, Calendar, MapPin, Activity } from 'lucide-react'

// Dummy data for design visualization logic
const AGENTS = [
  { id: 'research', label: 'Research', icon: Search, activeCount: 2, totalCount: 3, dotColor: 'bg-emerald-500' },
  { id: 'planning', label: 'Planning', icon: Calendar, activeCount: 0, totalCount: 0, dotColor: 'bg-amber-500' },
  { id: 'local', label: 'Local', icon: MapPin, activeCount: 0, totalCount: 0, dotColor: 'bg-amber-500' },
  { id: 'health', label: 'Health', icon: Activity, activeCount: 0, totalCount: 0, dotColor: 'bg-amber-500' },
]

export function ActiveAgentsList() {
  return (
    <div className="px-5 py-4">
      <h3 className="text-[10px] font-bold text-white/40 tracking-wider uppercase mb-3">
        Active Agents
      </h3>
      <div className="flex flex-col gap-1">
        {AGENTS.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between py-2 px-2 -mx-2 rounded-lg hover:bg-[var(--color-surface)] transition-colors text-white/70 hover:text-white cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <agent.icon size={16} className="text-[var(--color-primary)] opacity-80 group-hover:opacity-100 transition-opacity" />
              <span className="text-xs font-medium">{agent.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-white/40">
                {agent.activeCount}/{agent.totalCount}
              </span>
              <span className={`w-2 h-2 rounded-full ${agent.dotColor} ${agent.activeCount > 0 ? 'animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : ''}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
