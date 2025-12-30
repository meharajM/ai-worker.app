import React, { useState, useEffect } from "react";
import { Server, Terminal, Globe } from "lucide-react";
import { MCPServer } from "../../lib/mcp";

interface McpServerFormProps {
  editingServer: MCPServer | null;
  onSubmit: (config: any) => void;
  onCancel: () => void;
}

// Default values for Sequential Thinking server when creating new
const DEFAULT_SEQUENTIAL_THINKING = {
  name: "sequential-thinking",
  command: "npx",
  args: "-y @modelcontextprotocol/server-sequential-thinking",
};

export function McpServerForm({
  editingServer,
  onSubmit,
  onCancel,
}: McpServerFormProps) {
  const [name, setName] = useState(
    editingServer?.name || DEFAULT_SEQUENTIAL_THINKING.name
  );
  const [serverType, setServerType] = useState<"stdio" | "sse">(
    (editingServer?.type as any) || "stdio"
  );
  const [command, setCommand] = useState(
    editingServer?.command || DEFAULT_SEQUENTIAL_THINKING.command
  );
  const [args, setArgs] = useState(
    editingServer?.args?.join(" ") || DEFAULT_SEQUENTIAL_THINKING.args
  );
  const [url, setUrl] = useState(editingServer?.url || "");

  useEffect(() => {
    if (editingServer) {
      setName(editingServer.name);
      setServerType(editingServer.type as any);
      setCommand(editingServer.command || "");
      setArgs(editingServer.args?.join(" ") || "");
      setUrl(editingServer.url || "");
    } else {
      // Reset to defaults when creating new server
      setName(DEFAULT_SEQUENTIAL_THINKING.name);
      setServerType("stdio");
      setCommand(DEFAULT_SEQUENTIAL_THINKING.command);
      setArgs(DEFAULT_SEQUENTIAL_THINKING.args);
      setUrl("");
    }
  }, [editingServer]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (serverType === "stdio" && !command.trim()) return;
    if (serverType === "sse" && !url.trim()) return;

    // Generate description based on server type and name
    let description =
      serverType === "stdio" ? "Local CLI Tool" : "Remote SSE Server";
    if (
      name.toLowerCase().includes("sequential") ||
      name.toLowerCase().includes("thinking")
    ) {
      description =
        "Sequential Thinking MCP Server - Enables step-by-step reasoning for complex tasks";
    }

    onSubmit({
      name: name.trim(),
      description: description,
      type: serverType,
      command: serverType === "stdio" ? command.trim() : undefined,
      args:
        serverType === "stdio" ? args.split(" ").filter(Boolean) : undefined,
      url: serverType === "sse" ? url.trim() : undefined,
    });
  };

  return (
    <div className="bg-[#1a1d23] border border-[#4fd1c5]/30 rounded-xl p-6 mb-6 animate-in slide-in-from-top-2 border-l-4">
      <h3 className="text-lg font-medium mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Server size={20} className="text-[#4fd1c5]" />
          {editingServer ? `Edit ${name}` : "New MCP Connection"}
        </span>
        {editingServer && (
          <span className="text-[10px] bg-[#4fd1c5]/10 text-[#4fd1c5] px-2 py-0.5 rounded uppercase tracking-wider font-bold">
            Editing
          </span>
        )}
      </h3>

      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">
            Name
          </label>
          <input
            type="text"
            placeholder="My Server"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                             placeholder-white/30 focus:border-[#4fd1c5]/50 focus:outline-none focus:ring-1 focus:ring-[#4fd1c5]/50"
          />
        </div>

        {/* Type Selection */}
        <div>
          <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">
            Connection Type
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setServerType("stdio")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors border ${
                serverType === "stdio"
                  ? "bg-[#4fd1c5]/10 border-[#4fd1c5] text-[#4fd1c5]"
                  : "bg-black/30 border-white/10 text-white/60 hover:bg-white/5"
              }`}
            >
              <Terminal size={16} />
              Stdio (Local)
            </button>
            <button
              onClick={() => setServerType("sse")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors border ${
                serverType === "sse"
                  ? "bg-[#4fd1c5]/10 border-[#4fd1c5] text-[#4fd1c5]"
                  : "bg-black/30 border-white/10 text-white/60 hover:bg-white/5"
              }`}
            >
              <Globe size={16} />
              SSE (Remote)
            </button>
          </div>
        </div>

        {/* Dynamic Fields */}
        {serverType === "stdio" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-1">
              <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">
                Command
              </label>
              <input
                type="text"
                placeholder="npx, python, node..."
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                     placeholder-white/30 focus:border-[#4fd1c5]/50 focus:outline-none focus:ring-1 focus:ring-[#4fd1c5]/50 font-mono"
              />
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">
                Arguments
              </label>
              <input
                type="text"
                placeholder="--args..."
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                     placeholder-white/30 focus:border-[#4fd1c5]/50 focus:outline-none focus:ring-1 focus:ring-[#4fd1c5]/50 font-mono"
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider">
              Server URL
            </label>
            <input
              type="text"
              placeholder="http://localhost:8000/sse"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm
                                 placeholder-white/30 focus:border-[#4fd1c5]/50 focus:outline-none focus:ring-1 focus:ring-[#4fd1c5]/50 font-mono"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSubmit}
            disabled={!name || (serverType === "stdio" ? !command : !url)}
            className="px-6 py-2 bg-[#4fd1c5] text-white rounded-lg text-sm font-medium
                           hover:bg-[#5fe0d4] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editingServer ? "Update Connection" : "Add Connection"}
          </button>
          <button
            onClick={onCancel}
            className="px-6 py-2 bg-white/5 text-white/60 rounded-lg text-sm font-medium
                           hover:bg-white/10 transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
