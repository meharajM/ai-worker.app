import { chat } from "./llm";
import { LLMMessage, LLMTool, ServerInfo, type LLMResponse } from "./types";
import { pruneContext } from "./dcp";
import { executeToolCall, getAllTools, getServers } from "./mcp";
import { CLIENT_TOOLS } from "./client-tools";
import { analyzeTask, type TaskAnalysis } from "./confirmation-message";
import { analyzeToolOutput } from "./result-reporter";
import {
  analyzeTaskForDecomposition,
  generateSubAgentInstruction,
  type TaskDecomposition
} from "./task-decomposer";
import { MemoryReflector } from "./memory-reflector";
import { validateUserInput } from "./prompt-guard";

export type AgentStatusCallback = (message: LLMMessage) => string | void;

interface AgentRuntimeOptions {
  activeSessionId?: string;
  workspacePath?: string;  // Optional workspace folder for filesystem operations
  settings: any;
  onMessage?: AgentStatusCallback;
  signal?: AbortSignal;
  requireConfirmation?: boolean;
  onConfirmationNeeded?: (analysis: TaskAnalysis) => Promise<string | null>; // Returns enriched prompt or null to cancel
  isSubAgent?: boolean; // Flag to identify sub-agents
  taskCategory?: string; // Optional: Force a specific task category (e.g. for sub-agents)
  onMessageUpdate?: (id: string, updates: Partial<LLMMessage>) => void; // Update existing message in UI
  tabId?: number; // Dedicated browser tab ID for this agent
  parentAgentId?: string; // Link to parent for sub-agents
  agentInstanceId?: string; // Force specific ID (for pre-seeding memory)
}

export class AgentRuntime {
  private messages: LLMMessage[] = [];
  private options: AgentRuntimeOptions;
  private maxIterations: number;
  private maxConsecutiveErrors = 3; // Bailout after 3 consecutive tool failures
  private executionPlan: { goal: string; steps: Array<{ id: number; description: string; status: string; result?: string }> } | null = null;
  private taskCategory?: string; // Store identified task category
  private totalIterations = 0; // Track total iterations across all continuations
  private readonly ABSOLUTE_MAX_ITERATIONS = 150; // Hard cap to prevent runaway costs
  private toolCallHistory = new Set<string>(); // Track unique tool signatures for progress detection
  private agentInstanceId: string;
  private lastCheckpoint: { step: number; summary: string; timestamp: number } | null = null;

  constructor(options: AgentRuntimeOptions, initialHistory: LLMMessage[] = []) {
    this.options = options;

    // CRITICAL: Sub-agents MUST start with empty context for token efficiency
    if (options.isSubAgent) {
      this.messages = []; // Force empty - never inherit history
      console.log('[AgentRuntime] Sub-agent created with FRESH context (0 messages)');
    } else {
      this.messages = [...initialHistory];
      console.log(`[AgentRuntime] Main agent created with ${this.messages.length} historical messages`);
    }

    // Sub-agents get 15 iterations (enough for most tasks), main agents get 50 to allow for deep reasoning/thinking chains
    this.maxIterations = options.isSubAgent ? 15 : 50;

    // Inherit category if passed
    if (options.taskCategory) {
      this.taskCategory = options.taskCategory;
    }

    // Generate unique instance ID OR use provided one
    this.agentInstanceId = options.agentInstanceId || globalThis.crypto.randomUUID();
  }

  /**
   * Initialize or Load Session State from Memory
   */
  private async initializeSessionState() {
    const entityName = `AgentState_${this.agentInstanceId}`;
    try {
      // Try to read existing state
      const result = await executeToolCall('memory_read_entity', { name: entityName });
      if (result && result.result) {
        const entity = result.result as any;
        if (entity.Metadata?.lastCheckpoint) {
          this.lastCheckpoint = entity.Metadata.lastCheckpoint;
          console.log(`[AgentRuntime] Restored checkpoint from memory: Step ${this.lastCheckpoint?.step}`);
        }
      } else {
        // Create new state
        await executeToolCall('memory_create_entity', {
          name: entityName,
          type: 'agent_execution_state',
          description: `Agent initialized at ${new Date().toISOString()}`,
          metadata: {
            agentInstanceId: this.agentInstanceId,
            sessionId: this.options.activeSessionId || 'unknown',
            status: 'active',
            iterationCount: 0,
            isInternal: true,
            parentAgentId: this.options.parentAgentId
          }
        });
        console.log(`[AgentRuntime] Created new ExecutionState: ${entityName}`);
      }
    } catch (err) {
      console.warn(`[AgentRuntime] Failed to initialize session state: ${err}`);
    }

    // GAP FIX 3: Load parent context if sub-agent
    if (this.options.parentAgentId) {
      try {
        const parentState = await executeToolCall('memory_read_entity', {
          name: `AgentState_${this.options.parentAgentId}`
        });

        if (parentState.result) {
          const parent = parentState.result as any;
          let contextContent = '';

          // Load checkpoint summary
          if (parent.Metadata?.lastCheckpoint) {
            const checkpoint = parent.Metadata.lastCheckpoint;
            contextContent += `[Parent Context - Step ${checkpoint.step}]\n${checkpoint.summary}\n\n`;
          }

          // Load last 3 observations
          if (parent.observations && Array.isArray(parent.observations)) {
            const lastObservations = parent.observations.slice(-3);
            if (lastObservations.length > 0) {
              contextContent += `Recent Context:\n`;
              lastObservations.forEach((obs: string, idx: number) => {
                contextContent += `${idx + 1}. ${obs}\n`;
              });
            }
          }

          if (contextContent) {
            this.messages.push({
              role: 'system',
              content: `${contextContent}\nYou are a sub-agent. Use this parent context to understand the broader goal.`
            });
            console.log(`[AgentRuntime] Loaded parent context from ${this.options.parentAgentId}`);
          }
        }
      } catch (err) {
        console.warn(`[AgentRuntime] Failed to load parent context: ${err}`);
      }
    }
  }

