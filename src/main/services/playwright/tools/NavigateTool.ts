/**
 * playwright/tools/NavigateTool.ts — Tool for browser navigation.
 *
 * Responsibility: Navigates to a URL, captures basic page information (title, text, links),
 *   and provides staged recovery when navigation fails.
 *
 * Issue coverage: #2 #3 #7 #9
 *
 * Navigation outcome contract:
 *   Every navigation attempt resolves to exactly one typed outcome:
 *     success | interactive_timeout | protocol_blocked | hard_failure
 *   The outcome is included in the tool result metadata so downstream consumers
 *   (ToolExecutionService, result-reporter) can make informed retry/display decisions.
 *
 * Staged recovery (replaces blind Google fallback):
 *   1. Retry with `waitUntil=commit` (softer checkpoint)
 *   2. Readiness probe snapshot (is the page usable despite the error?)
 *   3. Compact state extraction (extract what we can from the current state)
 *   4. Scoped web search fallback as last resort (only for DNS/connection failures)
 *
 * Consumed by: PlaywrightService (via ToolRegistry)
 */

import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';
import {
    probeReadiness,
    classifyNavigationError,
    type NavigationOutcome,
} from './readiness-probe';

/**
 * Extracts a compact page snapshot: title, text preview, and top interactive elements.
 * Used after both successful navigation and soft-success recovery paths.
 */
async function extractCompactState(page: Page): Promise<string> {
    const title = await page.title().catch(() => '(loading...)');
    const pageText = await page
        .evaluate(() => document.body?.innerText?.substring(0, 2000) || '')
        .catch(() => '');

    const elements = await page
        .evaluate(() => {
            const sels =
                'a[href],button,input,textarea,select,[role="button"],[role="link"]';
            const els = document.querySelectorAll(sels);
            const list: string[] = [];
            let i = 1;
            els.forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && i <= 15) {
                    const t = (
                        (el as HTMLElement).innerText ||
                        (el as HTMLInputElement).placeholder ||
                        ''
                    )
                        .substring(0, 40)
                        .trim();
                    const tag = el.tagName.toLowerCase();
                    let sel = tag;
                    if (el.id) sel = `#${el.id}`;
                    else if (el.className && typeof el.className === 'string')
                        sel = `.${el.className.split(' ')[0]}`;
                    list.push(`[${i++}] ${tag}: "${t || '(empty)'}" → ${sel}`);
                }
            });
            return list;
        })
        .catch(() => [] as string[]);

    return (
        `Page: ${title}\nURL: ${page.url()}\n\n` +
        `--- Page Content (preview) ---\n${pageText}\n\n` +
        `--- Interactive Elements (${elements.length}) ---\n${elements.join('\n')}`
    );
}

/**
 * Navigation tool implementation with typed outcomes and staged recovery.
 */
export class NavigateTool extends PlaywrightTool {
    name = 'navigate';
    aliases = ['browser_navigate'];

