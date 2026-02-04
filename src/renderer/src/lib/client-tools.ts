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

export const CLIENT_TOOLS = [PLANNING_TOOL, SUB_AGENT_TOOL, SCAN_PAGE_TOOL, PROGRESS_SUMMARY_TOOL];

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
  'get_tabs'
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
