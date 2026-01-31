import { chat } from "./llm";
import { LLMMessage, LLMTool, ServerInfo, type LLMResponse } from "./types";
import { pruneContext } from "./dcp";
import { executeToolCall, getAllTools, getServers } from "./mcp";
import { CLIENT_TOOLS } from "./client-tools";
import { analyzeTask, type TaskAnalysis } from "./confirmation-message";
import {
  analyzeTaskForDecomposition,
  generateSubAgentInstruction,
  type TaskDecomposition
} from "./task-decomposer";

export type AgentStatusCallback = (message: LLMMessage) => void;

interface AgentRuntimeOptions {
  activeSessionId?: string;
  settings: any;
  onMessage?: AgentStatusCallback;
  signal?: AbortSignal;
  requireConfirmation?: boolean;
  onConfirmationNeeded?: (analysis: TaskAnalysis) => Promise<string | null>; // Returns enriched prompt or null to cancel
  isSubAgent?: boolean; // Flag to identify sub-agents
  taskCategory?: string; // Optional: Force a specific task category (e.g. for sub-agents)
}

export class AgentRuntime {
  private messages: LLMMessage[] = [];
  private options: AgentRuntimeOptions;
  private maxIterations: number;
  private maxConsecutiveErrors = 3; // Bailout after 3 consecutive tool failures
  private executionPlan: { goal: string; steps: Array<{ id: number; description: string; status: string; result?: string }> } | null = null;
  private taskCategory?: string; // Store identified task category

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

    // Sub-agents get 10 iterations (enough for most tasks), main agents get 20
    this.maxIterations = options.isSubAgent ? 10 : 20;

