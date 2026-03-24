import { MCPTool } from "../stores/mcpStore";

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

export const PROGRESS_SUMMARY_TOOL: MCPTool = {
  name: "update_progress_summary",
  description: "Record a summary of progress/findings so far. Call this every ~15 steps to track what you've accomplished. Be concise and incremental - only add NEW findings since last summary. Examples: 'Extracted 50 user records with email and phone' or 'Completed steps 1-3: navigated to dashboard, logged in, accessed reports section' or 'Found 5 matching documents: Q4-Report.pdf, Budget-2024.xlsx...' or 'Submitted form with confirmation ID: ABC123'.",
  inputSchema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Concise summary of NEW findings/progress since last update. Focus on results and data, not tool names."
      }
    },
    required: ["summary"]
  }
};

// Tools that modify browser state and must be serialized (using browserLock)
export const STATEFUL_BROWSER_TOOLS = [
  'navigate',
  'click',
  'click_text',
  'fill',
  'type',
  'select_option',
  'hover',
  'press',
  'scroll',
  'wait_for_element',
  'wait_for_navigation',
  'get_state',
  'get_interactive_elements',
  'get_page_content',
  'extract_data',
  'evaluate',
  'browser_evaluate', // Alias
  'browser_run_code', // Alias
  'screenshot',
  'upload_file',
  'handle_dialog',
  'switch_frame',
  'get_cookies',
  'set_cookie',
  'check_element',
  'drag_drop',
  'go_back',
  'go_forward',
  'set_viewport',
  'find_by_xpath',
  // Tab management is also stateful/browser-locked
  'new_tab',
  'switch_tab',
  'close_tab',
  'get_tabs',
  // Compound / recipe tools — also browser-stateful
  'browser_action_sequence',
  'web_search',
  'fill_form',
];

// Tools that modify file system state (using fileLock)
export const STATEFUL_FILE_TOOLS = [
  'write_to_file',
  'replace_file_content',
  'create_file',
  'delete_file',
  'edit_file', // potential alias
  'append_file' // potential alias
];
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


export const MEMORY_UPDATE_ENTITY_TOOL: MCPTool = {
  name: "memory_update_entity",
  description: "Update an existing entity by adding a new observation or updating description. Use this to APPEND facts to existing entities instead of creating duplicates.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The UUID of the entity to update (from memory_search results)" },
      observation: { type: "string", description: "A new observation/fact to append to the entity's history" },
      description: { type: "string", description: "Updated description (replaces existing)" },
      metadata: { type: "object", description: "Merged metadata updates" }
    },
    required: ["id"]
  }
};

// ============================================================
// Browser Turbo / Recipe Tools
// Imported from shared schema (single source of truth).
// The actual execution happens in PlaywrightService.callTool().
// ============================================================

import {
  BROWSER_ACTION_SEQUENCE_SCHEMA,
  WEB_SEARCH_SCHEMA,
  FILL_FORM_SCHEMA,
} from '../../../shared/browser-tool-schemas';

export const BROWSER_ACTION_SEQUENCE_TOOL: MCPTool = BROWSER_ACTION_SEQUENCE_SCHEMA as MCPTool;
export const WEB_SEARCH_TOOL: MCPTool = WEB_SEARCH_SCHEMA as MCPTool;
export const FILL_FORM_TOOL: MCPTool = FILL_FORM_SCHEMA as MCPTool;

export const WHATSAPP_SEND_MEDIA_TOOL: MCPTool = {
  name: "whatsapp_send_media",
  description: "Send a media file (image, video, audio, document) to a WhatsApp chat. Use this when the user explicitly asks to send a file from their workspace to WhatsApp.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Absolute path to the file to send" },
      to: { type: "string", description: "The WhatsApp number to send to (include country code without +). If replying to a message, extract from 'WhatsApp (number):' prefix." },
      caption: { type: "string", description: "Optional message to accompany the file" },
      type: { type: "string", enum: ["image", "video", "audio", "document"], description: "The type of media being sent (default: image)" }
    },
    required: ["filePath"] // 'to' is handled via fallback if omitted
  }
};

export const WHATSAPP_SEND_MESSAGE_TOOL: MCPTool = {
  name: "whatsapp_send_message",
  description: "Send a text message to a WhatsApp chat. Use this to notify the user of task completion or to ask a question.",
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "The message text to send to the WhatsApp chat" },
      to: { type: "string", description: "The WhatsApp number to send to. If replying to a message, extract from 'WhatsApp (number):' prefix." }
    },
    required: ["content"]
  }
};

export const CLIENT_TOOLS = [
  PLANNING_TOOL,
  SUB_AGENT_TOOL,
  SCAN_PAGE_TOOL,
  PROGRESS_SUMMARY_TOOL,
  MEMORY_CREATE_ENTITY_TOOL,
  MEMORY_CREATE_RELATION_TOOL,
  MEMORY_SEARCH_TOOL,
  MEMORY_UPDATE_ENTITY_TOOL,
  WHATSAPP_SEND_MEDIA_TOOL,
  WHATSAPP_SEND_MESSAGE_TOOL,
];

