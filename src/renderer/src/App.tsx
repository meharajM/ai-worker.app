import React, { useState, useCallback, useEffect, useRef } from "react";
import { FEATURE_FLAGS } from "./lib/constants";
import { VoiceInput } from "./components/VoiceInput";
import { ChatView } from "./components/ChatView";
import { ChatSidebar } from "./components/ChatSidebar";
import { ConnectionsPanel } from "./components/ConnectionsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { PlanCard } from "./components/PlanCard";

import { Sidebar, View } from "./components/Sidebar";
import { Header } from "./components/Header";
import { useChatStore } from "./stores/chatStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useLogStore } from "./stores/logStore";
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
import { analyzeRequest, isOrchestratorReady, isLikelySimpleTask } from "./lib/orchestrator";
import { executePlan } from "./lib/executor";
import { ToolRegistry } from "./lib/tool-registry";
import { AppModeId } from "./types/modes";

function App() {
  const [currentView, setCurrentView] = useState<View>("chat");
  const [activeMode, setActiveMode] = useState<AppModeId>("general");
  const {
    sessions,
    activeSessionId,
    addMessage,
    setProcessing,
    isProcessing,
    currentPlan,
    planningPhase,
    executionProgress,
    setCurrentPlan,
    setPlanningPhase,
    setExecutionProgress,
    approvePlan,
    rejectPlan,
  } = useChatStore();
  const { addLog } = useLogStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = activeSession?.messages || [];
  const settings = useSettingsStore();
  const { speak } = useSpeechSynthesis();


  // Independent statuses for Local and Remote
  const [localStatus, setLocalStatus] = useState<{
    provider: string | null;
    available: boolean;
    isDownloading?: boolean;
  }>({
    provider: null,
    available: false,
    isDownloading: false,
  });

  const [remoteStatus, setRemoteStatus] = useState<{
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

        // Wait a bit for connections to establish, then index tools
        // Using a short delay to let async connections complete
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Await tool indexing to ensure tools are ready before first query
        console.log('[App] Indexing tools...');
        await ToolRegistry.indexTools();
        console.log('[App] Tool indexing complete');

      } catch (error) {
        console.error("Error initializing MCP servers:", error);
      }
    };
    initializeAndAutoConnect();

    // OPTIMIZATION: Trigger background load of local model (only if WebGPU supported)
    if (FEATURE_FLAGS.BROWSER_LLM_ENABLED) {
      import('./lib/webllm').then(async ({ loadWebLLMModel, getWebLLMStatus, checkWebLLMModelCompatibility }) => {
        // Check WebGPU support first
        const status = getWebLLMStatus();
        if (!status.isSupported) {
          console.log('[App] WebGPU not supported, skipping auto-download');
          return;
        }

        const qwenModelId = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

        // Check compatibility before download
        const { compatible, reasons } = await checkWebLLMModelCompatibility(qwenModelId);
        if (!compatible) {
          console.warn('[App] Model not compatible, skipping auto-download:', reasons);
          return;
        }

        loadWebLLMModel(qwenModelId).catch(err => console.warn('[App] Background model load failed:', err));
      });
    }
  }, []);

  // AUTO-SYNC Tool Registry whenever planning starts or servers list might have changed
  useEffect(() => {
    if (planningPhase === 'analyzing') {
      console.log('[App] Auto-syncing Tool Registry before analysis...');
      ToolRegistry.indexTools().catch(err => console.error("Failed to re-index tools:", err));
    }
  }, [planningPhase]);

  // Check Remote LLM availability on mount and when settings change
  // Only check when not in settings view to avoid duplicate calls
  const checkLLMRef = React.useRef<Promise<void> | null>(null);
  const checkRemoteLLM = React.useCallback(async () => {
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

        // Use getAvailableProviders but ignore browser status here (handled via subscription)
        const providers = await getAvailableProviders(settingsForLLM);

        if (providers.ollama.available) {
          setRemoteStatus({
            provider: `Ollama (${providers.ollama.model})`,
            available: true,
          });
        } else if (providers.gemini.available) {
          setRemoteStatus({
            provider: `Gemini (${providers.gemini.model})`,
            available: true,
          });
        } else if (providers.openrouter.available) {
          setRemoteStatus({
            provider: `OpenRouter (${providers.openrouter.model})`,
            available: true,
          });
        } else if (providers.openai.available) {
          setRemoteStatus({
            provider: `OpenAI (${providers.openai.model})`,
            available: true,
          });
        } else {
          setRemoteStatus({ provider: null, available: false });
        }
      } catch (error) {
        console.error("Error checking Remote LLM:", error);
        setRemoteStatus({ provider: null, available: false });
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
      checkRemoteLLM();
    }, 500);
    return () => clearTimeout(timer);
  }, [checkRemoteLLM]);

  // Re-check every 60 seconds (reduced from 30s) when not in settings
  useEffect(() => {
    if (currentView === "settings") {
      return; // Don't poll when in settings view
    }
    const interval = setInterval(() => {
      checkRemoteLLM();
    }, 60000);
    return () => clearInterval(interval);
  }, [checkRemoteLLM, currentView]);

  // Subscribe to WebLLM status for real-time updates (Local Only)
  useEffect(() => {
    const unsubscribe = subscribeToWebLLMStatus((status: WebLLMStatus) => {
      if (status.isLoaded && status.currentModel) {
        setLocalStatus({
          provider: `On-Device (${status.currentModel})`,
          available: true,
          isDownloading: false
        });
      } else if (status.isLoading || status.backgroundDownload) {
        setLocalStatus({
          provider: `Loading ${status.loadingProgress.toFixed(0)}%`,
          available: false,
          isDownloading: true
        });
      } else {
        setLocalStatus({
          provider: null,
          available: false,
          isDownloading: false
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Handle message submission - uses orchestrator for planning
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

      console.log('>>> [App.handleSubmit] Processing:', content.trim());
      setProcessing(true);

      try {
        // Use orchestrator for planning if enabled in flags
        // This ensures a plan is always generated (and progress shown if loading)
        if (FEATURE_FLAGS.BROWSER_LLM_ENABLED) {
          setPlanningPhase('analyzing');

          addLog({
            eventType: 'DEBUG',
            sessionId: activeSessionId || "default",
            component: "App.handleSubmit",
            details: {
              metadata: {
                usingOrchestrator: true,
                stage: 'initial_analysis',
                msg: 'Checking if tools are needed'
              }
            },
          });

          try {
            // Fetch relevant tools immediately based on mode + query for 1-step analysis
            // This helps smaller models like Qwen 2.5 0.5B see availability right away
            let mcpTools = ToolRegistry.searchTools(content.trim(), activeMode);
            let llmTools: LLMTool[] = mcpTools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            }));

            addLog({
              eventType: 'DEBUG',
              sessionId: activeSessionId || "default",
              component: "App.handleSubmit",
              details: {
                metadata: {
                  msg: 'Hydrating tools for planning',
                  mode: activeMode,
                  toolCount: mcpTools.length,
                  tools: mcpTools.map(t => t.name)
                }
              }
            });

            // Analyze request WITH tools immediately
            let plan = await analyzeRequest(content.trim(), llmTools);
            console.log('>>> [App.handleSubmit] Orchestrator Plan Result:', plan);

            // If the model still thinks it needs more tools (unlikely with RAG)
            // or if it specifically flagged need for them, we could re-try,
            // but for now, 1-step with RAG is the most robust path for latency.

            addLog({
              eventType: 'DEBUG',
              sessionId: activeSessionId || "default",
              component: "App.handleSubmit",
              details: {
                metadata: {
                  planComplexity: plan.complexity,
                  planSteps: plan.plan.length,
                  requiresConfirmation: plan.requiresConfirmation,
                  recommendedProvider: plan.recommendedProvider,
                }
              },
            });

            if (!plan.requiresConfirmation) {
              console.log('>>> [App.handleSubmit] Simple/Read-only task detected, auto-executing with provider:', plan.recommendedProvider);
              setPlanningPhase('executing');
              setCurrentPlan(plan);

              // Execute immediately without showing PlanCard
              const settingsForExec = {
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

              const availableToolsForExec = mcpTools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              }));

              const result = await executePlan(
                {
                  plan: plan,
                  provider: plan.recommendedProvider,
                  userMessage: content.trim(),
                  availableTools: availableToolsForExec,
                },
                settingsForExec,
                (step, description) => {
                  setExecutionProgress({ step, description });
                }
              );

              // Add assistant response
              addMessage({
                role: "assistant",
                content: result.content || result.error || "No response generated.",
                provider: result.provider || plan.recommendedProvider,
                model: result.model || 'unknown',
              });

              if (result.success && result.provider !== 'browser') {
                setRemoteStatus({
                  provider: `${result.provider} (${result.model})`,
                  available: true,
                });
              }

              setProcessing(false);
              setCurrentPlan(null);
              setPlanningPhase('idle');
              setExecutionProgress(null);
              return;
            }

            // NORMAL PATH: Show PlanCard for complex tasks
            setCurrentPlan(plan);
            setPlanningPhase('waiting_approval');
            // Don't setProcessing(false) here - the plan approval flow handles it
            return;

          } catch (analysisError) {
            console.warn('[Orchestrator] Analysis failed, falling back to direct execution:', analysisError);
            // Fall through to direct execution below
            setPlanningPhase('idle');
          }
        }

        // Direct execution path (fallback or for simple tasks without orchestrator)
        setPlanningPhase('analyzing');
        // This preserves the original behavior for backwards compatibility
        const llmMessages: LLMMessage[] = messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
        llmMessages.push({
          role: "user",
          content: content.trim(),
        });

        const servers = getServers();
        const serverInfo: ServerInfo[] = servers
          .filter((server) => server.connected)
          .map((server) => ({
            name: server.name,
            description: server.description.substring(0, 40),
            toolCount: server.tools.length,
            isReasoningServer:
              server.name.includes("sequential-thinking") ||
              server.name.includes("sequential") ||
              server.description.toLowerCase().includes("reasoning"),
          }));

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

        // Ensure tools are available for direct execution
        // If orchestrator didn't run or decided not to fetch tools, we fetch them here for direct fallback
        // Use Registry to find relevant tools contextually
        const mcpToolsForFallback = ToolRegistry.searchTools(content.trim(), activeMode);
        const llmToolsForFallback: LLMTool[] = mcpToolsForFallback.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }));

        // Simple direct execution - single LLM call
        const response = await chat(
          llmMessages,
          llmToolsForFallback.length > 0 ? llmToolsForFallback : undefined,
          settingsForLLM,
          serverInfo.length > 0 ? serverInfo : undefined
        );

        // Handle tool calls if any (simplified for direct path)
        if (response.toolCalls && response.toolCalls.length > 0) {
          // Execute tools and get final response
          let currentMessages = [...llmMessages];
          let finalResponse = response;
          let iterationCount = 0;
          const maxIterations = 10;

          while (iterationCount < maxIterations && finalResponse.toolCalls?.length) {
            currentMessages.push({
              role: "assistant",
              content: finalResponse.content || "",
              tool_calls: finalResponse.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.arguments),
                },
              })),
            } as LLMMessage);

            for (const toolCall of finalResponse.toolCalls) {
              const result = await executeToolCall(toolCall.name, toolCall.arguments);
              const resultStr = result.error
                ? JSON.stringify({ error: result.error })
                : typeof result.result === 'string'
                  ? result.result
                  : JSON.stringify(result.result);

              currentMessages.push({
                role: "tool",
                content: resultStr.length > 4000 ? resultStr.substring(0, 4000) + '\n...(truncated)' : resultStr,
                tool_call_id: toolCall.id,
                name: toolCall.name,
              } as LLMMessage);
            }

            finalResponse = await chat(
              currentMessages,
              llmToolsForFallback.length > 0 ? llmToolsForFallback : undefined,
              settingsForLLM,
              serverInfo.length > 0 ? serverInfo : undefined
            );
            iterationCount++;
          }

          addMessage({
            role: "assistant",
            content: finalResponse.content,
            provider: finalResponse.provider,
            model: finalResponse.model,
          });
        } else {
          addMessage({
            role: "assistant",
            content: response.content,
            provider: response.provider,
            model: response.model,
          });
        }

        setRemoteStatus({
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
        setPlanningPhase('idle');
      }
    },
    [messages, addMessage, setProcessing, speak, settings, activeSessionId, addLog, setCurrentPlan, setPlanningPhase]
  );

  // Handle plan approval - execute the plan
  const handlePlanApproval = useCallback(async () => {
    if (!currentPlan) return;

    approvePlan();
    setProcessing(true);

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

      // Get available tools for executor - Optimized via Registry
      const extraIntent = currentPlan.intent; // or original message
      const mcpTools = ToolRegistry.searchTools(extraIntent, activeMode, 20); // Get top 20 relevant tools

      const availableTools = mcpTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters, // Normalized property
      }));

      // Get the user message from the last user message in the session
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      const userMessage = lastUserMessage?.content || currentPlan.intent;

      const result = await executePlan(
        {
          plan: currentPlan,
          provider: currentPlan.recommendedProvider,
          userMessage,
          availableTools,
        },
        settingsForLLM,
        (step, description) => {
          setExecutionProgress({ step, description });
        }
      );

      // Add assistant response
      addMessage({
        role: "assistant",
        content: result.content || result.error || "No response generated.",
        provider: result.provider,
        model: result.model,
      });

      // Update LLM status
      if (result.success) {
        // We assume plan execution updates the remote status if it was a remote execution
        // Or local status if it was local. For simplicity here, if provider is not 'browser', update remote.
        if (result.provider !== 'browser') {
          setRemoteStatus({
            provider: `${result.provider} (${result.model})`,
            available: true,
          });
        }
      }

      addLog({
        eventType: 'LLM_RESPONSE',
        sessionId: activeSessionId || "default",
        component: "App.handlePlanApproval",
        details: {
          output: result.content,
          metadata: {
            provider: result.provider,
            model: result.model,
            success: result.success,
            totalDuration: result.totalDuration,
            stepsExecuted: result.executedSteps.length,
          }
        },
      });

    } catch (error) {
      console.error("Plan execution error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      addMessage({
        role: "assistant",
        content: `Sorry, I couldn't complete that. ${errorMessage}`,
      });

      speak("Sorry, I couldn't complete that request.");
    } finally {
      setProcessing(false);
      setCurrentPlan(null);
      setPlanningPhase('idle');
      setExecutionProgress(null);
    }
  }, [currentPlan, approvePlan, settings, messages, addMessage, speak, activeSessionId, addLog, setProcessing, setCurrentPlan, setPlanningPhase, setExecutionProgress]);

  // Handle plan rejection
  const handlePlanRejection = useCallback(() => {
    rejectPlan();
    setProcessing(false);
  }, [rejectPlan, setProcessing]);

  return (
    <div className="flex h-screen bg-[#0f1115] text-white font-sans overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />

      <div className="flex-1 flex flex-col relative min-w-0">
        <Header
          localStatus={localStatus}
          remoteStatus={remoteStatus}
          activeMode={activeMode}
          onModeChange={setActiveMode}
        />

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {currentView === "chat" && (
            <div className="flex-1 flex overflow-hidden min-w-0">
              <ChatSidebar />
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <ChatView />

                {/* Plan Card - shows when waiting for approval */}
                {(() => {
                  if (planningPhase !== 'idle') {
                    console.log('>>> [App.render] Current Planning Phase:', planningPhase);
                  }
                  return null;
                })()}

                {planningPhase === 'waiting_approval' && currentPlan && (
                  <div className="p-4 border-t border-white/5">
                    <PlanCard
                      plan={currentPlan}
                      onApprove={handlePlanApproval}
                      onReject={handlePlanRejection}
                      autoApproving={!currentPlan.requiresConfirmation}
                    />
                  </div>
                )}

                {/* Execution Progress - shows when executing */}
                {planningPhase === 'executing' && executionProgress && (
                  <div className="p-4 border-t border-white/5">
                    <div className="bg-gradient-to-br from-[#1a1d23] to-[#252930] border border-white/10 rounded-xl p-4 flex items-center gap-3">
                      <div className="animate-spin w-5 h-5 border-2 border-white/20 border-t-[#00a896] rounded-full" />
                      <div>
                        <p className="text-sm font-medium text-white">Step {executionProgress.step}</p>
                        <p className="text-xs text-white/60">{executionProgress.description}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Analyzing indicator */}
                {planningPhase === 'analyzing' && (
                  <div className="p-4 border-t border-white/5">
                    <div className="bg-gradient-to-br from-[#1a1d23] to-[#252930] border border-white/10 rounded-xl p-4 flex items-center gap-3">
                      <div className="animate-pulse w-5 h-5 bg-[#00a896] rounded-full" />
                      <p className="text-sm text-white/80">Understanding your request...</p>
                    </div>
                  </div>
                )}

                <div className="p-4 flex-shrink-0 border-t border-white/5">
                  <VoiceInput onSubmit={handleSubmit} disabled={isProcessing || planningPhase !== 'idle'} />
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
