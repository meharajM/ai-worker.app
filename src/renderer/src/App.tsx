import React, { useState, useCallback, useEffect, useRef } from 'react';
import { VoiceInput } from './components/VoiceInput';
import { ChatView } from './components/ChatView';
import { ChatSidebar } from './components/ChatSidebar';
import { ConnectionsPanel } from './components/ConnectionsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar, View } from './components/Sidebar';
import { Header } from './components/Header';
import { useChatStore } from './stores/chatStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';
import {
  chat,
  getAvailableProviders,
  LLMMessage,
  LLMTool,
  ServerInfo,
} from './lib/llm';
import { getAllTools, getServers, executeToolCall } from './lib/mcp';

function App() {
  const [currentView, setCurrentView] = useState<View>('chat');
  const { sessions, activeSessionId, addMessage, setProcessing, isProcessing } = useChatStore();
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const messages = activeSession?.messages || [];
  const settings = useSettingsStore();
  const { speak } = useSpeechSynthesis();
  const [llmStatus, setLlmStatus] = useState<{
    provider: string | null;
    available: boolean;
  }>({
    provider: null,
    available: false,
  });

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
        };
        const providers = await getAvailableProviders(settingsForLLM);
        if (providers.ollama.available) {
          setLlmStatus({
            provider: `Ollama (${providers.ollama.model})`,
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

  // Handle message submission
  const handleSubmit = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      // Add user message
      addMessage({
        role: "user",
        content: content.trim(),
      });

      setProcessing(true);

      try {
        // Build message history for LLM
        const llmMessages: LLMMessage[] = messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        // Add the new user message
        llmMessages.push({
          role: "user",
          content: content.trim(),
        });

        // Get available MCP tools and servers
        const mcpTools = getAllTools();
        const servers = getServers();

        // Convert to LLM format (minimal for token efficiency)
        const llmTools: LLMTool[] = mcpTools.map((tool) => ({
          name: tool.name,
          description: tool.description, // Keep full description for tool schema
          parameters: tool.inputSchema,
        }));

        // Build compact server info
        const serverInfo: ServerInfo[] = servers
          .filter((server) => server.connected && server.tools.length > 0)
          .map((server) => ({
            name: server.name,
            description: server.description.substring(0, 40), // Truncate for token efficiency
            toolCount: server.tools.length,
          }));

        // Call LLM with current settings and tools
        const settingsForLLM = {
          preferredProvider: settings.preferredProvider,
          ollamaModel: settings.ollamaModel,
          ollamaBaseUrl: settings.ollamaBaseUrl,
          openaiApiKey: settings.openaiApiKey,
          openaiBaseUrl: settings.openaiBaseUrl,
          openaiModel: settings.openaiModel,
        };
        const response = await chat(
          llmMessages,
          llmTools.length > 0 ? llmTools : undefined,
          settingsForLLM,
          serverInfo.length > 0 ? serverInfo : undefined
        );

        // Execute tool calls if any
        let finalContent = response.content;
        if (response.toolCalls && response.toolCalls.length > 0) {
          const toolResults: string[] = [];

          for (const toolCall of response.toolCalls) {
            try {
              const result = await executeToolCall(
                toolCall.name,
                toolCall.arguments
              );
              if (result.error) {
                toolResults.push(
                  `Tool ${toolCall.name} failed: ${result.error}`
                );
              } else {
                const resultStr =
                  typeof result.result === "string"
                    ? result.result
                    : JSON.stringify(result.result);
                toolResults.push(
                  `Tool ${toolCall.name
                  } executed. Result: ${resultStr.substring(0, 200)}`
                );
              }
            } catch (error) {
              toolResults.push(
                `Tool ${toolCall.name} error: ${error instanceof Error ? error.message : "Unknown error"
                }`
              );
            }
          }

          // If we have tool results, we might want to send them back to the LLM for a follow-up response
          // For now, append to the content
          if (toolResults.length > 0) {
            finalContent += `\n\nTool execution results:\n${toolResults.join(
              "\n"
            )}`;
          }
        }

        // Add assistant response
        addMessage({
          role: "assistant",
          content: finalContent,
          toolCalls: response.toolCalls,
        });

        // Update provider status
        setLlmStatus({
          provider: `${response.provider} (${response.model})`,
          available: true,
        });
      } catch (error) {
        console.error("LLM error:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        addMessage({
          role: "assistant",
          content: `Sorry, I couldn't process that. ${errorMessage}`,
        });

        speak("Sorry, I couldn't process that request.");
      } finally {
        setProcessing(false);
      }
    },
    [messages, addMessage, setProcessing, speak, settings]
  );

  return (
    <div className="flex h-screen bg-[#0f1115] text-white font-sans overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />

      <div className="flex-1 flex flex-col relative">
        <Header status={llmStatus} />

        <main className="flex-1 flex flex-col overflow-hidden">
          {currentView === 'chat' && (
            <div className="flex-1 flex overflow-hidden">
              <ChatSidebar />
              <div className="flex-1 flex flex-col overflow-hidden">
                <ChatView />
                <div className="p-4 flex-shrink-0 border-t border-white/5">
                  <VoiceInput onSubmit={handleSubmit} disabled={isProcessing} />
                </div>
              </div>
            </div>
          )}

          {currentView === 'connections' && <ConnectionsPanel />}
          {currentView === 'settings' && <SettingsPanel />}
        </main>
      </div>

    </div>
  );
}

export default App;
