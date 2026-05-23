# Model Context Protocol (MCP) Guide 🔌

AI-Worker integrates Anthropic's **Model Context Protocol (MCP)** as its primary extensibility framework. MCP enables LLMs to safely query data, execute commands, and interact with the local filesystem and remote services via standardized tool schemas.

---

## 🗂️ Out-of-the-Box MCP Servers

AI-Worker ships with native integration for two powerful MCP servers:

### 1. Memory Server (`@modelcontextprotocol/server-memory`)
- **Purpose**: Provides persistent, graph-like semantic memory management.
- **Context Engineering**: Allows the agent to construct a long-term knowledge base. It registers facts, user preferences, and project-specific knowledge contextually, feeding it back to the LLM during prompts.

### 2. Playwright Server (`@playwright/mcp`)
- **Purpose**: Enables browser automation.
- **Harness Engineering**: The agent can launch a chromium instance, click elements, fill forms, take screenshots, and scrape page contents to execute complex web workflows.

---

## ⚙️ Connecting Custom MCP Servers

You can register custom MCP servers inside AI-Worker's configuration dashboard or by modifying the local configuration store. AI-Worker supports two primary transport protocol standards:

### 1. Stdio Transport
Runs the MCP server as a local subprocess. The main Electron process communicates with it using standard input and output streams.

**Example Config:**
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "node",
      "args": ["/path/to/mcp-server-filesystem/dist/index.js", "/allowed/workspace/path"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

### 2. SSE Transport (Server-Sent Events)
Connects to an MCP server running as an independent network service.

**Example Config:**
```json
{
  "mcpServers": {
    "remote-database-service": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

---

## 🛠️ Tool Execution & Self-Healing

When an MCP tool call is executed:
1. **Validation**: The main process verifies the tool schema, arguments, and security parameters.
2. **Sandbox Execution**: The tool is executed within its sandboxed server scope.
3. **Self-Healing Retries**: If a tool fails due to execution timeouts, model mismatch, or network blips, AI-Worker's tool executor attempts self-healing retries by automatically correcting JSON schemas or feeding error backtraces to the model to try alternative arguments.
