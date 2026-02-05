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

  constructor(options: AgentRuntimeOptions, initialHistory: LLMMessage[] = []) {
    this.options = options;
    this.messages = [...initialHistory];
    // Sub-agents get 15 iterations, main agents get 50 to allow for deep reasoning/thinking chains
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

    // PHASE 0.5: Auto-Fork Analysis (skip for sub-agents)
    if (!this.options.isSubAgent) {
      const decomposition = analyzeTaskForDecomposition(finalPrompt);
      console.log('[AgentRuntime] Task decomposition:', decomposition);

      if (decomposition.shouldFork && decomposition.type === 'multi_context') {
        const subAgentResult = await this.executeParallelSubAgents(finalPrompt, decomposition);
        // Fire-and-forget memory analysis
        MemoryReflector.getInstance().analyze(this.messages, this.options.settings);
        return subAgentResult;
      }

      // For single-context with 3+ actions, we let LLM decide via create_execution_plan
      // but add a hint to the prompt
      if (decomposition.shouldFork && decomposition.type === 'single_context') {
        console.log(`[AgentRuntime] Complex single-context task: ${decomposition.estimatedActions} actions`);
        // Continue with normal flow - the LLM will be instructed to use create_execution_plan
      }
    }

    const userMsg: LLMMessage = { role: "user", content: finalPrompt };
    this.addMessage(userMsg);

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

      // Simplest approach: Classification is done at start. Store it.
      if (this.taskCategory) {
        // Import helper dynamically to avoid circular deps if needed, or just use imported
        const { getPromptForCategory } = await import('./prompt-library');
        // Pass isSubAgent flag to get refined prompts
        dynamicRules = getPromptForCategory(this.taskCategory, this.options.isSubAgent);
        // console.log(`[AgentRuntime] Injecting dynamic rules for: ${this.taskCategory}`);
      }

      try {
        response = await chat(
          contextMessages,
          allTools.length > 0 ? allTools : undefined,
          this.options.settings,
          serverInfo.length > 0 ? serverInfo : undefined,
          this.options.signal
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
      for (const call of response.toolCalls) {
        if (this.options.signal?.aborted) break;

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
            // Build focused prompt with clear success criteria
            const prompt = `You are a sub-agent optimized for token efficiency. Complete this task and return ONLY a concise summary.

TASK: ${instruction}
${context ? `\nCONTEXT DATA: ${context}` : ''}

CRITICAL RULES:
- Execute the task using available tools
- **Return ONLY the key findings** - no explanations, no process description
- **Maximum 200 words** in your final response
- Use <think> tags for reasoning (hidden from main agent)
- Format: Short bullet points or 2-3 sentences MAX
- When complete, end with: "✓ Complete"

Example Good Response:
"Found 3 laptops on Amazon: Dell XPS ($1200), HP Spectre ($1400), Lenovo ($999). XPS has best reviews. ✓ Complete"

Example BAD Response (too verbose):
"I searched Amazon and found several laptops. First I navigated to... then I clicked... The results show that..."`;

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

    const limitReachedMsg: LLMMessage = {
      role: 'assistant',
      content: `I've worked for **${this.maxIterations} steps** but haven't finished yet.

**Progress Status:** ${progressIndicator} (${uniqueToolsUsed} unique tool calls so far)

**Latest Results:**
${recentToolOutputs || 'Processing data...'}

**Do you want me to continue?**
• Reply **"Yes"** or **"Continue"** to proceed (I'll do another batch of work).
• Reply **"Stop"** to end here.`
    };
    this.addMessage(limitReachedMsg);
    return limitReachedMsg;
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
}