  /**
   * Main entry point to run the agent loop.
   */
  async chat(userContent: string, attachments?: { name: string; path: string; type: string }[]): Promise<LLMMessage> {
    // PHASE 0: Prompt Injection Defense (M-01 Enhanced)
    const validation = await validateUserInput(
      userContent,
      true // Enable LLM guard for maximum security
    );

    if (!validation.allowed) {
      console.warn('[AgentRuntime] Prompt injection detected:', validation.reason);
      
      // Return error message to user (without timestamp - not in LLMMessage interface)
      return {
        role: 'assistant',
        content: validation.reason || 'I cannot process this request due to security concerns. Please rephrase your question.'
      };
    }

    // PHASE 1: Smart Confirmation (if enabled)
    let finalPrompt = userContent;

    // INJECT ATTACHMENTS CONTEXT
    // We append this to the user message to ensure it survives system prompt replacement in llm.ts
    // and to keep it tightly coupled with the user's request.
    
    // M-01 Security Fix: Use unique, tamper-evident delimiters
    const ATTACHMENT_DELIMITER_START = '<<<ATTACHMENT_BLOCK_a8f3>>>';
    const ATTACHMENT_DELIMITER_END = '<<<END_ATTACHMENT_BLOCK_a8f3>>>';
    
    // Sanitize filename to prevent control character injection
    function sanitizeFilename(filename: string): string {
      return filename.replace(/[\r\n\x00-\x1f\x7f]/g, '_');
    }
    
    let attachmentContext = '';
    if (attachments && attachments.length > 0) {
        const resourceList = attachments.map(a => `- ${sanitizeFilename(a.name)} (Path: ${a.path})`).join('\n');
        const toolHint = `\n\n[To analyze these files, use the 'convert_to_markdown' tool with file:// URIs. Example: convert_to_markdown(uri="file:///absolute/path")]`;
        
        attachmentContext = `\n\n${ATTACHMENT_DELIMITER_START}\nUser attached the following files. Use absolute paths to access them.\n${resourceList}${toolHint}\n${ATTACHMENT_DELIMITER_END}`;
        console.log('[AgentRuntime] Prepared attachment context:', resourceList);
    }

    // Initialize State (Idempotent)
    await this.initializeSessionState();

    // GAP FIX 2B: Detect and resume from pending handoffs
    if (!this.options.isSubAgent) {
      try {
        const handoffCheck = await executeToolCall('memory_search', {
          query: `handoff ${this.options.activeSessionId || ''}`
        });

        if (handoffCheck.result && typeof handoffCheck.result === 'object') {
          const resultData = handoffCheck.result as { entities?: any[] };
          if (resultData.entities && Array.isArray(resultData.entities)) {
            const pendingHandoffs = resultData.entities.filter((e: any) =>
              e.Metadata?.sessionId === this.options.activeSessionId
            );

            if (pendingHandoffs.length > 0) {
              const handoff = pendingHandoffs[0];
              console.log(`[AgentRuntime] Resuming from handoff: ${handoff.name}`);

              // Restore context from handoff
              if (handoff.Metadata?.lastCheckpoint) {
                this.lastCheckpoint = handoff.Metadata.lastCheckpoint;
              }

              // Add context message
              const contextMsg: LLMMessage = {
                role: 'system',
                content: `[Resuming from previous agent session]
Previous progress: ${handoff.Metadata?.lastCheckpoint?.summary || 'In progress...'}
Original goal: ${handoff.Metadata?.originalGoal || userContent}

Continue from where the previous agent left off.`
              };
              this.messages.push(contextMsg);

              // Delete handoff entity (consumed)
              try {
                await executeToolCall('memory_delete_entity', { name: handoff.name });
                console.log(`[AgentRuntime] Deleted consumed handoff: ${handoff.name}`);
              } catch (e) {
                console.warn(`[AgentRuntime] Failed to delete handoff: ${e}`);
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[AgentRuntime] Failed to check for handoffs: ${err}`);
      }
    }

    // PHASE 0: Task Analysis (for complexity detection and optional confirmation)
    let taskComplexity: 'simple' | 'moderate' | 'complex' = 'moderate'; // Default to moderate
    
    if (this.options.requireConfirmation && this.options.onConfirmationNeeded) {
      try {
        // Check if this is a simple reply to a previous agent question
        const isSimpleReply = /^(yes|no|ok|okay|sure|nope|continue|stop|proceed|go ahead|skip|next|back)$/i.test(userContent.trim());
        const lastMessage = this.messages[this.messages.length - 1];
        const lastContent = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
        const isReplyToQuestion = lastMessage?.role === 'assistant' && lastContent.includes('?');

        // Skip confirmation if user is just replying to the agent's question
        if (isSimpleReply && isReplyToQuestion) {
          console.log('[AgentRuntime] Simple reply to agent question. Skipping confirmation.');
          taskComplexity = 'simple';
        } else {
          console.log('[AgentRuntime] Analyzing task for ambiguity...');
          // Pass attachments to analysis - this ensures "convert this" with an attachment is NOT marked ambiguous
          const analysis = await analyzeTask(userContent, this.options.settings, attachments);

          // Capture category from analysis
          if (analysis.category) {
            this.taskCategory = analysis.category;
            console.log(`[AgentRuntime] Identified task category: ${this.taskCategory}`);
          }

          // Capture complexity level to skip decomposition for simple tasks
          if (analysis.complexity) {
            taskComplexity = analysis.complexity.level;
            console.log(`[AgentRuntime] Task complexity: ${taskComplexity}`);
          }

          if (analysis.shouldConfirm) {
            console.log('[AgentRuntime] Task needs confirmation. Asking user...');
            const enrichedPrompt = await this.options.onConfirmationNeeded(analysis);

            if (enrichedPrompt === null) {
              // User cancelled
              return {
                role: 'assistant',
                content: 'Task cancelled. Let me know when you want to try again!'
              };
            }

            finalPrompt = enrichedPrompt;
            console.log('[AgentRuntime] Using enriched prompt:', finalPrompt);
          } else {
            console.log('[AgentRuntime] Task is clear. Skipping confirmation.');
          }
        }
      } catch (error) {
        console.error('[AgentRuntime] Confirmation analysis failed:', error);
        // Continue with original prompt if analysis fails
      }
    }
    // Note: When confirmation is disabled (requireConfirmation === false), this agent is typically:
    // 1. A sub-agent spawned by the main agent with a specific task instruction
    // 2. A background process (e.g., Memory Reflector)
    // 
    // Sub-agents NEVER receive simple greetings like "hi" or "thanks" - they receive task-specific
    // instructions from the parent agent (e.g., "Search Amazon for laptops under $500").
    // Therefore, we don't need to check for simple prompts when confirmation is disabled.
    // The taskComplexity remains at its default value ('moderate').

    // PHASE 0.1: Check for Dynamic Handoff Confirmation
    const lastMsg = this.messages[this.messages.length - 1];
    const isConfirmingHandoff =
      lastMsg?.role === 'assistant' &&
      lastMsg?.content?.toString().includes('reached the maximum number of steps') &&
      /^(yes|continue|proceed|go ahead|sure)$/i.test(userContent.trim());

    if (isConfirmingHandoff) {
      console.log('[AgentRuntime] User confirmed handoff. Triggering sub-agent...');
      // Add user confirmation to history
      this.addMessage({ role: 'user', content: userContent });

      // Get the original goal (approximate by looking back)
      // Usually the first user message, or we can try to find the "step 1" context
      // Simplified: use the very first user message as the Goal
      const originalGoal = this.messages.find(m => m.role === 'user')?.content?.toString() || "Complete the task";

      return this.triggerSubAgentHandoff(originalGoal);
    }
    // PHASE 1: Task Decomposition (only for moderate/complex tasks)
    if (!this.options.isSubAgent && taskComplexity !== 'simple') {
      // Async task decomposition with LLM-based independence verification
      // Skip this for simple prompts (greetings, basic questions) to reduce latency
      console.log('[AgentRuntime] Running task decomposition analysis...');
      const decomposition = await analyzeTaskForDecomposition(
        finalPrompt,
        this.options.settings
      );
      console.log('[AgentRuntime] Task decomposition:', decomposition);

      if (decomposition.shouldFork && decomposition.type === 'multi_context') {
        const subAgentResult = await this.executeParallelSubAgents(finalPrompt, decomposition);
        // Fire-and-forget memory analysis
        MemoryReflector.getInstance().analyze(this.messages, this.options.settings);
        return subAgentResult;
      }

      // For single-context with 3+ actions, trigger sequential sub-agent orchestration
      if (decomposition.shouldFork && decomposition.type === 'single_context') {
        console.log(`[AgentRuntime] Complex single-context task: ${decomposition.estimatedActions} actions - using sequential sub-agents`);
        return this.executeSequentialSubAgents(finalPrompt, decomposition);
      }
    } else if (!this.options.isSubAgent && taskComplexity === 'simple') {
      console.log('[AgentRuntime] Simple task detected - skipping decomposition for faster response');
    }

    // Handle User Message Addition & Context Injection
    const lastMessage = this.messages[this.messages.length - 1];
    const alreadyHasMessage = lastMessage?.role === 'user' && lastMessage?.content === finalPrompt;

    if (alreadyHasMessage && lastMessage) {
      // User message exists in history (from UI). Update it with attachment context.
      // We modify the message in place to include the hidden system note
      lastMessage.content = finalPrompt + attachmentContext;
      console.log('[AgentRuntime] Updated existing user message with attachment context');
    } else {
      // User message not in history (new session or sub-agent). Add it with context.
      const userMsg: LLMMessage = { role: "user", content: finalPrompt + attachmentContext };
      this.addMessage(userMsg);
    }

    let iterationCount = 0;
    let consecutiveErrors = 0; // Track consecutive tool failures
    const recentToolCalls: string[] = []; // Track recent tool signatures to detect loops
    const MAX_IDENTICAL_CALLS = 3; // Bail out if same tool called 3+ times in a row

    while (iterationCount < this.maxIterations) {
      // Check absolute max first to prevent runaway continuations
      this.totalIterations++;

      // GAP FIX 2: Context-limit based handoff with progress check
      // Estimate token usage (rough: 4 chars per token)
      const contextText = JSON.stringify(this.messages);
      const estimatedTokens = Math.ceil(contextText.length / 4);
      const contextLimit = 100000; // Adjust based on model (Gemini 2.0 Flash = 1M tokens, but be conservative)
      const isApproachingLimit = estimatedTokens > (contextLimit * 0.8); // 80% threshold

      if (isApproachingLimit && !this.options.isSubAgent) {
        console.warn(`[AgentRuntime] Approaching context limit: ${estimatedTokens} tokens (~${Math.round(estimatedTokens / contextLimit * 100)}%)`);

        // Check if original goal has been met by analyzing progress
        const originalGoalMsg = this.messages.find(m => m.role === 'user');
        const originalGoal = originalGoalMsg?.content ? originalGoalMsg.content.toString() : '';

        // Simple progress heuristic: check if there's a checkpoint and if it mentions completion
        const summary = this.lastCheckpoint?.summary || '';
        const looksComplete = /complete|done|finished|success/i.test(summary);

        if (!looksComplete) {
          // Goal not met - create handoff
          const handoffId = `Handoff_${this.options.activeSessionId}_${Date.now()}`;

          try {
            await executeToolCall('memory_create_entity', {
              name: handoffId,
              type: 'agent_handoff',
              description: [
                `Agent ${this.agentInstanceId} approaching context limit (${estimatedTokens} tokens)`,
                `Handing off at checkpoint: ${this.lastCheckpoint?.summary || 'No checkpoint'}`,
                `Original goal: ${originalGoal.substring(0, 200)}`
              ].join('\n'),
              metadata: {
                fromAgentId: this.agentInstanceId,
                sessionId: this.options.activeSessionId,
                reason: 'context_limit',
                originalGoal: originalGoal,
                lastCheckpoint: this.lastCheckpoint,
                timestamp: Date.now(),
                estimatedTokens: estimatedTokens,
                isInternal: true
              }
            });

            console.log(`[AgentRuntime] Created handoff entity: ${handoffId}`);

            const handoffMsg: LLMMessage = {
              role: 'assistant',
              content: `I'm approaching my context limit (${estimatedTokens} tokens) and haven't fully completed the task yet. I've saved my progress and will hand off to a fresh agent instance to continue.

**Progress So Far:**
${this.lastCheckpoint?.summary || 'Working on the task...'}

Please send your next message to continue with a fresh agent.`
            };
            this.addMessage(handoffMsg);
            return handoffMsg;

          } catch (err) {
            console.error(`[AgentRuntime] Failed to create handoff: ${err}`);
          }
        }
      }

      if (this.options.signal?.aborted) {
        throw new Error("Aborted by user");
      }

      // Progressive Delegation removed due to infinite loop issues
      // Other delegation methods (sequential, parallel) are still active

      // 1. DCP: Prune context
      this.messages = pruneContext(this.messages);

      // 2. Prepare context
      const contextMessages = this.messages;

      // 3. Get Tools (MCP + Client)
      const mcpTools = getAllTools();
      const llmTools: LLMTool[] = mcpTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));

      // Add Client Tools (Sub-agent, etc.)
      const clientLlmTools: LLMTool[] = CLIENT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));

      // Deduplicate tools by name
      const toolMap = new Map<string, LLMTool>();
      const combinedTools = [...llmTools, ...clientLlmTools];

      for (const tool of combinedTools) {
        if (!toolMap.has(tool.name)) {
          toolMap.set(tool.name, tool);
        }
      }

      const allTools = Array.from(toolMap.values());

      const servers = getServers();
      const serverInfo: ServerInfo[] = servers
        .filter((server) => server.connected)
        .map((server) => {
          const isReasoningServer =
            server.name.includes("sequential-thinking") ||
            server.name.includes("sequential") ||
            server.description.toLowerCase().includes("reasoning");

          return {
            name: server.name,
            description: server.description.substring(0, 40),
            toolCount: server.tools.length,
            isReasoningServer,
          };
        });

      // 4. Call LLM
      console.log(`[AgentRuntime] Iteration ${iterationCount + 1}: Calling LLM...`);

      if (this.options.settings?.debugMode) {
        console.log('[DEBUG] Full messages history:', JSON.stringify(this.messages, null, 2));
      }

      // Include execution plan progress in context if available
      if (this.executionPlan && !this.options.isSubAgent) {
        const completed = this.executionPlan.steps.filter(s => s.status === 'completed');
        const pending = this.executionPlan.steps.filter(s => s.status === 'pending');
        const nextStep = pending[0];

        if (nextStep) {
          console.log(`[AgentRuntime] Next planned step: ${nextStep.id}. ${nextStep.description}`);

          // Inject plan context into system by adding a user message reminder
          if (iterationCount > 0 && completed.length > 0) {
            const planReminder = `[PLAN PROGRESS: ${completed.length}/${this.executionPlan.steps.length} complete. Next: Step ${nextStep.id} - ${nextStep.description}]`;
            console.log(planReminder);
          }
        }
      }

      let response: LLMResponse;

      // Get task-specific rules if category is available from analysis
      let dynamicRules: string | undefined = undefined;

      // Import helper dynamically to avoid circular deps
      const { getPromptForCategory, getComposedPrompts, PROMPTS } = await import('./prompt-library');

      // 1. Start with the base category prompt
      const promptsToLoad: string[] = [];
      if (this.taskCategory) {
        promptsToLoad.push(this.taskCategory);
      }


      // 2. PARALLEL EXECUTION DETECTION - DISABLED (Issue #1 Fix)
      // This was causing false parallels for research tasks like "Research X and Y"
      // Now handled by LLM-based verification in task-decomposer.ts
      // The old keyword-based detection was too broad and has been removed.


      // 3. Compose the final dynamic rules
      if (promptsToLoad.length > 0) {
        dynamicRules = getComposedPrompts(promptsToLoad, this.options.isSubAgent);
        console.log(`[AgentRuntime] Injected dynamic rules for: ${promptsToLoad.join(' + ')}`);
      }
      // Sub-agent context verification
      if (this.options.isSubAgent) {
        console.log(`[SubAgent] LLM call with ${contextMessages.length} messages (should be 1-3 for fresh sub-agent)`);
      }

      if (this.options.signal?.aborted) {
        throw new Error("Aborted by user");
      }


      try {
        response = await chat(
          contextMessages,
          allTools.length > 0 ? allTools : undefined,
          this.options.settings,
          serverInfo.length > 0 ? serverInfo : undefined,
          this.options.signal,
          dynamicRules,
          this.options.isSubAgent, // NEW: Enable lightweight prompt for sub-agents
          this.options.workspacePath // Inject workspace path
        );
      } catch (error) {
        console.error("[AgentRuntime] LLM Error:", error);
        console.error("[AgentRuntime] Error details:", {
          provider: this.options.settings?.preferredProvider || 'auto',
          messageCount: contextMessages.length,
          toolCount: allTools.length,
          hasSignal: !!this.options.signal,
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error)
        });

        // Provide more helpful error message
        if (error instanceof Error && error.message.includes('Failed to fetch')) {
          const provider = this.options.settings?.preferredProvider || 'auto';
          throw new Error(
            `Network error when calling LLM (provider: ${provider}). ` +
            `This could be caused by:\n` +
            `1. Invalid API key or configuration\n` +
            `2. Network connectivity issues\n` +
            `3. CORS issues (if using browser LLM)\n` +
            `4. Provider service is down\n\n` +
            `Original error: ${error.message}`
          );
        }
        throw error;
      }

      // 5. Check for Tool Calls
      if (!response.toolCalls || response.toolCalls.length === 0) {
        // FALLBACK: Detect if weak model is refusing instead of using tools
        // Strong models (Gemini 2.0 Flash, Claude) rarely trigger this
        const refusalPatterns = [
          /don't have access to/i,
          /can't (?:access|check|fetch|get)/i,
          /I (?:am|'m) (?:just|only) a/i,
          /unable to (?:browse|access)/i,
          /you(?:'ll)? need to check/i,
        ];
        const isRefusal = refusalPatterns.some(p => p.test(response.content || ''));

        // Only auto-correct once per conversation to avoid loops
        const alreadyCorrected = this.messages.some(m =>
          typeof m.content === 'string' && m.content.includes('[AUTO-CORRECT]')
        );

        if (isRefusal && !alreadyCorrected) {
          console.warn('[AgentRuntime] Model refused tool use. Auto-correcting...');
          const userQuery = this.messages.filter(m => m.role === 'user').pop();
          const query = typeof userQuery?.content === 'string' ? userQuery.content : 'the request';

          this.addMessage({
            role: 'user',
            content: `[AUTO-CORRECT] You refused to help. This is wrong - you HAVE browser tools.
            
For "${query}", use: navigate({"url": "https://google.com/search?q=${encodeURIComponent(query)}"})

Then extract the answer from the results. DO NOT refuse again.`
          });
          continue; // Retry with correction
        }

        // Append Progress Summary if available and this is the main agent (user-facing)
        if (!this.options.isSubAgent && this.lastCheckpoint) {
          const summaryText = `[Resuming Context from Checkpoint ${this.lastCheckpoint.step}]\nSummary: ${this.lastCheckpoint.summary}`;
          // Avoid duplicating if the model already included it nicely
          if (!response.content?.includes('Summary')) {
            if (response.content) response.content += `\n\n## 📝 Execution Report\n${summaryText}`;
            else response.content = `## 📝 Execution Report\n${summaryText}`;
          }
        }

        const assistantMsg: LLMMessage = {
          role: "assistant",
          content: response.content,
        };
        this.addMessage(assistantMsg);

        // DISABLED: Memory analysis on every turn causes unwanted delays
        // Memory analysis should only happen:
        // 1. When sub-agents complete (line 294) - for context preservation
        // 2. When user explicitly wants to store preferences (via tool call)
        // 
        // Fire-and-forget memory analysis (Standard Turn Complete)
        // MemoryReflector.getInstance().analyze(this.messages, this.options.settings);


        // GAP FIX 4: Production Cleanup
        // Requirement: Keep for debugging in dev mode, clear on completed status in prod
        if (process.env.NODE_ENV !== 'development') {
          try {
            const entityName = `AgentState_${this.agentInstanceId}`;
            await executeToolCall('memory_delete_entity', { name: entityName });
            console.log(`[AgentRuntime] Production cleanup: Deleted ${entityName}`);
          } catch (e) {
            console.warn(`[AgentRuntime] Production cleanup failed: ${e}`);
          }
        }

        return assistantMsg;
      }

      // 6. Handle Tool Calls
      const assistantMsg: LLMMessage = {
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: tc.arguments,
          }
        })) as any
      };
      this.addMessage(assistantMsg);

