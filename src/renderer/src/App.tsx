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
import { TaskConfirmationDialog } from "./components/TaskConfirmationDialog";
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

function App() {
  const [currentView, setCurrentView] = useState<View>("chat");

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

  const { handleSubmit, pendingConfirmation, clearConfirmation } = useAgent();
  const { llmStatus } = useLLMStatus(currentView);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-[#0f1115] text-white font-sans overflow-hidden">
      <CommandPalette />
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
                    // Disable input while the agent is processing in the active session,
                    // or while waiting for user confirmation on a task.
                    disabled={
                      (isProcessing && processingSessionId === activeSessionId) ||
                      !!pendingConfirmation
                    }
                    onAbort={abortProcessing}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Task Confirmation Dialog ─────────────────────────────────────────
              Shown when AgentRuntime pauses and asks the user to confirm or
              cancel a task before executing it. The `resolve` callback is
              provided by the agent — calling it unblocks the agent's async flow. */}
          <TaskConfirmationDialog
            open={!!pendingConfirmation}
            analysis={pendingConfirmation?.analysis || null}
            onConfirm={(enrichedPrompt) => {
              if (pendingConfirmation) {
                pendingConfirmation.resolve(enrichedPrompt);
                clearConfirmation();
              }
            }}
            onCancel={() => {
              if (pendingConfirmation) {
                pendingConfirmation.resolve(null); // null = user cancelled
                clearConfirmation();
                useChatStore.getState().setProcessing(false);
              }
            }}
            onBypass={() => {
              if (pendingConfirmation) {
                // Bypass: skip the enriched prompt, use the raw detected intent
                pendingConfirmation.resolve(
                  pendingConfirmation.analysis.detectedIntent
                );
                clearConfirmation();
              }
            }}
          />

          {currentView === "connections" && <ConnectionsPanel />}
          {currentView === "settings" && <SettingsPanel />}
        </main>
      </div>

      <FileChangeReview />
    </div>
  );
}

export default App;
