/**
 * Task Decomposer Module
 * 
 * Helper functions for generating sub-agent instructions.
 * The actual analysis is now handled centrally in `confirmation-message.ts`.
 */

export interface TaskDecomposition {
  type: 'single_context' | 'multi_context';
  contexts: string[];           // URLs or app names detected
  estimatedActions: number;     // Estimated number of actions needed
  shouldFork: boolean;          // Whether to spawn sub-agents
  forkReason?: string;          // Explanation for the decision
  forkStrategy?: 'parallel' | 'sequential'; // How to execute sub-agents
}

// (Legacy analysis function removed - logic consolidated into confirmation-message.ts)

/**
 * Generate sub-agent instructions for a specific context
 */
export function generateSubAgentInstruction(
  originalRequest: string,
  targetContext: string,
  allContexts: string[]
): string {
  // MINIMAL instruction - just target and goal
  if (allContexts.length > 1) {
    // Parallel comparison - focus on one site
    return `On ${targetContext}: ${originalRequest}

Return key findings only. End with "✓ complete".`;
  }

  // Single context
  return `${originalRequest}

Return brief result. End with "✓ complete".`;
}