      // Execute tools
      // Execute tools in PARALLEL
      const toolPromises = response.toolCalls.map(async (call) => {
        if (this.options.signal?.aborted) return null;

        // Create a signature for this tool call to detect loops
        const toolSignature = `${call.name}:${JSON.stringify(call.arguments)}`;
        const toolNameOnly = call.name;
        recentToolCalls.push(toolSignature);

        // Track unique tool calls for progress monitoring
        this.toolCallHistory.add(toolSignature);

        // Keep only last 5 calls for loop detection
        if (recentToolCalls.length > 5) {
          recentToolCalls.shift();
        }

        // ENHANCED LOOP DETECTION: Check for both identical and similar patterns
        if (recentToolCalls.length >= MAX_IDENTICAL_CALLS) {
          const lastN = recentToolCalls.slice(-MAX_IDENTICAL_CALLS);
          const allSame = lastN.every(sig => sig === lastN[0]);

          // Also check if same tool is being called repeatedly (even with different args)
          const toolNames = lastN.map(sig => sig.split(':')[0]);
          const sameToolRepeated = toolNames.every(name => name === toolNames[0]);

          if (allSame || sameToolRepeated) {
            const loopType = allSame ? 'identical arguments' : 'similar pattern (same tool)';
            console.error(`[AgentRuntime] Infinite loop detected: ${call.name} called ${MAX_IDENTICAL_CALLS}+ times with ${loopType}`);

            // Gather information from recent tool outputs
            const recentResults = this.messages
              .filter(m => m.role === 'tool')
              .slice(-5) // Last 5 tool results
              .map(m => {
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                // Truncate but keep useful info
                return content.length > 500 ? content.substring(0, 500) + '...' : content;
              });

            // Count completed steps
            const completedSteps = this.messages.filter(m => m.role === 'tool').length;
            const uniqueToolsUsed = this.toolCallHistory.size;

            const loopMsg: LLMMessage = {
              role: 'assistant',
              content: `## ⚠️ I noticed I'm repeating the same action

I've called \`${call.name}\` **${MAX_IDENTICAL_CALLS} times** with ${loopType}, which usually means something isn't working as expected.

---

### 📊 Progress So Far
- **${completedSteps} tool calls** executed
- **${uniqueToolsUsed} unique actions** tried

### 📋 Recent Results
${recentResults.length > 0 ? recentResults.map((r, i) => `**Result ${i + 1}:**\n\`\`\`\n${r}\n\`\`\``).join('\n\n') : '_No results captured yet_'}

---

### 🔄 What would you like me to do?
1. **"Try a different approach"** - I'll use alternative methods
2. **"Continue anyway"** - I'll keep trying the current approach
3. **"Stop here"** - I'll stop and you can take over manually
4. Or give me specific instructions on what to try next`
            };
            this.addMessage(loopMsg);
            return loopMsg;
          }
        }

        console.log(`[AgentRuntime] Executing tool: ${call.name}`);

        let resultStr = "";

        // Check if it's an internal system tool
        if (call.name === 'create_execution_plan') {
          const args = call.arguments as any;
          const steps = args.steps || [];

          // Store the plan for tracking
          this.executionPlan = {
            goal: args.goal || "Unknown goal",
            steps: steps.map((s: any) => ({
              id: s.id,
              description: s.description,
              status: s.status || 'pending',
              assigned_agent: s.assigned_agent
            }))
          };

          resultStr = `Execution plan created: ${args.goal}\n\nSteps:\n${steps.map((s: any) => `${s.id}. ${s.description} [${s.assigned_agent}]`).join('\n')}\n\nI will now execute each step sequentially.`;
          console.log(`[AgentRuntime] Plan created with ${steps.length} steps:`, args.goal);


        } else if (call.name === 'scan_page_accessibility') {
          console.log(`[AgentRuntime] Scanning page accessibility tree...`);

          // Script to extract lightweight accessibility tree
          const script = `
               (function() {
                 function getAccessibilityTree(element) {
                   if (!element) return null;
                   
                   const style = window.getComputedStyle(element);
                   if (style.display === 'none' || style.visibility === 'hidden') return null;
                   
                   const role = element.getAttribute('role') || element.tagName.toLowerCase();
                   const label = element.getAttribute('aria-label') || element.innerText || '';
                   
                   const interestingRoles = ['button', 'link', 'input', 'textarea', 'select', 'heading', 'article', 'section', 'nav', 'main', 'form', 'img', 'a'];
                   const isInteresting = interestingRoles.includes(role) || 
                                         (element.onclick != null) ||
                                         (role === 'div' && (element.className.includes('btn') || element.className.includes('button')));
                   
                   if (!isInteresting && element.children.length === 0 && !label.trim()) return null;
                   
                   const node = {
                     role: role,
                     name: (label.substring(0, 50) + (label.length > 50 ? '...' : '')).replace(/\\n/g, ' ').trim(),
                   };
                   
                   if (element.id) node.id = element.id;
                   if (element.value) node.value = element.value;
                   if (element.href) node.href = element.href;
                   
                   if (element.children.length > 0) {
                     const children = Array.from(element.children)
                       .map(child => getAccessibilityTree(child))
                       .filter(c => c !== null);
                       
                     if (children.length > 0) node.children = children;
                   }
                   
                   if (!isInteresting && node.children) {
                     return node.children.length === 1 ? node.children[0] : { role: 'group', children: node.children };
                   }
                   
                   if (!isInteresting && !node.children) return null;
                   
                   return node;
                 }
                 return JSON.stringify(getAccessibilityTree(document.body));
               })()
             `;

          try {
            // Execute accessibility scan using browser_evaluate
            const result = await executeToolCall("browser_evaluate", { script });

            if (result.error) {
              resultStr = `Error scanning page: ${result.error}. Try using browser_snapshot instead if this persists.`;
            } else {
              const tree = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
              resultStr = `Page Accessibility Tree (Semantic Structure):\n${tree.substring(0, 15000)}`;
              console.log(`[AgentRuntime] Accessibility scan complete (${resultStr.length} chars)`);
            }
          } catch (err: any) {
            resultStr = `Error executing accessibility scan: ${err.message}`;
          }


        } else if (call.name === 'update_progress_summary') {
          const args = call.arguments as any;
          const summary = args.summary || '';

          if (summary.trim()) {
            // Update Local Cache
            this.lastCheckpoint = {
              step: iterationCount,
              summary: summary,
              timestamp: Date.now()
            };

            // Update Memory Entity
            await executeToolCall('memory_update_entity', {
              name: `AgentState_${this.agentInstanceId}`,
              Metadata: {
                lastCheckpoint: this.lastCheckpoint,
                status: 'active',
                iterationCount: iterationCount
              }
            });

            console.log(`[AgentRuntime] Progress checkpoint saved to memory (Step ${iterationCount})`);
          }

          resultStr = JSON.stringify({
            success: true,
            message: 'Progress checkpoint saved to persistent memory.',
            checkpointStep: iterationCount
          });

        } else if (call.name === 'delegate_sub_task') {
          const args = call.arguments as any;
          const instruction = args.instruction || "";
          let context = args.context || "";

          // Safeguard: Truncate context if too large (aligns with 500-word guidance)
          if (context.length > 5000) {
            console.warn(`[AgentRuntime] Sub-agent context too large (${context.length} chars), truncating to 5000`);
            context = context.substring(0, 5000) + "\n...[truncated for efficiency]...";
          }

          console.log(`[AgentRuntime] Delegating to sub-agent: ${instruction}`);

          // 1. Generate ID for Sub-Agent
          const subAgentId = globalThis.crypto.randomUUID();

          // 2. Pre-seed Memory with Context (Avoid passing huge string in constructor)
          try {
            const contextEntityName = `AgentState_${subAgentId}`;
            await executeToolCall('memory_create_entity', {
              name: contextEntityName,
              type: 'agent_execution_state',
              description: [
                `Sub-agent initialized for task: ${instruction}`,
                `Context Summary: ${context}`
              ].join('\n'),
              metadata: {
                agentInstanceId: subAgentId,
                sessionId: this.options.activeSessionId || 'unknown',
                status: 'active',
                iterationCount: 0,
                parentAgentId: this.agentInstanceId, // Link to me
                isInternal: true
              }
            });
            console.log(`[AgentRuntime] Pre-seeded memory for sub-agent ${subAgentId}`);
          } catch (err) {
            console.warn(`[AgentRuntime] Failed to pre-seed sub-agent memory: ${err}`);
          }

          // Provision a dedicated browser tab for this sub-agent to ensure isolation
          let subAgentTabId: number | undefined;
          try {
            // Import lock dynamically
            const { browserLock } = await import('./resource-lock');
            const tabResult = await browserLock.runExclusive(async () => {
              return await executeToolCall('new_tab', { url: 'about:blank' });
            });

            const resAny = tabResult.result as any;
            if (resAny && resAny.tabId !== undefined) {
              subAgentTabId = resAny.tabId;
              console.log(`[AgentRuntime] Provisioned tab ${subAgentTabId} for sub-agent`);
            }
          } catch (e) {
            console.warn('[AgentRuntime] Failed to provision tab for sub-agent', e);
          }

          // Create sub-agent with isolated context and dedicated tab
          const subAgent = new AgentRuntime({
            ...this.options,
            isSubAgent: true,
            tabId: subAgentTabId,
            taskCategory: this.taskCategory, // Inherit category for safety protocols
            requireConfirmation: false,
            agentInstanceId: subAgentId, // Use pre-generated ID
            parentAgentId: this.agentInstanceId, // Link to me
            onMessage: (msg: LLMMessage) => {
              const contentStr = typeof msg.content === 'string'
                ? msg.content
                : Array.isArray(msg.content) ? msg.content.map(c => c.type === 'text' ? c.text : '[Image]').join(' ') : '';
              console.log(`[SubAgent Tab:${subAgentTabId ?? 'default'}] ${msg.role}: ${contentStr ? contentStr.substring(0, 50) : '...'}`);
            }
          });

          try {
            // MINIMAL prompt - just instruction and context
            const prompt = `${instruction}${context ? `\n\nContext: ${context}` : ''}

Return key findings only. End with "✓ Done".`;

            const finalRes = await subAgent.chat(prompt);
            const finalContent = typeof finalRes.content === 'string'
              ? finalRes.content
              : finalRes.content.map(c => c.type === 'text' ? c.text : '').join('');

            // CLEANUP: Close the sub-agent's tab to save resources
            if (subAgentTabId !== undefined) {
              try {
                const { browserLock } = await import('./resource-lock');
                await browserLock.runExclusive(async () => {
                  await executeToolCall('close_tab', { tabId: subAgentTabId });
                });
                console.log(`[AgentRuntime] Closed sub-agent tab ${subAgentTabId}`);
              } catch (e) {
                console.warn(`[AgentRuntime] Failed to close sub-agent tab ${subAgentTabId}`, e);
              }
            }

            // Return raw content without wrapper (save tokens)
            resultStr = finalContent.trim();

            // Update execution plan if we have one
            if (this.executionPlan) {
              // Try to match this task to a plan step
              const matchingStep = this.executionPlan.steps.find(s =>
                s.status === 'pending' &&
                (instruction.toLowerCase().includes(s.description.toLowerCase().substring(0, 20)) ||
                  s.description.toLowerCase().includes(instruction.toLowerCase().substring(0, 20)))
              );

              if (matchingStep) {
                matchingStep.status = 'completed';
                matchingStep.result = finalContent.substring(0, 200); // Store brief result
                console.log(`[AgentRuntime] Plan step ${matchingStep.id} completed: ${matchingStep.description}`);

                // Calculate progress
                const completed = this.executionPlan.steps.filter(s => s.status === 'completed').length;
                const total = this.executionPlan.steps.length;
                console.log(`[AgentRuntime] Plan progress: ${completed}/${total} steps completed`);
              }
            }
          } catch (err: any) {
            resultStr = `Sub-agent failed: ${err.message}`;
          }

        } else {
          // Standard MCP tool with SELF-HEALING Wrapper
          const executeCallWithSelfHealing = async (name: string, args: Record<string, unknown>, attempt = 1): Promise<any> => {
            try {
              // DYNAMIC RESOURCE LOCKING
              // We lock based on tool type to prevent race conditions during parallel execution
              let result;


              // Import Lane Manager dynamically
              const { laneManager } = await import('./execution-lanes');
              const { STATEFUL_BROWSER_TOOLS } = await import('./client-tools');

              // INJECTION: If this agent has a dedicated tab, force all browser tools to use it
              if (this.options.tabId !== undefined && STATEFUL_BROWSER_TOOLS.includes(name)) {
                args.tabId = this.options.tabId;
              }

              // INJECTION: Add workspace path to filesystem tools for security validation
              if (name.startsWith('fs_') && this.options.workspacePath) {
                args.workspacePath = this.options.workspacePath;
              }

              // EXECUTE via Lane Manager
              // It handles routing (Browser Serial vs Tab Serial vs API Parallel)
              result = await laneManager.getLane(name, { tabId: this.options.tabId }).run(async () => {
                return await executeToolCall(name, args);
              });

              return result;

            } catch (error: any) {
              const errorStr = String(error);

              // RECOVERY STRATEGIES (Max 2 Attempts)
              if (attempt <= 2) {
                // Strategy 1: Context Destroyed (Navigation Race Condition)
                if (errorStr.includes('Execution context was destroyed')) {
                  console.log(`[Self-Healing] Context destroyed during ${name}. Waiting 1s and retrying...`);
                  await new Promise(r => setTimeout(r, 1000));
                  return executeCallWithSelfHealing(name, args, attempt + 1);
                }

                // Strategy 2: Stale Element (DOM Update)
                if (errorStr.includes('Element is not attached') || errorStr.includes('Node is detached')) {
                  console.log(`[Self-Healing] Stale element in ${name}. Retrying immediately...`);
                  return executeCallWithSelfHealing(name, args, attempt + 1);
                }

                // Strategy 3: Timeout (Increase Timeout)
                if (errorStr.includes('Timeout') && args.timeout && typeof args.timeout === 'number') {
                  console.log(`[Self-Healing] Timeout in ${name}. Retrying with double timeout...`);
                  const newArgs = { ...args, timeout: args.timeout * 2 };
                  return executeCallWithSelfHealing(name, newArgs, attempt + 1);
                }

                // Strategy 4: Network Errors (Transient)
                if (errorStr.includes('net::ERR_') || errorStr.includes('ECONNREFUSED') || errorStr.includes('fetch failed')) {
                  console.log(`[Self-Healing] Network error in ${name}. Retrying in 2s...`);
                  await new Promise(r => setTimeout(r, 2000));
                  return executeCallWithSelfHealing(name, args, attempt + 1);
                }

                // Strategy 5: Browser Context Lost (Transient)
                if (errorStr.includes('Target closed') || errorStr.includes('Session closed') || errorStr.includes('Browser has been closed')) {
                  console.log(`[Self-Healing] Browser context lost in ${name}. Retrying in 1s...`);
                  await new Promise(r => setTimeout(r, 1000));
                  return executeCallWithSelfHealing(name, args, attempt + 1);
                }

                // Strategy 6: Element Not Found (Retry with longer wait - page might be loading)
                if (errorStr.includes('Element not found') || errorStr.includes('waiting for selector') || errorStr.includes('No element matches')) {
                  console.log(`[Self-Healing] Element not found in ${name}. Retrying with longer wait...`);
                  const newArgs = { ...args, timeout: (args.timeout as number || 5000) * 1.5 };
                  return executeCallWithSelfHealing(name, newArgs, attempt + 1);
                }

                // Strategy 7: Navigation Timeout (Retry with longer timeout)
                if (errorStr.includes('Navigation timeout') || errorStr.includes('page.goto')) {
                  console.log(`[Self-Healing] Navigation timeout in ${name}. Retrying with extended timeout...`);
                  const newArgs = { ...args, timeout: (args.timeout as number || 30000) * 1.5 };
                  return executeCallWithSelfHealing(name, newArgs, attempt + 1);
                }
              }

              // DON'T auto-retry syntax/logic errors - they need LLM intervention
              if (errorStr.includes('Syntax error') || errorStr.includes('ReferenceError') || errorStr.includes('TypeError') || errorStr.includes('Unexpected identifier')) {
                console.log(`[Self-Healing] Syntax/logic error detected in ${name} - delegating to LLM for correction`);
                // Fall through to error return with enhanced hints
              }

              // Fallback to error return
              return { result: null, error: errorStr };
            }
          };

          try {
            // Execute with self-healing wrapper
            let result = await executeCallWithSelfHealing(call.name, call.arguments as Record<string, unknown>);
            // Type assertion to handle 'unknown' return from locking
            const typedResult = result as { result: unknown; error?: string };

            if (typedResult.error) {
              // Enrich error message with recovery hints
              const errorMsg = typedResult.error;
              let recoveryHint = '';

              if (errorMsg.includes('not found') || errorMsg.includes('Timeout')) {
                recoveryHint = '\n\n💡 **Recovery Tip**: The element was not found. Try:\n1. Take a screenshot to see the current page state.\n2. Use `get_state` to list available elements.\n3. Use a different, more general selector (e.g., text-based like `text="Submit"`).\n4. The page might have changed—verify the URL is correct.';
              } else if (errorMsg.includes('not visible') || errorMsg.includes('hidden')) {
                recoveryHint = '\n\n💡 **Recovery Tip**: The element exists but is hidden. Try:\n1. Scroll the page first (`scroll`).\n2. Wait for animations to complete (`wait`).\n3. Check if a modal or popup is blocking.';
              } else if (errorMsg.includes('Syntax error') || errorMsg.includes('JavaScript evaluation')) {
                recoveryHint = '\n\n💡 **Recovery Tip**: Selector syntax error detected. Common fixes:\n1. **Use text-based selectors** instead: `click_text("wireless headphones")` or `click_text("Add to cart")`\n2. **Check attribute quotes**: `div[data-attr="value"]` not `div[data-attr=value]`\n3. **Use simpler selectors**: Try `get_interactive_elements()` to see available elements\n4. **Escape special characters**: Use `\\` before special chars in selectors';
              } else if (errorMsg.includes('Missing required parameter')) {
                recoveryHint = `\n\n💡 **Recovery Tip**: A required parameter was missing. Check the tool definition and ensure all required fields are provided.`;
              } else if (errorMsg.includes('ExtractionError')) {
                recoveryHint = '\n\n💡 **Recovery Tip**: Extraction failed (empty results). The selector is likely wrong. \n1. **Use `get_interactive_elements`** immediately to find the correct selector.\n2. Do NOT retry the same selector.';
              }

              resultStr = JSON.stringify({ error: errorMsg + recoveryHint });
              consecutiveErrors++;
            } else {
              resultStr = typeof typedResult.result === 'string'
                ? typedResult.result
                : JSON.stringify(typedResult.result);
              consecutiveErrors = 0; // Reset on success
            }
          } catch (err: any) {
            resultStr = JSON.stringify({ error: err.message || "Unknown error" });
            consecutiveErrors++;
          }

          // Bailout check: stop if too many consecutive errors
          if (consecutiveErrors >= this.maxConsecutiveErrors) {
            console.error(`[AgentRuntime] Bailing out after ${consecutiveErrors} consecutive errors`);
            const bailoutMsg: LLMMessage = {
              role: 'assistant',
              content: `I encountered ${consecutiveErrors} consecutive errors and am stopping to prevent an infinite loop. The last error was: ${resultStr}\n\nPlease try a different approach or simplify the task.`
            };
            this.addMessage(bailoutMsg);
            return bailoutMsg;
          }
        }

        // CRITICAL: Truncate tool outputs to prevent context bloat
        // Tools like get_state can return 100k+ characters, quickly exceeding token limits
        const MAX_TOOL_OUTPUT_LENGTH = 5000;
        let truncatedResultStr = resultStr;

        if (resultStr.length > MAX_TOOL_OUTPUT_LENGTH) {
          // Check if it's an error - preserve full error messages
          const isError = resultStr.includes('"error":') || resultStr.startsWith('Error:');

          if (!isError) {
            truncatedResultStr = resultStr.substring(0, MAX_TOOL_OUTPUT_LENGTH) +
              `\n\n[Tool output truncated from ${resultStr.length} to ${MAX_TOOL_OUTPUT_LENGTH} chars to save context. 💡 TIP: If you don't see what you need, use a more specific selector or filter instead of dumping the whole page.]`;
            console.log(`[AgentRuntime] Truncated ${call.name} output: ${resultStr.length} → ${MAX_TOOL_OUTPUT_LENGTH} chars`);
          }
        }

        // Add tool result
        this.addMessage({
          role: "tool",
          content: truncatedResultStr,
          tool_call_id: call.id
        });

        // INCREMENTAL REPORTING: Check if this result is presentable to the user
        if (!this.options.isSubAgent) {
          try {
            const analysisResult = analyzeToolOutput(call.name, resultStr);
            if (analysisResult.hasPresentableData && analysisResult.summary) {
              // Show findings to user immediately
              this.addMessage({
                role: 'assistant',
                content: `**📋 Finding:**\n${analysisResult.summary}`
              });
              console.log(`[AgentRuntime] Reported finding: ${analysisResult.summary.substring(0, 50)}...`);
            }
          } catch (e) {
            console.warn('[AgentRuntime] Failed to analyze tool output:', e);
          }
        }
        return undefined;
      });

