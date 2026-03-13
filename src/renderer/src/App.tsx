/**
 * App.tsx — Root UI shell for the ai-worker renderer process.
 *
 * Architecture: This component is ONLY responsible for:
 *   1. Rendering the top-level layout (Sidebar, Header, main content area)
 *   2. Routing between views (chat, connections, settings)
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
import { ConnectionsPanel } from "./components/ConnectionsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { FileChangeReview } from "./components/FileChangeReview";
import { CommandPalette } from "./components/CommandPalette";
import { Sidebar, View } from "./components/Sidebar";
import { Header } from "./components/Header";

import { useChatStore } from "./stores/chatStore";
import { useAuthPersistence } from "./hooks/useAuthPersistence";
import { useSettingsSync } from "./hooks/useSettingsSync";
import { useAgent } from "./hooks/useAgent";
import { useLLMStatus } from "./hooks/useLLMStatus";
import { MissingDependenciesScreen } from "./components/MissingDependenciesScreen";
import { ExperimentProvider } from "./lib/experiments/experimentProvider";

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
    isSessionProcessing,
    abortSession,
  } = useChatStore();
  // Whether the currently-active session is processing (used to disable the input)
  const activeIsProcessing = activeSessionId ? isSessionProcessing(activeSessionId) : false;

  // ── Side-effect hooks ─────────────────────────────────────────────────────
  useAuthPersistence();
  useSettingsSync();

  // ── Business logic hooks ──────────────────────────────────────────────────
  // All agent execution logic lives in useAgent. All LLM status polling lives
  // in useLLMStatus. App.tsx just wires their outputs to the UI.

  const { handleSubmit } = useAgent();
  const { llmStatus } = useLLMStatus(currentView);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ExperimentProvider>
    <div className="flex h-screen bg-[var(--color-bg-dark)] text-white font-sans overflow-hidden">
      <CommandPalette onViewChange={setCurrentView} />
      {!dependenciesResolved && <MissingDependenciesScreen onResolved={() => setDependenciesResolved(true)} />}
      
      {currentView !== "settings" && (
        <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      )}

      <div className="flex-1 flex flex-col relative min-w-0">
        <Header status={llmStatus} />

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {currentView === "chat" && (
            <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
              <div className="flex-1 overflow-hidden flex flex-col relative w-full h-full pb-0 bg-[var(--color-bg-dark)] z-0">
                <ChatView />
              </div>

              <div className="pt-2 pb-6 px-6 flex justify-center w-full z-10 bg-[var(--color-bg-dark)] shrink-0 shadow-[0_-10px_20px_rgba(0,0,0,0.2)]">
                <div className="w-full max-w-2xl">
                  <VoiceInput
                    onSubmit={handleSubmit}
                    // Only disable input while THIS session is the one processing
                    disabled={activeIsProcessing}
                    onAbort={activeSessionId ? () => abortSession(activeSessionId) : undefined}
                  />
                </div>
              </div>
            </div>
          )}

          {currentView === "connections" && <ConnectionsPanel />}
          {currentView === "settings" && <SettingsPanel onClose={() => setCurrentView("chat")} />}
        </main>
      </div>

      <FileChangeReview />
    </div>
    </ExperimentProvider>
  );
}

export default App;
