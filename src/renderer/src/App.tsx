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
import { useSpeechSynthesis } from "./hooks/useSpeechSynthesis";
import {
  chat,
  getAvailableProviders,
  subscribeToWebLLMStatus,
  type WebLLMStatus,
  LLMMessage,
  LLMTool,
  ServerInfo,
} from "./lib/llm";
import {
  getAllTools,
  getServers,
  executeToolCall,
  autoConnectServers,
  initializeMcpServers,
} from "./lib/mcp";
import { parseSequentialResponse, ParsedStep } from "./utils/llmParser";
import { getCompactToolList } from "./utils/toolRegistry";
import { getSystemPrompt } from "./utils/llmPrompt";
import { executeToolWithCompression } from "./lib/mcp";

function App() {
  const [currentView, setCurrentView] = useState<View>("chat");
  const { sessions, activeSessionId, addMessage, setProcessing, isProcessing } =
    useChatStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
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
  const [sequentialSteps, setSequentialSteps] = useState<ParsedStep[]>([]);

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

  // Helper: Build minimal context for small LLMs
  const buildMinimalContext = useCallback((
    userInput: string,
    steps: ParsedStep[],
    lastResult: any
  ): LLMMessage[] => {
    const messages: LLMMessage[] = [];
    const mcpTools = getAllTools();
    const compactList = getCompactToolList(mcpTools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema
    })));

    // System prompt
    messages.push({
      role: 'system',
      content: getSystemPrompt(compactList)
    });

    // Only include last interaction (not full history)
    if (steps.length > 0) {
      const lastStep = steps[steps.length - 1];

      messages.push({
        role: 'user',
        content: steps.length === 1 ? userInput : "Continue with next step"
      });

      // Ensure reasoning is present
      const reasoning = lastStep.reasoning || "Processing...";

      messages.push({
        role: 'assistant',
        content: `<THINK>${reasoning}</THINK>` +
          (lastStep.toolCall ?
            `<TOOL>${JSON.stringify(lastStep.toolCall)}</TOOL>` :
            lastStep.finalAnswer || "")
      });

      if (lastResult) {
        const resultStr = typeof lastResult === 'string' ?
          lastResult : JSON.stringify(lastResult);
        messages.push({
          role: 'user', // Small LLMs sometimes react better to tool results as user messages if role 'tool' is not supported
          content: `Tool result: ${resultStr}`
        });
      }
    } else {
      // First message
      messages.push({ role: 'user', content: userInput });
    }

    return messages;
  }, []);

  // Handle sequential tool call
  const handleSequentialToolCall = useCallback(async (content: string) => {
    if (!content.trim()) return;

    // Add user message
    addMessage({
      role: "user",
      content: content.trim(),
    });

    setProcessing(true);
    setSequentialSteps([]);

    try {
      const steps: ParsedStep[] = [];
      let lastToolResult: any = null;
      let iteration = 0;
      let finalResponseContent = "";
      let finalToolCalls: any[] = [];

      const settingsForLLM = {
        preferredProvider: settings.preferredProvider,
        ollamaModel: settings.ollamaModel,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        openaiApiKey: settings.openaiApiKey,
        openaiBaseUrl: settings.openaiBaseUrl,
        openaiModel: settings.openaiModel,
      };

      while (iteration < 5) { // Max 5 steps for small context
        // Build context with only last step (not full history)
        const context = buildMinimalContext(content, steps, lastToolResult);

        // Call LLM using existing chat function
        const response = await chat(
          context,
          undefined, // We include tool list in system prompt
          settingsForLLM,
          undefined,
          { useSequentialPrompt: true }
        );

        // Parse response
        const step = parseSequentialResponse(response.content);
        steps.push(step);
        setSequentialSteps([...steps]);

        // Execute tool if needed
        if (step.toolCall) {
          console.log(`[Sequential] Executing tool: ${step.toolCall.name}`);

          // Add thinking message with tool call placeholder
          addMessage({
            role: "assistant",
            content: `<THINK>${step.reasoning}</THINK>`,
            toolCalls: [{
              id: `call_${Date.now()}`,
              name: step.toolCall.name,
              arguments: step.toolCall.args
            }]
          });

          const result = await executeToolWithCompression(
            step.toolCall.name,
            step.toolCall.args
          );
          lastToolResult = result.result || result.error;

          // Add tool result as a separate message (visible in UI)
          addMessage({
            role: "user",
            content: `Result: ${typeof lastToolResult === 'string' ? lastToolResult : JSON.stringify(lastToolResult)}`
          });
        } else {
          // Final answer reached
          finalResponseContent = step.finalAnswer || step.reasoning;
          addMessage({
            role: "assistant",
            content: finalResponseContent
          });
          break;
        }

        iteration++;
      }

      // Update provider status
      setLlmStatus({
        provider: `Sequential (${settings.preferredProvider})`,
        available: true,
      });

    } catch (error) {
      console.error("Sequential LLM error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addMessage({
        role: "assistant",
        content: `Sorry, I couldn't process that. ${errorMessage}`,
      });
      speak("Sorry, I couldn't process that request.");
    } finally {
      setProcessing(false);
    }
  }, [addMessage, setProcessing, settings, speak, buildMinimalContext]);

  // Use handleSequentialToolCall for handleSubmit
  const handleSubmit = useCallback(
    async (content: string) => {
      await handleSequentialToolCall(content);
    },
    [handleSequentialToolCall]
  );

  return (
    <div className="flex h-screen bg-[#0f1115] text-white font-sans overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />

      <div className="flex-1 flex flex-col relative">
        <Header status={llmStatus} />

        <main className="flex-1 flex flex-col overflow-hidden">
          {currentView === "chat" && (
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

          {currentView === "connections" && <ConnectionsPanel />}
          {currentView === "settings" && <SettingsPanel />}
        </main>
      </div>
    </div>
  );
}

export default App;
