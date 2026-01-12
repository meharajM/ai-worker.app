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

      // Create a placeholder assistant message that we'll update incrementally
      const assistantMessage = addMessage({
        role: "assistant",
        content: "",
      });
      const assistantMessageId = assistantMessage.id;
      const { updateMessage } = useChatStore.getState();

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

        console.log(`[MCP App] Preparing LLM request with MCP tools`, {
          timestamp: new Date().toISOString(),
          operation: "prepareLLMRequest",
          mcpToolCount: mcpTools.length,
          connectedServerCount: servers.filter((s) => s.connected).length,
          totalServerCount: servers.length,
          toolNames: mcpTools.map((t) => t.name),
          serverNames: servers.filter((s) => s.connected).map((s) => s.name),
        });

        // Convert to LLM format (minimal for token efficiency)
        const llmTools: LLMTool[] = mcpTools.map((tool) => ({
          name: tool.name,
          description: tool.description, // Keep full description for tool schema
          parameters: tool.inputSchema,
        }));

        // Build compact server info
        const serverInfo: ServerInfo[] = servers
          .filter((server) => server.connected)
          .map((server) => {
            const isReasoningServer =
              server.name.includes("sequential-thinking") ||
              server.name.includes("sequential") ||
              server.description.toLowerCase().includes("reasoning");

            return {
              name: server.name,
              description: server.description.substring(0, 40), // Truncate for token efficiency
              toolCount: server.tools.length,
              isReasoningServer,
            };
          });

        // Tool execution loop - continue until no more tool calls are needed
        const settingsForLLM = {
          preferredProvider: settings.preferredProvider,
          ollamaModel: settings.ollamaModel,
          ollamaBaseUrl: settings.ollamaBaseUrl,
          openaiApiKey: settings.openaiApiKey,
          openaiBaseUrl: settings.openaiBaseUrl,
          openaiModel: settings.openaiModel,
        };

        let currentMessages = [...llmMessages];
        let finalResponse: Awaited<ReturnType<typeof chat>> | null = null;
        let iterationCount = 0;
        const maxIterations = 10; // Safety limit to prevent infinite loops
        const allToolCalls: Array<{
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        }> = [];
        let accumulatedContent = "";

        while (iterationCount < maxIterations) {
          console.log(
            `[MCP App] Starting LLM call (iteration ${iterationCount + 1})`,
            {
              timestamp: new Date().toISOString(),
              operation: "llmCall",
              iteration: iterationCount + 1,
              messageCount: currentMessages.length,
              hasTools: llmTools.length > 0,
            }
          );

          let response: Awaited<ReturnType<typeof chat>>;
          try {
            // Add timeout to prevent infinite hanging
            const chatPromise = chat(
              currentMessages,
              llmTools.length > 0 ? llmTools : undefined,
              settingsForLLM,
              serverInfo.length > 0 ? serverInfo : undefined,
              (chunk, fullContent) => {
                // Determine what content to show
                // If this is a subsequent iteration, we append to accumulated content
                // Note: fullContent is just for THIS turn
                const displayContent = accumulatedContent + (accumulatedContent ? "\n\n" : "") + fullContent;
                updateMessage(assistantMessageId, {
                  content: displayContent
                });
              }
            );

            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(new Error("LLM call timeout after 120 seconds")),
                120000
              );
            });

            response = await Promise.race([chatPromise, timeoutPromise]);
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            console.error(
              `[MCP App] LLM call failed (iteration ${iterationCount + 1})`,
              {
                timestamp: new Date().toISOString(),
                operation: "llmCall",
                iteration: iterationCount + 1,
                error: errorMessage,
              }
            );

            // Check if this is a timeout and we can fallback to cloud
            const isTimeout = errorMessage.includes("timeout");
            const isWebLLMError = errorMessage.includes("WebLLM") || 
                                  errorMessage.includes("MessageOrder") ||
                                  errorMessage.includes("Context");
            
            if (isTimeout || isWebLLMError) {
              console.log("[MCP App] Attempting cloud fallback...");
              
              // Update UI to show fallback status
              updateMessage(assistantMessageId, {
                content: accumulatedContent + (accumulatedContent ? "\n\n" : "") + "⚠️ Connection timed out. Switching to cloud provider..."
              });

              // Check for available cloud providers
              const providers = await getAvailableProviders(settingsForLLM);
              const hasCloudFallback = providers.ollama.available || providers.openai.available;
              
              if (hasCloudFallback) {
                try {
                  // Force cloud provider
                  const cloudSettings = {
                    ...settingsForLLM,
                    preferredProvider: providers.openai.available ? "openai" as const : "ollama" as const,
                  };
                  
                  console.log(`[MCP App] Retrying with ${cloudSettings.preferredProvider}...`);
                  
                  response = await chat(
                    currentMessages,
                    llmTools.length > 0 ? llmTools : undefined,
                    cloudSettings,
                    serverInfo.length > 0 ? serverInfo : undefined
                  );
                  
                  console.log(`[MCP App] Cloud fallback succeeded with ${cloudSettings.preferredProvider}`);
                  // Continue with the response from cloud
                } catch (cloudError) {
                  console.error("[MCP App] Cloud fallback also failed:", cloudError);
                  const failMsg = `WebLLM timed out and cloud fallback failed. Please try a simpler query or check your cloud provider settings.`;
                  updateMessage(assistantMessageId, {
                     content: accumulatedContent + (accumulatedContent ? "\n\n" : "") + failMsg
                  });
                  finalResponse = {
                    content: failMsg,
                    provider: "error",
                    model: "unknown",
                  };
                  break;
                }
              } else {
                // No cloud fallback available
                const failMsg = `WebLLM timed out. Configure OpenAI or Ollama in Settings for automatic fallback.`;
                updateMessage(assistantMessageId, {
                   content: accumulatedContent + (accumulatedContent ? "\n\n" : "") + failMsg
                });
                finalResponse = {
                  content: failMsg,
                  provider: "error",
                  model: "unknown",
                };
                break;
              }
            } else {
              // Non-timeout error, just show it
              const failMsg = `Error during tool execution: ${errorMessage}. The task may be incomplete.`;
              updateMessage(assistantMessageId, {
                 content: accumulatedContent + (accumulatedContent ? "\n\n" : "") + failMsg
              });
              finalResponse = {
                content: failMsg,
                provider: "error",
                model: "unknown",
              };
              break;
            }
          }

          // Accumulate content if successful
          if (response.content) {
             accumulatedContent += (accumulatedContent ? "\n\n" : "") + response.content;
             // Update final state of this turn
             updateMessage(assistantMessageId, {
               content: accumulatedContent
             });
          }

          console.log(
            `[MCP App] LLM call completed (iteration ${iterationCount + 1})`,
            {
              timestamp: new Date().toISOString(),
              operation: "llmCall",
              iteration: iterationCount + 1,
              hasContent: !!response.content,
              hasToolCalls: !!(
                response.toolCalls && response.toolCalls.length > 0
              ),
              toolCallCount: response.toolCalls?.length || 0,
              contentPreview: response.content?.substring(0, 100),
            }
          );

          finalResponse = response;

          // If no tool calls, we're done
          if (!response.toolCalls || response.toolCalls.length === 0) {
            console.log(`[MCP App] No more tool calls, completing task`, {
              timestamp: new Date().toISOString(),
              operation: "complete",
              iteration: iterationCount + 1,
              totalIterations: iterationCount + 1,
              finalContent: response.content?.substring(0, 200),
            });
            break;
          }

          // Track all tool calls for display
          allToolCalls.push(...response.toolCalls);
          
          // Update message with accumulated tool calls
          updateMessage(assistantMessageId, {
            toolCalls: allToolCalls
          });

          // Log what tool calls we're about to execute
          console.log(
            `[MCP App] LLM requested ${response.toolCalls.length} tool call(s)`,
            {
              timestamp: new Date().toISOString(),
              operation: "toolCallsRequested",
              iteration: iterationCount + 1,
              toolNames: response.toolCalls.map((tc) => tc.name),
            }
          );

          // Execute tool calls
          const toolExecutionStartTime = Date.now();
          console.log(
            `[MCP App] Tool execution batch started (iteration ${
              iterationCount + 1
            })`,
            {
              timestamp: new Date().toISOString(),
              operation: "executeToolCalls",
              iteration: iterationCount + 1,
              toolCallCount: response.toolCalls.length,
              toolNames: response.toolCalls.map((tc) => tc.name),
              llmProvider: response.provider,
              llmModel: response.model,
            }
          );

          // Add assistant message with tool calls to conversation (for OpenAI API format)
          currentMessages.push({
            role: "assistant",
            content: response.content || "",
            tool_calls: response.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name, // Ensure this matches actual tool name
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          } as any); // Type assertion needed for tool_calls support

          // Execute all tool calls
          const toolResults: Array<{
            toolCallId: string;
            name: string;
            result: string;
          }> = [];

          for (let i = 0; i < response.toolCalls.length; i++) {
            const toolCall = response.toolCalls[i];
            const toolCallStartTime = Date.now();

            console.log(
              `[MCP App] Executing tool call ${i + 1}/${
                response.toolCalls.length
              }`,
              {
                timestamp: new Date().toISOString(),
                operation: "executeToolCall",
                toolName: toolCall.name,
                toolIndex: i + 1,
                totalTools: response.toolCalls.length,
                argsKeys: Object.keys(toolCall.arguments || {}),
                argsSize: JSON.stringify(toolCall.arguments).length,
              }
            );

            try {
              const result = await executeToolCall(
                toolCall.name,
                toolCall.arguments
              );

              const toolCallDuration = Date.now() - toolCallStartTime;

              if (result.error) {
                console.error(`[MCP App] Tool call ${i + 1} failed`, {
                  timestamp: new Date().toISOString(),
                  operation: "executeToolCall",
                  toolName: toolCall.name,
                  toolIndex: i + 1,
                  error: result.error,
                  duration: toolCallDuration,
                });

                toolResults.push({
                  toolCallId: toolCall.id,
                  name: toolCall.name,
                  result: JSON.stringify({ error: result.error }),
                });
              } else {
                const resultSize = JSON.stringify(result.result).length;
                const resultPreview =
                  typeof result.result === "string"
                    ? result.result.substring(0, 100)
                    : JSON.stringify(result.result).substring(0, 100);

                console.log(`[MCP App] Tool call ${i + 1} completed`, {
                  timestamp: new Date().toISOString(),
                  operation: "executeToolCall",
                  toolName: toolCall.name,
                  toolIndex: i + 1,
                  duration: toolCallDuration,
                  resultSize,
                  resultPreview:
                    resultPreview + (resultSize > 100 ? "..." : ""),
                });

                const resultStr =
                  typeof result.result === "string"
                    ? result.result
                    : JSON.stringify(result.result);
                toolResults.push({
                  toolCallId: toolCall.id,
                  name: toolCall.name,
                  result: resultStr,
                });
              }
            } catch (error) {
              const toolCallDuration = Date.now() - toolCallStartTime;
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";

              console.error(`[MCP App] Tool call ${i + 1} threw exception`, {
                timestamp: new Date().toISOString(),
                operation: "executeToolCall",
                toolName: toolCall.name,
                toolIndex: i + 1,
                error: errorMessage,
                duration: toolCallDuration,
              });

              toolResults.push({
                toolCallId: toolCall.id,
                name: toolCall.name,
                result: JSON.stringify({ error: errorMessage }),
              });
            }
          }

          const totalDuration = Date.now() - toolExecutionStartTime;
          const successCount = toolResults.filter(
            (r) => !r.result.includes('"error"')
          ).length;
          const failureCount = toolResults.length - successCount;

          console.log(`[MCP App] Tool execution batch completed`, {
            timestamp: new Date().toISOString(),
            operation: "executeToolCalls",
            iteration: iterationCount + 1,
            totalTools: response.toolCalls.length,
            successCount,
            failureCount,
            totalDuration,
            averageDuration: totalDuration / response.toolCalls.length,
          });

          // Add tool results to conversation (for OpenAI API format)
          for (const toolResult of toolResults) {
            currentMessages.push({
              role: "tool",
              content: toolResult.result,
              tool_call_id: toolResult.toolCallId,
            } as any); // Type assertion needed for tool role support
          }

          console.log(
            `[MCP App] Tool results added to conversation, continuing loop`,
            {
              timestamp: new Date().toISOString(),
              operation: "continueLoop",
              iteration: iterationCount + 1,
              totalMessages: currentMessages.length,
              toolResultsCount: toolResults.length,
            }
          );

          iterationCount++;
        }

        console.log(`[MCP App] Tool execution loop completed`, {
          timestamp: new Date().toISOString(),
          operation: "loopComplete",
          totalIterations: iterationCount,
          reachedMaxIterations: iterationCount >= maxIterations,
          hasFinalResponse: !!finalResponse,
        });

        // If we hit max iterations, warn
        if (iterationCount >= maxIterations) {
          console.warn(
            `[MCP App] Reached max iterations (${maxIterations}), stopping tool execution loop`
          );
        }

        if (!finalResponse) {
          throw new Error("No response from LLM");
        }
        
        // Final status update
        setLlmStatus({
          provider: `${finalResponse.provider} (${finalResponse.model})`,
          available: true,
        });

      } catch (error) {
        console.error("LLM error:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        // Update the assistant message with the error if it wasn't already handled
        const { updateMessage } = useChatStore.getState();
        // Check if we need to append or replace based on if we have an ID
        if (assistantMessageId) {
           updateMessage(assistantMessageId, {
             content: (useChatStore.getState().getActiveSession()?.messages.find(m => m.id === assistantMessageId)?.content || "") + `\n\nSorry, I couldn't process that. ${errorMessage}`
           });
        }

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
