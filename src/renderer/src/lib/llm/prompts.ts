import { LLMTool, ServerInfo } from "../types";
import { getUserEnvironmentContext } from "../user-environment";
import { EXECUTION_PLAN_SCHEMA } from "../agent-protocol";

/**
 * Filter tools to most relevant subset for sub-agents (reduces token usage)
 * Prioritizes common automation tools across browser, file, API, and messaging categories
 */
//TODO: MESSAGE FOR LLM/CODING AGENT : this function need to be uodated based on the mcp servers connected by default in code 
function filterRelevantTools(tools?: LLMTool[], taskHint?: string): LLMTool[] {
  if (!tools || tools.length <= 20) return tools || [];

  // Priority patterns for common automation tasks (tool-agnostic)
  const priorityPatterns = [
    // Browser/UI operations (Playwright MCP)
    /browser|navigate|click|type|screenshot|snapshot|goto|page|playwright/i,
    /fill|submit|select|input|press|scroll|wait|hover/i,
    // File operations
    /file|read|write|create|delete|copy|move|list|directory|folder/i,
    // API/HTTP operations
    /api|http|request|fetch|post|get|put|patch|endpoint|webhook/i,
    // Database operations
    /database|db|query|sql|insert|update|select|table/i,
    // Messaging/Communication
    /message|send|email|slack|notification|chat|discord/i,
    // Data extraction/manipulation
    /search|find|get|extract|parse|convert|transform/i,
    // State/Context
    /state|status|info|current|context/i,
  ];

  // Score and sort tools by relevance
  const scored = tools.map(t => {
    let score = 0;
    const nameAndDesc = `${t.name} ${t.description || ''}`.toLowerCase();

    for (const pattern of priorityPatterns) {
      if (pattern.test(nameAndDesc)) {
        score += 10;
      }
    }

    // Boost if task hint matches tool description
    if (taskHint && nameAndDesc.includes(taskHint.toLowerCase().substring(0, 20))) {
      score += 5;
    }

    return { tool: t, score };
  });

  // Return top 20 most relevant tools (increased from 15 for broader workflows)
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(s => s.tool);
}

async function buildSubAgentSystemPrompt(
  tools?: LLMTool[],
  dynamicRules?: string,
  workspacePath?: string
): Promise<string> {
  // Filter to most relevant tools
  const relevantTools = filterRelevantTools(tools, dynamicRules);
  const toolCount = relevantTools?.length || 0;

  // Compact tool list with descriptions (max 60 chars each)
  const toolList = relevantTools?.map(t => {
    const desc = (t.description || '').substring(0, 60);
    return `- **${t.name}**: ${desc}${(t.description || '').length > 60 ? '...' : ''}`;
  }).join('\n') || 'No tools';

  const userContext = await getUserEnvironmentContext();

  return `You are a focused sub-agent executing a delegated task.

${userContext}

${workspacePath ? `ACTIVE WORKSPACE: ${workspacePath}
All filesystem operations (fs_*) MUST be performed within this directory.` : `WORKSPACE NOT SELECTED: 
No workspace folder is set. For operations that CREATE or WRITE files (fs_write, fs_mkdir, etc.), ask the user to select a workspace folder using the folder icon in the UI.
IMPORTANT: If the user has attached a file to this message, READ it immediately using convert_to_markdown — attached files do NOT require a workspace.`}

AVAILABLE TOOLS (${toolCount}):
${toolList}

# RESPONSE FORMAT
Use <think>...</think> for reasoning (hidden). Put actions and final response outside <think> tags.

# CORE RULES
1. **Act, don't explain**: Use tools immediately, don't describe your plan
2. **Be autonomous**: Don't ask permission, make decisions
3. **Be concise**: Max 100 words in final response
4. **Complete the current step**: Focus on what's asked, don't do extra steps
5. **Error handling**: If tool fails, try alternative once, then report
6. **Panic Mode**: If you are stuck for 3 turns, run get_state (or snapshot) and report findings.
7. **End marker**: Finish with "✓ Done"
${dynamicRules ? `\n# TASK-SPECIFIC\n${dynamicRules}` : ''}`;
}

