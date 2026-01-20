import { CREATE_PLAN_TOOL_DEF, AgentStep, ExecutionPlan } from "./agent-protocol";
import { LLMTool } from "./llm";

// Re-export types
export type { AgentStep, ExecutionPlan as AgentPlanData };

export const PLAN_TOOL_NAME = CREATE_PLAN_TOOL_DEF.name;

export const CREATE_PLAN_TOOL: LLMTool = {
  name: CREATE_PLAN_TOOL_DEF.name,
  description: CREATE_PLAN_TOOL_DEF.description,
  parameters: CREATE_PLAN_TOOL_DEF.parameters as Record<string, unknown>
};
