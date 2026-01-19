import React, { useState, useEffect } from "react";
import { Server, Terminal, Globe, Plus, Trash2 } from "lucide-react";
import { MCPServer } from "../../stores/mcpStore";

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
  // Using explicit Record<string, string> to match the type
  const [env, setEnv] = useState<Record<string, string>>(editingServer?.env || {});

  // Refactoring to use array state for stability during editing
  const [envPairs, setEnvPairs] = useState<{key: string, value: string}[]>([]);

  useEffect(() => {
    if (editingServer?.env) {
        setEnvPairs(Object.entries(editingServer.env).map(([key, value]) => ({ key, value })));
    } else {
        setEnvPairs([]);
    }
  }, [editingServer]);

  const addEnvPair = () => setEnvPairs([...envPairs, { key: "", value: "" }]);
  
  const updateEnvPair = (index: number, field: 'key' | 'value', text: string) => {
      const newPairs = [...envPairs];
      newPairs[index][field] = text;
      setEnvPairs(newPairs);
  };

  const removeEnvPair = (index: number) => {
      setEnvPairs(envPairs.filter((_, i) => i !== index));
  };

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

    // Convert envPairs back to object
    const envObject = envPairs.reduce((acc, { key, value }) => {
        if (key.trim()) acc[key.trim()] = value; // Only include if key exists
        return acc;
    }, {} as Record<string, string>);

    onSubmit({
      name: name.trim(),
      description: description,
      type: serverType,
      command: serverType === "stdio" ? command.trim() : undefined,
      args:
        serverType === "stdio" ? args.split(" ").filter(Boolean) : undefined,
      url: serverType === "sse" ? url.trim() : undefined,
      env: Object.keys(envObject).length > 0 ? envObject : undefined
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

        {/* Environment Variables (Local Only) */}
        {serverType === "stdio" && (
            <div className="space-y-3 pt-2 border-t border-white/5">
                <div className="flex items-center gap-2 mb-2">
                    <label className="text-xs text-white/40 uppercase tracking-wider">
                        Environment Variables
                    </label>
                    <span className="px-1.5 py-0.5 rounded bg-[#4fd1c5]/10 text-[#4fd1c5] text-[10px] font-bold border border-[#4fd1c5]/20">
                        LOCAL ONLY
                    </span>
                </div>
                
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg mb-3">
                    <p className="text-yellow-200/80 text-[11px] leading-relaxed flex gap-2">
                        <span className="shrink-0">⚠️</span>
                        Secrets like API Keys are stored locally on this device only. We do not sync them to the cloud. If you switch devices or clear data, you will need to re-enter them.
                    </p>
                </div>

                {/* Env Vars Editor */}
                <div className="space-y-2">
                    {envPairs.map((pair, index) => (
                        <div key={index} className="flex gap-2">
                            <input 
                                placeholder="KEY" 
                                value={pair.key}
                                onChange={(e) => updateEnvPair(index, 'key', e.target.value)}
                                className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono placeholder-white/20 focus:border-[#4fd1c5]/50 focus:outline-none"
                            />
                            <input 
                                placeholder="VALUE" 
                                value={pair.value}
                                type="password"
                                onChange={(e) => updateEnvPair(index, 'value', e.target.value)}
                                className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono placeholder-white/20 focus:border-[#4fd1c5]/50 focus:outline-none"
                            />
                            <button 
                                onClick={() => removeEnvPair(index)}
                                className="p-2 text-white/40 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                    <button 
                        onClick={addEnvPair}
                        className="text-xs text-[#4fd1c5] hover:text-[#4fd1c5]/80 flex items-center gap-1 font-medium px-1"
                    >
                        <Plus size={14} /> Add Variable
                    </button>
                </div>
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
