/**
 * Orchestrator Type Definitions
 * Defines the contract between orchestrator, chat store, and UI components.
 */

export type TaskComplexity = 'simple' | 'moderate' | 'complex';
export type RecommendedProvider = 'local' | 'cloud';
export type PlanStatus = 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';

/**
 * A single step in an execution plan
 */
export interface PlanStep {
    /** Step number (1, 2, 3...) */
    stepNumber: number;

    /** Human-readable description: "Search for recent files" */
    description: string;

    /** Optional tool to use: "filesystem_list_directory" */
    toolName?: string;

    /** Whether this step requires LLM reasoning */
    requiresLLM: boolean;

    /** Estimated time in seconds */
    estimatedTime?: number;
}

/**
 * Analysis result from orchestrator
 */
export interface PlanningResponse {
    /** Discriminator for message type */
    type: 'plan';

    /** Task complexity level */
    complexity: TaskComplexity;

    /** Cleaned/corrected user intent */
    intent: string;

    /** Execution plan steps */
    plan: PlanStep[];

    /** Tools that will be used */
    suggestedTools: string[];

    /** Recommended provider */
    recommendedProvider: RecommendedProvider;

    /** Reasoning for complexity assessment */
    reasoning: string;

    /** Whether user confirmation is required (false for simple tasks) */
    requiresConfirmation: boolean;

    /** Auto-approve timeout in seconds (null if requires confirmation) */
    autoApproveTimeout?: number | null;

    /** Whether the task requires external tools (used for optimization) */
    needsTools?: boolean;
}

/**
 * Execution context for plan execution
 */
export interface ExecutionContext {
    /** The approved plan */
    plan: PlanningResponse;

    /** Provider to use (may differ from recommendation if user overrides) */
    provider: 'local' | 'cloud';

    /** Original user message */
    userMessage: string;

    /** Available MCP tools */
    availableTools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;

    /** Abort signal for cancellation */
    abortSignal?: AbortSignal;
}

/**
 * Result of a single step execution
 */
export interface ExecutedStep {
    stepNumber: number;
    success: boolean;
    result?: string;
    error?: string;
    duration: number;
}

/**
 * Result of plan execution
 */
export interface ExecutionResult {
    /** Whether execution succeeded */
    success: boolean;

    /** Final response content */
    content: string;

    /** Steps that were executed */
    executedSteps: ExecutedStep[];

    /** Provider that was used */
    provider: string;

    /** Model that was used */
    model: string;

    /** Total execution time */
    totalDuration: number;

    /** Error message if failed */
    error?: string;
}

/**
 * Orchestrator state for UI
 */
export interface OrchestratorState {
    /** Current plan (if any) */
    currentPlan: PlanningResponse | null;

    /** Current phase of orchestration */
    planningPhase: 'idle' | 'analyzing' | 'waiting_approval' | 'executing';

    /** Execution progress (null if not executing) */
    executionProgress: { step: number; description: string } | null;
}
