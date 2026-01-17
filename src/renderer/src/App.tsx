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
import { useSpeechSynthesis } from "./hooks/useSpeechSynthesis";
import { useAuthPersistence } from "./hooks/useAuthPersistence";
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
  const { addLog } = useLogStore();
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
  
  // Initialize Auth Persistence
  useAuthPersistence();

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

      // Log the user message
      addLog({
        eventType: 'USER_MESSAGE',
        sessionId: activeSessionId || "default",
        component: "App.handleSubmit",
        details: {
          input: content.trim()
        },
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

        addLog({
          eventType: 'DEBUG',
          sessionId: activeSessionId || "default",
          component: "App.handleSubmit",
          details: {
            metadata: {
              mcpToolCount: mcpTools.length,
              connectedServerCount: servers.filter((s) => s.connected).length,
              toolNames: mcpTools.map((t) => t.name),
            }
          },
        });

        // Convert to LLM format (minimal for token efficiency)
        const llmTools: LLMTool[] = mcpTools.map((tool) => ({
          name: tool.name,
          description: tool.description, // Keep full description for tool schema
          parameters: tool.inputSchema,
        }));

        // Build compact server info
        // Include all connected servers, even if they have no tools (reasoning servers)
        // Note: Reasoning servers are included for context but don't affect tool execution
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
          geminiApiKey: settings.geminiApiKey,
          geminiModel: settings.geminiModel,
          openrouterApiKey: settings.openrouterApiKey,
          openrouterModel: settings.openrouterModel,
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

        while (iterationCount < maxIterations) {
          addLog({
            eventType: 'LLM_REQUEST',
            sessionId: activeSessionId || "default",
            component: "App",
            correlationId: `iter_${iterationCount + 1}_${Date.now()}`, // Simple correlation ID for this iteration
            details: {
              metadata: {
                iteration: iterationCount + 1,
                provider: settingsForLLM.preferredProvider,
              },
              input: currentMessages, // LOGGING FULL CONTEXT
            },
          });

          let response: Awaited<ReturnType<typeof chat>>;
          try {
            // Add timeout to prevent infinite hanging
            const chatPromise = chat(
              currentMessages,
              llmTools.length > 0 ? llmTools : undefined,
              settingsForLLM,
              serverInfo.length > 0 ? serverInfo : undefined
            );

            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(new Error("LLM call timeout after 60 seconds")),
                60000
              );
            });

            response = await Promise.race([chatPromise, timeoutPromise]);
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            addLog({
              eventType: 'ERROR',
              sessionId: activeSessionId || "default",
              component: "App",
              details: {
                error: errorMessage,
                metadata: { iteration: iterationCount + 1 }
              }
            });

            // If it's a timeout or error, break the loop and show error
            finalResponse = {
              content: `Error during tool execution: ${errorMessage}. The task may be incomplete.`,
              provider: "error",
              model: "unknown",
            };
            break;
          }

          addLog({
            eventType: 'LLM_RESPONSE',
            sessionId: activeSessionId || "default",
            component: "App",
            details: {
              model: response.model,
              output: response.content, // FULL RESPONSE CONTENT
              metadata: {
                provider: response.provider,
                iteration: iterationCount + 1,
                toolCallCount: response.toolCalls?.length || 0,
              }
            },
          });

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

          // Track all tool calls for display
          allToolCalls.push(...response.toolCalls);

          // Execute tool calls
          const toolExecutionStartTime = Date.now();



          // Add assistant message with tool calls to conversation (for OpenAI API format)
          currentMessages.push({
            role: "assistant",
            content: response.content || "",
            tool_calls: response.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name,
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
              `[MCP App] Executing tool call ${i + 1}/${response.toolCalls.length
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

            // Log TOOL_CALL (AI's intention before execution)
            addLog({
              eventType: 'TOOL_CALL',
              sessionId: activeSessionId || "default",
              component: "App.ToolExecutor",
              correlationId: toolCall.id,
              details: {
                input: {
                  toolName: toolCall.name,
                  arguments: toolCall.arguments,
                }
              }
            });

            try {
              const result = await executeToolCall(
                toolCall.name,
                toolCall.arguments
              );

              const toolCallDuration = Date.now() - toolCallStartTime;

              if (result.error) {
                addLog({
                  eventType: 'ERROR',
                  sessionId: activeSessionId || "default",
                  component: "App",
                  correlationId: toolCall.id, // Linking back to the tool call request
                  durationMs: toolCallDuration,
                  details: {
                    error: result.error,
                    input: { toolName: toolCall.name }
                  }
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

                addLog({
                  eventType: 'TOOL_RESULT',
                  sessionId: activeSessionId || "default",
                  component: "App",
                  correlationId: toolCall.id, // Linking back to the tool call request
                  durationMs: toolCallDuration,
                  details: {
                    output: result.result, // RAW TOOL OUTPUT
                    input: { toolName: toolCall.name, args: toolCall.arguments } // REPEATING ARGS FOR CLARITY
                  }
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

        // Add assistant response
        addMessage({
          role: "assistant",
          content: finalResponse.content,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        });

        // Update provider status
        setLlmStatus({
          provider: `${finalResponse.provider} (${finalResponse.model})`,
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

      <div className="flex-1 flex flex-col relative min-w-0">
        <Header status={llmStatus} />

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {currentView === "chat" && (
            <div className="flex-1 flex overflow-hidden min-w-0">
              <ChatSidebar />
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
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