      const results = await Promise.all(toolPromises);

      // Check for bailouts (e.g. infinite loops)
      const bailout = results.find(r => r && r.role === 'assistant');
      if (bailout) return bailout;

      iterationCount++;

      // CHECKPOINT: Request progress summary at iterations 15, 30, 45...
      // Relaxed enforcement to prevent infinite loops
      const CHECKPOINT_INTERVAL = 15;
      if (!this.options.isSubAgent && iterationCount % CHECKPOINT_INTERVAL === 0 && iterationCount > 0) {
        // Check if summary was recorded for this checkpoint iteration
        const lastRecordedIteration = this.lastCheckpoint?.step || 0;

        if (lastRecordedIteration < iterationCount) {
          console.log(`[AgentRuntime] Checkpoint ${iterationCount}: Requesting progress summary...`);

          // Add user message (stronger than system) to request summary
          // Using 'user' role ensures the LLM sees it as a direct instruction
          this.addMessage({
            role: 'user',
            content: `[CHECKPOINT ${iterationCount}] Please call update_progress_summary now with a brief summary of your findings and progress in the last ${CHECKPOINT_INTERVAL} steps.`
          });

          // DO NOT continue - let the loop proceed normally
          // The LLM will see the message and likely call the tool
          // If it doesn't, we'll generate a fallback summary after a few more iterations
        } else {
          console.log(`[AgentRuntime] Checkpoint ${iterationCount}: Summary recorded ✓`);
        }
      }

