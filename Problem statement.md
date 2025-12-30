# AI-Worker: Problem Statement & Requirements

AI-Worker is a voice-first desktop workspace designed to revolutionize productivity by integrating Large Language Models (LLMs) with everyday applications and files using the Model Context Protocol (MCP). We are currently in the active MVP development stage, providing high-performance orchestration via secure cloud-based LLM connectivity.

---

## Problem Statement

- **AI assistants are siloed and text-heavy.** Traditional AI assistants operate in isolation, requiring users to switch between applications and rely primarily on text-based interactions.
- **Lack of seamless integration with enterprise tools.** Existing solutions don't bridge the gap between AI capabilities and local tools, files, and workflows.
- **Privacy concerns with cloud-only data exposure.** Users are forced to send sensitive data to cloud services without local processing options.

---

## The Solution

A universal bridge using MCP to connect state-of-the-art LLMs (Cloud) to local apps. This hybrid model ensures maximum capability today while architecting for a local-first future.

---

## Compute Strategy

"If users' systems are capable of running local LLMs, and with the anticipated availability of lightweight machine-runnable LLMs (e.g., Chrome Gemini Nano or Phi models on Chrome and Edge browsers), AI-Worker will support fully privacy-focused operation locally at that time."

---

## Functional Requirements

### 1. Voice-First Interface

#### 1.1 Speech Recognition (STT)
- ✅ **Push-to-talk voice input** - Click microphone button to start/stop recording
- ✅ **Real-time transcription** - Speech converted to text as user speaks
- ✅ **Web Speech API integration** - Browser-native speech recognition
- ✅ **Multi-language support** - Configurable speech language (default: en-US)
- ✅ **Microphone permission handling** - Automatic permission requests

#### 1.2 Text-to-Speech (TTS)
- ✅ **Voice readout of AI responses** - Automatic TTS for assistant messages
- ✅ **Mute toggle** - User can disable TTS output
- ✅ **Voice selection** - Configurable TTS voice from system voices
- ✅ **Rate and pitch control** - Adjustable speech rate and pitch
- ✅ **Feature flag control** - TTS can be globally enabled/disabled

### 2. Chat Interface

#### 2.1 Message Management
- ✅ **Dual input methods** - Voice and text input support
- ✅ **Message history** - Persistent chat history across sessions
- ✅ **Message persistence** - Chat history saved to localStorage
- ✅ **Clear chat functionality** - User can clear conversation history
- ✅ **Message timestamps** - Each message includes timestamp
- ✅ **Message roles** - Support for user, assistant, and system messages

#### 2.2 UI Components
- ✅ **Chat view** - Dedicated chat interface with message bubbles
- ✅ **Message bubbles** - Visual distinction between user and assistant messages
- ✅ **Processing indicators** - Visual feedback during LLM processing
- ✅ **Error handling** - User-friendly error messages displayed in chat

### 3. LLM Integration

#### 3.1 Multi-Provider Support
- ✅ **Ollama integration** - Local LLM support via Ollama API
  - Default model: `qwen2.5:3b`
  - Configurable base URL (default: `http://localhost:11434`)
  - Model selection support
- ✅ **OpenAI-compatible API** - Support for OpenAI and compatible services
  - API key management
  - Custom base URL support
  - Default model: `gpt-4o-mini`
- ✅ **Browser LLM detection** - Support for Gemini Nano/Phi (feature-flagged)
- ✅ **Provider auto-selection** - Automatic fallback between providers
- ✅ **Provider priority** - Browser → Ollama → OpenAI fallback chain

#### 3.2 LLM Configuration
- ✅ **Provider selection** - User can choose preferred provider (auto/ollama/openai/browser)
- ✅ **API key management** - Secure storage of OpenAI API keys
- ✅ **Model configuration** - Per-provider model selection
- ✅ **Status indicators** - Real-time LLM availability status in header
- ✅ **Provider health checks** - Automatic provider availability detection

### 4. Model Context Protocol (MCP) Integration

