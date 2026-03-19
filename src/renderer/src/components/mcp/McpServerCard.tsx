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
import { Card, CardContent } from "../primitives/Card";
import { StatusBadge } from "../primitives/StatusDot";
import { Button } from "../primitives/Button";

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
    <Card 
      variant="elevated" 
      padding="none"
      hoverable={!isEditing}
      className={`overflow-hidden ${isEditing ? 'border-[var(--color-brand-teal)]/50 ring-1 ring-[var(--color-brand-teal)]/20' : ''}`}
    >
      {/* Server Header */}
      <div className="flex items-center gap-4 p-4">
        <button
          onClick={onToggleExpand}
          className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </button>

        <div
          className={`p-2.5 rounded-[var(--radius-md)] ${server.connected
              ? "bg-[var(--color-brand-teal)]/10 text-[var(--color-brand-teal)]"
              : "bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]"
            }`}
        >
          {getServerIcon(server.type)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h3 className="font-[var(--font-weight-medium)] text-[var(--color-text-primary)] truncate">
              {server.name}
            </h3>
            {server.connected ? (
              <StatusBadge variant="success" label="Active" animated />
            ) : server.error ? (
              <StatusBadge variant="error" label="Error" />
            ) : (
              <span className="text-[var(--text-xs)] text-[var(--color-text-dim)]">Offline</span>
            )}
          </div>
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-0.5 truncate font-[var(--font-family-mono)]">
            {server.type === "stdio"
              ? `${server.command} ${(server.args || []).join(" ")}`
              : server.url}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={isEditing ? 'primary' : 'ghost'}
            size="sm"
            onClick={onEdit}
            title="Edit configuration"
          >
            <Edit2 size={18} />
          </Button>

          <Button
            variant={server.connected ? 'ghost' : 'ghost'}
            size="sm"
            onClick={onToggleConnection}
            disabled={isConnecting}
            className={server.connected 
              ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/10' 
              : 'text-[var(--color-success)] hover:bg-[var(--color-success)]/10'
            }
            title={server.connected ? "Disconnect" : "Connect"}
          >
            {isConnecting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Power size={18} />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
            title="Remove server"
          >
            <Trash2 size={18} />
          </Button>
        </div>
      </div>

      {/* Details & Error Message */}
      {(isExpanded || server.error) && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-input-bg)]">
          {server.error && (
            <div className="p-4 bg-[var(--color-error)]/5 border-b border-[var(--color-error)]/10">
              <div className="flex items-start gap-3">
                <AlertCircle
                  size={16}
                  className="text-[var(--color-error)] shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--text-xs)] text-[var(--color-error)] leading-[var(--leading-relaxed)] whitespace-pre-wrap">
                    {server.error.split("`").map((part, i) =>
                      i % 2 === 1 ? (
                        <code
                          key={i}
                          className="bg-[var(--color-error)]/20 px-1.5 py-0.5 rounded text-[var(--color-error)] font-[var(--font-family-mono)] text-[11px] mx-0.5 border border-[var(--color-error)]/20 select-all cursor-pointer hover:bg-[var(--color-error)]/30 transition-colors"
                          title="Click to select"
                        >
                          {part}
                        </code>
                      ) : (
                        <span key={i}>{part}</span>
                      )
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onTroubleshoot}
                    className="mt-4 text-[var(--color-brand-teal)] hover:bg-[var(--color-brand-teal)]/10"
                  >
                    <MessageSquare size={14} />
                    Troubleshoot with AI
                  </Button>
                </div>
              </div>
            </div>
          )}

          {isExpanded && (
            <div className="p-4 space-y-4">
              {/* Auto-Connect Toggle */}
              <div className="flex items-center justify-between p-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)]">
                <div className="flex items-center gap-3">
                  <Zap
                    size={16}
                    className={server.autoConnect ? "text-[var(--color-brand-teal)]" : "text-[var(--color-text-muted)]"}
                  />
                  <div>
                    <p className="text-[var(--color-text-primary)] text-[var(--text-sm)] font-[var(--font-weight-medium)]">
                      Auto-connect on startup
                    </p>
                    <p className="text-[var(--color-text-muted)] text-[var(--text-xs)]">
                      {server.autoConnect
                        ? "This server will automatically connect when the app starts"
                        : "This server requires manual connection"}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="toggle"
                  checked={server.autoConnect}
                  onChange={() => onToggleAutoConnect(!server.autoConnect)}
                  title="Toggle auto-connect"
                />
              </div>

              {/* Tools List */}
              {server.connected && server.tools.length > 0 ? (
                <div>
                  <p className="text-[var(--color-text-muted)] text-[var(--text-xs)] mb-3 uppercase tracking-wider font-[var(--font-weight-medium)]">
                    Available Tools ({server.tools.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {server.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="p-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col gap-1"
                      >
                        <span className="text-[var(--color-brand-teal)] text-[var(--text-xs)] font-[var(--font-family-mono)] font-[var(--font-weight-medium)]">
                          {tool.name}
                        </span>
                        <span className="text-[var(--color-text-muted)] text-[10px] truncate">
                          {tool.description}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : server.connected ? (
                <div className="space-y-2">
                  <p className="text-[var(--color-text-dim)] text-[var(--text-sm)] italic">
                    No tools exposed by this server.
                  </p>
                  {(server.name.includes("sequential-thinking") ||
                    server.name.includes("sequential") ||
                    server.description.toLowerCase().includes("reasoning")) && (
                      <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-brand-teal)]/10 border border-[var(--color-brand-teal)]/20">
                        <p className="text-[var(--color-brand-teal)] text-[var(--text-xs)] font-[var(--font-weight-medium)] mb-1">
                          ℹ️ Reasoning Server
                        </p>
                        <p className="text-[var(--color-text-secondary)] text-[11px] leading-[var(--leading-relaxed)]">
                          This server works differently - it provides reasoning
                          capabilities rather than traditional tools. It will be
                          used automatically by the AI for complex multi-step
                          tasks.
                        </p>
                      </div>
                    )}
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-[var(--text-sm)] italic">
                  Connect to inspect available tools.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