    async execute(page: Page, args: any): Promise<ToolResult> {
        const safeArgs = args ?? {};
        const navError = this.requireParam(safeArgs, 'url');
        if (navError) return { result: null, error: navError };
        const timeout =
            typeof safeArgs.timeout === 'number' ? safeArgs.timeout : 30000;
        const targetUrl = String(safeArgs.url);
        const startedAt = Date.now();
        console.info(
            `[NavigateTool][Issue #2/#3/#7/#9] start url=${targetUrl} timeout=${timeout}`
        );

        try {
            // ── Stage 1: Primary navigation ──────────────────────────────────────
            try {
                await page.goto(targetUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout,
                });
            } catch (firstError) {
                const msg = String(firstError);
                // ── Stage 2: Retry with softer readiness checkpoint ──────────────
                if (
                    msg.includes('Timeout') ||
                    msg.includes('ERR_HTTP2_PROTOCOL_ERROR')
                ) {
                    console.warn(
                        `[NavigateTool][Issue #2/#7/#9] primary goto failed (${msg.substring(0, 80)}). Retrying with waitUntil=commit timeout=${Math.round(timeout * 1.5)}`
                    );
                    await page.goto(targetUrl, {
                        waitUntil: 'commit',
                        timeout: Math.round(timeout * 1.5),
                    });
                } else {
                    throw firstError;
                }
            }

            // ── Success path ─────────────────────────────────────────────────────
            const elapsedMs = Date.now() - startedAt;
            console.info(
                `[NavigateTool][Issue #2/#7/#9] outcome=success url=${page.url()} elapsedMs=${elapsedMs}`
            );
            const content = await extractCompactState(page);
            return {
                result: content,
                meta: { navigationOutcome: 'success' as NavigationOutcome },
            };
        } catch (e) {
            const errorStr = String(e);
            const elapsedMs = Date.now() - startedAt;

            // ── Stage 3: Readiness probe snapshot ────────────────────────────────
            // Even failed navigations can leave a partially-loaded, interactive page.
            const probe = await probeReadiness(page);
            const outcome = classifyNavigationError(errorStr, probe);

            console.info(
                `[NavigateTool][Issue #2/#7/#9] error_classified outcome=${outcome} probe.isUsable=${probe.isUsable} readyState=${probe.readyState} interactive=${probe.interactiveCount} elapsedMs=${elapsedMs}`
            );

            // ── interactive_timeout: page is usable despite the timeout ──────────
            if (outcome === 'interactive_timeout') {
                console.warn(
                    `[NavigateTool][Issue #7/#9] interactive_timeout — page usable. reason=${probe.reason}`
                );
                // Stage 4: Compact state extraction from the usable page
                let content: string;
                try {
                    content = await extractCompactState(page);
                } catch {
                    content = `URL: ${page.url()}\nreadyState: ${probe.readyState}\ninteractiveElements: ${probe.interactiveCount}`;
                }
                return {
                    result:
                        `Navigation timed out but page appears interactive.\n` +
                        `outcome: interactive_timeout\n` +
                        `readyState: ${probe.readyState}\n` +
                        `interactiveElements: ${probe.interactiveCount}\n\n` +
                        content +
                        `\n\nTry get_state() or interact with visible elements.`,
                    meta: { navigationOutcome: 'interactive_timeout' as NavigationOutcome },
                };
            }

            // ── protocol_blocked: anti-bot / protocol error ──────────────────────
            if (outcome === 'protocol_blocked') {
                console.warn(
                    `[NavigateTool][Issue #2/#3] protocol_blocked for ${targetUrl}. probe.reason=${probe.reason}`
                );
                // If there IS some content on the page, extract it before falling back
                if (probe.interactiveCount > 0) {
                    let content: string;
                    try {
                        content = await extractCompactState(page);
                    } catch {
                        content = `URL: ${page.url()}\nPartial content may be available.`;
                    }
                    return {
                        result:
                            `Navigation encountered a protocol error but some content loaded.\n` +
                            `outcome: protocol_blocked (partial)\n\n` +
                            content,
                        meta: { navigationOutcome: 'protocol_blocked' as NavigationOutcome },
                    };
                }

                // Fallback: scoped Google search (only for true blocked/connection failures)
                return this._searchFallback(page, targetUrl, timeout, startedAt, errorStr);
            }

            // ── hard_failure: DNS, connection refused, etc. ──────────────────────
            if (outcome === 'hard_failure') {
                // DNS/connection errors → try search fallback
                if (
                    errorStr.includes('ERR_NAME_NOT_RESOLVED') ||
                    errorStr.includes('ERR_CONNECTION_REFUSED') ||
                    errorStr.includes('ERR_CONNECTION_RESET')
                ) {
                    return this._searchFallback(
                        page,
                        targetUrl,
                        timeout,
                        startedAt,
                        errorStr
                    );
                }

                console.error(
                    `[NavigateTool][Issue #2/#7/#9] hard_failure error=${errorStr.substring(0, 200)}`
                );
                return {
                    result: null,
                    error: `Navigation failed (hard_failure): ${errorStr.substring(0, 300)}`,
                    meta: { navigationOutcome: 'hard_failure' as NavigationOutcome },
                };
            }

            // ── Unexpected: re-throw ─────────────────────────────────────────────
            console.error(
                `[NavigateTool][Issue #2/#7/#9] unclassified fatal error=${errorStr.substring(0, 200)}`
            );
            throw e;
        }
    }

    /**
     * Last-resort search fallback.
     * Only used for DNS failures, connection refused, or true protocol blocks
     * where the page has zero usable content.
     */
    private async _searchFallback(
        page: Page,
        targetUrl: string,
        timeout: number,
        startedAt: number,
        originalError: string
    ): Promise<ToolResult> {
        const fallbackUrl = `https://google.com/search?q=${encodeURIComponent(targetUrl)}`;
        console.warn(
            `[NavigateTool][Issue #2/#3] search_fallback for ${targetUrl}. originalError=${originalError.substring(0, 80)}`
        );
        try {
            await page.goto(fallbackUrl, {
                waitUntil: 'domcontentloaded',
                timeout: Math.round(timeout * 1.5),
            });
            console.info(
                `[NavigateTool][Issue #3] fallback success finalUrl=${page.url()} elapsedMs=${Date.now() - startedAt}`
            );
            return {
                result: `Navigation failed for '${targetUrl}' (${originalError.substring(0, 60)}), so I searched Google instead. Now at: ${page.url()}`,
                meta: { navigationOutcome: 'hard_failure' as NavigationOutcome },
            };
        } catch (fallbackError) {
            console.error(
                `[NavigateTool][Issue #2/#3] fallback failed error=${String(fallbackError).substring(0, 120)}`
            );
            return {
                result: null,
                error: `Navigation failed: ${originalError.substring(0, 200)}. Google fallback also failed.`,
                meta: { navigationOutcome: 'hard_failure' as NavigationOutcome },
            };
        }
    }

    getSchema() {
        return {
            name: 'navigate',
            description:
                'NAVIGATION: Go to a URL. Use this FIRST to open any website. Example: navigate to "https://google.com" before searching.',
            inputSchema: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'Full URL including https://',
                    },
                    timeout: {
                        type: 'number',
                        description: 'Max wait time in ms (default: 30000)',
                    },
                },
                required: ['url'],
            },
        };
    }
}