#### 4.1 MCP Server Management
- ✅ **Generic server connection** - Support for any MCP-compatible server
- ✅ **Stdio transport** - Local command-line server support
  - Command execution (node, python, npx, etc.)
  - Arguments configuration
  - Environment variable inheritance
  - Stderr inheritance for debugging
- ✅ **SSE transport** - Server-Sent Events for remote servers
  - URL-based connection
  - Remote server support
- ✅ **Server configuration** - Add, edit, and remove MCP servers
- ✅ **Server persistence** - Server configurations saved across sessions
- ✅ **Connection state management** - Connect/disconnect functionality
- ✅ **Error handling** - Actionable error messages with installation instructions

#### 4.2 MCP Tool Management
- ✅ **Tool discovery** - Automatic tool listing from connected servers
- ✅ **Tool display** - Visual representation of available tools
- ✅ **Tool execution** - Call MCP tools with arguments
- ✅ **Tool metadata** - Display tool names and descriptions

#### 4.3 MCP UX Enhancements
- ✅ **Server cards** - Visual server representation with status indicators
- ✅ **Expandable server details** - View tools and server information
- ✅ **Edit configuration** - Update server settings without re-creation
- ✅ **Troubleshooting support** - AI-assisted troubleshooting for connection errors
- ✅ **Installation instructions** - Platform-specific dependency installation guides
- ✅ **Connection status** - Real-time connection state (Active/Offline/Error)

### 5. Settings & Configuration

#### 5.1 LLM Settings
- ✅ **Provider selection** - Choose preferred LLM provider
- ✅ **Ollama configuration** - Model and base URL settings
- ✅ **OpenAI configuration** - API key, base URL, and model settings
- ✅ **Provider status display** - Real-time availability checking

#### 5.2 Voice Settings
- ✅ **TTS enable/disable** - Toggle text-to-speech
- ✅ **Voice selection** - Choose from available system voices
- ✅ **Speech rate** - Adjustable speech speed (default: 1.0)
- ✅ **Speech pitch** - Adjustable voice pitch (default: 1.0)
- ✅ **Speech language** - Configurable recognition language

#### 5.3 Appearance Settings
- ✅ **Theme selection** - Dark/Light/System theme support
- ✅ **Theme persistence** - Theme preference saved across sessions

#### 5.4 Account Settings (Feature-Flagged)
- ✅ **Firebase Auth integration** - Google Sign-in support (disabled by default)
- ✅ **Authentication state** - User login/logout functionality
- ✅ **Rate limiting** - Configurable limits for anonymous users
  - Anonymous: 10 chats/day, 20 MCP operations/hour
  - Authenticated: Unlimited usage

### 6. Navigation & UI

#### 6.1 Sidebar Navigation
- ✅ **View switching** - Chat, Connections, Settings views
- ✅ **Icon-based navigation** - Visual navigation with icons
- ✅ **Active state indication** - Visual feedback for current view

#### 6.2 Header
- ✅ **LLM status indicator** - Real-time provider availability
- ✅ **Connection status** - Visual connection state indicators
- ✅ **Session indicator** - Local session status display

### 7. Data Persistence

#### 7.1 Storage
- ✅ **Chat history persistence** - Messages saved to localStorage
- ✅ **Settings persistence** - All settings saved across sessions
- ✅ **MCP server persistence** - Server configurations saved
- ✅ **Cross-platform storage** - electron-store for system-specific paths
  - macOS: `~/Library/Application Support/ai-worker/`
  - Windows: `%APPDATA%/ai-worker/`
  - Linux: `~/.config/ai-worker/`

### 8. Cross-Platform Support

#### 8.1 Build & Distribution
- ✅ **macOS support** - DMG and ZIP distribution
- ✅ **Windows support** - NSIS installer and portable EXE
- ✅ **Linux support** - AppImage and deb package formats
- ✅ **Auto-update infrastructure** - Electron updater configuration

