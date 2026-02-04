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

export type AgentStatusCallback = (message: LLMMessage) => string | void;

interface AgentRuntimeOptions {
  activeSessionId?: string;
  settings: any;
  onMessage?: AgentStatusCallback;
  signal?: AbortSignal;
  requireConfirmation?: boolean;
  onConfirmationNeeded?: (analysis: TaskAnalysis) => Promise<string | null>; // Returns enriched prompt or null to cancel
  isSubAgent?: boolean; // Flag to identify sub-agents
  taskCategory?: string; // Optional: Force a specific task category (e.g. for sub-agents)
  onMessageUpdate?: (id: string, updates: Partial<LLMMessage>) => void; // Update existing message in UI
  tabId?: number; // Dedicated browser tab ID for this agent
}

export class AgentRuntime {
  private messages: LLMMessage[] = [];
  private options: AgentRuntimeOptions;
  private maxIterations: number;
  private maxConsecutiveErrors = 3; // Bailout after 3 consecutive tool failures
  private executionPlan: { goal: string; steps: Array<{ id: number; description: string; status: string; result?: string }> } | null = null;
  private taskCategory?: string; // Store identified task category
  private progressSummary: string[] = []; // LLM-driven progress summaries
  private totalIterations = 0; // Track total iterations across all continuations
  private readonly ABSOLUTE_MAX_ITERATIONS = 150; // Hard cap to prevent runaway costs
  private toolCallHistory = new Set<string>(); // Track unique tool signatures for progress detection

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
    if (!this.options.isSubAgent) {
      const decomposition = analyzeTaskForDecomposition(finalPrompt);
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
      // Check absolute max first to prevent runaway continuations
      this.totalIterations++;

      if (this.totalIterations >= this.ABSOLUTE_MAX_ITERATIONS) {
        const absoluteLimitMsg: LLMMessage = {
          role: 'assistant',
          content: `⚠️ **Absolute Limit Reached**\n\nI've performed **${this.ABSOLUTE_MAX_ITERATIONS} total steps** across all continuations. This task requires manual intervention or a different approach.\n\n**Recommendations:**\n• Break the task into smaller sub-tasks\n• Review if the goal is achievable with current tools\n• Check for errors or loops in recent steps`
        };
        this.addMessage(absoluteLimitMsg);
        return absoluteLimitMsg;
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
      let dynamicRules = undefined;

      // Import helper dynamically to avoid circular deps
      const { getPromptForCategory, getComposedPrompts, PROMPTS } = await import('./prompt-library');

      // 1. Start with the base category prompt
      const promptsToLoad: string[] = [];
      if (this.taskCategory) {
        promptsToLoad.push(this.taskCategory);
      }

      // 2. PARALLEL EXECUTION DETECTION (Dynamic Injection)
      // Inject parallel execution prompt if user request suggests multiple independent tasks
      // Regex patterns to detect parallel intent: "Research X and Y", "Check 3 websites"
      const parallelIndicators = [
        /\band\b/i,          // "Research X and Y"
        /,/,                 // "Check A, B, C"
        /\bmultiple\b/i,
        /\beach\b/i,
        /\ball\b/i,
        /\d+\s+(websites|pages|items|products|companies)/i  // "5 websites"
      ];

      const hasParallelIntent = parallelIndicators.some(pattern => pattern.test(finalPrompt));

      // Only inject if detected AND not already a sub-agent (sub-agents should focus on their specific task)
      if (hasParallelIntent && !this.options.isSubAgent) {
        promptsToLoad.push('PARALLEL_EXECUTION');
        console.log('[AgentRuntime] Parallel execution detected. Injecting PARALLEL_EXECUTION prompt.');
      }

      // 3. Compose the final dynamic rules
      if (promptsToLoad.length > 0) {
        dynamicRules = getComposedPrompts(promptsToLoad, this.options.isSubAgent);
        console.log(`[AgentRuntime] Injected dynamic rules for: ${promptsToLoad.join(' + ')}`);
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

        // Append Progress Summary if available and this is the main agent (user-facing)
        if (!this.options.isSubAgent && this.progressSummary.length > 0) {
          const summaryText = this.progressSummary.join('\n');
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

        // Fire-and-forget memory analysis (Standard Turn Complete)
        MemoryReflector.getInstance().analyze(this.messages, this.options.settings);

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
        recentToolCalls.push(toolSignature);

        // Track unique tool calls for progress monitoring
        this.toolCallHistory.add(toolSignature);

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

I've called \`${call.name}\` **${MAX_IDENTICAL_CALLS} times** with identical parameters, which usually means something isn't working as expected.

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


        } else if (call.name === 'update_progress_summary') {
          const args = call.arguments as any;
          const summary = args.summary || '';

          if (summary.trim()) {
            this.progressSummary.push(`**Step ${iterationCount}**: ${summary}`);
            console.log(`[AgentRuntime] Progress summary recorded (${this.progressSummary.length} total)`);
          }

          resultStr = JSON.stringify({
            success: true,
            message: 'Progress summary recorded.',
            totalSummaries: this.progressSummary.length
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

              // Import locks dynamically to avoid top-level side effects/circular deps
              const { browserLock, fileLock } = await import('./resource-lock');
              const { STATEFUL_BROWSER_TOOLS, STATEFUL_FILE_TOOLS } = await import('./client-tools');

              // 1. Browser Tools -> browserLock (Global for now, effectively serializes tab actions)
              if (STATEFUL_BROWSER_TOOLS.includes(name)) {

                // INJECTION: If this agent has a dedicated tab, force all browser tools to use it
                if (this.options.tabId !== undefined) {
                  args.tabId = this.options.tabId;
                }

                result = await browserLock.runExclusive(async () => {
                  return await executeToolCall(name, args);
                });
              }
              // 2. File System Tools -> fileLock (GRANULAR: Lock key = file path)
              else if (STATEFUL_FILE_TOOLS.includes(name)) {
                const targetFile = (args.TargetFile || args.path || args.AbsolutePath) as string;
                // If path is available, lock ONLY that file. Else fallback to global 'unknown' key
                const lockKey = targetFile || 'global_fs_lock';

                result = await fileLock.runExclusive(lockKey, async () => {
                  return await executeToolCall(name, args);
                });
              }
              // 3. Other Tools (Search, Memory, etc.) -> No Lock (True Parallelism)
              else {
                result = await executeToolCall(name, args);
              }

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
              } else if (errorMsg.includes('Missing required parameter')) {
                recoveryHint = `\n\n💡 **Recovery Tip**: A required parameter was missing. Check the tool definition and ensure all required fields are provided.`;
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

      // MANDATORY CHECKPOINT: Enforce progress summary at iterations 15, 30, 45...
      // User request: Increased from 5 to 15 to allow more flow before interrupting
      const CHECKPOINT_INTERVAL = 15;
      if (!this.options.isSubAgent && iterationCount % CHECKPOINT_INTERVAL === 0 && iterationCount > 0) {
        const checkpointIndex = (iterationCount / CHECKPOINT_INTERVAL) - 1; // 0-indexed checkpoint

        // Check if summary was recorded for this checkpoint
        if (this.progressSummary.length <= checkpointIndex) {
          console.log(`[AgentRuntime] Checkpoint ${iterationCount}: Waiting for progress summary...`);

          // Add system message to enforce summary (MUST be non-conversational to prevent verbose responses)
          this.addMessage({
            role: 'system',
            content: `CHECKPOINT ${iterationCount}: Call update_progress_summary tool NOW with your Summary of your findings and what you've accomplished in the last ${CHECKPOINT_INTERVAL} steps. No text output - tool call only.`
          });

          // Continue loop - LLM will be forced to call the tool on next iteration
          // Continue loop - LLM will be forced to call the tool on next iteration
          continue;
        } else {
          console.log(`[AgentRuntime] Checkpoint ${iterationCount}: Summary recorded ✓`);
        }
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
      const summary = this.progressSummary.length > 0
        ? this.progressSummary.join('\n\n')
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
    const progressContext = this.progressSummary.length > 0
      ? this.progressSummary.join('\n')
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
      let content = `## � Parallel Execution\n\n`;

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

      const subAgent = new AgentRuntime({
        ...this.options,
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