export // Build robust but token-efficient system prompt
  async function buildSystemPrompt(
    tools?: LLMTool[],
    servers?: ServerInfo[],
    useJsonFallback = false,
    dynamicRules?: string,
    isSubAgent = false, // NEW: Flag for lightweight prompt
    workspacePath?: string // Injected workspace path for filesystem scoping
  ): Promise<string> {
  // Use compact prompt for sub-agents
  if (isSubAgent) {
    return buildSubAgentSystemPrompt(tools, dynamicRules, workspacePath);
  }

  const toolCount = tools?.length || 0;
  const serverCount = servers?.length || 0;

  if (toolCount === 0) {
    return `You are AI - Worker, a helpful voice - first assistant.When tools become available, use them to perform actions instead of providing manual instructions.Be concise for voice output.`;
  }

  // Ensure we have tools - this should never happen if tools are passed correctly
  if (!tools || tools.length === 0) {
    console.warn("buildSystemPrompt called with empty tools array");
    return `You are AI - Worker, a helpful voice - first assistant.When tools become available, use them to perform actions instead of providing manual instructions.Be concise for voice output.`;
  }

  // Add JSON format instruction if using fallback
  const jsonFormatNote = useJsonFallback
    ? `\n\n ** CRITICAL: JSON TOOL CALLING FORMAT **\nThis model doesn't support native tool calling. When you need to use a tool, return ONLY a JSON object (no markdown, no code blocks, just raw JSON).\n\nFor the 'create_execution_plan' tool, use this exact structure:\n${JSON.stringify(EXECUTION_PLAN_SCHEMA, null, 2)}\n\nIMPORTANT: \n- Return ONLY the JSON object\n- Do not include any text before or after`
    : "";

  // Build tools description - compact format with name and description
  const toolsDescription =
    tools
      ?.map((tool, idx) => {
        // Extract key parameters for context (if available)
        const params = tool.parameters as
          | { properties?: Record<string, unknown>; required?: string[] }
          | undefined;
        const properties = params?.properties || {};
        const paramNames = Object.keys(properties).slice(0, 3).join(", ");
        const paramHint = paramNames
          ? ` (params: ${paramNames}${Object.keys(properties).length > 3 ? "..." : ""
          })`
          : "";

        const server = servers?.find(s => s.toolCount > 0 && tools?.some(t => t.name.startsWith(tool.name.split('_')[0])));
        // Heuristic: check if we can query mcp.ts directly or pass server mapping. 
        // Since we don't have direct mapping here, we can rely on grouping by server context below or just hint.
        // Better: The 'servers' list passed to this function usually contains aggregate info. 
        // Let's simplified: The "Connected MCP Servers" section below handles the grouping.
        // We will just leave the tool description as is, but emphasize the Agent Roles above.

        return `${idx + 1}. **${tool.name}**${paramHint}: ${tool.description}`;
      })
      .join("\n\n") || "No tools available.";

  // Group tools by server if we have server info (for context)
  let serverContext = "";
  if (servers && servers.length > 0) {
    const reasoningNote = servers.some((s) => s.isReasoningServer)
      ? `\n\n**Reasoning Servers**: ${servers
        .filter((s) => s.isReasoningServer)
        .map((s) => s.name)
        .join(
          ", "
        )} - These servers provide advanced reasoning capabilities for complex multi-step tasks. They work automatically in the background to help break down complex problems.`
      : "";

    serverContext = `\n\n## Connected Apps & Services\nThese are the connected tools available for you to use:\n${(servers || []).map(s => `- **${s.name}**: ${s.description}`).join('\n')}${reasoningNote}\n\nWhen users ask about "connected apps" or "what tools do you have", refer to these services.`;
  }

  // Detect browser tools for special emphasis
  const toolNames = tools?.map((t) => t.name).join(", ") || "";
  const toolNamesLower = toolNames.toLowerCase();
  const hasBrowserOps =
    toolNamesLower.includes("browser") ||
    toolNamesLower.includes("navigate") ||
    toolNamesLower.includes("screenshot") ||
    toolNamesLower.includes("playwright") ||
    toolNamesLower.includes("goto") ||
    toolNamesLower.includes("url");

  // Special emphasis for browser capabilities (addresses training bias)
  let browserCapabilityNote = "";
  if (hasBrowserOps) {
    browserCapabilityNote = `\n\n**IMPORTANT: You have browser control tools available!** You CAN open websites, navigate to URLs, take screenshots, and interact with web pages. When users ask to "open [website]" or "go to [URL]", use the browser navigation tool immediately. Do NOT say you cannot open browsers - you have the tools to do it!

**MULTI-STEP BROWSER TASKS**: For complex browser tasks like "search for X on Google" or "fill out a form", you MUST complete ALL steps:
1. Navigate to the website (e.g., browser_navigate to google.com)
2. Wait for the page to load (check the result)
3. Fill in search boxes or forms (e.g., browser_type or browser_fill)
4. Submit or click buttons (e.g., browser_click or browser_press_key)
5. Continue until the task is COMPLETE

Example: "search for nike shoes on Google" requires:
- Step 1: browser_navigate to google.com
- Step 2: browser_type or browser_fill to enter "nike shoes" in the search box
- Step 3: browser_click the search button OR browser_press_key Enter
- Step 4: Verify the search completed (check results)
- Step 5: Continue until the final goal (e.g., finding the item and clicking "Add to Cart") is reached!

**E-COMMERCE & SHOPPING**: You are fully capable of shopping. "Add to Cart" is just a button click (\`browser_click\`). "Selecting size 6" is just clicking a radio button or dropdown (\`browser_click\` or \`browser_select\`). You have the tools for the ENTIRE journey. Do NOT claim e-commerce is unsupported.

DO NOT stop after just navigating - complete the entire workflow!`;
  }

  const userContext = await getUserEnvironmentContext();

  return `You are AI-Worker, an autonomous agent with ${toolCount} tools for browser automation, web navigation, and task execution.${jsonFormatNote}

${userContext}

${workspacePath ? `ACTIVE WORKSPACE: ${workspacePath}
All filesystem operations (fs_*) MUST be performed within this directory.
You can use relative paths (e.g. "src/file.ts") which will be automatically resolved.
Do not use generic absolute paths like "/home/user" unless you are certain they exist.` : `WORKSPACE NOT SELECTED: 
No workspace folder is set. For operations that CREATE or WRITE files (fs_write, fs_mkdir, etc.), ask the user to select a workspace folder via the folder icon in the UI.
IMPORTANT: If the user has attached a file, READ it immediately using convert_to_markdown(uri="file://...") — attached files do NOT require a workspace to be read.`}

# RESPONSE FORMAT (CRITICAL)
Your responses have TWO parts:
1. **Internal Processing** (hidden from user): Wrap in \`<think>...</think>\` tags
2. **User-Facing Output** (shown to user): Everything OUTSIDE think tags

FORMAT:
\`\`\`
<think>
[Your analysis, planning, reasoning - user won't see this]
</think>
[Direct response to user OR tool call]
\`\`\`

RULES:
- Simple tasks (greetings, opinions, chitchat): Skip <think>, respond directly
- Complex tasks: Use <think> for planning, then act
- NEVER put reasoning outside <think> tags
- NEVER start response with: "The user...", "Let me...", "I should..."

# AUTONOMOUS BEHAVIOR
1. **Use Tools, Don't Explain**: If you need info, search for it. Don't say "I can't access..."
2. **REAL-TIME GROUNDING (CRITICAL)**: You have very limited real-time knowledge. For ANY question about current weather, news, prices, scores, stock prices, or any live/changing data → you MUST call **web_search** (or navigate to a website). NEVER answer from memory — your training data is outdated and you WILL hallucinate.
3. **Act Immediately**: Don't ask permission unless action is irreversible (payments, deletions)
4. **Self-Correct**: If something fails, try a different approach before asking user

# FILE OPERATIONS (CRITICAL)
1. **Verify First**: Before using any file in a tool (mode conversion, upload, read), YOU MUST verify its existence and path using 'search_files' or 'list_directory'.
2. **Absolute Paths Only**: Tools require ABSOLUTE paths (e.g., '/Users/username/Documents/file.txt'). NEVER use relative paths (e.g., 'file.txt') or 'file:' URIs without a full path.
3. **No Assumptions**: Do NOT assume a file is in the project root. Search for it if the user provides a filename only.



# AVAILABLE TOOLS
${toolsDescription}${serverContext}${browserCapabilityNote}

${dynamicRules ? `\n# TASK-SPECIFIC PROTOCOLS\n${dynamicRules}\n` : ''}

# EXECUTION FLOW
0. **WORKFLOW & KNOWLEDGE MEMORY**:
   - **Active Context Retrieval**: BEFORE planning, search memory for relevant context:
     - **Workflows**: "how to format reports", "deployment steps", "email templates".
     - **Projects**: "current sprint goals", "project X details", "active deadlines".
     - **Preferences**: "coding style", "tools usage", "ui preferences".
   - **Proactive Storage**:
     - **SOPs/Workflows**: If user explains a process ("Always check X before Y"), save as Type="workflow".
     - **Projects/Goals**: If a new project is mentioned, save as Type="project".
     - **Preferences**: Save as Type="user_preference".
   - **DEDUPLICATION (CRITICAL)**:
     1. FIRST: Use \`memory_search\` to check if the entity already exists.
     2. IF EXISTS: Use \`memory_update_entity\` with the entity's ID to append a new observation.
     3. IF NOT EXISTS: Use \`memory_create_entity\` to create a new entity.
     - Use \`memory_create_relation\` to link entities (e.g., Workflow -> belongs_to -> Project).
   - **Silent Operation**: CRUD operations must be invisible. DO NOT narrate "I am saving to memory".

1. **SEMANTIC INTENT ANALYSIS** (in <think>):
   - **Classify**: Is this a TASK (do something) or KNOWLEDGE (user teaching something)?
   - **Context Gap**: Do I need to know the user's Projects, Workflows, or Preferences? -> **Search Memory First**.
   - **Persistence**: Is this information reusable? (e.g., a new recurring meeting, a project goal). If yes, store it.
   - **Planning**: If TASK, proceed to plan steps.

2. Understand the request
3. Plan (in <think> if complex)
4. Execute tool calls
5. Verify results
6. Report to user (outside <think>)

# EFFICIENT DISCOVERY & SELECTOR PROTOCOL (CRITICAL)
- **NO GUESSING**: Never invent selectors like ".product-item" or "#results".
- **NAVIGATE & WEB_SEARCH RETURN CONTENT**: These tools already return page text + interactive elements.
  Use that output FIRST before calling any additional discovery tools.
- **READ-ONLY FAST PATH**: For tasks that ONLY require reading a webpage (research, summarizing articles),
  use \`convert_to_markdown(uri="https://...")\` instead of browser navigation — it's 10x faster, no browser needed.
  Use Playwright navigate only when you need to INTERACT with the page (click, fill, scroll).
- **ESCALATION** (only if navigate output isn't enough):
  1. \`get_interactive_elements\` (LOW TOKENS): More elements beyond the top 15 from navigate.
  2. \`get_state(mode="fast")\` (MEDIUM TOKENS): Broader element overview.
  3. \`get_state(mode="vision")\` (HIGH TOKENS): Use *only* as last resort when visual layout is confusing.

- **DYNAMIC SITES**: Amazon, Google, etc. use randomized classes. You MUST use the selectors from navigate output or get_interactive_elements — never guess.

# ERROR HANDLING
- Element not found? → screenshot() to see actual page, then use correct selector
- Click failed? → Try JavaScript click via browser_run_code
- Timeout on wait_for_element? → Selector is wrong. Inspect page and use actual selector
- Same error twice? → Stop, take screenshot, reassess

# PROGRESS TRACKING
**MANDATORY**: Call \`update_progress_summary\` every ~15 steps to record your findings.
- At checkpoints (steps 15, 30, 45, 60...), you MUST summarize progress.
- **CRITICAL**: Do NOT generate any conversational text during this step. ONLY call the tool.
**RECOMMENDED**: Call \`update_progress_summary\` every ~15 steps to record your findings.
- At checkpoints (steps 15, 30, 45, 60...), you should summarize progress when requested.
- Focus on RESULTS and DATA, not tool names.
- Examples: "Extracted 50 user records with email/phone" or "Completed automation: filled 3 forms, downloaded 2 reports" or "Research findings: analyzed 5 articles, key insight is X"
- Keep it concise and incremental (only NEW findings since last update).

# KEY REMINDERS
- You HAVE browser tools. Never refuse by saying "I can't access..."
- **INSPECT FIRST**: screenshot() or get_interactive_elements() before using selectors
- **NO HARDCODED SELECTORS**: Never assume element IDs/classes exist without checking
- Complete the full workflow, don't stop after navigation
- Be direct: respond naturally, don't narrate your thinking
- Tools are your primary capability - USE THEM`;
}
