/**
 * App.tsx — Root UI shell for the ai-worker renderer process.
 *
 * Architecture: This component is ONLY responsible for:
 *   1. Rendering the top-level layout (Sidebar, Header, main content area)
 *   2. Routing between views (chat, connections, settings)
 *   3. Rendering the TaskConfirmationDialog when the agent needs user approval
 *
 * What this file does NOT do (extracted to hooks):
 *   - Agent execution logic → useAgent.ts
 *   - LLM status polling → useLLMStatus.ts
 *   - Auth persistence → useAuthPersistence.ts
 *   - Settings sync → useSettingsSync.ts
 *
 * Phase 3 note: This file does not change in Phase 3. The agent swap
 *   (local → remote) happens entirely inside useAgent.ts.
 */

import React, { useState, useEffect } from "react";
import { VoiceInput } from "./components/VoiceInput";
import { ChatView } from "./components/ChatView";
import { ChatSidebar } from "./components/ChatSidebar";
import { ConnectionsPanel } from "./components/ConnectionsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { FileChangeReview } from "./components/FileChangeReview";
import { CommandPalette } from "./components/CommandPalette";
import { Sidebar, View } from "./components/Sidebar";
import { Header } from "./components/Header";

import { useChatStore } from "./stores/chatStore";
import { useMcpStore } from "./stores/mcpStore";
import { useAuthPersistence } from "./hooks/useAuthPersistence";
import { useSettingsSync } from "./hooks/useSettingsSync";
import { useAgent } from "./hooks/useAgent";
import { useLLMStatus } from "./hooks/useLLMStatus";
import { MissingDependenciesScreen } from "./components/MissingDependenciesScreen";

function App() {
  const [currentView, setCurrentView] = useState<View>("chat");
  const [dependenciesResolved, setDependenciesResolved] = useState(false);

  useEffect(() => {
    const triggerCheck = () => setDependenciesResolved(false);
    window.addEventListener('app:check-dependencies', triggerCheck);
    return () => window.removeEventListener('app:check-dependencies', triggerCheck);
  }, []);

  // ── Store subscriptions ───────────────────────────────────────────────────
  const {
    activeSessionId,
    sessions,
    isProcessing,
    processingSessionId,
    abortProcessing,
  } = useChatStore();

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // ── Side-effect hooks ─────────────────────────────────────────────────────
  useAuthPersistence();
  useSettingsSync();

  // Ensure MCP is initialized for the chat view. ConnectionsPanel also calls
  // initialize(), but we need it ready before the user opens that panel.
  useEffect(() => {
    const mcp = useMcpStore.getState();
    if (!mcp.initialized) {
      mcp.initialize();
    }
  }, []);

  // ── Business logic hooks ──────────────────────────────────────────────────
  // All agent execution logic lives in useAgent. All LLM status polling lives
  // in useLLMStatus. App.tsx just wires their outputs to the UI.

  const { handleSubmit } = useAgent();
  const { llmStatus } = useLLMStatus(currentView);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-[#0f1115] text-white font-sans overflow-hidden">
      <CommandPalette />
      {!dependenciesResolved && <MissingDependenciesScreen onResolved={() => setDependenciesResolved(true)} />}
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />

      <div className="flex-1 flex flex-col relative min-w-0">
        <Header status={llmStatus} />

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {currentView === "chat" && (
            <div className="flex-1 flex overflow-hidden min-w-0">
              <ChatSidebar />
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <ChatView />

                <div className="p-4 flex-shrink-0 border-t border-white/5">
                  <VoiceInput
                    onSubmit={handleSubmit}
                    // Disable input while the agent is processing in the active session
                    disabled={isProcessing && processingSessionId === activeSessionId}
                    onAbort={abortProcessing}
                  />
                </div>
              </div>
            </div>
          )}

          {currentView === "connections" && <ConnectionsPanel />}
          {currentView === "settings" && <SettingsPanel />}
        </main>
      </div>

      <FileChangeReview />
    </div>
  );
}

export default App;
