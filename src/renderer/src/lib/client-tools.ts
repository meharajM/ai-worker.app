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

export const MEMORY_CREATE_ENTITY_TOOL: MCPTool = {
  name: "memory_create_entity",
  description: "Create a new entity in the knowledge graph. Use this to remember people, concepts, files, or projects.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Display name of the entity" },
      type: { type: "string", description: "Category: person, project, concept, file, etc." },
      description: { type: "string", description: "Detailed description for context and searchability" },
      metadata: { type: "object", description: "Optional structured data (JSON object)" }
    },
    required: ["name", "type", "description"]
  }
};

export const MEMORY_CREATE_RELATION_TOOL: MCPTool = {
  name: "memory_create_relation",
  description: "Create a relationship between two entities. Connect concepts in the knowledge graph.",
  inputSchema: {
    type: "object",
    properties: {
      from_entity_id: { type: "string", description: "UUID of the source entity" },
      to_entity_id: { type: "string", description: "UUID of the target entity" },
      relation_type: { type: "string", description: "Relationship type: works_on, author_of, relates_to, etc." },
      description: { type: "string", description: "Context about this relationship" },
      weight: { type: "number", description: "Relationship strength from 0.0 (weak) to 1.0 (strong)" }
    },
    required: ["from_entity_id", "to_entity_id", "relation_type"]
  }
};

export const MEMORY_SEARCH_TOOL: MCPTool = {
  name: "memory_search",
  description: "Search the knowledge graph using full-text search. Returns matching entities.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (natural language)" },
      limit: { type: "number", description: "Maximum results to return (default: 10)" }
    },
    required: ["query"]
  }
};

export const CLIENT_TOOLS = [
  PLANNING_TOOL, 
  SUB_AGENT_TOOL, 
  SCAN_PAGE_TOOL,
  MEMORY_CREATE_ENTITY_TOOL,
  MEMORY_CREATE_RELATION_TOOL,
  MEMORY_SEARCH_TOOL
];