      // FALLBACK: If checkpoint was requested 3+ iterations ago but still not recorded, auto-generate summary
      const lastRecordedIteration = this.lastCheckpoint?.step || 0;
      const iterationsSinceLastCheckpoint = iterationCount - lastRecordedIteration;
      const shouldHaveCheckpoint = iterationCount >= CHECKPOINT_INTERVAL && iterationCount % CHECKPOINT_INTERVAL <= 3;

      if (!this.options.isSubAgent && shouldHaveCheckpoint && iterationsSinceLastCheckpoint >= CHECKPOINT_INTERVAL + 3) {
        console.warn(`[AgentRuntime] Checkpoint overdue by ${iterationsSinceLastCheckpoint - CHECKPOINT_INTERVAL} iterations. Auto-generating summary...`);

        // Generate fallback summary from recent tool outputs
        const recentToolMessages = this.messages
          .filter(m => m.role === 'tool')
          .slice(-5)
          .map(m => {
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return content.substring(0, 100);
          });

        const fallbackSummary = `Auto-generated checkpoint at iteration ${iterationCount}. Recent actions: ${recentToolMessages.join('; ') || 'Processing...'}`.substring(0, 200);

        // Update checkpoint directly
        this.lastCheckpoint = {
          step: iterationCount,
          summary: fallbackSummary,
          timestamp: Date.now()
        };

        console.log(`[AgentRuntime] Fallback summary generated: ${fallbackSummary}`);
      }
    }

    // If we reach here, we hit max iterations
    if (!this.options.isSubAgent) {
      console.log(`[AgentRuntime] Max iterations (${this.maxIterations}) reached. Checking if user wants to continue...`);

      // Summarize recent tool outputs for context
      const recentToolOutputs = this.messages
        .filter(m => m.role === 'tool')
        .slice(-2) // Last 2 tool outputs
        .map(m => {
          const content = typeof m.content === 'string' ? m.content : '';
          return content.substring(0, 300) + (content.length > 300 ? '...' : '');
        })
        .join('\n\n');

      // Progress analysis
      const uniqueToolsUsed = this.toolCallHistory.size;
      const progressIndicator = uniqueToolsUsed > iterationCount * 0.5
        ? '✅ Making diverse progress'
        : '⚠️ Possibly stuck in a loop';

      // Use LLM-generated progress summaries
      const summary = this.lastCheckpoint
        ? this.lastCheckpoint.summary
        : 'No progress summaries recorded yet. The agent may not have reached any checkpoints.';

      const handoffMsg: LLMMessage = {
        role: 'assistant',
        content: `I've worked for **${this.maxIterations} steps** but haven't finished yet.

**Progress Status:** ${progressIndicator} (${uniqueToolsUsed} unique tool calls so far)

**Progress Summary:**
${summary || 'Executed several actions.'}

**Latest Results:**
${recentToolOutputs || 'Processing data...'}

Would you like me to continue with a fresh sub-agent?`,
        actions: [
          {
            type: 'continue',
            label: '▶️ Continue Task',
            payload: { goal: finalPrompt }
          },
          {
            type: 'cancel',
            label: '⏹️ Stop Here',
            payload: {}
          }
        ]
      };

      this.addMessage(handoffMsg);
      return handoffMsg;
    }

    throw new Error(`Max iterations (${this.maxIterations}) reached. Task appears stuck or too complex.`);
  }

  /**
   * Helper to continue with sub-agent based on history
   */
  private async triggerSubAgentHandoff(originalRequest: string): Promise<LLMMessage> {
    // Recalculate steps roughly based on history length / 2
    const stepsTaken = Math.floor(this.messages.length / 2);
    return this.continueWithSubAgent(originalRequest, stepsTaken);
  }

  /**
   * Dynamically hand off remaining work to a sub-agent
   */
  private async continueWithSubAgent(
    originalRequest: string,
    stepsTaken: number
  ): Promise<LLMMessage> {
    // Use LLM-generated progress summaries instead of reconstructing from messages
    const progressContext = this.lastCheckpoint
      ? `Last Checkpoint: ${this.lastCheckpoint.summary}`
      : 'No detailed progress recorded yet.';

    const instruction = `GOAL: ${originalRequest}

CONTEXT: I have already taken ${stepsTaken} steps but haven't finished.
Progress so far:
${progressContext}

INSTRUCTION: Continue the task from here. You have a fresh context window.
Focus on the next logical steps to complete the goal.
Use tools immediately. End with "✓ Done".`;

    // Create a sequential sub-agent with the "continuation" instruction
    const decomposition: TaskDecomposition = {
      type: 'single_context',
      contexts: ['continuation'],
      estimatedActions: 10,
      shouldFork: true,
      forkReason: 'User confirmed continuation after max iterations'
    };

    // Let's manually spin up an AgentRuntime to be safe and direct
    const subAgent = new AgentRuntime({
      ...this.options,
      isSubAgent: true,
      taskCategory: this.taskCategory,
      onMessage: (msg) => {
        if (msg.role === 'assistant' && msg.content) {
          // Pass through partial updates if needed
        }
      }
    });

    this.addMessage({
      role: 'assistant',
      content: `Starting sub-agent to continue the task...`
    });

    try {
      const result = await subAgent.chat(instruction);
      return result;
    } catch (error) {
      throw new Error(`Sub-agent failed to complete task: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private addMessage(msg: LLMMessage): string | void {
    this.messages.push(msg);
    if (this.options.onMessage) {
      return this.options.onMessage(msg);
    }
  }

  getHistory(): LLMMessage[] {
    return this.messages;
  }

  /**
   * Execute sub-agents in parallel for multi-context tasks.
   * Each context (website/app) gets its own sub-agent.
   */
  private async executeParallelSubAgents(
    originalRequest: string,
    decomposition: TaskDecomposition
  ): Promise<LLMMessage> {
    const { contexts } = decomposition;

    // Track status of each sub-agent
    const agentStatuses = contexts.map(ctx => ({
      context: ctx,
      status: 'Starting...',
      isRunning: true,
      result: null as string | null
    }));

    // Helper to render the live status message
    const renderStatus = () => {
      let content = `## ⚡ Parallel Execution\n\n`;

      for (const s of agentStatuses) {
        const icon = s.isRunning ? '⟳' : (s.result?.startsWith('Error') ? '⚠️' : '✓');
        // Bold the context, show status in small text
        content += `- **${s.context}**: ${s.isRunning ? `*${s.status}*` : (s.result ? 'Completed' : s.status)}\n`;
      }

      // Add footer if still running
      if (agentStatuses.some(s => s.isRunning)) {
        content += `\n---\n*Working on ${contexts.length} sources...*`;
      }

      return content;
    };

    // Initial status message
    const statusMessage: LLMMessage = {
      role: 'assistant',
      content: renderStatus()
    };

    // Capture the ID of the status message so we can update it
    const statusMessageId = this.addMessage(statusMessage) as string | undefined;

    // Create sub-agents for each context
    const subAgentPromises = contexts.map(async (context, index) => {
      const instruction = generateSubAgentInstruction(originalRequest, context, contexts);

      console.log(`[AgentRuntime] Spawning sub-agent for: ${context}`);

      // GAP FIX 1A: Pre-seed memory for parallel sub-agent
      const subAgentId = globalThis.crypto.randomUUID();

      try {
        await executeToolCall('memory_create_entity', {
          name: `AgentState_${subAgentId}`,
          type: 'agent_execution_state',
          description: [
            `Parallel sub-agent for context: ${context}`,
            `Task: ${originalRequest}`,
            `Initialized at ${new Date().toISOString()}`
          ].join('\n'),
          metadata: {
            agentInstanceId: subAgentId,
            sessionId: this.options.activeSessionId || 'unknown',
            parentAgentId: this.agentInstanceId,
            status: 'active',
            iterationCount: 0,
            isInternal: true,
            context: context
          }
        });
        console.log(`[AgentRuntime] Pre-seeded memory for parallel sub-agent ${subAgentId}`);
      } catch (err) {
        console.warn(`[AgentRuntime] Failed to pre-seed sub-agent memory: ${err}`);
      }

      const subAgent = new AgentRuntime({
        ...this.options,
        agentInstanceId: subAgentId,
        parentAgentId: this.agentInstanceId,
        isSubAgent: true,
        taskCategory: this.taskCategory, // Inherit category from parent
        requireConfirmation: false,
        onMessage: (msg: LLMMessage) => {
          // Update status based on sub-agent activity
          let newStatus = '';
          if (msg.role === 'assistant' && msg.content) {
            // Use thought process or content start
            const content = typeof msg.content === 'string' ? msg.content : '';
            if (content.includes('<think>')) {
              newStatus = 'Thinking...';
            } else {
              newStatus = 'Processing response...';
            }
          } else if (msg.tool_calls && msg.tool_calls.length > 0) {
            const toolName = msg.tool_calls[0].function.name;
            if (toolName.includes('navigate')) newStatus = 'Navigating...';
            else if (toolName.includes('click')) newStatus = 'Interacting...';
            else if (toolName.includes('search')) newStatus = 'Searching...';
            else newStatus = `Using ${toolName}...`;
          }

          if (newStatus) {
            agentStatuses[index].status = newStatus;
            // Trigger update
            if (statusMessageId && this.options.onMessageUpdate) {
              this.options.onMessageUpdate(statusMessageId, { content: renderStatus() });
            }
          }

          const contentStr = typeof msg.content === 'string'
            ? msg.content
            : msg.content.map(c => c.type === 'text' ? c.text : '[Image]').join(' ');
          console.log(`[SubAgent:${context}] ${msg.role}: ${contentStr?.substring(0, 50)}...`);
        }
      });

      try {
        const result = await subAgent.chat(instruction);
        const resultContent = typeof result.content === 'string'
          ? result.content
          : result.content.map(c => c.type === 'text' ? c.text : '').join('');

        // Update final status
        agentStatuses[index].isRunning = false;
        agentStatuses[index].result = resultContent;
        agentStatuses[index].status = 'Done';

        if (statusMessageId && this.options.onMessageUpdate) {
          this.options.onMessageUpdate(statusMessageId, { content: renderStatus() });
        }

        // REPORTING FIX: Immediately show the result to the user as a distinct message
        this.addMessage({
          role: 'assistant',
          content: `**✅ ${context} Analysis Complete**\n\n${resultContent.substring(0, 500)}${resultContent.length > 500 ? '...' : ''}`
        });

        return {
          context,
          success: true,
          result: resultContent
        };
      } catch (error: any) {
        agentStatuses[index].isRunning = false;
        agentStatuses[index].status = 'Failed';
        agentStatuses[index].result = `Error: ${error.message}`;

        if (statusMessageId && this.options.onMessageUpdate) {
          this.options.onMessageUpdate(statusMessageId, { content: renderStatus() });
        }

        return {
          context,
          success: false,
          result: `Error: ${error.message}`
        };
      }
    });

    // Wait for all sub-agents to complete
    const results = await Promise.all(subAgentPromises);

    // Combine results
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    // Format the final output using a cleaner structure
    let summary = `## Results from ${contexts.length} sources\n\n`;

    // 1. Successful results
    for (const result of successfulResults) {
      summary += `### ${result.context}\n${result.result.trim()}\n\n`;
    }

    // 2. Failed results (if any)
    if (failedResults.length > 0) {
      summary += `### ⚠️ Failed Sources\n`;
      for (const result of failedResults) {
        summary += `- **${result.context}**: ${result.result}\n`;
      }
      summary += `\n`;
    }

    // 3. Overall validation (Footer)
    summary += `---\n\n*Parallel execution complete: ${successfulResults.length}/${contexts.length} sources succeeded.*`;

    // Update the status message one last time with the FINAL result
    // effectively replacing the progress view with the result view
    if (statusMessageId && this.options.onMessageUpdate) {
      this.options.onMessageUpdate(statusMessageId, { content: summary });
    }

    return {
      role: 'assistant',
      content: summary,
    };
  }

  /**
   * Execute sub-agents sequentially for complex single-context tasks.
   * Creates a plan and delegates each step to a fresh sub-agent.
   */
  private async executeSequentialSubAgents(
    originalRequest: string,
    decomposition: TaskDecomposition
  ): Promise<LLMMessage> {
    const { contexts, estimatedActions } = decomposition;
    const targetContext = contexts[0] || 'task';

    // Notify user about auto-orchestration
    const planMessage: LLMMessage = {
      role: 'assistant',
      content: `📋 **Auto-Orchestration**: This task requires ~${estimatedActions} steps. I'll break it down and execute each part efficiently to preserve context.\n\nAnalyzing...`
    };
    this.addMessage(planMessage);
    this.options.onMessage?.(planMessage); // Forward to UI

    // Step 1: Create high-level plan using LLM
    console.log('[AgentRuntime] Generating execution plan...');
    const planPrompt = `Break this task into 3-5 CONCRETE steps for an automation agent:

TASK: ${originalRequest}
TARGET: ${targetContext}

Rules:
- Each step = 1-3 tool calls (could be browser, file, API, database, messaging, etc.)
- Be specific: include URLs, filenames, endpoints, or identifiers when known
- NO vague steps like "gather information" or "clarify requirements"
- Each step should produce a clear, verifiable result

Format as JSON:
{
  "steps": [
    {"id": 1, "description": "Navigate to example.com OR Open file X OR Call API Y"},
    {"id": 2, "description": "Perform the main action"},
    {"id": 3, "description": "Extract/save results"}
  ]
}`;

    try {
      const planResponse = await chat(
        [{ role: 'user', content: planPrompt }],
        [], // tools
        this.options.settings,
        [], // servers
        this.options.signal
      );

      let planData: { steps: Array<{ id: number; description: string }> } | null = null;
      try {
        const jsonMatch = planResponse.content.match(/\{[\s\S]*"steps"[\s\S]*\}/);
        if (jsonMatch) {
          planData = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // JSON parse failed, will use fallback
      }

      // Fallback if no valid plan
      if (!planData || !planData.steps || planData.steps.length === 0) {
        planData = {
          steps: [
            { id: 1, description: `Navigate to ${targetContext === 'current_page' ? 'the target website' : targetContext}` },
            { id: 2, description: `Complete the main action: ${originalRequest.substring(0, 80)}` },
            { id: 3, description: "Verify results and extract relevant information" }
          ]
        };
      }

      const steps = planData.steps;
      console.log(`[AgentRuntime] Plan created with ${steps.length} steps`);

      // Display plan to user
      const planDisplayMsg: LLMMessage = {
        role: 'assistant',
        content: `## Execution Plan\n\n${steps.map((s) => `**Step ${s.id}**: ${s.description}`).join('\n')}\n\n---\n`
      };
      this.addMessage(planDisplayMsg);
      this.options.onMessage?.(planDisplayMsg);

      // Step 2: Execute each step via sub-agent
      const results: Array<{ step: number; description: string; result: string }> = [];

      for (const step of steps) {
        // Check for abort before each step
        if (this.options.signal?.aborted) {
          console.log('[AgentRuntime] Sequential orchestration aborted by user');
          throw new Error('Aborted by user');
        }

        console.log(`[AgentRuntime] Executing step ${step.id}: ${step.description}`);

        // Build context from previous steps
        const previousStepsSummary = results.length > 0
          ? `\n\nCOMPLETED STEPS:\n${results.map(r => `- Step ${r.step}: ${r.result.substring(0, 100)}${r.result.length > 100 ? '...' : ''}`).join('\n')}`
          : '';

        // Include original goal + current step + context
        const subAgentInstruction = `GOAL: ${originalRequest}

CURRENT STEP (${step.id}/${steps.length}): ${step.description}
${previousStepsSummary}

Execute this step using available tools. State persists from previous steps.
End with "✓ Done" and a brief result.`;

        // GAP FIX 1B: Pre-seed memory for sequential sub-agent
        const subAgentId = globalThis.crypto.randomUUID();

        try {
          await executeToolCall('memory_create_entity', {
            name: `AgentState_${subAgentId}`,
            type: 'agent_execution_state',
            description: [
              `Sequential sub-agent for step ${step.id}/${steps.length}`,
              `Task: ${step.description}`,
              `Parent task: ${originalRequest}`,
              `Initialized at ${new Date().toISOString()}`
            ].join('\n'),
            metadata: {
              agentInstanceId: subAgentId,
              sessionId: this.options.activeSessionId || 'unknown',
              parentAgentId: this.agentInstanceId,
              status: 'active',
              iterationCount: 0,
              isInternal: true,
              stepId: step.id,
              stepDescription: step.description
            }
          });
          console.log(`[AgentRuntime] Pre-seeded memory for sequential sub-agent ${subAgentId} (step ${step.id})`);
        } catch (err) {
          console.warn(`[AgentRuntime] Failed to pre-seed sub-agent memory: ${err}`);
        }

        const subAgent = new AgentRuntime({
          ...this.options,
          agentInstanceId: subAgentId,
          parentAgentId: this.agentInstanceId,
          isSubAgent: true,
          taskCategory: this.taskCategory,
          requireConfirmation: false,
          onMessage: (msg) => {
            const contentStr = typeof msg.content === 'string'
              ? msg.content
              : msg.content.map(c => c.type === 'text' ? c.text : '[Image]').join(' ');
            console.log(`[SubAgent:Step${step.id}] ${msg.role}: ${contentStr?.substring(0, 50)}...`);
          }
        });

        try {
          const stepResult = await subAgent.chat(subAgentInstruction);
          const stepContent = typeof stepResult.content === 'string'
            ? stepResult.content
            : stepResult.content.map(c => c.type === 'text' ? c.text : '').join('');

          results.push({
            step: step.id,
            description: step.description,
            result: stepContent.trim()
          });

          // Show progress to user
          const progressMessage: LLMMessage = {
            role: 'assistant',
            content: `✓ **Step ${step.id} completed**\n${stepContent.substring(0, 150)}${stepContent.length > 150 ? '...' : ''}`
          };
          this.addMessage(progressMessage);
          this.options.onMessage?.(progressMessage);

        } catch (error: any) {
          console.error(`[AgentRuntime] Step ${step.id} failed:`, error);
          results.push({
            step: step.id,
            description: step.description,
            result: `Error: ${error.message}`
          });
        }
      }

      // Step 3: Compile final summary
      let finalSummary = `## Task Complete\n\n`;
      for (const result of results) {
        finalSummary += `**${result.description}**\n${result.result}\n\n`;
      }
      finalSummary += `---\n\n*Sequential orchestration complete: ${results.length} steps executed.*`;

      const finalMessage: LLMMessage = {
        role: 'assistant',
        content: finalSummary
      };
      this.addMessage(finalMessage);
      this.options.onMessage?.(finalMessage);

      return finalMessage;

    } catch (error: any) {
      console.error('[AgentRuntime] Sequential orchestration failed:', error);
      return {
        role: 'assistant',
        content: `Failed to orchestrate task: ${error.message}. Falling back to direct execution.`
      };
    }
  }
}