    // Inherit category if passed
    if (options.taskCategory) {
      this.taskCategory = options.taskCategory;
    }
  }

  /**
   * Main entry point to run the agent loop.
   */
  async chat(userContent: string): Promise<LLMMessage> {
    // PHASE 0: Smart Confirmation (if enabled)
    let finalPrompt = userContent;

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
        } else {
          console.log('[AgentRuntime] Analyzing task for ambiguity...');
          const analysis = await analyzeTask(userContent, this.options.settings);

          // Capture category from analysis
          if (analysis.category) {
            this.taskCategory = analysis.category;
            console.log(`[AgentRuntime] Identified task category: ${this.taskCategory}`);
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

    // PHASE 0.5: Auto-Fork Analysis (skip for sub-agents)
    if (!this.options.isSubAgent) {
      const decomposition = analyzeTaskForDecomposition(finalPrompt);
      console.log('[AgentRuntime] Task decomposition:', decomposition);

      if (decomposition.shouldFork && decomposition.type === 'multi_context') {
        console.log(`[AgentRuntime] Auto-forking: ${decomposition.contexts.length} contexts detected`);
        return this.executeParallelSubAgents(finalPrompt, decomposition);
      }

      // For single-context with 3+ actions, trigger sequential sub-agent orchestration
      if (decomposition.shouldFork && decomposition.type === 'single_context') {
        console.log(`[AgentRuntime] Complex single-context task: ${decomposition.estimatedActions} actions - using sequential sub-agents`);
        return this.executeSequentialSubAgents(finalPrompt, decomposition);
      }
    }

    // Add user message (only if not already in history - prevents duplicates)
    const lastMessage = this.messages[this.messages.length - 1];
    const alreadyHasMessage = lastMessage?.role === 'user' && lastMessage?.content === finalPrompt;

    if (!alreadyHasMessage) {
      const userMsg: LLMMessage = { role: "user", content: finalPrompt };
      this.addMessage(userMsg);
    } else {
      console.log('[AgentRuntime] User message already in history, skipping duplicate add');
    }

    let iterationCount = 0;
    let consecutiveErrors = 0; // Track consecutive tool failures
    const recentToolCalls: string[] = []; // Track recent tool signatures to detect loops
    const MAX_IDENTICAL_CALLS = 3; // Bail out if same tool called 3+ times in a row

    while (iterationCount < this.maxIterations) {
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

      const allTools = [...llmTools, ...clientLlmTools];

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
      let dynamicRules = undefined;
      // Check if we have a pending confirmation analysis in logic flow (not directly accessible here easily without passing state)
      // Alternatively, check execution plan metadata or just classify on the fly?
      // Since analyzeTask is run at START of chat(), we can store the result.

      // Wait, analyzeTask results are local to chat()'s start block.
      // We should store the category in class state or pass it.

      // Simplest approach: Classification is done at start. Store it.
      if (this.taskCategory) {
        // Import helper dynamically to avoid circular deps if needed, or just use imported
        const { getPromptForCategory } = await import('./prompt-library');
        // Pass isSubAgent flag to get refined prompts
        dynamicRules = getPromptForCategory(this.taskCategory, this.options.isSubAgent);
        // console.log(`[AgentRuntime] Injecting dynamic rules for: ${this.taskCategory}`);
      }
      // Sub-agent context verification
      if (this.options.isSubAgent) {
        console.log(`[SubAgent] LLM call with ${contextMessages.length} messages (should be 1-3 for fresh sub-agent)`);
      }

      try {
        response = await chat(
          contextMessages,
          allTools.length > 0 ? allTools : undefined,
          this.options.settings,
          serverInfo.length > 0 ? serverInfo : undefined,
          this.options.signal,
          dynamicRules,
          this.options.isSubAgent // NEW: Enable lightweight prompt for sub-agents
        );
      } catch (error) {
        console.error("[AgentRuntime] LLM Error:", error);
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

        const assistantMsg: LLMMessage = {
          role: "assistant",
          content: response.content,
        };
        this.addMessage(assistantMsg);
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
      for (const call of response.toolCalls) {
        if (this.options.signal?.aborted) break;

        // Create a signature for this tool call to detect loops
        const toolSignature = `${call.name}:${JSON.stringify(call.arguments)}`;
        recentToolCalls.push(toolSignature);

        // Keep only last 5 calls for loop detection
        if (recentToolCalls.length > 5) {
          recentToolCalls.shift();
        }

        // Detect infinite loops: same tool called 3+ times in a row
        if (recentToolCalls.length >= MAX_IDENTICAL_CALLS) {
          const lastN = recentToolCalls.slice(-MAX_IDENTICAL_CALLS);
          const allSame = lastN.every(sig => sig === lastN[0]);

          if (allSame) {
            console.error(`[AgentRuntime] Infinite loop detected: ${call.name} called ${MAX_IDENTICAL_CALLS}+ times with identical arguments`);
            const loopMsg: LLMMessage = {
              role: 'assistant',
              content: `I detected an infinite loop - I've been calling the same tool (${call.name}) repeatedly without making progress. This usually means the tool isn't working as expected or I need to try a different approach.\n\nLet me stop and ask: Is there a different way I should approach this task?`
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
            // Try browser_evaluate first
            let result;
            try {
              result = await executeToolCall("browser_evaluate", { script });
            } catch (e) {
              console.warn("[AgentRuntime] browser_evaluate failed, trying browser_run_code...");
            }

            // Fallback to browser_run_code if needed
            if (!result || result.error) {
              result = await executeToolCall("browser_run_code", { code: script });
            }

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

          // Create sub-agent with isolated context
          const subAgent = new AgentRuntime({
            ...this.options,
            isSubAgent: true,
            taskCategory: this.taskCategory, // Inherit category for safety protocols
            requireConfirmation: false,
            onMessage: (msg) => {
              const contentStr = typeof msg.content === 'string'
                ? msg.content
                : msg.content.map(c => c.type === 'text' ? c.text : '[Image]').join(' ');
              console.log(`[SubAgent] ${msg.role}: ${contentStr ? contentStr.substring(0, 50) : '...'}`);
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
          // Standard MCP tool
          try {
            const result = await executeToolCall(call.name, call.arguments as Record<string, unknown>);
            if (result.error) {
              // Enrich error message with recovery hints
              const errorMsg = result.error;
              let recoveryHint = '';

              if (errorMsg.includes('not found') || errorMsg.includes('Timeout')) {
                recoveryHint = '\n\n💡 **Recovery Tip**: The element was not found. Try:\n1. Take a screenshot to see the current page state.\n2. Use `get_state` to list available elements.\n3. Use a different, more general selector (e.g., text-based like `text="Submit"`).\n4. The page might have changed—verify the URL is correct.';
              } else if (errorMsg.includes('not visible') || errorMsg.includes('hidden')) {
                recoveryHint = '\n\n💡 **Recovery Tip**: The element exists but is hidden. Try:\n1. Scroll the page first (`scroll`).\n2. Wait for animations to complete (`wait`).\n3. Check if a modal or popup is blocking.';
              } else if (errorMsg.includes('Missing required parameter')) {
                recoveryHint = `\n\n💡 **Recovery Tip**: A required parameter was missing. Check the tool definition and ensure all required fields are provided.`;
              }

              resultStr = JSON.stringify({ error: errorMsg + recoveryHint });
              consecutiveErrors++;
            } else {
              resultStr = typeof result.result === 'string'
                ? result.result
                : JSON.stringify(result.result);
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

        // Add tool result
        this.addMessage({
          role: "tool",
          content: resultStr,
          tool_call_id: call.id
        });
      }

      iterationCount++;
    }

    throw new Error("Max iterations reached");
  }

  private addMessage(msg: LLMMessage) {
    this.messages.push(msg);
    if (this.options.onMessage) {
      this.options.onMessage(msg);
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

    // Notify user about the decomposition
    const planMessage: LLMMessage = {
      role: 'assistant',
      content: `📋 **Task Analysis**: This task involves ${contexts.length} websites. I'll work on them in parallel:\n\n${contexts.map((ctx, i) => `${i + 1}. **${ctx}**`).join('\n')}\n\nStarting parallel execution...`
    };
    this.addMessage(planMessage);
    this.options.onMessage?.(planMessage); // Forward to UI

    // Create sub-agents for each context
    const subAgentPromises = contexts.map(async (context) => {
      const instruction = generateSubAgentInstruction(originalRequest, context, contexts);

      console.log(`[AgentRuntime] Spawning sub-agent for: ${context}`);

      const subAgent = new AgentRuntime({
        ...this.options,
        isSubAgent: true,
        taskCategory: this.taskCategory, // Inherit category from parent
        requireConfirmation: false,
        onMessage: (msg: LLMMessage) => {
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

        return {
          context,
          success: true,
          result: resultContent
        };
      } catch (error: any) {
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

    let summary = `## Results from ${contexts.length} sources\n\n`;

    for (const result of successfulResults) {
      summary += `### ${result.context}\n${result.result}\n\n`;
    }

    if (failedResults.length > 0) {
      summary += `### ⚠️ Failed Sources\n`;
      for (const result of failedResults) {
        summary += `- **${result.context}**: ${result.result}\n`;
      }
    }

    // Add comparison/summary if multiple successful results
    if (successfulResults.length > 1) {
      summary += `\n---\n\n*Parallel execution complete: ${successfulResults.length}/${contexts.length} sources succeeded.*`;
    }

    const finalMessage: LLMMessage = {
      role: 'assistant',
      content: summary
    };
    this.addMessage(finalMessage);
    this.options.onMessage?.(finalMessage); // Forward to UI

    return finalMessage;
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
    const planPrompt = `Analyze this task and break it into 3-5 concrete steps:

TASK: ${originalRequest}

Create a step-by-step plan. Each step should be:
- Actionable (can be completed by a sub-agent)
- Self-contained (doesn't need full conversation history)
- Sequential (builds on previous steps)

Format as JSON:
{
  "steps": [
    {"id": 1, "description": "Step 1 description"},
    {"id": 2, "description": "Step 2 description"}
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
            { id: 1, description: "Clarify task requirements and gather details" },
            { id: 2, description: `Navigate to ${targetContext} and complete the task` },
            { id: 3, description: "Verify and summarize results" }
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

        // MINIMAL instruction - just the step + persistence awareness
        const stateNote = step.id > 1
          ? ' State persists from previous steps. Check current state first (e.g., get_state, cwd).'
          : '';

        const subAgentInstruction = `${step.description}${stateNote}

Return brief result. End with "✓ Done".`;

        const subAgent = new AgentRuntime({
          ...this.options,
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

