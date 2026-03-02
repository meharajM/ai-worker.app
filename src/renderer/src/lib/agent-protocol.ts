export interface AgentStep {
  id: number;
  description: string;
  assigned_agent?: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  result?: string;
}

export interface ExecutionPlan {
  goal: string;
  steps: AgentStep[];
}

// JSON Schema for the Execution Plan - used for validation and prompting
export const EXECUTION_PLAN_SCHEMA = {
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
};

// Tool definition for creating the plan
export const CREATE_PLAN_TOOL_DEF = {
  name: "create_execution_plan",
  description: "Create a structured execution plan. Call this tool FIRST for any complex task.",
  parameters: EXECUTION_PLAN_SCHEMA
};
