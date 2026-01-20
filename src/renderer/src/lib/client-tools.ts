import { MCPTool } from "./mcp";

export const SUB_AGENT_TOOL: MCPTool = {
  name: "delegate_sub_task",
  description: "Delegate a complex sub-task to a specialized sub-agent. The sub-agent has its own context window and will return a summary of its work. Use this for complex multi-step tasks to save your own context window.",
  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "The specific task instructions for the sub-agent."
      },
      context: {
        type: "string",
        description: "Relevant context or data the sub-agent needs to know."
      }
    },
    required: ["instruction"]
  }
};

export const CLIENT_TOOLS = [SUB_AGENT_TOOL];
