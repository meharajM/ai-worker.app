import { MCPTool } from "./mcp";

export const SUB_AGENT_TOOL: MCPTool = {
  name: "delegate_sub_task",
  description: "Delegate a complex sub-task to a specialized sub-agent. The sub-agent has its own fresh context window. IMPORTANT: Do NOT include your entire conversation history in the 'context' field. Only provide the specific data or summary needed for this sub-task.",
  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "The specific task instructions for the sub-agent."
      },
      context: {
        type: "string",
        description: "Specific data needed (e.g., search results, file contents). Do NOT dump full conversation history here."
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