#### 8.2 Platform-Specific Features
- ✅ **PATH resolution** - fix-path integration for GUI-launched apps
- ✅ **Environment variable handling** - Proper PATH inheritance for MCP servers
- ✅ **Node.js runtime detection** - Fallback to Electron's internal Node.js

---

## Non-Functional Requirements

### 1. Performance

#### 1.1 Response Time
- ✅ **Low-latency voice input** - Real-time speech recognition
- ✅ **Efficient LLM communication** - Optimized API calls with error handling
- ✅ **Fast UI rendering** - React with optimized re-renders
- ✅ **Provider health checks** - 30-second interval for status updates

#### 1.2 Resource Management
- ✅ **Memory efficiency** - Zustand state management with persistence
- ✅ **Connection pooling** - Efficient MCP client connection management
- ✅ **Lazy loading** - Component-based code splitting

### 2. Security

#### 2.1 Data Protection
- ✅ **Local-first architecture** - Data stored locally by default
- ✅ **API key security** - Secure storage of credentials
- ✅ **Zero Trust design** - No central data collection
- ✅ **Content Security Policy** - CSP headers for Electron security
  - Allows localhost connections for Ollama
  - Allows HTTPS for external APIs
  - Allows WebSocket for Speech API

#### 2.2 Privacy
- ✅ **Anonymous mode** - Works without authentication
- ✅ **Local processing** - Support for local LLMs (Ollama)
- ✅ **No telemetry** - Privacy-focused, no tracking
- ✅ **User data control** - All data stored locally

### 3. Usability

#### 3.1 User Experience
- ✅ **Intuitive navigation** - Clear sidebar and view switching
- ✅ **Visual feedback** - Loading states, status indicators, error messages
- ✅ **Accessibility** - Keyboard navigation support
- ✅ **Error messages** - Actionable, user-friendly error descriptions
- ✅ **Installation guidance** - Platform-specific dependency installation help

#### 3.2 Interface Design
- ✅ **Modern UI** - Tailwind CSS with dark theme
- ✅ **Responsive layout** - Flexible component layout
- ✅ **Icon system** - Lucide React icons for visual clarity
- ✅ **Color coding** - Status indicators with color (green/yellow/red)

### 4. Reliability

#### 4.1 Error Handling
- ✅ **Graceful degradation** - Fallback between LLM providers
- ✅ **Connection retry logic** - MCP connection error handling
- ✅ **Error recovery** - User-friendly error messages with solutions
- ✅ **Validation** - Input validation for server configurations

#### 4.2 Stability
- ✅ **Type safety** - TypeScript throughout codebase
- ✅ **State management** - Zustand for predictable state
- ✅ **IPC communication** - Secure Electron IPC handlers
- ✅ **ESM compatibility** - Proper ESM shims for Node.js

### 5. Maintainability

#### 5.1 Code Organization
- ✅ **Modular architecture** - Separated IPC handlers, components, stores
- ✅ **Component reusability** - Reusable UI components (Header, Sidebar, Cards)
- ✅ **Separation of concerns** - Clear boundaries between main/renderer processes
- ✅ **Type definitions** - Comprehensive TypeScript types

#### 5.2 Developer Experience
- ✅ **Feature flags** - Easy feature toggling via constants
- ✅ **Configuration management** - Centralized constants file
- ✅ **Build system** - electron-vite for fast development
- ✅ **Hot reload** - Development server with HMR

### 6. Scalability

#### 6.1 Extensibility
- ✅ **Plugin architecture** - MCP server support for extensibility
- ✅ **Provider abstraction** - Easy to add new LLM providers
- ✅ **Transport abstraction** - Support for multiple MCP transport types
- ✅ **Feature flag system** - Easy feature enablement/disablement

#### 6.2 Future-Proofing
- ✅ **Local-first design** - Ready for local LLM integration
- ✅ **Browser LLM support** - Prepared for Gemini Nano/Phi
- ✅ **Authentication ready** - Firebase Auth infrastructure in place
- ✅ **Rate limiting framework** - Ready for production rate limits

### 7. Compatibility

