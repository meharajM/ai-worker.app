import React, { useState, useCallback } from "react";
import { Plus, Database, MessageCircle, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useMcpStore, MCPServer } from "../stores/mcpStore";
import { useChatStore } from "../stores/chatStore";
import { useWhatsAppStore } from "../stores/whatsappStore";
import { McpServerCard } from "./mcp/McpServerCard";
import { McpServerForm } from "./mcp/McpServerForm";

export function ConnectionsPanel() {
  const mcp = useMcpStore();
  const [showForm, setShowForm] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const { connectionState, openDialog } = useWhatsAppStore();
  const waStatus = connectionState.status;


  // Refresh servers (handled automatically by Zustand reactivity)
  const servers = mcp.servers;

  // Add or Update server
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFormSubmit = async (config: any) => {
    try {
      if (editingServerId) {
        await mcp.updateServer(editingServerId, config);
      } else {
        await mcp.addServer(config);
      }
      setShowForm(false);
      setEditingServerId(null);
    } catch (error) {
      console.error("Error saving server:", error);
      alert("Failed to save server configuration");
    }
  };

  const handleEdit = (server: MCPServer) => {
    setEditingServerId(server.id);
    setShowForm(true);
    // Scroll to top to see form
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Connect/disconnect server
  const handleToggleConnection = useCallback(
    async (server: MCPServer) => {
      setConnecting(server.id);
      try {
        if (server.connected) {
          await mcp.disconnectServer(server.id);
        } else {
          await mcp.connectServer(server.id);
        }
      } catch (error) {
        console.error("Connection error:", error);
      } finally {
        setConnecting(null);
      }
    },
    [mcp]
  );

  // Remove server
  const handleRemove = async (serverId: string) => {
    if (window.confirm("Remove this MCP server?")) {
      try {
        await mcp.removeServer(serverId);
      } catch (error) {
        console.error("Error removing server:", error);
        alert("Failed to remove server");
      }
    }
  };

  // Troubleshooting
  const handleTroubleshoot = useCallback((server: MCPServer) => {
    if (!server.error) return;

    const chatStore = useChatStore.getState();
    const prompt = `I'm having trouble connecting to an MCP server named "${server.name
      }".
        
**Server Configuration:**
- Type: ${server.type}
- Command: ${server.command || "N/A"}
- Arguments: ${server.args?.join(" ") || "N/A"}
- URL: ${server.url || "N/A"}

**Error Message:**
${server.error}

Can you help me troubleshoot this?`;

    chatStore.addMessage({
      role: "user",
      content: prompt,
    });

    // Notify user
    alert("Prompt sent to AI tutor! Check the Chat view for the solution.");
  }, []);

  const connectedCount = servers.filter((s) => s.connected).length;
  const editingServer = servers.find((s) => s.id === editingServerId) || null;

  return (
    <div className="flex-1 min-w-0 p-6 overflow-y-auto">

      {/* ── WhatsApp Section ──────────────────────────────── */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-1">WhatsApp</h2>
        <p className="text-sm text-white/40 mb-4">Direct WhatsApp integration</p>

        <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--color-surface)] border border-white/5">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              waStatus === 'connected' ? 'bg-[#25D366]/20' : 'bg-white/5'
            }`}>
              <MessageCircle
                size={18}
                className={waStatus === 'connected' ? 'text-[#25D366]' : 'text-white/30'}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {waStatus === 'connected'
                  ? `Connected${connectionState.phoneNumber ? ` · ${connectionState.phoneNumber}` : ''}`
                  : waStatus === 'connecting'
                    ? 'Connecting…'
                    : waStatus === 'error'
                      ? 'Connection error'
                      : 'Disconnected'}
              </p>
              <p className="text-xs text-white/40">
                {waStatus === 'connected'
                  ? 'Ready for bidirectional messaging'
                  : 'Scan QR code to connect'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {waStatus === 'connected' ? (
              <CheckCircle size={18} className="text-[#25D366]" />
            ) : waStatus === 'connecting' ? (
              <Loader2 size={18} className="text-white/40 animate-spin" />
            ) : waStatus === 'error' ? (
              <XCircle size={18} className="text-red-400" />
            ) : null}

            <button
              id="connections-whatsapp-btn"
              onClick={openDialog}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                waStatus === 'connected'
                  ? 'bg-white/5 hover:bg-white/10 text-white/70'
                  : 'bg-[#25D366]/20 hover:bg-[#25D366]/30 text-[#25D366]'
              }`}
            >
              {waStatus === 'connected' ? 'Manage' : 'Connect'}
            </button>
          </div>
        </div>
      </div>

      {/* ── MCP Servers Section ───────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">MCP Connections</h2>
          <p className="text-sm text-white/40 mt-1">
            {connectedCount} connected · {servers.length} configured
          </p>
        </div>

        <button
          onClick={() => {
            if (showForm && editingServerId) {
              setEditingServerId(null);
            } else {
              setShowForm(!showForm);
            }
          }}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--color-brand-teal)] text-white rounded-xl
                       hover:bg-[var(--color-brand-teal)]/90 transition-all shadow-lg shadow-[var(--color-brand-teal)]/20"
        >
          <Plus size={18} />
          {editingServerId
            ? "Add New Instead"
            : showForm
              ? "Hide Form"
              : "Add Connection"}
        </button>
      </div>

      {/* Add/Edit Server Form */}
      {showForm && (
        <McpServerForm
          editingServer={editingServer}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditingServerId(null);
          }}
        />
      )}

      {/* Server List */}
      {servers.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-xl">
          <Database size={48} className="mx-auto text-white/20 mb-4" />
          <p className="text-white/40 mb-2 font-medium">
            No MCP servers configured
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {servers.filter(s => s.name !== 'playwright').map((server) => (
            <McpServerCard
              key={server.id}
              server={server}
              isExpanded={expandedServer === server.id}
              isEditing={editingServerId === server.id}
              isConnecting={connecting === server.id}
              onToggleExpand={() =>
                setExpandedServer(
                  expandedServer === server.id ? null : server.id
                )
              }
              onEdit={() => handleEdit(server)}
              onToggleConnection={() => handleToggleConnection(server)}
              onRemove={() => handleRemove(server.id)}
              onTroubleshoot={() => handleTroubleshoot(server)}
              onToggleAutoConnect={async (enabled) => {
                try {
                  await mcp.setAutoConnect(server.id, enabled);
                } catch (error) {
                  console.error("Error updating auto-connect:", error);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
