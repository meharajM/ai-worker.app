/**
 * Custom error classes for the agent runtime system.
 */

/**
 * Thrown when an agent iteration exceeds the maximum allowed time.
 * Issue #4: Per-Iteration Timeout
 */
export class IterationTimeoutError extends Error {
  constructor(public iterationNumber: number, public timeoutMs: number) {
    super(`Iteration ${iterationNumber} exceeded ${timeoutMs}ms timeout`);
    this.name = 'IterationTimeoutError';
  }
}
