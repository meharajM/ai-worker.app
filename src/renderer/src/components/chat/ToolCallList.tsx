import React, { useState } from 'react'
import { CheckCircle2, AlertTriangle, ChevronRight, Activity, ChevronDown, Copy, Check } from 'lucide-react'
import { ToolCall } from '../../stores/chatStore'
import { FormattedText } from '../FormattedText'
import { cn } from '../../lib/utils'

/**
 * Agent display configuration.
 * Maps tool name prefixes to human-readable agent labels with accent colors.
 *
 * WHY config object instead of if/else: Adding a new agent is a single line,
 * and we avoid the old catch-all bug where `toolName.includes('_')` matched everything.
 */
const AGENT_CONFIG: Record<string, { label: string; accent: string }> = {
  browser_:     { label: 'Browser Agent',     accent: 'var(--color-primary)' },
  playwright_:  { label: 'Browser Agent',     accent: 'var(--color-primary)' },
  fs_:          { label: 'Filesystem Agent',  accent: 'var(--color-agent-fs)' },
  file_:        { label: 'Filesystem Agent',  accent: 'var(--color-agent-fs)' },
  mcp_:         { label: 'Research MCP',      accent: 'var(--color-agent-mcp)' },
}

/** Default agent for tools that don't match any prefix */
const DEFAULT_AGENT = { label: 'Tool Execution', accent: 'var(--color-agent-default)' }

/** Special tool names with their own agent identity */
const SPECIAL_TOOLS: Record<string, { label: string; accent: string }> = {
  create_execution_plan: { label: 'Planner', accent: 'var(--color-brand-teal)' },
}

interface ToolCallListProps {
  /** Tool calls to display (should already be filtered to exclude internal tools) */
  toolCalls: ToolCall[]
}

/**
 * Determines which agent group a tool belongs to.
 * Uses AGENT_CONFIG prefix matching + SPECIAL_TOOLS exact matching.
 */
function getAgentInfo(toolName: string): { label: string; accent: string } {
  // Check exact match first (special tools)
  if (SPECIAL_TOOLS[toolName]) return SPECIAL_TOOLS[toolName]

  // Check prefix match
  for (const [prefix, config] of Object.entries(AGENT_CONFIG)) {
    if (toolName.startsWith(prefix)) return config
  }

  return DEFAULT_AGENT
}

/**
 * Formats elapsed time from ms to a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

/**
 * Calculates total elapsed time for a set of tool calls.
 */
function getTotalDuration(tools: ToolCall[]): string | null {
  const withTiming = tools.filter(t => t.startedAt && t.completedAt)
  if (withTiming.length === 0) return null

  const earliest = Math.min(...withTiming.map(t => t.startedAt!))
  const latest = Math.max(...withTiming.map(t => t.completedAt!))
  return formatDuration(latest - earliest)
}

/**
 * Single tool row with optional expand/collapse for raw details.
 */
