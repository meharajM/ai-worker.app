import React from 'react'
import { Search, Calendar, MapPin, Activity } from 'lucide-react'

const AGENTS = [
  { id: 'research', label: 'Research', icon: Search, activeCount: 2, totalCount: 3, dotColor: 'bg-[var(--color-success)]' },
  { id: 'planning', label: 'Planning', icon: Calendar, activeCount: 0, totalCount: 0, dotColor: 'bg-[var(--color-warning)]' },
  { id: 'local', label: 'Local', icon: MapPin, activeCount: 0, totalCount: 0, dotColor: 'bg-[var(--color-warning)]' },
  { id: 'health', label: 'Health', icon: Activity, activeCount: 0, totalCount: 0, dotColor: 'bg-[var(--color-warning)]' },
]

export function ActiveAgentsList() {
  return (
    <div className="px-5 py-4">
      <h3 className="text-[10px] font-[var(--font-weight-bold)] text-[var(--color-text-dim)] tracking-wider uppercase mb-3">
        Active Agents
      </h3>
      <div className="flex flex-col gap-1">
        {AGENTS.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between py-2 px-2 -mx-2 rounded-[var(--radius-lg)] hover:bg-[var(--color-surface)] transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <agent.icon size={16} className="text-[var(--color-primary)] opacity-80 group-hover:opacity-100 transition-opacity" />
              <span className="text-[var(--text-xs)] font-[var(--font-weight-medium)]">{agent.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-[var(--font-family-mono)] text-[var(--color-text-dim)]">
                {agent.activeCount}/{agent.totalCount}
              </span>
              <span className={`w-2 h-2 rounded-full ${agent.dotColor} ${agent.activeCount > 0 ? 'shadow-[0_0_8px_var(--color-success)]' : ''}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
