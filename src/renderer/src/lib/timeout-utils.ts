/**
 * Timeout utilities for preventing indefinite hangs in async operations.
 * Issue #4: Per-Iteration Timeout
 */

import { IterationTimeoutError } from './errors';

/**
 * Timeout configuration constants
 */
export const TIMEOUT_CONFIG = {
  /** Default iteration timeout: 3 minutes (accounts for 120s cumulative tool timeout + LLM call) */
  ITERATION_TIMEOUT_MS: 180_000,
} as const;

/**
 * Wraps an async operation with a timeout using Promise.race pattern.
 * 
 * @param operation The async function to execute
 * @param timeoutMs Maximum time allowed for the operation (milliseconds)
 * @param errorFactory Function to create the timeout error (receives timeoutMs)
 * @returns Result of the operation
 * @throws Error created by errorFactory if timeout is exceeded
 * 
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   () => fetchData(),
 *   5000,
 *   (ms) => new Error(`Operation timed out after ${ms}ms`)
 * );
 * ```
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  errorFactory: (timeoutMs: number) => Error
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(errorFactory(timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([operation(), timeoutPromise]);
    return result;
  } finally {
    // Always clear timeout to prevent memory leaks
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Wraps an async operation with iteration timeout specifically for agent iterations.
 * 
 * @param operation The async function to execute
 * @param iterationNumber Current iteration number (for error messages)
 * @param timeoutMs Optional custom timeout (defaults to ITERATION_TIMEOUT_MS)
 * @returns Result of the operation
 * @throws IterationTimeoutError if timeout is exceeded
 */
export async function withIterationTimeout<T>(
  operation: () => Promise<T>,
  iterationNumber: number,
  timeoutMs: number = TIMEOUT_CONFIG.ITERATION_TIMEOUT_MS
): Promise<T> {
  return withTimeout(
    operation,
    timeoutMs,
    (ms) => new IterationTimeoutError(iterationNumber, ms)
  );
}
