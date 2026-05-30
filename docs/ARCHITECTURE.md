# AI-Worker Architecture Overview

This document details the core design principles and architecture of **AI-Worker**. The application is structured around three main engineering pillars that enable local-first agentic workflows.

```
┌─────────────────────────────────────────────────────────────────┐
│                      AI-Worker Architecture                     │
├───────────────────┬──────────────────────┬──────────────────────┤
│ Prompt Engineering │ Context Engineering  │  Harness Engineering │
│                   │                      │                      │
│ ∙ System Intent   │ ∙ Semantic Memory    │ ∙ Browser Sandboxing │
│ ∙ On-Device LLMs  │ ∙ Context Pruning    │ ∙ Secure IPC Bridges │
│ ∙ Tool Validation │ ∙ MCP Server Binding │ ∙ WhatsApp Gateway   │
└───────────────────┴──────────────────────┴──────────────────────┘
```

---

## 1. Prompt Engineering

Prompt engineering in AI-Worker focuses on defining how LLMs interpret user intents and interact with local system capabilities.

* **System Instruction Alignment**: Pre-configured prompts enforce strict adherence to the Model Context Protocol (MCP) and structure tool calling schemas (JSON outputs).
* **On-Device Inference**: Out-of-the-box support for `Web-LLM` directly in the browser runtime (using WebGPU) to execute open models (like Gemini Nano or Phi) locally.
* **Dynamic Template Injection**: Appends system state, active workspace paths, local time, and preceding tool invocation results directly into the LLM context window.

---

## 2. Context Engineering

Context engineering ensures that the LLM is supplied with highly relevant, minimal data, preventing context window exhaustion and reducing token consumption.

* **Semantic Memory Core**: Uses a persistent SQLite-backed MCP server to store, index, and retrieve entities and relationships.
* **Context Pruning & Compaction**: Implements automatic truncation and formatting rules to keep chat histories compact and clean.
* **Multi-Source Fusion**: Merges filesystem watch updates, active browser contents, dragged-and-dropped files, and memory into a unified context payload.

---

## 3. Harness & Tool Engineering

Harness engineering connects the LLM's decisions safely to the physical host environment (browser, files, network).

* **Playwright Browser Harness**: Runs a local, stealth-configured Playwright instance that allows the LLM to navigate the web, fill forms, handle dropdowns, and take screenshots.
* **Secure Process Isolation**: The frontend runs in an Electron browser window with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Communication occurs over a strict IPC boundary exposed in the preload script.
* **Communication Bridges**: Integrates the WhatsApp web protocol (`Baileys` library) to allow remote task status alerts and interactive human-in-the-loop approval messages.
