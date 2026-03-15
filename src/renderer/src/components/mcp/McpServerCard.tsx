import React from "react";
import {
  Power,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  Globe,
  AlertCircle,
  Loader2,
  Terminal,
  MessageSquare,
  Zap,
} from "lucide-react";
import { MCPServer } from "../../lib/mcp";

interface McpServerCardProps {
  server: MCPServer;
  isExpanded: boolean;
  isEditing: boolean;
  isConnecting: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onToggleConnection: () => void;
  onRemove: () => void;
  onTroubleshoot: () => void;
  onToggleAutoConnect: (enabled: boolean) => void;
}

function getServerIcon(type: string) {
  return type === "stdio" ? <Terminal size={20} /> : <Globe size={20} />;
}

export function McpServerCard({
  server,
  isExpanded,
  isEditing,
  isConnecting,
  onToggleExpand,
  onEdit,
  onToggleConnection,
  onRemove,
  onTroubleshoot,
  onToggleAutoConnect,
}: McpServerCardProps) {
  return (
    <div
      data-testid={`mcp-server-card-${server.name.toLowerCase().replace(/\s+/g, '-')}`}
      className={`bg-[var(--color-bg-elevated)] border rounded-lg overflow-hidden shadow-sm hover:border-[var(--color-border-hover)] transition-colors ${isEditing
          ? "border-[var(--color-accent)]/50 ring-1 ring-[var(--color-accent)]/20"
          : "border-[var(--color-border)]"
        }`}
    >
      {/* Server Header */}
      <div className="flex items-center gap-4 p-4">
        <button
          onClick={onToggleExpand}
          className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </button>

        <div
          className={`p-2.5 rounded-lg ${server.connected
              ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
              : "bg-[var(--color-bg-surface)] text-[var(--color-text-tertiary)]"
            }`}
        >
          {getServerIcon(server.type)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h3 className="font-medium text-[var(--color-text-primary)] truncate">
              {server.name}
            </h3>
            {server.connected ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--color-success-muted)] text-[var(--color-success)] text-[10px] font-medium uppercase tracking-wide border border-[var(--color-success)]/20">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
                Active
              </span>
            ) : server.error ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--color-error-muted)] text-[var(--color-error)] text-[10px] font-medium uppercase tracking-wide border border-[var(--color-error)]/20">
                Error
              </span>
            ) : (
              <span className="text-xs text-[var(--color-text-disabled)]">Offline</span>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 truncate font-mono">
            {server.type === "stdio"
              ? `${server.command} ${(server.args || []).join(" ")}`
              : server.url}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className={`p-2 rounded-lg transition-all ${isEditing
                ? "bg-[var(--color-accent)] text-[var(--color-bg-dark)]"
                : "bg-[var(--color-bg-surface)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-raised)] hover:text-[var(--color-text-primary)]"
              }`}
            title="Edit configuration"
          >
            <Edit2 size={18} />
          </button>

          <button
            onClick={onToggleConnection}
            disabled={isConnecting}
            className={`p-2 rounded-lg transition-all ${server.connected
                ? "bg-[var(--color-error-muted)] text-[var(--color-error)] hover:bg-[var(--color-error)]/20"
                : "bg-[var(--color-success-muted)] text-[var(--color-success)] hover:bg-[var(--color-success)]/20"
              } disabled:opacity-50`}
            title={server.connected ? "Disconnect" : "Connect"}
          >
            {isConnecting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Power size={18} />
            )}
          </button>

          <button
            onClick={onRemove}
            className="p-2 rounded-lg bg-[var(--color-bg-surface)] text-[var(--color-text-tertiary)] 
                           hover:bg-[var(--color-error-muted)] hover:text-[var(--color-error)] transition-all border border-transparent hover:border-[var(--color-error)]/20"
            title="Remove server"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Details & Error Message */}
      {(isExpanded || server.error) && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-dark)]">
          {server.error && (
            <div className="p-4 bg-[var(--color-error-muted)] border-b border-[var(--color-error)]/10">
              <div className="flex items-start gap-3">
                <AlertCircle
                  size={16}
                  className="text-[var(--color-error)] shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[var(--color-error)] leading-relaxed font-sans whitespace-pre-wrap">
                    {server.error.split("`").map((part, i) =>
                      i % 2 === 1 ? (
                        <code
                          key={i}
                          className="bg-[var(--color-error)]/20 px-1.5 py-0.5 rounded text-[var(--color-text-primary)] font-mono text-[11px] mx-0.5 border border-[var(--color-error)]/20 select-all cursor-pointer hover:bg-[var(--color-error)]/30 transition-colors"
                          title="Click to select"
                        >
                          {part}
                        </code>
                      ) : (
                        <span key={i}>{part}</span>
                      )
                    )}
                  </div>

                  <button
                    onClick={onTroubleshoot}
                    className="mt-4 flex items-center gap-2 px-3 py-1.5 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] hover:border-[var(--color-accent)]/30 transition-all font-medium"
                  >
                    <MessageSquare size={14} />
                    Troubleshoot with AI
                  </button>
                </div>
              </div>
            </div>
          )}

          {isExpanded && (
            <div className="p-4 space-y-4">
              {/* Auto-Connect Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border)]">
                <div className="flex items-center gap-3">
                  <Zap
                    size={16}
                    className={`${server.autoConnect ? "text-[var(--color-accent)]" : "text-[var(--color-text-tertiary)]"
                      }`}
                  />
                  <div>
                    <p className="text-[var(--color-text-primary)] text-sm font-medium">
                      Auto-connect on startup
                    </p>
                    <p className="text-[var(--color-text-tertiary)] text-xs">
                      {server.autoConnect
                        ? "This server will automatically connect when the app starts"
                        : "This server requires manual connection"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onToggleAutoConnect(!server.autoConnect)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${server.autoConnect ? "bg-[var(--color-accent)]" : "bg-[var(--color-bg-surface)]"
                    }`}
                  role="switch"
                  aria-checked={server.autoConnect}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-[var(--color-text-primary)] transition-transform ${server.autoConnect ? "translate-x-6" : "translate-x-1"
                      }`}
                  />
                </button>
              </div>

              {/* Tools List */}
              {server.connected && server.tools.length > 0 ? (
                <div>
                  <p className="text-[var(--color-text-tertiary)] text-xs mb-3 uppercase tracking-wider font-medium">
                    Available Tools ({server.tools.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {server.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="p-2 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] flex flex-col gap-1"
                      >
                        <span className="text-[var(--color-accent)] text-xs font-mono font-medium">
                          {tool.name}
                        </span>
                        <span className="text-[var(--color-text-tertiary)] text-[10px] truncate">
                          {tool.description}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : server.connected ? (
                <div className="space-y-2">
                  <p className="text-[var(--color-text-disabled)] text-sm italic">
                    No tools exposed by this server.
                  </p>
                  {(server.name.includes("sequential-thinking") ||
                    server.name.includes("sequential") ||
                    server.description.toLowerCase().includes("reasoning")) && (
                      <div className="p-3 rounded-lg bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/20">
                        <p className="text-[var(--color-accent)] text-xs font-medium mb-1">
                          ℹ️ Reasoning Server
                        </p>
                        <p className="text-[var(--color-text-secondary)] text-[11px] leading-relaxed">
                          This server works differently - it provides reasoning
                          capabilities rather than traditional tools. It will be
                          used automatically by the AI for complex multi-step
                          tasks.
                        </p>
                      </div>
                    )}
                </div>
              ) : (
                <p className="text-[var(--color-text-disabled)] text-sm italic">
                  Connect to inspect available tools.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
