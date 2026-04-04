/**
 * readiness-probe.ts — Shared readiness detection for browser pages.
 *
 * WHY: NavigateTool, WaitForNavigationTool, and GetStateTool all need to judge
 *   whether a page is "usable" (interactive enough for continued automation).
 *   Previously each tool had its own inline heuristic, making behaviour
 *   inconsistent and hard to tune. This module centralises the decision into
 *   one probe that all three tools share.
 *
 * Issues addressed: #2 #7 #9 #10
 *
 * Consumed by: NavigateTool, MiscTools (WaitForNavigationTool), GetStateTool
 */

import { Page, Frame } from 'playwright-core';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Navigation outcome classes.
 * Each navigation attempt MUST resolve to exactly one of these.
 */
export type NavigationOutcome =
  | 'success'              // Page loaded normally
  | 'interactive_timeout'  // Timed out but page is usable
  | 'protocol_blocked'     // Anti-bot / protocol error (ERR_HTTP2, etc.)
  | 'hard_failure';        // DNS failure, connection refused, fatal error

/**
 * Result of a readiness probe — snapshot of the page's interactive state.
 */
export interface ReadinessResult {
  /** document.readyState at probe time */
  readyState: string;
  /** Count of visible interactive elements on the page */
  interactiveCount: number;
  /** Whether the page is considered "usable" for continued automation */
  isUsable: boolean;
  /** Reason string for logging / diagnostics */
  reason: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Minimum interactive elements for a page to be considered "usable"
 * even when document.readyState is not yet 'complete'.
 */
const MIN_INTERACTIVE_FOR_USABLE = 1;

// ── Probe Implementation ───────────────────────────────────────────────────────

/**
 * Runs a single readiness probe against the current page.
 *
 * Safe to call during navigation races — catches execution context destruction
 * and returns a conservative "not usable" result.
 *
 * @param pageOrFrame - The Playwright Page or Frame to probe.
 * @returns ReadinessResult with usability verdict and diagnostics.
 */
export async function probeReadiness(
  pageOrFrame: Page | Frame
): Promise<ReadinessResult> {
  try {
    const heuristics = await pageOrFrame.evaluate(() => {
      const selectors =
        'a[href],button,input,textarea,select,[role="button"],[role="link"]';
      const elements = document.querySelectorAll(selectors);
      let visibleCount = 0;
      elements.forEach((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) visibleCount++;
      });
      return {
        readyState: document.readyState,
        interactiveCount: visibleCount,
      };
    });

    const isUsable =
      heuristics.readyState === 'complete' ||
      heuristics.readyState === 'interactive' ||
      heuristics.interactiveCount >= MIN_INTERACTIVE_FOR_USABLE;

    let reason: string;
    if (heuristics.readyState === 'complete') {
      reason = 'document fully loaded';
    } else if (heuristics.readyState === 'interactive') {
      reason = `document interactive (${heuristics.interactiveCount} elements)`;
    } else if (heuristics.interactiveCount >= MIN_INTERACTIVE_FOR_USABLE) {
      reason = `readyState=${heuristics.readyState} but ${heuristics.interactiveCount} interactive elements found`;
    } else {
      reason = `readyState=${heuristics.readyState}, ${heuristics.interactiveCount} interactive elements — not yet usable`;
    }

    return {
      readyState: heuristics.readyState,
      interactiveCount: heuristics.interactiveCount,
      isUsable,
      reason,
    };
  } catch (error) {
    const msg = String(error);
    const isNavigationRace =
      msg.includes('Execution context was destroyed') ||
      msg.includes('Cannot find context with specified id');
    const isClosed = msg.includes('Target page, context or browser has been closed');

    return {
      readyState: 'unknown',
      interactiveCount: 0,
      isUsable: false,
      reason: isNavigationRace
        ? 'navigation race — execution context destroyed'
        : isClosed
          ? 'page/context closed'
          : `probe error: ${msg.substring(0, 120)}`,
    };
  }
}

/**
 * Probes readiness with bounded retries.
 *
 * Useful when the page is suspected to be mid-navigation (context may be
 * destroyed and recreated). Waits `delayMs` between attempts.
 *
 * @param pageOrFrame - The Playwright Page or Frame to probe.
 * @param maxAttempts - Maximum number of probe attempts (default 3).
 * @param delayMs - Delay between attempts in milliseconds (default 800).
 * @returns The last ReadinessResult (which may still be !isUsable).
 */
export async function probeReadinessWithRetry(
  pageOrFrame: Page | Frame,
  maxAttempts = 3,
  delayMs = 800
): Promise<ReadinessResult> {
  let lastResult: ReadinessResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await probeReadiness(pageOrFrame);

    if (lastResult.isUsable) {
      console.info(
        `[readiness-probe] usable on attempt ${attempt}: ${lastResult.reason}`
      );
      return lastResult;
    }

    if (attempt < maxAttempts) {
      console.info(
        `[readiness-probe] not usable on attempt ${attempt}: ${lastResult.reason}. Retrying in ${delayMs}ms...`
      );
      // Wait for domcontentloaded as a lightweight synchronisation point
      await (pageOrFrame as Page)
        .waitForLoadState?.('domcontentloaded', { timeout: delayMs })
        .catch(() => {});
      // Fallback pure delay in case waitForLoadState is not available on Frame
      await new Promise((resolve) => setTimeout(resolve, Math.max(100, delayMs - 500)));
    }
  }

  console.warn(
    `[readiness-probe] not usable after ${maxAttempts} attempts: ${lastResult!.reason}`
  );
  return lastResult!;
}

/**
 * Classifies a navigation error string into a NavigationOutcome.
 *
 * @param errorStr - The stringified error from page.goto or similar.
 * @param probe - Optional readiness probe result taken after the error.
 * @returns The classified NavigationOutcome.
 */
export function classifyNavigationError(
  errorStr: string,
  probe?: ReadinessResult
): NavigationOutcome {
  // Protocol / anti-bot blocks
  if (
    errorStr.includes('ERR_HTTP2_PROTOCOL_ERROR') ||
    errorStr.includes('ERR_HTTP2_') ||
    errorStr.includes('ERR_SSL_') ||
    errorStr.includes('ERR_CERT_') ||
    errorStr.includes('ERR_BLOCKED_BY') ||
    errorStr.includes('ERR_ABORTED')
  ) {
    // Even protocol errors can leave a usable page behind (e.g., partial load)
    if (probe?.isUsable) return 'interactive_timeout';
    return 'protocol_blocked';
  }

  // DNS / connection failures — page is definitely not usable
  if (
    errorStr.includes('ERR_NAME_NOT_RESOLVED') ||
    errorStr.includes('ERR_CONNECTION_REFUSED') ||
    errorStr.includes('ERR_CONNECTION_RESET') ||
    errorStr.includes('ERR_INTERNET_DISCONNECTED')
  ) {
    return 'hard_failure';
  }

  // Timeout — may or may not be usable
  if (errorStr.includes('Timeout') || errorStr.includes('timeout')) {
    if (probe?.isUsable) return 'interactive_timeout';
    return 'hard_failure';
  }

  // Default: hard failure
  return 'hard_failure';
}
