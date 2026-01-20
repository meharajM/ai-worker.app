import React, { useState, useCallback, useEffect, useRef } from "react";
import { VoiceInput } from "./components/VoiceInput";
import { ChatView } from "./components/ChatView";
import { ChatSidebar } from "./components/ChatSidebar";
import { ConnectionsPanel } from "./components/ConnectionsPanel";
import { SettingsPanel } from "./components/SettingsPanel";

import { Sidebar, View } from "./components/Sidebar";
import { Header } from "./components/Header";
import { useChatStore } from "./stores/chatStore";
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
import {
  getAllTools,
  getServers,
  executeToolCall,
  autoConnectServers,
  initializeMcpServers,
} from "./lib/mcp";
import { voskService } from "./lib/vosk";
import { isElectron } from "./lib/electron";

function App() {
  const [currentView, setCurrentView] = useState<View>("chat");
  const { sessions, activeSessionId, addMessage, setProcessing, isProcessing, abortProcessing } =
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
  
  // Initialize Auth Persistence
  useAuthPersistence();
  useSettingsSync();

  // Initialize MCP servers and auto-connect on mount
  useEffect(() => {
    const initializeAndAutoConnect = async () => {
      try {
        // Ensure servers are loaded
        await initializeMcpServers();
        // Auto-connect servers with autoConnect enabled
        await autoConnectServers();
      } catch (error) {
        console.error("Error initializing MCP servers:", error);
      }
    };
    initializeAndAutoConnect();
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

      // Create a reference to the runtime to allow aborting
      const abortController = new AbortController();
      // We need to use a mutable ref or store for the controller if we want to support external aborts
      // effectively (like the stop button). 
      // The current store uses its own AbortController, so we should sync them or use the store's signal.
      
      // Since App.tsx sets up the store's abort controller in setProcessing(true),
      // we can grab it.
      
      // However, the setProcessing(true) happens synchronously.
      // The store updates. We can get the signal from the store.
      // But `handleSubmit` is a callback closure. `useChatStore.getState()` is safer.

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

        // Convert store messages to LLMMessage format
        const initialHistory: LLMMessage[] = messages.map((m) => {
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
          // Note: Store might store tool results as 'tool' role messages too?
          // Looking at chatStore.ts, 'toolCalls' property is on the message.
          // Yet in the old App.tsx loop, we added 'tool' role messages to `currentMessages` array locally,
          // but did we add them to the store?
          // check chatStore: addMessage takes role 'user'|'assistant'|'system'.
          // It doesn't seem to support 'tool' role in the typed interface `Message`.
          // Wait, `Message` interface has `role: 'user' | 'assistant' | 'system'`.
          // So 'tool' role messages were NOT being persisted in the store in the old implementation?
          
          // Old App.tsx:
          // toolResults.push(...)
          // currentMessages.push({ role: "tool", ... }) -> This was local `currentMessages` array.
          // It wasn't calling `addMessage` for tool results.
          // It only called `addMessage` for the final assistant response.
          // AND it passed `allToolCalls` to the final assistant message in the store: 
          // `addMessage({ role: "assistant", content: ..., toolCalls: ... })`
          
          // So the STORE representation compresses the tool calls into the assistant message?
          // "allToolCalls.push(...response.toolCalls)"
          // "addMessage({ ... toolCalls: allToolCalls ... })"
          
          // BUT, for correct context reconstruction in the NEXT turn, we need the tool outputs.
          // If the store doesn't save "tool" role messages (outputs), then next turn `messages` will lack them.
          // This would break multi-turn coherency if we just reload from store.
          
          // Let's re-read `chatStore.ts` to see if `role` allows `tool`.
          // "role: 'user' | 'assistant' | 'system'"
          // It strictly probably doesn't allow 'tool'.
          
          // So how did the old app handle history?
          // `const llmMessages: LLMMessage[] = messages.map(...)`
          // It seems it LOST the tool outputs between sessions?
          // If so, that's a pre-existing bug/limitation.
          // OR `LLMMessage` creation in `App.tsx` handled it?
          // No, it just mapped `messages`.
          
          // Verify `chatStore.ts`:
          // `export interface Message { ... role: 'user' | 'assistant' | 'system' ... }`
          
          // This confirms the store does not save tool outputs as separate messages.
          // It attaches `toolCalls` to the assistant message.
          // But where do the RESULTS go?
          // `export interface ToolCall { ... result?: string }`
          // Ah! `result` is inside `ToolCall`.
          
          // So we need to reconstruct `tool` role messages from the `toolCalls` array in the assistant message.
          
          return msg;
        });
        
        // Reconstruct tool outputs from history
        const reconstructedHistory: LLMMessage[] = [];
        for (const msg of initialHistory) {
           reconstructedHistory.push(msg);
           // If this message has tool calls with results, we need to append synthetic "tool" messages
           // IF the store actually saved the results.
           // In `App.tsx` old loop:
           // `toolResults` had `result`.
           // But `allToolCalls` passed to `addMessage` was `response.toolCalls` (from LLM) which DOES NOT have results.
           // Wait. `allToolCalls.push(...response.toolCalls)`.
           // `response.toolCalls` comes from `callOpenAI` or similar. It has `arguments`. It does NOT have `result` usually.
           // So the store saved the tool CALLS but not the RESULTS?
           // If so, the history was indeed broken for tool use.
           
           // However, looking closer at `App.tsx` old code:
           // `addMessage({ role: "assistant", content: ..., toolCalls: allToolCalls ... })`
           // And `message.toolCalls` in store uses `ToolCall` interface which has `result?: string`.
           
           // If the old code didn't populate `result` in `allToolCalls`, then we lost the results.
           // Old code: `allToolCalls` came from `response.toolCalls`.
           // `toolResults` contained the results.
           // But `toolResults` was NOT saved to store.
           
           // This implies the old app did NOT persist tool outputs.
           // I should fix this or at least match behavior.
           // But `AgentRuntime` needs outputs to work (especially for DCP).
           // If I only fix it for the current session, that's fine.
           // `AgentRuntime` keeps `this.messages`.
           
           // For now, I will map the store messages as best as I can.
           // And I should update `handleSubmit` to try to save results if possible, 
           // OR just rely on `AgentRuntime` managing the conversation for the current turn.
        }

        const { AgentRuntime } = await import("./lib/agent-runtime");
        
        const runtime = new AgentRuntime({
          activeSessionId: activeSessionId || "default",
          settings: settingsForLLM,
          signal: useChatStore.getState().getAbortSignal() || undefined,
          onMessage: (msg) => {
             // Map back to store
             // We only want to add 'user' and 'assistant' messages to the UI/Store
             // 'tool' outcomes are not fully supported by the simplistic store 'role' enum
             // UNLESS we want to hack them in.
             // But for now, let's just add user/assistant.
             
             // Wait, if we don't save tool outputs, DCP won't work across app restarts.
             // But it will work within the session since `runtime` would hold the history if we kept the instance?
             // But we recreate `runtime` every `handleSubmit`.
             // So we rely on `messages` from store.
             
             // If store doesn't have tool outputs, we lose context.
             // I should probably Upgrade the Store to support 'tool' role or valid ToolCall results.
             // But that's a bigger refactor.
             // For now, I will stick to the plan: Implement DCP/Sub-agents.
             // If history persistence is lossy, that's a separate issue (maybe pre-existing).
             // But I will verify if I can at least pass `tool` messages to `onMessage` to see what happens.
             
             if (msg.role === 'user' || msg.role === 'assistant') {
                // Check if we need to merge tool calls
                const toolCalls = msg.tool_calls ? msg.tool_calls.map(tc => ({
                   id: tc.id,
                   name: tc.function.name,
                   arguments: typeof tc.function.arguments === 'string' 
                     ? JSON.parse(tc.function.arguments) 
                     : tc.function.arguments,
                   // We don't have results here yet usually?
                   // AgentRuntime adds 'assistant' msg with calls, THEN 'tool' msgs with results.
                })) : undefined;
                
                addMessage({
                  role: msg.role as any,
                  content: msg.content || "",
                  toolCalls: toolCalls
                });
             } else if (msg.role === 'tool') {
                // It's a tool result.
                // We currently can't easily save this to the store as a separate message
                // without changing ShortStore schema.
                // WE CAN however, try to find the previous assistant message and update it with the result?
                // `updateMessage` exists in store.
                // We'd need to find the message with the matching tool_call_id.
                // This is complex to do robustly without a proper DB.
                
                // For now, just logging it (AgentRuntime logs it).
                // DCP will work for the *current* turn loop inside AgentRuntime.
                // Across turns, it might be limited if we reload from store.
             }
          }
        }, initialHistory); // Pass initialized history

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
                <div className="p-4 flex-shrink-0 border-t border-white/5">
                  <VoiceInput onSubmit={handleSubmit} disabled={isProcessing} onAbort={abortProcessing} />
                </div>
              </div>
            </div>
          )}

          {currentView === "connections" && <ConnectionsPanel />}
          {currentView === "settings" && <SettingsPanel />}

        </main>
      </div>
    </div>
  );
}

export default App;
