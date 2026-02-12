/**
 * Iteration error tracking for agent runtime.
 * Issue #5: Consecutive Error Counter Fix
 * 
 * Tracks consecutive failed iterations (not individual tool failures)
 * to determine when to bail out of the agent loop.
 */

import { LLMMessage } from './types';

/**
 * Tracks iteration-level success/failure state
 */
export class IterationErrorTracker {
  private consecutiveFailedIterations = 0;
  private iterationHadSuccess = false;
  private iterationHadError = false;
  
  constructor(private readonly maxConsecutiveErrors: number = 3) {}

  /**
   * Mark that a tool succeeded in the current iteration
   */
  recordSuccess(): void {
    this.iterationHadSuccess = true;
  }

  /**
   * Mark that a tool failed in the current iteration
   */
  recordError(): void {
    this.iterationHadError = true;
  }

  /**
   * Complete the current iteration and update the error counter.
   * Call this after all tools in an iteration have executed.
   * 
   * @param iterationNumber Current iteration number (for logging)
   * @returns Bailout message if threshold exceeded, null otherwise
   */
  completeIteration(iterationNumber: number): LLMMessage | null {
    if (this.iterationHadSuccess) {
      // At least one tool succeeded - reset counter
      if (this.consecutiveFailedIterations > 0) {
        console.log(
          `[IterationErrorTracker] Iteration ${iterationNumber} had success, ` +
          `resetting error counter (was ${this.consecutiveFailedIterations})`
        );
      }
      this.consecutiveFailedIterations = 0;
    } else if (this.iterationHadError) {
      // All tools failed - increment counter
      this.consecutiveFailedIterations++;
      console.warn(
        `[IterationErrorTracker] Iteration ${iterationNumber} had no successes ` +
        `(consecutive failed iterations: ${this.consecutiveFailedIterations})`
      );

      // Check if we've hit the threshold
      if (this.consecutiveFailedIterations >= this.maxConsecutiveErrors) {
        console.error(
          `[IterationErrorTracker] Bailing out after ${this.consecutiveFailedIterations} ` +
          `consecutive failed iterations`
        );
        
        return {
          role: 'assistant',
          content: `I've encountered ${this.consecutiveFailedIterations} consecutive failed iterations and cannot make progress. This usually means:
- The task requires capabilities I don't have
- There's a persistent error in the environment
- The goal may not be achievable with available tools

Please try rephrasing your request or check if there are any issues with the environment.`
        };
      }
    }

    // Reset flags for next iteration
    this.iterationHadSuccess = false;
    this.iterationHadError = false;

    return null;
  }

  /**
   * Get the current count of consecutive failed iterations
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailedIterations;
  }

  /**
   * Reset the tracker (useful for testing or manual resets)
   */
  reset(): void {
    this.consecutiveFailedIterations = 0;
    this.iterationHadSuccess = false;
    this.iterationHadError = false;
  }
}
