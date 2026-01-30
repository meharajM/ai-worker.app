import { MCPTool } from "./mcp";

export const SUB_AGENT_TOOL: MCPTool = {
  name: "delegate_sub_task",
  description: "Delegate a complex sub-task to a specialized sub-agent with a fresh context window. The sub-agent will execute the task and return ONLY a concise summary. **CRITICAL: In the 'context' field, provide only essential data (e.g., 'Product: Nike shoes, Size: 10') - NEVER dump conversation history or verbose text. Keep context under 500 words.**",
  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "Clear, specific task for the sub-agent. Example: 'Search Amazon for Nike shoes size 10 and return top 3 results with prices'"
      },
      context: {
        type: "string",
        description: "MINIMAL essential data only (e.g., 'User wants running shoes, budget $150'). Do NOT include full conversation history. Max 500 words."
      }
    },
    required: ["instruction"]
  }
};

export const PLANNING_TOOL: MCPTool = {
  name: "create_execution_plan",
  description: "Create a structured execution plan. Call this tool FIRST for any complex task.",
  inputSchema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "The main objective of the plan."
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            description: { type: "string" },
            assigned_agent: {
              type: "string",
              description: "The specalized agent role responsible for this step (e.g. 'PlaywrightAgent', 'ResearchAgent')."
            },
            status: { type: "string", enum: ["pending", "active", "completed", "failed"] }
          },
          required: ["id", "description", "assigned_agent"]
        }
      }
    },
    required: ["goal", "steps"]
  }
};

export const SCAN_PAGE_TOOL: MCPTool = {
  name: "scan_page_accessibility",
  description: "Extracts a token-efficient semantic structure (accessibility tree) of the current page. ALWAYS use this instead of browser_snapshot or reading full HTML to understand page content.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

export const CLIENT_TOOLS = [PLANNING_TOOL, SUB_AGENT_TOOL, SCAN_PAGE_TOOL];
