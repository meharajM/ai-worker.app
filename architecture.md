# AI-Worker: System Architecture

This document provides a comprehensive overview of the AI-Worker application architecture, including system design, component relationships, data flow, and integration patterns.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Process Architecture](#process-architecture)
3. [Component Architecture](#component-architecture)
4. [Data Flow](#data-flow)
5. [IPC Communication](#ipc-communication)
6. [MCP Integration](#mcp-integration)
7. [LLM & Agent Architecture](#llm--agent-architecture)
8. [Dynamic Context Pruning](#dynamic-context-pruning)
9. [Storage & Session Architecture](#storage--session-architecture)
10. [Security Architecture](#security-architecture)
11. [Build & Distribution](#build--distribution)
12. [Autonomous Monitoring & Recovery](#autonomous-monitoring--recovery)
---

## System Overview

AI-Worker is built on Electron, following a multi-process architecture with strict security boundaries. The application consists of three main processes: Main Process, Preload Script, and Renderer Process.

```mermaid
graph TB
    subgraph "Electron Application"
        Main[Main Process<br/>Node.js Runtime]
        Preload[Preload Script<br/>Bridge Layer]
        Renderer[Renderer Process<br/>React UI]
    end

    subgraph "External Services"
        Ollama[Ollama API<br/>Local LLM]
        OpenAI[OpenAI API<br/>Cloud LLM]
        MCPServers[MCP Servers<br/>Stdio/SSE]
    end

    subgraph "System Resources"
        FileSystem[File System<br/>electron-store]
        BrowserAPIs[Browser APIs<br/>Speech/Storage]
    end

    Main -->|IPC| Preload
    Preload -->|Context Bridge| Renderer
    Main -->|HTTP| Ollama
    Renderer -->|HTTP| OpenAI
    Main -->|Stdio/SSE| MCPServers
    Main -->|Read/Write| FileSystem
    Renderer -->|Access| BrowserAPIs
```

---

## Process Architecture

### Main Process

The Main Process runs in Node.js and handles system-level operations, MCP connections, and IPC communication.

```mermaid
graph LR
    subgraph "Main Process"
        App[app.ts<br/>Application Lifecycle]
        IPC[IPC Handlers<br/>Modular Handlers]
        MCP[MCP Client Manager<br/>@modelcontextprotocol/sdk]
        Playwright[Playwright Service<br/>Internal Browser Automation]
        Speech[Speech Services<br/>ModelManager & ModelServer]
        Env[Environment Utils<br/>fix-path, ESM shims]
    end

    subgraph "IPC Modules"
        AppHandlers[app.ts<br/>App Info & Shell]
        MCPHandlers[mcp.ts<br/>MCP Operations]
        LLMHandlers[llm.ts<br/>LLM Placeholder]
        StoreHandlers[store.ts<br/>Storage Operations]
        SpeechHandlers[speech.ts<br/>Speech Operations]
        AntigravityHandlers[antigravity.ts<br/>OAuth & Gateway]
    end

    App --> IPC
    IPC --> AppHandlers
    IPC --> MCPHandlers
    IPC --> LLMHandlers
    IPC --> StoreHandlers
    IPC --> SpeechHandlers
    IPC --> AntigravityHandlers
    MCPHandlers --> MCP
    MCPHandlers --> Playwright
    SpeechHandlers --> Speech
    AntigravityHandlers --> AntigravityAuthService[AntigravityAuthService]
    App --> Env
```

**Key Responsibilities:**

- Window management and lifecycle
- IPC handler registration
- MCP server connections (Stdio/SSE)
- Antigravity OAuth flow & Gateway access
- Speech Model Management (Download/Serving)
- System-level operations (file system, shell)
- Environment setup (PATH fixing, ESM compatibility)

### Preload Script

The Preload Script runs in an isolated context and bridges the Main and Renderer processes securely.

```mermaid
graph TB
    subgraph "Preload Script"
        ContextBridge[Context Bridge<br/>Secure API Exposure]
        IPCInvoke[IPC Invoke<br/>Async Communication]
    end

    subgraph "Exposed APIs"
        MCPAPI[MCP Operations]
        LLMAPI[LLM Operations]
        StoreAPI[Storage Operations]
        ShellAPI[Shell Operations]
        AppAPI[App Info]
        SpeechAPI[Speech Operations]
    end

    ContextBridge --> MCPAPI
    ContextBridge --> LLMAPI
    ContextBridge --> StoreAPI
    ContextBridge --> ShellAPI
    ContextBridge --> AppAPI
    ContextBridge --> SpeechAPI
    IPCInvoke --> ContextBridge
```

**Key Responsibilities:**

- Expose secure APIs to renderer via `contextBridge`
- Translate renderer calls to IPC invocations
- Maintain security boundaries (no direct Node.js access)

### Renderer Process

The Renderer Process runs React in a Chromium-based environment, handling all UI and user interactions.

```mermaid
graph TB
    subgraph "Renderer Process"
        ReactApp[React App<br/>App.tsx]
        Components[UI Components]
        Stores[Zustand Stores]
        Lib[Library Modules]
        Hooks[Custom Hooks]
    end

    subgraph "Components"
        ChatView[ChatView]
        VoiceInput[VoiceInput]
        ConnectionsPanel[ConnectionsPanel]
        SettingsPanel[SettingsPanel]
        Header[Header]
        Sidebar[Sidebar]
    end

    subgraph "Stores"
        ChatStore[chatStore]
        SettingsStore[settingsStore]
        AuthStore[authStore]
    end

    subgraph "Libraries"
        LLMLib[llm/]
        WebLLMLib[webllm.ts]
        MCPLib[mcp.ts]
        ElectronLib[electron.ts]
        VoskLib[vosk.ts]
        ThinkFilter[thinkBlockFilter.ts]
        Constants[constants.ts]
    end

    subgraph "Hooks"
         UseSpeech[useSpeechRecognition]
         UseVisualizer[useAudioVisualizer]
         UseDragDrop[useFileDragDrop]
    end

    ReactApp --> Components
    ReactApp --> Stores
    Components --> Lib
    Components --> Hooks
    Hooks --> VoskLib
    Hooks --> UseVisualizer
    Hooks --> UseDragDrop
    Stores --> Lib
    Lib --> ElectronLib
    
    subgraph "Web Worker"
        LLMWorker[llm-worker.ts<br/>Model Inference]
    end
    
    WebLLMLib -->|Worker Message| LLMWorker
```

**Key Responsibilities:**

- UI rendering and user interactions
- State management (Zustand)
- LLM API calls (via fetch)
- Voice input/output (Web Speech API)
- Local storage (localStorage)

---

## Component Architecture

### UI Component Hierarchy

```mermaid
graph TD
    App[App.tsx<br/>Root Component]

    App --> Sidebar[Sidebar<br/>Navigation]
    App --> Header[Header<br/>Status Display]
    App --> Main[Main Content Area]

    Main --> ChatView[ChatView<br/>Chat Interface]
    Main --> ConnectionsPanel[ConnectionsPanel<br/>MCP Management]
    Main --> SettingsPanel[SettingsPanel<br/>Configuration]
    Main --> FeatureFlagsPanel[FeatureFlagsPanel<br/>Dev Mode Flags]
    
    ChatView --> MessageBubble[MessageBubble<br/>Message Display]
    ChatView --> VoiceInput[VoiceInput<br/>Input Component]

    ConnectionsPanel --> McpServerForm[McpServerForm<br/>Server Configuration]
    ConnectionsPanel --> McpServerCard[McpServerCard<br/>Server Display]

    VoiceInput --> SpeechRecognition[useSpeechRecognition<br/>STT Hook]
    VoiceInput --> SpeechSynthesis[useSpeechSynthesis<br/>TTS Hook with Dynamic Controls]
    ChatView --> UseFileDragDrop[useFileDragDrop<br/>Attachment Handling]
```

### State Management Architecture

```mermaid
graph LR
    subgraph "Zustand Stores"
        ChatStore[chatStore<br/>Messages & Processing]
        SettingsStore[settingsStore<br/>User Preferences]
        AuthStore[authStore<br/>Authentication]
    end

    subgraph "Persistence"
        LocalStorage[localStorage<br/>Browser Storage]
        ElectronStore[electron-store<br/>Main Process]
    end

    ChatStore -->|Persist| LocalStorage
    SettingsStore -->|Persist| LocalStorage
    AuthStore -->|Persist| LocalStorage

    SettingsStore -.->|Sync API Keys| ElectronStore
```

---

## Data Flow

### User Message Flow

```mermaid
sequenceDiagram
    participant User
    participant VoiceInput
    participant ChatStore
    participant App
    participant LLMLib
    participant Ollama/OpenAI
    participant TTS

    User->>VoiceInput: Speak or Type
    VoiceInput->>ChatStore: addMessage(user)
    ChatStore->>App: Message Added
    App->>LLMLib: chat(messages)
    LLMLib->>Ollama/OpenAI: HTTP Request
    Ollama/OpenAI-->>LLMLib: Response
    LLMLib-->>App: LLM Response
    App->>ChatStore: addMessage(assistant)
    App->>TTS: speak(response)
    TTS-->>User: Audio Output
```

### Attachment Processing Flow

```mermaid
sequenceDiagram
    participant User
    participant DragDrop as useFileDragDrop
    participant ChatStore
    participant MarkItDown as MarkItDown MCP
    participant LLMLib

    User->>DragDrop: Drop File (PDF/Image)
    DragDrop->>ChatStore: addMessage(user + attachments)
    Note over ChatStore: Attachments stored with path & type
    
    ChatStore->>LLMLib: prepareContext()
    
    alt Needs Conversion
        LLMLib->>MarkItDown: convert(file_path)
        MarkItDown-->>LLMLib: Return Markdown Content
    end

    LLMLib->>LLMLib: Inject Content into Context
    LLMLib->>LLM Provider: Send Prompt + File Content
```

### MCP Connection Flow

```mermaid
sequenceDiagram
    participant User
    participant ConnectionsPanel
    participant MCPLib
    participant Preload
    participant Main Process
    participant MCPServer

    User->>ConnectionsPanel: Add Server Config
    ConnectionsPanel->>MCPLib: addCustomServer()
    MCPLib->>MCPLib: Save to Storage
    User->>ConnectionsPanel: Connect
    ConnectionsPanel->>MCPLib: connect(serverId)
    MCPLib->>Preload: electron.mcp.connect()
    Preload->>Main Process: IPC: mcp:connect
    Main Process->>MCPServer: Create Transport
    MCPServer-->>Main Process: Connection Established
    Main Process-->>Preload: Success Response
    Preload-->>MCPLib: Connection Result
    MCPLib->>ConnectionsPanel: Update State
    ConnectionsPanel->>MCPLib: listTools()
    MCPLib->>Preload: electron.mcp.listTools()
    Preload->>Main Process: IPC: mcp:list-tools
    Main Process->>MCPServer: listTools()
    MCPServer-->>Main Process: Tools List
    Main Process-->>Preload: Tools Response
    Preload-->>MCPLib: Tools Data
    MCPLib->>ConnectionsPanel: Update Tools
```

### Settings Persistence Flow

```mermaid
sequenceDiagram
    participant User
    participant SettingsPanel
    participant SettingsStore
    participant LocalStorage
    participant ElectronStore

    User->>SettingsPanel: Change Setting
    SettingsPanel->>SettingsStore: setTtsEnabled(true)
    SettingsStore->>LocalStorage: Persist State
    SettingsStore->>ElectronStore: Sync API Keys (if needed)
    ElectronStore->>FileSystem: Write to Config
    LocalStorage-->>SettingsStore: Confirmed
    SettingsStore-->>SettingsPanel: State Updated
    SettingsPanel-->>User: UI Updated
```

---

## IPC Communication

### IPC Handler Architecture

```mermaid
graph TB
    subgraph "Renderer Process"
        Renderer[React Components]
        ElectronAPI[window.electron API]
    end

    subgraph "Preload Script"
        ContextBridge[Context Bridge]
        IPCInvoke[ipcRenderer.invoke]
    end

    subgraph "Main Process"
        IPCReceive[ipcMain.handle]
        Handlers[IPC Handlers]
    end

    subgraph "Handler Modules"
        AppH[app.ts<br/>App Info & Shell]
        MCPH[mcp.ts<br/>MCP Operations]
        LLMH[llm.ts<br/>LLM Operations]
        StoreH[store.ts<br/>Storage]
    end

    Renderer --> ElectronAPI
    ElectronAPI --> ContextBridge
    ContextBridge --> IPCInvoke
    IPCInvoke --> IPCReceive
    IPCReceive --> Handlers
    Handlers --> AppH
    Handlers --> MCPH
    Handlers --> LLMH
    Handlers --> StoreH
```

### IPC Channel Mapping

| Renderer API                    | IPC Channel           | Handler Module | Description            |
| ------------------------------- | --------------------- | -------------- | ---------------------- |
| `electron.mcp.connect()`        | `mcp:connect`         | `mcp.ts`       | Connect to MCP server  |
| `electron.mcp.disconnect()`     | `mcp:disconnect`      | `mcp.ts`       | Disconnect from server |
| `electron.mcp.listTools()`      | `mcp:list-tools`      | `mcp.ts`       | List available tools   |
| `electron.mcp.callTool()`       | `mcp:call-tool`       | `mcp.ts`       | Execute MCP tool       |
| `electron.store.get()`          | `store:get`           | `store.ts`     | Get stored value       |
| `electron.store.set()`          | `store:set`           | `store.ts`     | Set stored value       |
| `electron.shell.openExternal()` | `shell:open-external` | `app.ts`       | Open external URL      |
| `electron.app.getVersion()`     | `app:get-version`     | `app.ts`       | Get app version        |
| `electron.speech.checkSupport()`| `speech:check-support`| `speech.ts`    | Check/Verify Model     |
| `electron.speech.downloadModel()`| `speech:download-model`| `speech.ts`  | Download logic         |
| `electron.speech.getModelPath()`| `speech:get-model-path`| `speech.ts`   | Get model server URL   |

---

## MCP Integration

### Default MCP Servers

AI-Worker comes with two pre-configured MCP servers that are automatically initialized on first run:

1. **Playwright Server** (`playwright`)

   - Purpose: Browser automation and web interaction
   - Mode: **Internal Service** (Zero-latency, in-process)
   - Configuration: `command: 'internal'` (Automatically routed by `mcp.ts`)
   - Tools: 30+ tools including navigate, click, fill, screenshot, get_state, evaluate, background_scrape (headless)

2. **Sequential Thinking Server** (`sequential-thinking`)
   - Purpose: Step-by-step reasoning for complex tasks
   - Configuration:
     - Type: `stdio`
     - Command: `npx`
     - Args: `-y @modelcontextprotocol/server-sequential-thinking`
   - Tools: Sequential reasoning, task decomposition

**Initialization Behavior:**

- Default servers are created automatically when localStorage is empty (first run)
- Missing default servers are automatically added on app load
- Users can edit, remove, or customize default servers
- Form pre-fills with Sequential Thinking configuration for quick setup

### MCP Client Architecture

```mermaid
graph TB
    subgraph "Main Process"
        MCPHandler[MCP IPC Handler]
        MCPClient[MCP Client<br/>@modelcontextprotocol/sdk]
        TransportManager[Transport Manager]
    end

    subgraph "Transport Types"
        StdioTransport[Stdio Transport<br/>Local Commands]
        SSETransport[SSE Transport<br/>Remote Servers]
    end

    subgraph "MCP Servers"
        LocalServer[Local Server<br/>node/python/npx]
        RemoteServer[Remote Server<br/>HTTP/SSE]
    end

    MCPHandler --> MCPClient
    MCPClient --> TransportManager
    TransportManager --> StdioTransport
    TransportManager --> SSETransport
    StdioTransport --> LocalServer
    SSETransport --> RemoteServer
```

### MCP Connection Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Initializing: App Start
    Initializing --> DefaultServersCreated: First Run
    Initializing --> ServersLoaded: Existing Config
    DefaultServersCreated --> Disconnected: Defaults Added
    ServersLoaded --> Disconnected: Servers Loaded
    Disconnected --> Connecting: User Clicks Connect
    Connecting --> Connected: Connection Success
    Connecting --> Error: Connection Failed
    Error --> Connecting: Retry
    Connected --> Disconnected: User Clicks Disconnect
    Connected --> ListingTools: Auto-fetch Tools
    ListingTools --> Connected: Tools Loaded
    Connected --> CallingTool: Execute Tool
    CallingTool --> Connected: Tool Complete
```

**Initialization Flow:**

1. App loads → Check localStorage for existing servers
2. If empty → Create default servers (Playwright, Sequential Thinking)
3. If servers exist → Load them and ensure defaults are present
4. Missing defaults → Automatically add them

### MCP Server Configuration

```mermaid
graph LR
    subgraph "Server Types"
        Stdio[Stdio Server<br/>Command + Args]
        SSE[SSE Server<br/>URL]
    end

    subgraph "Configuration"
        Name[Name]
        Type[Type: stdio/sse]
        Command[Command<br/>node/python/npx]
        Args[Arguments<br/>Array of strings]
        URL[URL<br/>http://...]
    end

    subgraph "Default Servers"
        Playwright[Playwright<br/>Browser Automation]
        SequentialThinking[Sequential Thinking<br/>Step-by-step Reasoning]
    end

    Stdio --> Command
    Stdio --> Args
    SSE --> URL
    Name --> Type
    Playwright --> Stdio
    SequentialThinking --> Stdio
```

**Default MCP Servers:**

- **Playwright** (`playwright`)

  - Type: `stdio`
  - Command: `npx`
  - Args: `-y @modelcontextprotocol/server-playwright`
  - Description: Browser automation and web interaction tools (includes headless `background_scrape` for background extraction)

- **Sequential Thinking** (`sequential-thinking`)
  - Type: `stdio`
  - Command: `npx`
  - Args: `-y @modelcontextprotocol/server-sequential-thinking`
  - Description: Enables step-by-step reasoning for complex tasks

- **MarkItDown** (`markitdown`)
  - Type: `stdio`
  - Command: `uvx`
  - Args: `markitdown-mcp`
  - Description: Convert documents (PDF, Word, Excel, Images) to Markdown
  - **Auto-Connect**: Enabled by default

**Initialization Logic:**

- Default servers are automatically created on first run (when localStorage is empty)
- Missing default servers are automatically added on app load
- Users can edit, remove, or customize default servers
- Form pre-fills with Sequential Thinking configuration for quick setup


---

### LLM & Agent Architecture

AI-Worker implements a reactive, tool-calling agent loop managed by the `AgentRuntime`. It prioritizes a **Plan-First** approach for complex tasks.

#### Modular LLM Provider System

The LLM logic is refactored into a modular provider system located in `src/renderer/src/lib/llm/`. This structure isolates provider-specific logic (OpenAI, Gemini, Ollama, WebLLM) and shared utilities.

```mermaid
graph TD
    Orchestrator[llm.ts<br/>Orchestrator]
    
    subgraph "lib/llm/ Modules"
        OpenAI[openai.ts]
        Gemini[gemini.ts]
        Ollama[ollama.ts]
        Browser[browser-llm.ts]
        Prompts[prompts.ts]
        Utils[utils.ts]
        Types[types.ts]
    end

    Orchestrator --> OpenAI
    Orchestrator --> Gemini
    Orchestrator --> Ollama
    Orchestrator --> Browser
    
    OpenAI & Gemini & Ollama & Browser --> Prompts
    OpenAI & Gemini & Ollama & Browser --> Utils
    OpenAI & Gemini & Ollama & Browser --> Types
```

- **llm.ts**: Central entry point. Handles provider auto-selection and message pruning (DCP).
- **openai.ts / gemini.ts / ...**: Provider-specific API formatting and calling.
- **prompts.ts**: System prompt generation and tool filtering.
- **utils.ts**: Shared JSON parsing and content normalization.

#### Reasoning & Thinking Blocks

The system implements a universal thinking filter (`thinkBlockFilter.ts`) to handle reasoning outputs from advanced models (e.g., Gemini 2.0, DeepSeek-R1).

- **Multi-Format Support**: Detects and strips XML `<think>`, `<thinking>`, `<thought>` tags and Markdown ```think``` blocks.
- **Leaked Reasoning Detection**: Proactively identifies reasoning patterns that escape designated blocks, ensuring a clean UI summary.
- **Gemini 2.0 Integration**: Specifically handles Gemini's native `thought` and `thought_signature` fields, echoing them back in message history for consistent tool-calling contexts.

### Agent Runtime Architecture (Phase 2 Refactor)

The `AgentRuntime` has been refactored from a monolithic class into a modular system of specialized services, orchestrated by a lean facade. This prepares the system for a client-server architecture in Phase 3.

```mermaid
graph TD
    User[User Input] --> Runtime[AgentRuntime Facade]
    
    subgraph "Core Services"
        Orchestration[OrchestrationService<br/>Task Decomposition]
        Tools[ToolExecutionService<br/>Loop Handling & Self-Healing]
        SpecialHandlers[SpecialToolHandlers<br/>High-level Tools]
        LLMOrchestrator[llm.ts<br/>Provider Selection]
        State[AgentStateService<br/>Memory & Checkpoints]
    end

    Runtime --> State
    Runtime --> Orchestration
    Orchestration -->|Sub-Agents| Runtime
    Runtime --> LLMOrchestrator
    LLMOrchestrator --> Providers[llm/ Providers<br/>OpenAI, Gemini, Ollama, Browser]
    Runtime --> Tools
    Runtime --> SpecialHandlers
    
    Tools --> MCP[MCP Tools]
    State --> Memory[Memory DB]
```

#### 1. AgentRuntime Facade
- **Role**: Entry point for the UI (`useAgent.ts`).
- **Responsibility**: Coordinates the high-level loop (Think -> Act -> Observe) and manages context limits.
- **Interface**: Implements `IAgentClient`, ensuring the UI is decoupled from the implementation (ready for remote execution).

#### 2. AgentStateService
- **Responsibility**: Manages the agent's memory lifecycle.
- **Key Features**:
  - **Session Management**: Initializes and restores execution state.
  - **Context Loading**: Loads parent context for sub-agents to share knowledge.
  - **Handoff Detection**: Automatically prompts for user intervention if the context limit is reached.

#### 3. SpecialToolHandlers
- **Responsibility**: Owns inline handlers for complex "agent-specific" logic.
- **Key Features**:
  - Coordinates multi-step execution plans (`create_execution_plan`).
  - Spawns sub-agents for isolated research (`delegate_sub_task`) and salvages partial data on failure.
  - Generates progress checkpoints for context preservation (`update_progress_summary`).
  - Runs advanced browser analysis like semantic accessibility trees (`scan_page_accessibility`).

#### 4. OrchestrationService
- **Responsibility**: Spawns and manages sub-agents.
- **Patterns**:
  - **Parallel Orchestration**: Spawns N sub-agents for independent contexts (e.g., comparing 3 websites).
  - **Sequential Orchestration**: Executes multi-step plans where step N+1 depends on step N.
  - **Sub-Agent Factory**: Uses a factory pattern to create new `AgentRuntime` instances, breaking circular dependencies.

#### 5. ToolExecutionService
- **Responsibility**: Safely executes tools and robustly handles errors.
- **Loop Detection**: Prevents infinite loops by detecting repetitive arguments or similar patterns (same tool N times in a row).
- **Self-Healing**: Automatically retries failed actions with context-aware recovery strategies:
  - **Context Destroyed**: 1s wait + retry (handles navigation race conditions).
  - **Stale Element**: Immediate retry (handles dynamic DOM updates).
  - **Lane/Tool Timeout**: Retry with extended/doubled timeout.
  - **Network/Browser Error**: Transient error recovery with exponential backoff.
- **Output Formatting**: Truncates large outputs (max 5000 chars) and formats results for the LLM with recovery hints (e.g., suggesting `get_interactive_elements` on click failure).

### Sub-Agent Delegation Flow

The system supports recursive task delegation through the `delegate_sub_task` tool. This allows the main agent to offload complex, self-contained units of work to a fresh `AgentRuntime` instance.

#### How It Works

1.  **Main Agent Decides**: The main agent determines a sub-task is too complex or requires isolation.
2.  **Tool Call**: Calls `delegate_sub_task` with specific instructions and context. The `SpecialToolHandlers` service intercepts this.
3.  **Recursive Runtime**: The system instantiates a *new* `AgentRuntime` (the "Sub-Agent").
4.  **Context Inheritance**: The Sub-Agent inherits the parent's `taskCategory`, ensuring it loads the correct safety protocols (e.g., a Shopping sub-agent also knows not to buy things).
5.  **Isolated Execution**: The Sub-Agent runs its own loop (Plan -> Act -> Verify) with a fresh context window.
6.  **Bailout & Salvage**: If the Sub-Agent fails (e.g. consecutive errors), `SpecialToolHandlers` detects the bailout and scans the Sub-Agent's history to salvage any useful partial data found before failure.
7.  **Result Aggregation**: The `SpecialToolHandlers` returns the final summary (or salvaged data) string, which becomes the tool result for the Main Agent.

```mermaid
sequenceDiagram
    participant MainAgent as Main AgentRuntime
    participant Tool as Tool: delegate_sub_task
    participant SubAgent as Sub-AgentRuntime
    participant LLM as LLM Provider

    MainAgent->>Tool: Call(instruction, context)
    Note over Tool: New AgentRuntime Created
    Tool->>SubAgent: chat(instruction)
    
    loop Sub-Agent Loop
        SubAgent->>LLM: Prompt
        LLM-->>SubAgent: Response/Tool Calls
        SubAgent->>SubAgent: Execute Tools
    end
    
    SubAgent-->>Tool: Return Final Summary
    Tool-->>MainAgent: Tool Result (Summary)
    Note over MainAgent: Context Preserved
```

#### Performance Consideration

> **⚠️ Critical Token Usage Note:**
> When delegating tasks, the `delegate_sub_task` tool takes a `context` argument. If the Main Agent blindly passes its entire conversation history into this field, it causes a specific token spikes:
>
> 1.  **Duplicate Context**: The full history is tokenized once as part of the Main Agent's tool call argument.
> 2.  **Sub-Agent Prompt**: The full history is tokenized *again* as the initial user message for the Sub-Agent.
>
> **Best Practice:** The Main Agent should always summarize or extract *only* the relevant facts needed for the sub-task, rather than dumping the raw conversation history. This is enforced via the `delegate_sub_task` tool definition.

### Resource Locking & Concurrency Management

To support parallel execution of sub-agents and tool calls while maintaining internal state consistency, AI-Worker implements a granular resource locking system.

#### 1. Hybrid Execution Engine
Tools are classified into three categories by the `laneManager`:

- **Stateful Browser Tools**: Tools that modify the browser state (e.g., `navigate`, `click`). These share a global **Browser Lock** via a serial execution lane.
- **Tab-Scoped Tools**: Tools bound to a specific tab (e.g., `screenshot(tabId)`). These run in a **Tab Serial Lane**, allowing parallel work across different tabs.
- **Stateful File Tools**: Tools that modify the filesystem. These use **Granular Locks** (Keyed Mutexes) keyed by absolute file path.
- **Stateless Tools**: Tools like `search`, `memory_retrieve`, or `sequential-thinking` that have no side effects. These run in **True Parallelism** via the API Parallel lane.

#### 2. Isolation Strategy
- **Sub-Agent Tabs**: Each sub-agent is provisioned with a **dedicated browser tab** (`tabId`). This ensures that one sub-agent's navigation does not interrupt another's workflow.
- **Auto-Cleanup**: Tabs are automatically closed upon sub-task completion to prevent memory leaks.

### Universal Self-Healing Architecture

AI-Worker implements a multi-layered self-healing system designed to make the agent resilient against flaky web pages and dynamic DOM updates.

#### 1. Resilience Middleware
Located in `agent-runtime.ts`, this middleware wraps all tool executions and intercepts common runtime errors.

```mermaid
sequenceDiagram
    participant Agent as AgentRuntime
    participant Mutex as Resource Lock
    participant Tool as executeToolCall
    participant Browser as Playwright/FS

    Agent->>Agent: analyzeTool(name)
    alt is Stateful
        Agent->>Mutex: acquireLock(resourceKey)
        Mutex-->>Agent: Lock Granted
    end
    
    rect rgb(240, 240, 240)
    Note over Agent, Browser: Self-Healing Loop (Max 3 Attempts)
    Agent->>Tool: execute(args)
    Tool->>Browser: Perform Action
    alt Success
        Browser-->>Agent: Result
    else Error (Stale/Context/Timeout)
        Browser-->>Agent: Error Response
        Agent->>Agent: analyzeError(retryable?)
        Agent->>Tool: Retry with adjustments
    end
    end

    alt is Stateful
        Agent->>Mutex: releaseLock(resourceKey)
    end
    Agent-->>Agent: updateResponseHistory()
```

| Error | Recovery Action | Target |
|-------|-----------------|--------|
| **Stale Element** | Immediate retry of the specific tool call. | React dynamic updates |
| **Context Destroyed** | 1s wait + retry. | Navigation race conditions |
| **Timeout** | Double the timeout + retry. | Slow loading pages |

#### 2. Runtime Preconditions (Pre-Validation & Auto-Fallback)
The `PlaywrightService` implements proactive validation for multi-step tools (`browser_action_sequence` and `fill_form`) to prevent hallucinated selectors from causing partial executions or long timeouts.
- **Auto-Observation Guard**: Automatically checks `page.$(selector)` implicitly before executing any step.
- **Fail-Fast Sequence Validation**: Validates all selectors in a sequence *before* running. If a selector is missing, the sequence aborts instantly (~50ms) instead of waiting for a 30s timeout, saving tokens and time. 
- **Smart Auto-Fallback**: If a `click` selector is invalid but acts like or is accompanied by valid `text`, the runtime automatically upgrades the action to `click_text` on the fly.

#### 3. Navigation & Recovery Fallbacks
- **Auto-Google**: If a URL navigation fails (DNS or typo), the agent automatically converts the URL into a Google search query.
- **Fuzzy Selector Fallback**: If a strict CSS selector (ID/Class) fails during execution, the system automatically tries "fuzzy" matching or text-based selectors.

#### 4. Sub-Agent Panic Mode
If a sub-agent enters an unproductive loop (3+ turns with no progress), it triggers **Panic Mode**:
1. It stops searching/clicking blindly.
2. It takes a visual snapshot of the page.
3. It reports the visual state to the parent, allowing the main agent to adjust the plan.

### Auto-Fork Task Decomposition

### Auto-Fork Task Decomposition

The system includes **automatic task decomposition** that intelligently spawns sub-agents based on context boundaries. This prevents "context drowning" where the main loop becomes overwhelmed by tool noise.

#### Decision Logic (LLM-Based)

The system now utilizes an **LLM-based analysis step** (`analyzeTaskWithLLM`) to determine the optimal execution strategy, replacing the previous regex-only approach.

| Scenario | Strategy | Implementation |
|----------|----------|----------------|
| **Independent Contexts** (e.g., compare Amazon & eBay) | Parallel Sub-Agents | LLM identifies contexts + parallel safety |
| **Complex Single Context** (4+ steps) | Sequential Sub-Agent | Protects main context history |
| **Simple Task** | Direct Execution | Runs in main loop |

#### Implementation

Located in [`task-decomposer.ts`](src/renderer/src/lib/task-decomposer.ts):

```typescript
interface TaskDecomposition {
  type: 'single_context' | 'multi_context';
  contexts: string[];           // URLs or app names detected by LLM
  estimatedActions: number;     // Heuristic count
  shouldFork: boolean;          // Decision
  forkStrategy?: 'parallel' | 'sequential';
}
```

**Key Features:**
- **LLM Analysis**: Prompts the model to extract contexts and verify independence.
- **Caching**: Analysis results are cached (5m TTL) to prevent redundant calls.
- **Fallbacks**: Defaults to sequential execution if LLM analysis fails.

#### Auto-Fork Flow

```mermaid
flowchart TD
    A[User Request] --> B[LLM Analysis]
    B --> C{Parallelizable?}
    C -->|Yes| D[Parallel Sub-Agents]
    C -->|No| E{Complex Task?}
    E -->|Yes| F[Sequential Sub-Agent]
    E -->|No| G[Direct Execution]
    D --> H[Combine Results]
    F --> H
    G --> I[Response]
    H --> I
```

### Strategic Result Extraction

To provide a premium user experience, AI-Worker separates "agent internal work" from "user-facing results" using the `ResultReporter` (`result-reporter.ts`).

#### 1. Noise Filtering
Raw tool outputs (e.g., a dump of 50 interactive elements from Playwright) are often several kilobytes of JSON. The `ResultReporter` identifies these as **Noise** based on patterns:
- Large JSON arrays with `index`, `selector`, and `type` fields.
- Deeply nested element property objects.
- Pruned content markers from DCP.

#### 2. Pattern-Based Extraction
When a tool returns data, the reporter attempts to extract structured entities:
- **Products**: Matches price symbols (₹, $), ratings (stars), and shopping actions.
- **Navigation**: Detects successful page loads and extracts page titles.
- **Confirmations**: Detects success markers (✓, "successfully").

#### 3. Interactive UI Reporting
Extracted data is formatted into natural language summaries or structured bullets (e.g., "Found 3 items: • Laptop - ₹50,000") which are displayed to the user, while the raw context is maintained for the agent's logic.

### Autonomous Monitoring & Progress Tracking

The `AgentRuntime` implements a persistent tracking layer to provide transparency into long-running tasks.

#### 1. Execution Plans
The agent can generate an **Execution Plan** via tool call. This plan is tracked in the `AgentRuntime` state:
- **Granular Steps**: Discrete actions (e.g., "Open Amazon", "Search for shoes").
- **Status Sync**: Steps transition through `loading` → `done`/`error`.
- **Result Anchoring**: Sub-agent results are anchored to specific plan steps for parent aggregation.

#### 2. Progress Summaries
During the interaction loop, the agent generates **Progress Summaries**.
- **LLM-Driven**: Major chunks of historical work are periodically summarized.
- **Final Reporting**: If the LLM generates a response without a summary, the `AgentRuntime` automatically appends the cumulative progress report to the final message to ensure the user is never left wondering what happened.

---

#### Example: Multi-Website Task

**User:** "Compare laptop prices on Amazon and BestBuy"

```
analyzeTaskForDecomposition() → 2 websites detected
     │
     ▼ Parallel Fork
┌─────────────┐    ┌─────────────┐
│ Sub-Agent   │    │ Sub-Agent   │
│ AMAZON      │    │ BESTBUY     │
└──────┬──────┘    └──────┬──────┘
       │                  │
       └────────┬─────────┘
                ▼
        Main Agent combines results
```

---

### Autonomous Monitoring & Progress Tracking

The `AgentRuntime` implements a persistent tracking layer to provide transparency into long-running tasks and ensure reliability.

#### 1. Execution Plans
The agent can generate an **Execution Plan** via tool call. This plan is tracked in the `AgentRuntime` state:
- **Granular Steps**: Discrete actions (e.g., "Open Amazon", "Search for shoes").
- **Status Sync**: Steps transition through `loading` → `done`/`error`.
- **Result Anchoring**: Sub-agent results are anchored to specific plan steps for parent aggregation.

#### 2. Progress Checkpoints & Summaries
During the interaction loop, the system enforces a **Mandatory Reporting Protocol**:
- **Step Checkpoints**: At fixed intervals (steps 5, 10, 15...), the runtime pauses the agent's main loop to enforce a `update_progress_summary` call.
- **LLM-Driven Summarization**: Major chunks of historical work are periodically summarized into incremental findings.
- **Badge-Based UI**: Checkpoints are rendered as subtle "Progress saved" badges in the UI, keeping the raw tool noise hidden.
- **Final Reporting**: If the LLM generates a response without a summary, the `AgentRuntime` automatically appends the cumulative progress report to the final message to ensure the user is never left wondering what happened.

### Token Efficiency & Drift Mitigation

To maintain performance and stay within context limits, the system employs **Dynamic Context Pruning** and **Strict Truncation**.

#### 1. Output Truncation & Agent Guidance
Tool outputs (especially `get_state` or `evaluate`) can be massive.
- **Hard Limit**: All tool outputs are truncated to **5000 characters** before reaching the LLM context.
- **Strategic Tips**: When truncation occurs, the system appends a **[SYSTEM TIP]** to the result. This tip guides the agent to use more specific selectors (e.g., `get_interactive_elements` or `find_by_xpath`) instead of dumping the entire DOM.
- **Redundancy Pruning (DCP)**: Identifies redundant or outdated tool outputs in the message history and replaces them with placeholders.

#### 2. Session Isolation
The architecture guarantees strict **Session Isolation** to prevent cross-contamination:
- **Independent History**: Each chat session maintains a separate `chatStore` partition.
- **Sub-Agent Scoping**: Sub-agents spawned from a session are strictly bound to that session's context and browser tabs.
- **Resource Cleanup**: Browser tabs and memory locks are cleared immediately when a session is closed or a task finishes.

### Strategic Result Extraction

To provide a premium user experience, AI-Worker separates "agent internal work" from "user-facing results" using the `ResultReporter` (`result-reporter.ts`).

#### 1. Noise Filtering & Pattern Extraction
Raw tool outputs (e.g., a dump of 50 interactive elements) are often kilobyte-scale JSON. The `ResultReporter` filters this "Noise" and extracts structured entities:
- **Products & Prices**: Matches currency symbols (₹, $) and reviews.
- **Navigation Results**: Detects page loads and extracts titles.
- **Confirmation Markers**: Identifies success/failure patterns.
- **UI Formatters**: Extracted data is formatted into natural language summaries displayed to the user, while raw data is kept in the agent's context.

---

```mermaid
graph LR
    subgraph "LLM Settings"
        Provider[Provider Selection<br/>auto/ollama/openai/browser]
        OllamaConfig[Ollama Config<br/>Model, Base URL]
        OpenAIConfig[OpenAI Config<br/>API Key, Base URL, Model]
    end

    subgraph "Storage"
        SettingsStore[settingsStore]
        LocalStorage[localStorage]
    end

    Provider --> SettingsStore
    OllamaConfig --> SettingsStore
    OpenAIConfig --> SettingsStore
    SettingsStore --> LocalStorage
```

---

## Memory Architecture

AI-Worker implements a **privacy-first, swappable-backend memory system** that allows users to build a knowledge graph of their work while maintaining strict privacy controls and enabling seamless scaling.

### Memory System Overview

```mermaid
graph TB
    subgraph "Application Layer"
        MemoryService[MemoryService\u003cbr/\u003eSingleton Instance]
    end
    
    subgraph "Privacy Layer"
        PIIDetector[PIIDetector\u003cbr/\u003eEmail, Phone, SSN]
        SecretRedactor[SecretRedactor\u003cbr/\u003eAPI Keys, Tokens]
    end
    
    subgraph "Metrics & Migration"
        MetricsCollector[MetricsCollector\u003cbr/\u003eUsage Tracking]
        MigrationService[MigrationService\u003cbr/\u003eAuto-Migration Logic]
    end
    
    subgraph "Backend Abstraction"
        UnifiedBackend[UnifiedMemoryBackend\u003cbr/\u003eInterface]
        Factory[MemoryServiceFactory\u003cbr/\u003eBackend Selection]
    end
    
    subgraph "Storage Backends"
        ServerMemory[ServerMemoryAdapter\u003cbr/\u003eJSON Storage MVP]
        MementoMCP[MementoMCPAdapter\u003cbr/\u003eNeo4j for Scale]
    end
    
    MemoryService --> PIIDetector
    MemoryService --> SecretRedactor
    MemoryService --> MetricsCollector
    MemoryService --> MigrationService
    MemoryService --> Factory
    Factory --> UnifiedBackend
    UnifiedBackend -.-> ServerMemory
    UnifiedBackend -.-> MementoMCP
```

### Backend Architecture (Swappable Storage)

The memory system uses an **abstract backend interface** that allows swapping storage engines without changing application code:

```typescript
// UnifiedMemoryBackend.ts - Interface all backends implement
export interface UnifiedMemoryBackend {
  // Lifecycle
  initialize(): Promise<void>
  
  // Entity CRUD
  createEntity(input: CreateEntityInput): Promise<Entity>
  getEntity(id: string): Promise<Entity | null>
  updateEntity(id: string, updates: Partial<Entity>): Promise<Entity>
  deleteEntity(id: string): Promise<void>
  
  // Search & Relations
  search(query: string, options?: SearchOptions): Promise<Entity[]>
  createRelation(input: CreateRelationInput): Promise<Relation>
  
  // Export/Import for migration
  exportAll(): Promise<ExportData>
  importAll(data: ExportData): Promise<void>
  getStats(): Promise<MemoryStats>
}
```

**Current Backends:**

1. **ServerMemoryAdapter** (Current MVP)
   - Wraps `@modelcontextprotocol/server-memory`
   - JSON file storage (~10K entities max)
   - Fast startup, simple deployment
   - Path: `src/main/services/memory/adapters/ServerMemoryAdapter.ts`

2. **MementoMCPAdapter** (Future Scale)
   - Neo4j-based graph database
   - Handles 100K+ entities with advanced queries
   - Temporal queries, semantic search
   - Path: `src/main/services/memory/adapters/MementoMCPAdapter.ts` (skeleton)

### Privacy-First Architecture

**Goal**: Prevent storage of sensitive data (PII, secrets) that could leak if memory files are accessed.

```mermaid
sequenceDiagram
    participant User
    participant MemoryService
    participant PIIDetector
    participant SecretRedactor
    participant Backend
    
    User->>MemoryService: createEntity("John", "Email: john@co.com")
    MemoryService->>PIIDetector: detect(description)
    PIIDetector-->>MemoryService: {found: true, types: ['email']}
    MemoryService-->>User: Error: PII detected
    
    Note over User: User removes PII
    User->>MemoryService: createEntity("John", "Software Engineer")
    MemoryService->>SecretRedactor: check(description)
    SecretRedactor-->>MemoryService: No secrets found
    MemoryService->>Backend: createEntity()
    Backend-->>MemoryService: Entity created
    MemoryService-->>User: Success
```

**Privacy Components:**

- **PIIDetector** (`privacy/PIIDetector.ts`)
  - Detects: emails, phone numbers, SSNs, credit cards
  - Returns redacted text + PII types found
  - Throws error to block storage

- **SecretRedactor** (`privacy/SecretRedactor.ts`)
  - Detects: API keys, JWT tokens, private keys, DB credentials
  - Throws error immediately (secrets never stored)
  - Patterns: `sk_*`, `eyJ*`, `ghp_*`, `-----BEGIN PRIVATE KEY-----`

### Metrics & Auto-Migration

The system tracks usage metrics to suggest migration when scaling thresholds are exceeded:

```typescript
// MetricsCollector.ts - Tracks usage
interface MemoryMetrics {
  entityCount: number          // Current: 0-10K (server-memory)
  avgSearchLatency: number     // Target: <100ms
  storageSizeMB: number        // Target: <50MB
}

// Migration thresholds (from memory-risks-and-scaling.md)
const THRESHOLDS = {
  entityCount: 10000,          // Migrate if >10K entities
  searchLatencyMs: 100,        // Migrate if searches >100ms
  storageSizeMB: 50            // Migrate if JSON >50MB
}
```

**Migration Flow:**

```mermaid
stateDiagram-v2
    [*] --> ServerMemory: MVP (0-10K entities)
    ServerMemory --> CheckMetrics: After each operation
    CheckMetrics --> ServerMemory: Below thresholds
    CheckMetrics --> SuggestMigration: Threshold exceeded
    SuggestMigration --> MementoMCP: User approves
    MementoMCP --> [*]: Scaled to 100K+ entities
```

**MigrationService** (`MigrationService.ts`):
- Monitors metrics automatically
- Suggests migration when needed
- Handles export from current backend
- Imports to new backend
- Updates configuration

### Legacy SQLite Migration

On first initialization, the system automatically migrates existing SQLite data:

```typescript
// MemoryService.ts - migrateLegacyDataIfNeeded()
async initialize() {
  // 1. Create backend (server-memory or memento-mcp)
  this.backend = MemoryServiceFactory.create()
  
  // 2. Check for legacy SQLite database
  if (exists('memory.db') && backend.isEmpty()) {
    // 3. Export from SQLite
    const legacyData = await exportLegacySQLiteData()
    
    // 4. Import to new backend
    await this.backend.importAll(legacyData)
    
    // 5. Archive old database
    rename('memory.db', 'memory.db.backup')
  }
}
```

### MCP Tool Integration

Memory is exposed as MCP tools for AI agent access:

**Available Tools:**
- `memory_create_entity` - Store facts about people, projects, preferences
- `memory_create_relation` - Link entities with relationships
- `memory_search` - Semantic search across knowledge graph

**In-Process Integration:**

```mermaid
graph LR
    subgraph "Renderer"
        Agent[AI Agent]
    end
    
    subgraph "Main Process"
        MCPHandler[MCP IPC Handler]
        MemorySvc[MemoryService]
        Backend[UnifiedMemoryBackend]
    end
    
    Agent -->|Tool Call| MCPHandler
    MCPHandler -->|In-Process| MemorySvc
    MemorySvc --> Backend
    Backend -->|Result| MemorySvc
    MemorySvc -->|Response| Agent
```

All memory operations go through in-process handlers (no external MCP server needed for memory).

### Data Model

```typescript
// Entity - A fact or concept
interface Entity {
  id: string                    // UUID
  name: string                  // e.g., "TypeScript Project"
  type: string                  // e.g., "project", "person", "preference"
  description: string           // Human-readable description
  observations: string[]        // Facts about this entity
  metadata: Record<string, any> // Extensible (future: workspace, project)
  createdAt: Date
  updatedAt: Date
}

// Relation - Connection between entities
interface Relation {
  id: string
  fromEntityId: string
  toEntityId: string
  relationType: string          // e.g., "works_on", "prefers", "uses"
  description?: string
  weight?: number               // Strength of relation
}
```

### Configuration

```typescript
// MemoryServiceFactory.ts - Configuration
interface MemoryConfig {
  backend: 'server-memory' | 'memento-mcp'
  
  serverMemory?: {
    storagePath: string  // JSON storage location
  }
  
  memento?: {
    neo4jUri: string
    username: string
    password: string
  }
  
  autoMigration?: {
    enabled: boolean
    thresholds: {
      entityCount: number
      searchLatencyMs: number
      storageSizeMB: number
    }
  }
}
```

Configuration is stored in `electron-store` and can be changed to switch backends:

```typescript
// Switch from server-memory to memento-mcp
await MemoryServiceFactory.switchBackend('memento-mcp')
```

### IPC Handlers

Memory-specific IPC handlers for stats and export:

| IPC Channel | Handler | Purpose |
|-------------|---------|---------|
| `memory:get-stats` | `memory.ts` | Get entity count, storage size, latency |
| `memory:export-all` | `memory.ts` | Export all data (backup/migration) |

Memory tool calls (`memory_create_entity`, etc.) go through the standard `mcp:call-tool` channel with in-process routing.

### Files

**Core Architecture:**
- [`UnifiedMemoryBackend.ts`](file:///Users/suhail/ai-worker-app/src/main/services/memory/UnifiedMemoryBackend.ts) - Backend interface
- [`MemoryServiceFactory.ts`](file:///Users/suhail/ai-worker-app/src/main/services/memory/MemoryServiceFactory.ts) - Backend factory
- [`MemoryService.ts`](file:///Users/suhail/ai-worker-app/src/main/services/MemoryService.ts) - Main service (refactored)

**Adapters:**
- [`ServerMemoryAdapter.ts`](file:///Users/suhail/ai-worker-app/src/main/services/memory/adapters/ServerMemoryAdapter.ts) - server-memory wrapper
- [`MementoMCPAdapter.ts`](file:///Users/suhail/ai-worker-app/src/main/services/memory/adapters/MementoMCPAdapter.ts) - memento-mcp (skeleton)

**Privacy:**
- [`PIIDetector.ts`](file:///Users/suhail/ai-worker-app/src/main/services/memory/privacy/PIIDetector.ts) - PII detection
- [`SecretRedactor.ts`](file:///Users/suhail/ai-worker-app/src/main/services/memory/privacy/SecretRedactor.ts) - Secret detection

**Metrics & Migration:**
- [`MetricsCollector.ts`](file:///Users/suhail/ai-worker-app/src/main/services/memory/MetricsCollector.ts) - Usage tracking
- [`MigrationService.ts`](file:///Users/suhail/ai-worker-app/src/main/services/memory/MigrationService.ts) - Migration logic

**IPC:**
- [`memory.ts`](file:///Users/suhail/ai-worker-app/src/main/ipc/memory.ts) - Memory IPC handlers

---

## Storage Architecture

### Storage Layers

```mermaid
graph TB
    subgraph "Renderer Storage"
        LocalStorage[localStorage<br/>Browser Storage]
        ZustandPersist[Zustand Persist<br/>Automatic Sync]
    end

    subgraph "Main Process Storage"
        ElectronStore[electron-store<br/>Cross-Platform]
        FileSystem[File System<br/>OS-Specific Paths]
    end

    subgraph "Storage Locations"
        MacPath[macOS<br/>~/Library/Application Support/ai-worker/]
        WinPath[Windows<br/>%APPDATA%/ai-worker/]
        LinuxPath[Linux<br/>~/.config/ai-worker/]
    end

    ZustandPersist --> LocalStorage
    ElectronStore --> FileSystem
    FileSystem --> MacPath
    FileSystem --> WinPath
    FileSystem --> LinuxPath
```

### Data Persistence Strategy

```mermaid
graph LR
    subgraph "Chat Data"
        ChatStore[chatStore]
        ChatLocalStorage[localStorage<br/>ai-worker-chat]
    end

    subgraph "Settings Data"
        SettingsStore[settingsStore]
        SettingsLocalStorage[localStorage<br/>ai-worker-settings]
    end

    subgraph "MCP Servers"
        MCPLib[mcp.ts]
        MCPStorage[localStorage<br/>mcp_servers]
        DefaultServers[Default Servers<br/>Auto-initialized]
    end

    DefaultServers --> MCPLib

    subgraph "API Keys & Secrets"
        SettingsStore2[settingsStore<br/>Memory: Cleared on Logout]
        ElectronStore2[electron-store<br/>Disk: User-Scoped]
    end

    ChatStore --> ChatLocalStorage
    SettingsStore --> SettingsLocalStorage
    MCPLib --> MCPStorage
    SettingsStore2 -->|"Read/Write (user_{uid}_key)"| ElectronStore2
```

### User-Scoped Persistence Strategy

To balance security and convenience, sensitive data like API keys follows a strict scoping strategy:

1.  **Encrypted Storage**: API keys are stored using Electron's `safeStorage` API, which encrypts data using the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service).
2.  **User Scoping**: Secrets are prefixed with the User ID (e.g., `user_123_openai_api_key`). This allows multiple users to share a device without leaking secrets.
3.  **Memory State**: When a user logs in, their scoped secrets are loaded into the store state (decrypted).
4.  **Logout**: When a user logs out, the store state is **cleared** from memory, preventing unauthorized access. The encrypted file on disk remains for their return.
5.  **Key Blocking**: The general `store:get/set` IPC handlers block access to sensitive keys (containing `api_key`, `secret`, `token`, `password`). These must go through `secure:get/set` handlers.

**Files involved:**
- [secure.ts](file:///Users/suhail/ai-worker-app/src/main/ipc/secure.ts) - Encryption handlers
- [store.ts](file:///Users/suhail/ai-worker-app/src/main/ipc/store.ts) - Key blocking logic
- [settingsStore.ts](file:///Users/suhail/ai-worker-app/src/renderer/src/stores/settingsStore.ts) - Uses secure storage

---

## Security Architecture

### Security Boundaries

```mermaid
graph TB
    subgraph "Renderer Process<br/>Sandboxed"
        ReactUI[React UI]
        BrowserAPIs[Browser APIs Only]
    end

    subgraph "Preload Script<br/>Isolated Context"
        ContextBridge[Context Bridge<br/>Secure API Exposure]
    end

    subgraph "Main Process<br/>Full Node.js Access"
        IPC[IPC Handlers]
        SystemAccess[System Access]
    end

    ReactUI -->|No Direct Access| BrowserAPIs
    ReactUI -->|Via Context Bridge| ContextBridge
    ContextBridge -->|IPC Only| IPC
    IPC --> SystemAccess

    style ReactUI fill:#90EE90
    style ContextBridge fill:#FFD700
    style IPC fill:#FF6B6B
```

### Content Security Policy

```mermaid
graph LR
    subgraph "CSP Rules"
        Localhost[Allow localhost:*<br/>Ollama, Local Services]
        HTTPS[Allow https://*<br/>OpenAI, External APIs]
        WSS[Allow wss://*<br/>WebSocket, Speech API]
        Media[Allow media-src<br/>Audio for TTS]
    end

    subgraph "Blocked"
        InlineScripts[Block Inline Scripts]
        Eval[Block eval()]
        UnsafeInline[Block unsafe-inline]
    end

    Localhost --> Security
    HTTPS --> Security
    WSS --> Security
    Media --> Security
    InlineScripts --> Security
    Eval --> Security
    UnsafeInline --> Security
```

### Antigravity Gateway Security

The Antigravity integration follows a "Privileged Proxy" model:
1. **OAuth Isolation**: OAuth tokens are handled exclusively by the `AntigravityAuthService` in the main process. The renderer never sees the refresh token or client secret.
2. **Gateway Proxying**: To avoid CORS issues and protect credentials, all calls to the Antigravity/Google Cloud Code Assist API are proxied through a dedicated IPC channel (`antigravity:call-gateway`).
3. **Internal Projects**: The service automatically resolves the correct Google Cloud Project ID needed for the gateway, falling back to a pre-authorized default for seamless onboarding.

---

## Firebase Authentication

AI-Worker uses Firebase Authentication with Google Sign-in for optional user identification. Authentication is feature-flagged via `AUTH_ENABLED`.

### Authentication Architecture

```mermaid
sequenceDiagram
    participant User
    participant App
    participant Firebase Auth
    participant App Check
    
    User->>App: Click Sign In
    App->>Firebase Auth: signInWithPopup(GoogleProvider)
    Firebase Auth->>User: Google OAuth Consent
    User->>Firebase Auth: Grant Permission
    Firebase Auth->>App Check: Validate App Token
    App Check->>Firebase Auth: Token Valid
    Firebase Auth->>App: User Credential
    App->>App: Store user in authStore
    App->>User: Show authenticated state
```

### Security Layers

| Layer | Purpose | Implementation |
|-------|---------|----------------|
| **Firebase Auth** | User identity | Google Sign-in via popup |
| **App Check** | Request validation | reCAPTCHA Enterprise |
| **Security Rules** | Data access control | Firestore rules |
| **Feature Flags** | Gradual rollout | `AUTH_ENABLED` flag |

### LLM Provider Compatibility (Gemini Fixes)

The system includes a **Strict Message Transformer** in `llm.ts` to normalize message history for providers with rigid API requirements:

- **Gemini Role Mapping**: Automatically maps `tool` roles to `user` and merges consecutive messages of the same role to prevent "Unexpected Role Alternation" errors.
- **Tool ID Tracking**: Maintains a persistent mapping of `tool_call_id` to function names to ensure Gemini's `functionResponse` blocks include the mandatory name field even when not explicitly provided in the internal history.
- **JSON Fallback**: Seamlessly switches to prompt-based JSON tool calling for models without native tool support.

### Why Firebase API Keys Are Safe to Bundle

Firebase API keys are **designed to be public** because:

1. They only identify the Firebase project (not authorize access)
2. Security is enforced by **Firebase Security Rules**
3. **App Check** validates requests come from legitimate apps
4. Authentication is required for data access

### App Check Integration

App Check prevents abuse by verifying requests originate from authentic apps:

```mermaid
graph LR
    subgraph "App Check Flow"
        App[AI-Worker App]
        reCAPTCHA[reCAPTCHA Enterprise]
        Firebase[Firebase Services]
    end
    
    App -->|Request Token| reCAPTCHA
    reCAPTCHA -->|App Check Token| App
    App -->|Token + Request| Firebase
    Firebase -->|Verify Token| reCAPTCHA
    Firebase -->|Allow/Deny| App
```

- **Development**: Use debug tokens from Firebase Console
- **Production**: reCAPTCHA Enterprise provider
- Auto-refresh enabled for seamless token rotation

### Firestore Security Rules

Security rules enforce user-scoped data access:

```javascript
// Users can only access their own data
match /users/{userId} {
  allow read, write: if request.auth != null 
                      && request.auth.uid == userId;
}

// All other access denied by default
match /{document=**} {
  allow read, write: if false;
}
```

Rules file: [firestore.rules](file:///Users/suhail/ai-worker-app/firestore.rules)

### Configuration

Required environment variables (`.env`):

| Variable | Description |
|----------|-------------|
| `VITE_FIREBASE_API_KEY` | Firebase project API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Auth domain (`project.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |
| `VITE_RECAPTCHA_SITE_KEY` | reCAPTCHA Enterprise site key (optional) |

See `.env.example` for full template.

---

## Build & Distribution

### Build Architecture

```mermaid
graph TB
    subgraph "Source Code"
        TypeScript[TypeScript Source]
        React[React Components]
        Assets[Static Assets]
    end

    subgraph "Build Process"
        ElectronVite[electron-vite<br/>Build Tool]
        Vite[Vite<br/>Frontend Bundler]
        TSC[TypeScript Compiler]
    end

    subgraph "Output"
        MainOut[out/main/<br/>Main Process]
        PreloadOut[out/preload/<br/>Preload Script]
        RendererOut[out/renderer/<br/>Renderer Bundle]
    end

    subgraph "Packaging"
        ElectronBuilder[electron-builder]
        MacBuild[macOS<br/>DMG + ZIP]
        WinBuild[Windows<br/>NSIS + Portable]
        LinuxBuild[Linux<br/>AppImage + deb]
    end

    TypeScript --> ElectronVite
    React --> ElectronVite
    Assets --> ElectronVite
    ElectronVite --> Vite
    ElectronVite --> TSC
    Vite --> RendererOut
    TSC --> MainOut
    TSC --> PreloadOut
    MainOut --> ElectronBuilder
    PreloadOut --> ElectronBuilder
    RendererOut --> ElectronBuilder
    ElectronBuilder --> MacBuild
    ElectronBuilder --> WinBuild
    ElectronBuilder --> LinuxBuild
    
### Cross-Platform Build Support

AI-Worker supports building for Windows from a Linux environment using Wine. This is integrated into the build process to ensure seamless CI/CD and local development compatibility.

**Windows Build Flow on Linux:**

1. **Dependency Check:** `npm run check:wine` verifies if Wine is installed.
2. **Environment Setup:** 
   - `install_build_deps.sh`: Helper to install Wine if missing.
   - `fix_wine_env.sh`: Troubleshooting tool to reset corrupted Wine prefixes.
3. **Build Execution:** `electron-builder` uses Wine to sign and package the Windows executable (`.exe`).

```bash
# Workflow
./install_build_deps.sh  # One-time setup
npm run build:win        # Builds .exe using Wine
```
```

### Distribution Structure

```mermaid
graph LR
    subgraph "macOS"
        DMG[AI-Worker.dmg<br/>~97 MB]
        ZIP[AI-Worker.zip<br/>~92 MB]
    end

    subgraph "Windows"
        NSIS[AI-Worker Setup.exe<br/>~79 MB]
        Portable[AI-Worker.exe<br/>~79 MB]
    end

    subgraph "Linux"
        AppImage[AI-Worker.AppImage<br/>~105 MB]
        DEB[ai-worker.deb<br/>~68 MB]
    end

    DMG --> Distribution
    ZIP --> Distribution
    NSIS --> Distribution
    Portable --> Distribution
    AppImage --> Distribution
    DEB --> Distribution
```

---

## Technology Stack

### Core Technologies

| Layer           | Technology                | Version | Purpose                       |
| --------------- | ------------------------- | ------- | ----------------------------- |
| **Framework**   | Electron                  | 28.2.0  | Desktop application framework |
| **Frontend**    | React                     | 18.2.0  | UI library                    |
| **Language**    | TypeScript                | 5.3.3   | Type-safe development         |
| **Styling**     | Tailwind CSS              | 3.4.1   | Utility-first CSS             |
| **State**       | Zustand                   | 5.0.9   | State management              |
| **Build**       | electron-vite             | 2.0.0   | Build tooling                 |
| **MCP**         | @modelcontextprotocol/sdk | 1.0.1   | MCP client library            |
| **Storage**     | electron-store            | 11.0.2  | Cross-platform storage        |
| **Environment** | fix-path                  | 5.0.0   | PATH resolution               |

### Development Tools

| Tool             | Purpose               |
| ---------------- | --------------------- |
| Vite             | Fast frontend bundler |
| TypeScript       | Type checking         |
| electron-builder | Application packaging |
| PostCSS          | CSS processing        |
| Autoprefixer     | CSS vendor prefixes   |

---

## File Structure

```
ai-worker-app/
├── src/
│   ├── main/                    # Main Process
│   │   ├── index.ts            # App entry point
│   │   ├── ipc/                 # IPC handlers
│   │   │   ├── index.ts        # Handler registration
│   │   │   ├── app.ts          # App info & shell
│   │   │   ├── mcp.ts          # MCP operations
│   │   │   ├── llm.ts          # LLM operations
│   │   │   └── store.ts        # Storage operations
│   │   └── utils/
│   │       └── env.ts          # Environment setup
│   ├── preload/                 # Preload Script
│   │   └── index.ts            # Context bridge
│   └── renderer/                # Renderer Process
│       └── src/
│           ├── App.tsx          # Root component
│           ├── components/      # UI components
│           ├── hooks/           # React hooks
│           ├── lib/             # Library modules
│           └── stores/         # Zustand stores
├── out/                         # Build output
├── dist/                        # Distribution packages
└── package.json                 # Dependencies
```

---

## Key Design Decisions

### 1. Multi-Process Architecture

- **Decision:** Use Electron's multi-process model
- **Rationale:** Security isolation, better performance, system access control

### 2. Context Isolation

- **Decision:** Enable context isolation with preload script
- **Rationale:** Security best practice, prevents renderer from accessing Node.js directly

### 3. Modular IPC Handlers

- **Decision:** Split IPC handlers into separate modules
- **Rationale:** Better maintainability, easier testing, clear separation of concerns

### 4. Zustand for State Management

- **Decision:** Use Zustand instead of Redux
- **Rationale:** Simpler API, less boilerplate, built-in persistence

### 5. Renderer-Side LLM Calls

- **Decision:** Make LLM API calls from renderer process
- **Rationale:** Simpler implementation, direct fetch API access, future main-process option available

### 6. Local-First Storage

- **Decision:** Use localStorage and electron-store
- **Rationale:** Privacy-focused, no cloud dependency, fast access

### 7. MCP in Main Process

- **Decision:** Handle MCP connections in main process
- **Rationale:** System-level access needed, better security, proper process management

---

## Future Architecture Considerations

### Planned Enhancements

1. **Main Process LLM Handling**

   - Move LLM calls to main process for better security
   - Implement streaming responses
   - Add request queuing

2. **Browser LLM Integration**

   - Full Gemini Nano/Phi support
   - Browser API integration
   - Local-first LLM priority

3. **Enhanced MCP Features**

   - Resource discovery
   - Prompt templates
   - Sampling support

4. **Authentication System**

   - Firebase Auth integration
   - Rate limiting enforcement
   - User preferences sync

5. **Plugin System**
   - Custom MCP server templates
   - UI extensions
   - Custom LLM providers

---

## Performance Considerations

### Optimization Strategies

1. **Code Splitting**

   - Component-based lazy loading
   - Route-based code splitting
   - Dynamic imports for heavy modules

2. **State Management**

   - Selective re-renders with Zustand
   - Memoization of expensive computations
   - Efficient persistence strategies

3. **IPC Communication**

   - Batch operations where possible
   - Async/await for non-blocking calls
   - Error handling and retries

4. **MCP Connections**
   - Connection pooling
   - Lazy connection establishment
   - Automatic reconnection logic

---

## Security Considerations

### Security Measures

1. **Context Isolation**

   - Renderer cannot access Node.js directly
   - All system access via IPC

2. **Content Security Policy**

   - Strict CSP headers
   - No inline scripts
   - Whitelisted domains only

3. **API Key Storage**

   - Secure storage via electron-store
   - No exposure to renderer
   - Encrypted at rest (OS-level)

4. **Permission Handling**
   - Explicit permission requests
   - Minimal required permissions
   - User-controlled access

---

**Last Updated:** 2026-02-27  
**Version:** 0.1.0  
**Architecture Version:** 1.1

**Recent Updates:**

- Added default MCP server configuration (Playwright, Sequential Thinking)
- Implemented automatic server initialization on first run
- Added form pre-filling with Sequential Thinking defaults
- Enhanced server management with automatic default restoration
- **Prompt Engineering**: Updated System Prompt with "Global Friendly" communication style and screenshot rules.
- **Task Analysis**: Enhanced confirmation logic for high-risk and ambiguous tasks (shopping, payments).
- **Universal Resilience**: Implemented Global Self-Healing middleware for automated recovery from flaky web pages.
- **Concurrency Safety**: Implemented Keyed Resource Locking for safe parallel tool execution.
- **Sub-Agent Isolation**: Added dedicated tab provisioning and session scoping for browser sub-tasks.
- **Parallel Dispatch**: Enhanced `AgentRuntime` and `prompt-library` to support and enforce concurrent sub-agent execution.
- **Gemini Stability**: Refactored `llm.ts` with role-merging and name-tracking logic to resolve Gemini API strictly-alternating role requirements.
- **Progress Checkpoints**: Standardized increment reporting via `update_progress_summary` mandatory checkpoints every 5-15 steps.
- **Token Resilience**: Implemented 5,000ch tool output truncation with automated "Strategic Tips" for agent self-correction.
- **Session Privacy**: Finalized session-level data isolation and auto-cleanup architecture.
- **Antigravity Gateway**: Integrated Google OAuth flow and Cloud Code Assist API for high-limit Gemini access.
- **Modular LLM Refactor**: Transitioned to a provider-based directory structure (`lib/llm/`) with isolated logic for Gemini, OpenAI, and Ollama.
- **Universal Reasoning Filter**: Added `thinkBlockFilter` to strip internal thinking blocks from all LLM outputs.
- **Self-Healing Tool Loop**: Enhanced `ToolExecutionService` with 8 context-aware recovery strategies for browser automation.
- **Secure Storage**: Implemented user-scoped, OS-level encrypted storage for all LLM API keys and OAuth tokens.

---

## Known Challenges & Solutions

---

## Known Challenges & Solutions

### Speech Recognition (Vosk Integration)

During the implementation of offline speech recognition using `vosk-browser`, several critical issues were encountered and resolved. These are documented here for future reference.

#### 1. Silent Transcription (Web Audio API)
- **Issue**: The `onaudioprocess` event (or `AudioWorklet`) would not fire, causing the speech recognizer to receive no data, even though the microphone stream was active.
- **Root Cause**: Modern browsers (and Electron) optimize resources by pausing the audio clock if the audio graph does not eventually connect to the `AudioContext.destination` (speakers).
- **Solution**: We created a "mute" connection to fool the browser. The processing graph is connected to a `GainNode` with `gain.value = 0`, which is then connected to `destination`. This forces the audio engine to run without producing feedback loop noise.
  ```typescript
  // Trick browser into running the audio clock
  const muteNode = audioContext.createGain()
  muteNode.gain.value = 0
  processor.connect(muteNode)
  muteNode.connect(audioContext.destination)
  ```

#### 2. Model Archive Format
- **Issue**: `vosk-browser` (WASM) failed to load the model with "Unrecognized archive format" when pointed to an extracted directory.
- **Root Cause**: The WASM version of Vosk specifically utilizes a virtual file system and prefers loading from a single `.zip` file URL to avoid hundreds of individual HTTP requests for model files.
- **Solution**: Updated `ModelServer` to serve the original `.zip` file with `application/zip` content type, and updated `ModelManager` to preserve the downloaded `.zip` file instead of deleting it after extraction.

#### 3. URL Construction
- **Issue**: 404 Errors when fetching model files.
- **Root Cause**: A typo in the URL construction (`${baseUrl} / ${modelName}.zip`) introduced spaces into the URL path, which the server naturally treated as part of the filename.
- **Solution**: Removed spaces to ensure valid URL paths (`${baseUrl}/${modelName}.zip`).

#### 4. Extraction Commands
- **Issue**: Model extraction failed initially.
- **Root Cause**: A typo in the unzip command flags (`unzip - o` instead of `unzip -o`).
- **Solution**: corrected the command execution string.