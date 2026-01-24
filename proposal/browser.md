# Browser Automation MCP Comparison

## Overview

This document compares different browser automation MCP servers for AI-Worker to help decide the best option for production use.

---

## Comparison Table

| Feature | **Playwright MCP** | **Browser-Use** | **Bundled Playwright** |
|---------|-------------------|-----------------|----------------------|
| **Package** | `@playwright/mcp` | `browser-use` | Direct import |
| **Architecture** | External MCP server (stdio) | Self-contained AI + Browser | Library in Electron |
| **Intelligence Source** | Your LLM (OpenAI, etc.) | Built-in AI | Your LLM |
| **Latency per Action** | ~50-200ms | ~50-200ms | ~10-20ms |
| **Setup Complexity** | Easy (npx) | Medium | Complex |
| **Browser Support** | Chromium, Firefox, WebKit | Chromium | Chromium, Firefox, WebKit |
| **Headless Mode** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Page Inspection** | Accessibility Tree | Vision + DOM | Full DOM access |
| **CAPTCHA Handling** | ❌ No | ⚠️ Limited | ❌ No |
| **Rate Limit Risk** | Low | Medium | Low |

---

## Playwright MCP (`@playwright/mcp`)

**Currently used in AI-Worker**

### Pros ✅
- Official Microsoft package
- Uses accessibility tree (fast, token-efficient)
- Works with any MCP-compatible LLM host
- Good for testing and automation
- No vision/screenshot needed for most tasks

### Cons ❌
- External process = IPC overhead
- Stdio communication adds latency
- No built-in intelligence
- Requires LLM to understand page structure

### Best For
- General web automation
- Form filling
- Data extraction
- Testing workflows

### Current Config in AI-Worker
```json
{
  "name": "playwright",
  "command": "npx",
  "args": ["-y", "@playwright/mcp"],
  "type": "stdio"
}
```

---

## Browser-Use

**Alternative option**

### Pros ✅
- Self-contained AI (can "think by itself")
- Designed for agentic workflows
- Vision + DOM hybrid approach
- Better at complex navigation

### Cons ❌
- Heavier resource usage
- Less control over AI decision-making
- May conflict with existing LLM integration
- Different architecture than MCP standard

### Best For
- Standalone automation tasks
- Complex multi-step workflows
- When you want the browser to make decisions

---

## Bundled Playwright (Direct Integration)

**Future optimization option**

### Pros ✅
- **Fastest latency** (~10-20ms per action)
- No IPC or stdio overhead
- Full control over browser instance
- Can share browser context with Electron

### Cons ❌
- Requires significant code changes
- Increases app bundle size (~50MB+)
- Must handle browser lifecycle management
- No MCP protocol (custom tool definitions needed)

### Best For
- Performance-critical applications
- When latency is the top priority
- Applications needing deep browser integration

### Implementation Effort
```
High - Requires:
1. Playwright bundled in electron-builder
2. Custom tool definitions
3. Browser instance management
4. Refactoring agent-runtime.ts
```

---

## Latency Breakdown

```
╔════════════════════════════════════════════════════════════════╗
║                    MCP Server Flow (Current)                    ║
╠════════════════════════════════════════════════════════════════╣
║  Agent ─[IPC]─> Main ─[stdio]─> MCP ─> Playwright ─> Browser   ║
║                                                                 ║
║  Latency: ~50-200ms per action                                 ║
║  Overhead: IPC (~5ms) + Stdio (~20ms) + JSON-RPC (~10ms)       ║
╚════════════════════════════════════════════════════════════════╝

╔════════════════════════════════════════════════════════════════╗
║                   Bundled Playwright (Future)                   ║
╠════════════════════════════════════════════════════════════════╣
║  Agent ─> Playwright (in-process) ─> Browser                   ║
║                                                                 ║
║  Latency: ~10-20ms per action                                  ║
║  Overhead: Near-zero (direct function calls)                   ║
╚════════════════════════════════════════════════════════════════╝
```

---

## Recommendation

### Current: Keep Playwright MCP ✅

**Rationale:**
1. Already integrated and working
2. Sufficient performance for most tasks
3. Standard MCP architecture
4. Easy to swap for other MCP servers

### Future: Consider Bundled Playwright

**When to upgrade:**
- User feedback indicates latency is a problem
- Complex workflows require faster execution
- Need for tighter browser-Electron integration

---

## Decision Matrix

| Scenario | Recommendation |
|----------|---------------|
| MVP / Beta | **Playwright MCP** |
| Production with latency complaints | **Bundled Playwright** |
| Need AI to make autonomous decisions | **Browser-Use** |
| Cross-browser testing | **Playwright MCP** |
| Maximum performance | **Bundled Playwright** |

---

## References

- [Playwright MCP Server](https://github.com/playwright-community/mcp-playwright)
- [Browser-Use](https://github.com/browser-use/browser-use)
- [Model Context Protocol](https://modelcontextprotocol.io/)
