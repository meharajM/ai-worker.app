---
trigger: always_on
---

# AI-Worker: Code Rules Index

This project's coding standards are split into focused rule files in `.agents/rules/`. Each file targets a specific domain so rules can be loaded precisely when needed.

**Always active:**
- `core-security.md` — Electron security constraints (non-negotiable on every task)

**Load these based on what you are working on:**

| File | Load when working on... |
|------|------------------------|
| `process-architecture.md` | `src/main/`, `src/preload/`, IPC handlers, services |
| `react-components.md` | `.tsx` component files in `src/renderer/src/components/` |
| `react-hooks.md` | Custom hooks in `src/renderer/src/hooks/` |
| `ai-agent-architecture.md` | `AgentRuntime`, `IAgentClient`, agent services in `lib/agent/` |
| `agent-loop-safety.md` | The agent message loop, tool execution, sub-agent spawning |
| `zustand-stores.md` | Zustand stores in `src/renderer/src/stores/` |
| `typescript-standards.md` | Any `.ts` / `.tsx` file (types, interfaces, generics) |
| `mcp-tools.md` | MCP integration, `executeToolCall`, tool schemas |
| `documentation.md` | Writing JSDoc, file-level comments, or new modules |

**Stack:** Electron 40 · React 18 · TypeScript 5 · Zustand 5 · MCP SDK · Playwright MCP