#### 7.1 Browser Compatibility
- ✅ **Web Speech API** - Standard browser APIs
- ✅ **Modern JavaScript** - ES6+ features
- ✅ **Electron compatibility** - Electron 30+ support

#### 7.2 System Compatibility
- ✅ **macOS** - 10.15+ (Catalina and later)
- ✅ **Windows** - Windows 10+
- ✅ **Linux** - Modern distributions with AppImage/deb support

---

## Key Features (Expanded)

### MCP Connector
- ✅ Bridge cloud brains to local tools and files
- ✅ Generic server support (Stdio & SSE)
- ✅ Visual server management interface
- ✅ Tool discovery and execution
- ✅ Connection state management
- ✅ Error handling with actionable guidance

### Voice Native
- ✅ Full system control via low-latency voice UX
- ✅ Push-to-talk interface
- ✅ Real-time transcription
- ✅ Text-to-speech readout
- ✅ Configurable voice settings

### Hybrid Privacy
- ✅ Zero Trust architecture for data processing
- ✅ Local-first data storage
- ✅ Support for local LLMs (Ollama)
- ✅ Anonymous mode operation
- ✅ No telemetry or tracking

### Cross Platform
- ✅ Native support for Mac, Windows, and Linux desktops
- ✅ Platform-specific builds (DMG, EXE, AppImage, deb)
- ✅ Cross-platform storage paths
- ✅ Platform-aware error messages

### Agentic Workflows
- ✅ Autonomous execution of complex tool chains
- ✅ MCP tool integration
- ✅ LLM tool calling support
- ✅ Multi-step workflow capability

### Secure Context
- ✅ End-to-end encrypted model communications (via HTTPS)
- ✅ Local API key storage
- ✅ Content Security Policy enforcement
- ✅ Secure IPC communication

---

## Technical Architecture

### Frontend Stack
- **Framework:** React 18.2.0
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **State Management:** Zustand with persistence
- **Icons:** Lucide React
- **Build Tool:** electron-vite

### Backend Stack
- **Runtime:** Electron (Main process)
- **MCP SDK:** @modelcontextprotocol/sdk 1.0.1
- **Storage:** electron-store 11.0.2
- **Environment:** fix-path 5.0.0

### Voice Stack
- **STT:** Web Speech API (SpeechRecognition)
- **TTS:** Web Speech API (SpeechSynthesis)

### LLM Providers
- **Ollama:** Local LLM support
- **OpenAI:** Cloud LLM support
- **Browser:** Future Gemini Nano/Phi support

---

## Implementation Status

### Completed Phases (1-12)
- ✅ Phase 1: Project Setup
- ✅ Phase 2: Voice & Text Input
- ✅ Phase 3: Chat Messages & State
- ✅ Phase 4: LLM Integration
- ✅ Phase 5: MCP Client
- ✅ Phase 6: Settings Panel
- ✅ Phase 7: Auth & Rate Limiting (Feature-Flagged)
- ✅ Phase 8: Polish & Cross-Platform
- ✅ Phase 9: Real MCP Client
- ✅ Phase 10: Robustness & DX
- ✅ Phase 11: Code Refactoring & Architecture Improvement
- ✅ Phase 12: Feature Flag Enhancements

### Current Status
**Production-ready with modular architecture and enhanced feature flags.** All core features implemented and tested, including validated feature flags and TTS controls. Codebase refactored for maintainability. Cross-platform builds verified for Mac, Windows, and Linux.

---

## Feature Flags

```typescript
AUTH_ENABLED: false              // Firebase Auth (ready but disabled)
RATE_LIMITING_ENABLED: false     // Rate limiting (ready but disabled)
TTS_ENABLED: true                // Text-to-speech (active)
BROWSER_LLM_ENABLED: true        // Browser LLM detection and implementation (active)
OLLAMA_ENABLED: true             // Ollama support (active)
CLOUD_LLM_ENABLED: true          // OpenAI support (active)
```

---

**Last Updated:** 2024-12-29  
**Version:** 0.1.0  
**Status:** MVP Complete - Production Ready
