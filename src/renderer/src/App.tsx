import React, { useState, useCallback, useEffect, useRef } from "react";
import { VoiceInput } from "./components/VoiceInput";
import { ChatView } from "./components/ChatView";
import { ChatSidebar } from "./components/ChatSidebar";
import { ConnectionsPanel } from "./components/ConnectionsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { TaskConfirmationCard } from "./components/TaskConfirmationCard";
import { FileChangeReview } from "./components/FileChangeReview";

import { Sidebar, View } from "./components/Sidebar";
import { Header } from "./components/Header";
import { useChatStore } from "./stores/chatStore";
import { useMcpStore } from "./stores/mcpStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useLogStore } from "./stores/logStore";
import { useAuthPersistence } from "./hooks/useAuthPersistence";
import { useSettingsSync } from "./hooks/useSettingsSync";
import {
  chat,
  getAvailableProviders,
  subscribeToWebLLMStatus,
  type WebLLMStatus,
  LLMMessage,
  LLMTool,
  ServerInfo,
  safeParseJSON,
} from "./lib/llm";
import { type TaskAnalysis } from "./lib/confirmation-message";
import {
  executeToolCall,
} from "./lib/mcp";
import { voskService } from "./lib/vosk";
import { isElectron } from "./lib/electron";

function App() {
  const [currentView, setCurrentView] = useState<View>("chat");
  const { sessions, activeSessionId, addMessage, setProcessing, isProcessing, processingSessionId, abortProcessing } =
    useChatStore();
  const { addLog } = useLogStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = activeSession?.messages || [];
  const settings = useSettingsStore();
  const [llmStatus, setLlmStatus] = useState<{
    provider: string | null;
    available: boolean;
  }>({
    provider: null,
    available: false,
  });
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    analysis: TaskAnalysis;
    resolve: (enrichedPrompt: string | null) => void;
  } | null>(null);

  // Initialize Auth Persistence
  useAuthPersistence();
  useSettingsSync();

  // MCP initialization is handled by mcpStore.initialize() inside ConnectionsPanel
  // but we should also ensure it's initialized for the Chat view.
  useEffect(() => {
    const mcp = useMcpStore.getState();
    if (!mcp.initialized) {
      mcp.initialize();
    }
  }, []);

  // Check LLM availability on mount and when settings change (debounced)
  // Only check when not in settings view to avoid duplicate calls
  const checkLLMRef = React.useRef<Promise<void> | null>(null);
  const checkLLM = React.useCallback(async () => {
    // Skip if we're in settings view (SettingsPanel handles it)
    if (currentView === "settings") {
      return;
    }

    // Prevent duplicate concurrent requests
    if (checkLLMRef.current) {
      return checkLLMRef.current;
    }

    const promise = (async () => {
      try {
        const settingsForLLM = {
          preferredProvider: settings.preferredProvider,
          ollamaModel: settings.ollamaModel,
          ollamaBaseUrl: settings.ollamaBaseUrl,
          openaiApiKey: settings.openaiApiKey,
          openaiBaseUrl: settings.openaiBaseUrl,
          openaiModel: settings.openaiModel,
          geminiApiKey: settings.geminiApiKey,
          geminiModel: settings.geminiModel,
          openrouterApiKey: settings.openrouterApiKey,
          openrouterModel: settings.openrouterModel,
        };
        const providers = await getAvailableProviders(settingsForLLM);
        if (providers.browser.available) {
          if (providers.browser.isLoaded) {
            setLlmStatus({
              provider: `On-Device (${providers.browser.model})`,
              available: true,
            });
          } else if (providers.browser.isLoading) {
            setLlmStatus({
              provider: `On-Device (Loading...)`,
              available: false,
            });
          } else if (providers.ollama.available) {
            setLlmStatus({
              provider: `Ollama (${providers.ollama.model})`,
              available: true,
            });
          } else if (providers.gemini.available) {
            setLlmStatus({
              provider: `Gemini (${providers.gemini.model})`,
              available: true,
            });
          } else if (providers.openrouter.available) {
            setLlmStatus({
              provider: `OpenRouter (${providers.openrouter.model})`,
              available: true,
            });
          } else if (providers.openai.available) {
            setLlmStatus({
              provider: `OpenAI (${providers.openai.model})`,
              available: true,
            });
          } else {
            setLlmStatus({ provider: null, available: false });
          }
        } else if (providers.ollama.available) {
          setLlmStatus({
            provider: `Ollama (${providers.ollama.model})`,
            available: true,
          });
        } else if (providers.gemini.available) {
          setLlmStatus({
            provider: `Gemini (${providers.gemini.model})`,
            available: true,
          });
        } else if (providers.openrouter.available) {
          setLlmStatus({
            provider: `OpenRouter (${providers.openrouter.model})`,
            available: true,
          });
        } else if (providers.openai.available) {
          setLlmStatus({
            provider: `OpenAI (${providers.openai.model})`,
            available: true,
          });
        } else {
          setLlmStatus({ provider: null, available: false });
        }
      } catch (error) {
        console.error("Error checking LLM:", error);
        setLlmStatus({ provider: null, available: false });
      } finally {
        checkLLMRef.current = null;
      }
    })();

    checkLLMRef.current = promise;
    return promise;
  }, [
    settings.preferredProvider,
    settings.ollamaModel,
    settings.ollamaBaseUrl,
    settings.openaiApiKey,
    settings.openaiBaseUrl,
    settings.openaiModel,
    settings.geminiApiKey,
    settings.geminiModel,
    settings.openrouterApiKey,
    settings.openrouterModel,
    currentView,
  ]);

  useEffect(() => {
    // Debounce to avoid rapid calls when settings change
    const timer = setTimeout(() => {
      checkLLM();
    }, 500);
    return () => clearTimeout(timer);
  }, [checkLLM]);

  // Re-check every 60 seconds (reduced from 30s) when not in settings
  useEffect(() => {
    if (currentView === "settings") {
      return; // Don't poll when in settings view
    }
    const interval = setInterval(() => {
      checkLLM();
    }, 60000); // Increased to 60 seconds
    return () => clearInterval(interval);
  }, [checkLLM, currentView]);

  // Subscribe to WebLLM status for real-time updates
  useEffect(() => {
    const unsubscribe = subscribeToWebLLMStatus((status: WebLLMStatus) => {
      if (status.isLoaded && status.currentModel) {
        setLlmStatus({
          provider: `On-Device (${status.currentModel})`,
          available: true,
        });
      } else if (status.isLoading || status.backgroundDownload) {
        setLlmStatus({
          provider: `On-Device (Loading ${status.loadingProgress.toFixed(0)}%)`,
          available: false, // Show as yellow/inactive while loading
        });
      } else {
        // Fallback to regular check if WebLLM is not loaded or loading
        checkLLM();
      }
    });
    return () => unsubscribe();
  }, [checkLLM]);


  // Handle message submission
  const handleSubmit = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      setProcessing(true);
      addMessage({ role: 'user', content });
      const abortController = new AbortController();
      // We need to use a mutable ref or store for the controller if we want to support external aborts
      // effectively (like the stop button). 
      // The current store uses its own AbortController, so we should sync them or use the store's signal.

      // Since App.tsx sets up the store's abort controller in setProcessing(true),
      // we can grab it.

      // However, the setProcessing(true) happens synchronously.
      // The store updates. We can get the signal from the store.
      // But `handleSubmit` is a callback closure. `useChatStore.getState()` is safer.

      const settingsForLLM = {
        preferredProvider: settings.preferredProvider,
        ollamaModel: settings.ollamaModel,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        openaiApiKey: settings.openaiApiKey,
        openaiBaseUrl: settings.openaiBaseUrl,
        openaiModel: settings.openaiModel,
        geminiApiKey: settings.geminiApiKey,
        geminiModel: settings.geminiModel,
        openrouterApiKey: settings.openrouterApiKey,
        openrouterModel: settings.openrouterModel,
      };

      try {

        // Convert store messages to LLMMessage format with proper tool result reconstruction
        const freshMessages = useChatStore.getState().getActiveSession()?.messages || [];
        const reconstructedHistory: LLMMessage[] = [];

        for (const m of freshMessages) {
          // 1. Add the main message
          const msg: LLMMessage = {
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          };

          if (m.toolCalls) {
            msg.tool_calls = m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name, // Fixed: use name
                arguments: tc.arguments
              }
            }));
          }

          reconstructedHistory.push(msg);

          // 2. Add synthetic tool messages if results exist
          if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            for (const tc of m.toolCalls) {
              if (tc.result !== undefined && tc.result !== null) {
                reconstructedHistory.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: tc.result
                });
              }
            }
          }
        }

        const { AgentRuntime } = await import("./lib/agent-runtime");

        let activeAssistantMessageId: string | null = null;

        const runtime = new AgentRuntime({
          activeSessionId: activeSessionId || "default",
          workspacePath: activeSession?.workspacePath,  // Pass workspace path from session
          settings: settingsForLLM,
          signal: useChatStore.getState().getAbortSignal() || undefined,
          requireConfirmation: true, // Enable smart confirmation
          onConfirmationNeeded: async (analysis) => {
            // Return a Promise that resolves when user makes a choice
            return new Promise((resolve) => {
              setPendingConfirmation({ analysis, resolve });
            });
          },
          onMessageUpdate: (id, updates) => {
            const { updateSessionMessage } = useChatStore.getState();
            // Convert LLMMessage updates to Store Message updates
            const storeUpdates: any = { ...updates };

            // Handle content array -> string
            if (Array.isArray(storeUpdates.content)) {
              storeUpdates.content = storeUpdates.content
                .map((c: any) => c.text || '')
                .join('');
            }

            // Remove role if it's 'tool' as store doesn't support it (and we rarely update role anyway)
            if (storeUpdates.role === 'tool') {
              delete storeUpdates.role;
            }

            // Use the session ID captured at start of this run via closure
            if (activeSessionId) {
              updateSessionMessage(activeSessionId, id, storeUpdates);
            }
          },
          onMessage: (msg: LLMMessage) => {
            const getContentString = (content: string | any[]): string => {
              if (typeof content === 'string') return content;
              return Array.isArray(content) ? content.map(c => c.text || '').join('') : '';
            };

            // Use session ID from closure for isolation
            const currentSessionId = activeSessionId;
            if (!currentSessionId) return; // Should not happen if we are running

            if (msg.role === 'assistant') {
              const newToolCalls = msg.tool_calls ? msg.tool_calls.map(tc => ({
                id: tc.id,
                name: tc.function.name,
                arguments: safeParseJSON(tc.function.arguments),
              })) : [];

              if (activeAssistantMessageId) {
                const { updateSessionMessage, getActiveSession } = useChatStore.getState();
                // We need to look up the session by ID to be safe, or assume isolation prevents concurrency issues on same object?
                // `getActiveSession` returns the CURRENTLY ACTIVE session in UI.
                // WE SHOULD NOT USE IT.
                // We should find the session by `currentSessionId`.
                const { sessions } = useChatStore.getState();
                const session = sessions.find(s => s.id === currentSessionId);

                const existingMsg = session?.messages.find(m => m.id === activeAssistantMessageId);
                if (existingMsg) {
                  // Update existing message
                  const mergedToolCalls = [...(existingMsg.toolCalls || []), ...newToolCalls];

                  // For content: overwrite if new content exists (often content in tool turns is intermediate)
                  let finalContent = existingMsg.content;
                  if (msg.content && getContentString(msg.content) !== existingMsg.content) {
                    finalContent = getContentString(msg.content || '');
                  }

                  updateSessionMessage(currentSessionId, activeAssistantMessageId, {
                    content: finalContent,
                    toolCalls: mergedToolCalls.length > 0 ? mergedToolCalls : undefined,
                    actions: msg.actions ?? existingMsg.actions
                  });
                  return activeAssistantMessageId;
                }
              }

              // Create new message and track its ID
              // `addMessage` adds to ACTIVE session.
              // IF user changed session, `addMessage` adds to WRONG session!
              // We need `addSessionMessage` too?
              // The user didn't report messages appearing in wrong session, only *updates* (status).
              // Initial message is added when user is looking at it.
              // But subsequent assistant chunks?

              // If `addMessage` uses `activeSessionId` from store state (which it does),
              // then `addMessage` is ALSO broken for background runs.
              // We fix `updateMessage` now. `addMessage` might be a separate issue.
              // BUT for `onMessage` here, it runs incrementally.

              // If we are strictly fixing "status appearing in other window", `updateMessage` fix handles the "Parallel Execution" status block.
              // The status block is created once via `addMessage` (while user is present hopefully).
              // Then updated via `onMessageUpdate`.

              // Wait, `AgentRuntime` calls `this.addMessage(statusMessage)`.
              // `App.tsx` handles `onMessage` -> `activeSessionId` closure -> ...
              // If `App.tsx` calls `addMessage`, it uses STORE `activeSessionId`.
              // So if user switched session, `addMessage` is dangerous.

              // However, fixing `addMessage` requires larger refactor.
              // The immediate issue "shows same in the other chat window" is likely about the STATUS updates (which use `updateMessage`).
              // Because `AgentRuntime` updates that specific message repeatedly.

              const { addSessionMessage } = useChatStore.getState();
              const added = addSessionMessage(currentSessionId, {
                role: 'assistant',
                content: getContentString(msg.content || ""),
                toolCalls: newToolCalls.length > 0 ? newToolCalls : undefined,
                actions: msg.actions
              });
              activeAssistantMessageId = added.id;
              return activeAssistantMessageId;

            } else if (msg.role === 'tool' && activeAssistantMessageId) {
              const { updateSessionMessage, sessions } = useChatStore.getState();
              const session = sessions.find(s => s.id === currentSessionId);
              const existingMsg = session?.messages.find(m => m.id === activeAssistantMessageId);

              if (existingMsg && existingMsg.toolCalls) {
                const updatedToolCalls = existingMsg.toolCalls.map(tc => {
                  if (tc.id === msg.tool_call_id) {
                    return { ...tc, result: getContentString(msg.content || '') };
                  }
                  return tc;
                });

                updateSessionMessage(currentSessionId, activeAssistantMessageId, {
                  toolCalls: updatedToolCalls
                });
              }
              return activeAssistantMessageId;
            }
          }
        }, reconstructedHistory); // Pass initialized history

        // Background Memory Reflection (Fire-and-forget)
        // We run this CONCURRENTLY with the main agent to ensure we capture user intent 
        // even if the main agent gets stuck in a confirmation loop or fails.
        import("./lib/memory-reflector").then(({ MemoryReflector }) => {
          const currentMessages = useChatStore.getState().getActiveSession()?.messages || [];

          // Convert to LLMMessage format for the reflector
          const historyForReflector: LLMMessage[] = currentMessages.map(m => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content
          }));

          MemoryReflector.getInstance().analyze(historyForReflector, settingsForLLM);
        });

        await runtime.chat(content);

      } catch (error) {
        console.error("Handler error:", error);
        addMessage({
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      } finally {
        setProcessing(false);
      }
    },
    [messages, addMessage, setProcessing, settings]
  );

  // Listen for action button clicks from MessageBubble
  useEffect(() => {
    const handleAgentAction = (e: CustomEvent) => {
      const { type, content } = e.detail;
      if (type === 'continue' && !isProcessing) {
        handleSubmit(content);
      }
      // 'cancel' type just stops — no action needed, the agent already returned
    };

    window.addEventListener('agent-action', handleAgentAction as EventListener);
    return () => window.removeEventListener('agent-action', handleAgentAction as EventListener);
  }, [handleSubmit, isProcessing]);

  return (
    <div className="flex h-screen bg-[#0f1115] text-white font-sans overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />

      <div className="flex-1 flex flex-col relative min-w-0">
        <Header status={llmStatus} />

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {currentView === "chat" && (
            <div className="flex-1 flex overflow-hidden min-w-0">
              <ChatSidebar />
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <ChatView />

                {/* Confirmation Card - Shows when task needs clarification */}
                {pendingConfirmation && (
                  <div className="px-4 py-2 border-t border-white/5">
                    <TaskConfirmationCard
                      analysis={pendingConfirmation.analysis}
                      onConfirm={(enrichedPrompt) => {
                        pendingConfirmation.resolve(enrichedPrompt);
                        setPendingConfirmation(null);
                      }}
                      onCancel={() => {
                        pendingConfirmation.resolve(null);
                        setPendingConfirmation(null);
                        setProcessing(false);
                      }}
                      onBypass={() => {
                        // Use original prompt
                        pendingConfirmation.resolve(pendingConfirmation.analysis.detectedIntent);
                        setPendingConfirmation(null);
                      }}
                    />
                  </div>
                )}

                <div className="p-4 flex-shrink-0 border-t border-white/5">
                  <VoiceInput onSubmit={handleSubmit} disabled={(isProcessing && processingSessionId === activeSessionId) || !!pendingConfirmation} onAbort={abortProcessing} />
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