function ToolRow({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const isDone = !!tool.result
  const isError = isDone && String(tool.result).toLowerCase().includes('error')

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for Electron
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.left = '-9999px'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Per-tool timing
  const toolDuration = tool.startedAt && tool.completedAt
    ? formatDuration(tool.completedAt - tool.startedAt)
    : null

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2.5 w-full text-left group/tool hover:bg-[var(--color-tool-badge-bg)] rounded-lg px-2 py-1.5 -mx-2 transition-colors"
      >
        <div className="mt-0.5 flex-shrink-0">
          {isError ? (
            <AlertTriangle size={14} className="text-[var(--color-error)]" />
          ) : isDone ? (
            <CheckCircle2 size={14} className="text-[var(--color-success)]" />
          ) : (
            <Activity size={14} className="text-[var(--color-primary)]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-[13px] font-medium leading-snug truncate',
              isError ? 'text-[var(--color-error)]' : 'text-[var(--color-tool-text)]'
            )}>
              {tool.name}
            </span>
            {toolDuration && (
              <span className="text-[10px] font-mono text-[var(--color-tool-text-dim)] flex-shrink-0">
                {toolDuration}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          size={12}
          className={cn(
            'text-[var(--color-tool-text-dim)] transition-transform flex-shrink-0 mt-1 opacity-0 group-hover/tool:opacity-100',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {/* Expanded finding for presentable tools */}
      {tool.isPresentable && tool.finding && (
        <div className="ml-6 mt-1 text-[12px] leading-relaxed text-[var(--color-tool-text-muted)] bg-[var(--color-tool-finding-bg)] p-3 rounded-lg border border-[var(--color-tool-finding-border)] whitespace-pre-wrap">
          <FormattedText content={tool.finding} />
        </div>
      )}

      {/* Expanded raw details for power-user inspection */}
      {expanded && (
        <div className="ml-6 mt-1 space-y-2">
          {/* Arguments */}
          {tool.arguments && Object.keys(tool.arguments).length > 0 && (
            <div className="text-[11px]">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[var(--color-tool-text-dim)] uppercase tracking-wider text-[9px]">Arguments</span>
              </div>
              <pre className="bg-[var(--color-tool-finding-bg)] border border-[var(--color-tool-finding-border)] rounded-md p-2 text-[var(--color-tool-text-muted)] font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
                {JSON.stringify(tool.arguments, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {tool.result && (
            <div className="text-[11px]">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[var(--color-tool-text-dim)] uppercase tracking-wider text-[9px]">Result</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopy(String(tool.result)) }}
                  className="p-0.5 rounded hover:bg-[var(--color-tool-badge-bg)] text-[var(--color-tool-text-dim)] hover:text-[var(--color-tool-text-muted)] transition-colors"
                  title="Copy result"
                >
                  {copied ? <Check size={10} className="text-[var(--color-success)]" /> : <Copy size={10} />}
                </button>
              </div>
              <pre className="bg-[var(--color-tool-finding-bg)] border border-[var(--color-tool-finding-border)] rounded-md p-2 text-[var(--color-tool-text-muted)] font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                {String(tool.result).substring(0, 2000)}
                {String(tool.result).length > 2000 && '\n\n… (truncated)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Renders tool calls grouped by agent as visually distinct execution blocks.
 *
 * Architecture:
 * - Full card for blocks with findings or in-progress tools
 * - Compact inline chip for completed blocks with no visible content
 * - All colors use CSS variables for dark/light theme support
 */
export function ToolCallList({ toolCalls }: ToolCallListProps) {
  if (!toolCalls || toolCalls.length === 0) return null

  // Group tools by agent
  const groupedByAgent = toolCalls.reduce(
    (acc, tool) => {
      const { label } = getAgentInfo(tool.name)
      if (!acc[label]) acc[label] = []
      acc[label].push(tool)
      return acc
    },
    {} as Record<string, ToolCall[]>
  )

  return (
    <div className="flex flex-col gap-3 mt-4 mb-2">
      {Object.entries(groupedByAgent).map(([agentLabel, tools]) => {
        const isDone = tools.every(t => !!t.result)
        const hasError = tools.some(t => t.result && String(t.result).toLowerCase().includes('error'))
        const completedCount = tools.filter(t => !!t.result).length
        const hasPresentableContent = tools.some(t => t.isPresentable && t.finding)
        const totalDuration = getTotalDuration(tools)
        const agentInfo = getAgentInfo(tools[0].name)

        // Compact chip for completed blocks with no visible content
        if (isDone && !hasPresentableContent && !hasError) {
          return (
            <div
              key={agentLabel}
              data-testid="toolcall-agent-chip"
              data-agent-label={agentLabel}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-tool-chip-bg)] border border-[var(--color-tool-border)] w-fit"
            >
              <CheckCircle2 size={12} className="text-[var(--color-success)]" />
              <span className="text-xs font-medium text-[var(--color-tool-text-muted)]">
                {agentLabel}
              </span>
              <span className="text-[10px] text-[var(--color-tool-text-dim)]">
                {tools.length} {tools.length === 1 ? 'action' : 'actions'}
                {totalDuration && ` · ${totalDuration}`}
              </span>
            </div>
          )
        }

        // Full card for blocks with content
        const statusColor = hasError
          ? 'var(--color-error)'
          : isDone
            ? 'var(--color-success)'
            : agentInfo.accent

        return (
          <div
            key={agentLabel}
            data-testid="toolcall-agent-group"
            data-agent-label={agentLabel}
            className="flex flex-col bg-[var(--color-tool-bg)] border border-[var(--color-tool-border)] rounded-2xl overflow-hidden relative"
          >
            {/* Left status strip — pulses when in-progress */}
            <div
              className={cn('absolute left-0 top-0 bottom-0 w-1', !isDone && !hasError && 'shadow-[0_0_8px_var(--color-primary)]')}
              style={{ backgroundColor: statusColor }}
            />

            <div className="p-4 pl-5">
              {/* Header row */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  {hasError ? (
                    <AlertTriangle size={16} className="text-[var(--color-error)]" />
                  ) : isDone ? (
                    <CheckCircle2 size={16} className="text-[var(--color-success)]" />
                  ) : (
                    <Activity size={16} className="text-[var(--color-primary)]" />
                  )}
                  <span className="font-semibold text-[var(--color-tool-text)] text-sm tracking-wide">
                    {agentLabel}
                  </span>
                </div>

                {/* Progress metric */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--color-tool-badge-bg)] rounded-md text-[11px] text-[var(--color-tool-text-muted)] font-mono">
                    <span>{completedCount}/{tools.length} complete</span>
                    {totalDuration && (
                      <>
                        <span className="text-[var(--color-tool-text-dim)]">·</span>
                        <span>{totalDuration}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Tool rows */}
              <div className="space-y-1">
                {tools.map(tool => (
                  <ToolRow key={tool.id} tool={tool} />
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
