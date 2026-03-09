import React from 'react'
import { CheckCircle2, Clock, AlertTriangle, ChevronRight, Activity } from 'lucide-react'
import { motion } from 'framer-motion'
import { ToolCall } from '../../stores/chatStore'
import { FormattedText } from '../FormattedText'

interface ToolCallListProps {
  /** Tool calls to display (should already be filtered to exclude internal tools) */
  toolCalls: ToolCall[]
}

/**
 * Maps an agent name to its display icon and color based on the Co-Worker Hub theme.
 */
function getAgentTheme(agentName: string) {
  switch (agentName) {
    case 'Research MCP':
      return { icon: <Activity size={16} />, ring: 'ring-blue-500/50', border: 'border-blue-500/20', fill: 'bg-blue-500', text: 'text-blue-400' }
    case 'NavigationAgent':
      return { icon: <Activity size={16} />, ring: 'ring-emerald-500/50', border: 'border-emerald-500/20', fill: 'bg-emerald-500', text: 'text-emerald-400' }
    case 'FilesystemAgent':
      return { icon: <Activity size={16} />, ring: 'ring-purple-500/50', border: 'border-purple-500/20', fill: 'bg-purple-500', text: 'text-purple-400' }
    case 'MCPAgent':
      return { icon: <Activity size={16} />, ring: 'ring-orange-500/50', border: 'border-orange-500/20', fill: 'bg-orange-500', text: 'text-orange-400' }
    case 'PlannerAgent':
      return { icon: <Activity size={16} />, ring: 'ring-[var(--color-primary)]/50', border: 'border-[var(--color-primary)]/20', fill: 'bg-[var(--color-primary)]', text: 'text-[var(--color-primary)]' }
    default:
      return { icon: <Activity size={16} />, ring: 'ring-gray-500/50', border: 'border-gray-500/20', fill: 'bg-gray-500', text: 'text-gray-400' }
  }
}

/**
 * Parses tool names to categorize them into logical Agents.
 */
function determineAgentName(toolName: string): string {
  if (toolName.startsWith('browser_') || toolName.startsWith('playwright_')) return 'NavigationAgent'
  if (toolName.startsWith('fs_') || toolName.startsWith('file_')) return 'FilesystemAgent'
  if (toolName.startsWith('mcp_') || toolName.includes('_')) return 'MCPAgent'
  if (toolName === 'create_execution_plan') return 'PlannerAgent'
  return 'SystemAgent'
}

/**
 * Renders tool calls as large, visually distinct execution block cards
 * matching the Co-Worker Hub mockup.
 */
export function ToolCallList({ toolCalls }: ToolCallListProps) {
  if (!toolCalls || toolCalls.length === 0) return null

  // In a real execution, we'd have exact token/timing metrics, but we mock them or omit them based on available data
  const renderAgentBlock = (agentName: string, tools: ToolCall[]) => {
    // If ANY tool is still processing, the whole block is 'processing'
    const isDone = tools.every(t => !!t.result)
    const hasError = tools.some(t => t.result && String(t.result).toLowerCase().includes('error'))
    
    // In the mockup, there's a left border strip indicating status.
    const statusColor = hasError ? 'bg-orange-500' : (isDone ? 'bg-emerald-500' : 'bg-blue-500 animate-pulse')
    const StatusIcon = hasError ? AlertTriangle : (isDone ? CheckCircle2 : Clock)
    const iconColor = hasError ? 'text-orange-500' : (isDone ? 'text-emerald-500' : 'text-blue-500')
    const Theme = getAgentTheme(agentName)

    return (
      <div key={agentName} className="flex flex-col bg-[var(--color-card-dark)] border border-[var(--color-border)] rounded-2xl overflow-hidden relative">
        {/* Left Status Strip */}
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${statusColor}`} />

        <div className="p-4 pl-5">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <StatusIcon size={16} className={iconColor} />
              <span className="font-semibold text-white/90 text-sm tracking-wide">
                {agentName === 'MCPAgent' ? 'Research MCP' : agentName}
              </span>
            </div>
            
            {/* Metrics (Mocked/Derived for mockup fidelity) */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md text-[10px] text-white/50 font-mono">
                <Clock size={10} />
                <span>{isDone ? '223ms' : '...'}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md text-[10px] text-white/50 font-mono">
                <span className="px-1 py-0.5 rounded-sm bg-white/10 text-[8px] leading-none">⚙️</span>
                <span>{tools.length} actions</span>
              </div>
            </div>
          </div>

          {/* Body content */}
          <div className="space-y-3">
            {tools.map(tool => {
               const toolDone = !!tool.result
               const toolError = toolDone && String(tool.result).toLowerCase().includes('error')
               return (
                 <div key={tool.id} className="flex flex-col gap-1">
                   <div className="flex items-start gap-2.5">
                     <div className="mt-1 flex-shrink-0 opacity-50">
                       <ChevronRight size={14} className={toolError ? 'text-orange-400' : (toolDone ? 'text-emerald-400' : 'text-blue-400 animate-pulse')} />
                     </div>
                     <div className="flex-1">
                       <span className={`text-[13px] font-medium leading-tight ${toolError ? 'text-orange-200' : 'text-white/80'}`}>
                         {tool.name}
                       </span>
                       
                       {/* Expanded finding for presentable tools */}
                       {tool.isPresentable && tool.finding && (
                          <div className="mt-2 text-[12px] leading-relaxed text-white/60 bg-black/20 p-3 rounded-lg border border-white/5 whitespace-pre-wrap">
                            <FormattedText content={tool.finding} />
                          </div>
                       )}
                     </div>
                   </div>
                 </div>
               )
            })}
          </div>
        </div>
      </div>
    )
  }

  // Group the tools
  const groupedByAgent = toolCalls.reduce(
    (acc, tool) => {
      const agentName = determineAgentName(tool.name)
      if (!acc[agentName]) acc[agentName] = []
      acc[agentName].push(tool)
      return acc
    },
    {} as Record<string, ToolCall[]>
  )

  return (
    <div className="flex flex-col gap-3 mt-4 mb-2">
      {Object.entries(groupedByAgent).map(([agentName, tools]) => renderAgentBlock(agentName, tools))}
    </div>
  )
}
