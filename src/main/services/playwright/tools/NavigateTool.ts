/**
 * playwright/tools/NavigateTool.ts — Tool for browser navigation.
 *
 * Responsibility: Navigates to a URL, captures basic page information (title, text, links),
 *   and provides a search fallback if the navigation fails due to DNS/connection issues.
 *
 * Consumed by: PlaywrightService (via ToolRegistry)
 */

import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

/**
 * Navigation tool implementation with Google search fallback.
 */
export class NavigateTool extends PlaywrightTool {
    name = 'navigate';
    aliases = ['browser_navigate'];

    async execute(page: Page, args: any): Promise<ToolResult> {
        const navError = this.requireParam(args, 'url');
        if (navError) return { result: null, error: navError };
        const timeout = typeof args.timeout === 'number' ? args.timeout : 30000;
        const startedAt = Date.now();
        console.info(`[NavigateTool][Issue #2/#3/#7/#9] start url=${args.url} timeout=${timeout}`);

        try {
            try {
                await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout });
            } catch (firstError) {
                const msg = String(firstError);
                // Retry once with a softer readiness check for heavy anti-bot pages
                // that often miss domcontentloaded/network idle timing windows.
                if (msg.includes('Timeout') || msg.includes('ERR_HTTP2_PROTOCOL_ERROR')) {
                    console.warn(`[NavigateTool][Issue #2/#7/#9] primary goto failed (${msg}). Retrying with waitUntil=commit timeout=${Math.round(timeout * 1.5)}`);
                    await page.goto(args.url, { waitUntil: 'commit', timeout: Math.round(timeout * 1.5) });
                } else {
                    throw firstError;
                }
            }
            console.info(`[NavigateTool][Issue #2/#7/#9] success url=${page.url()} elapsedMs=${Date.now() - startedAt}`);

            const navTitle = await page.title();
            const navPageText = await page.evaluate(() => {
                return document.body?.innerText?.substring(0, 2000) || '';
            }).catch(() => '');

            const navElements = await page.evaluate(() => {
                const sels = 'a[href],button,input,textarea,select,[role="button"],[role="link"]';
                const els = document.querySelectorAll(sels);
                const list: string[] = [];
                let i = 1;
                els.forEach(el => {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0 && i <= 15) {
                        const t = ((el as HTMLElement).innerText ||
                            (el as HTMLInputElement).placeholder || '').substring(0, 40).trim();
                        const tag = el.tagName.toLowerCase();
                        let sel = tag;
                        if (el.id) sel = `#${el.id}`;
                        else if (el.className && typeof el.className === 'string') sel = `.${el.className.split(' ')[0]}`;
                        list.push(`[${i++}] ${tag}: "${t || '(empty)'}" → ${sel}`);
                    }
                });
                return list;
            }).catch(() => [] as string[]);

            return {
                result: `Page: ${navTitle}\nURL: ${page.url()}\n\n` +
                    `--- Page Content (preview) ---\n${navPageText}\n\n` +
                    `--- Interactive Elements (${navElements.length}) ---\n${navElements.join('\n')}`
            };
        } catch (e) {
            const errorStr = String(e);
            if (
                errorStr.includes('ERR_NAME_NOT_RESOLVED') ||
                errorStr.includes('ERR_CONNECTION_REFUSED') ||
                errorStr.includes('ERR_HTTP2_PROTOCOL_ERROR')
            ) {
                const fallbackUrl = `https://google.com/search?q=${encodeURIComponent(args.url)}`;
                console.warn(`[NavigateTool][Issue #2/#3] Navigation failed (${errorStr}). Falling back to Google Search: ${fallbackUrl}`);
                try {
                    await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: Math.round(timeout * 1.5) });
                    console.info(`[NavigateTool][Issue #3] fallback success finalUrl=${page.url()} elapsedMs=${Date.now() - startedAt}`);
                    return { result: `Navigation failed for '${args.url}', so I searched Google instead. Now at: ${page.url()}` };
                } catch (fallbackError) {
                    console.error(`[NavigateTool][Issue #2/#3] fallback failed error=${String(fallbackError)}`);
                    return { result: null, error: `Navigation failed: ${errorStr}` };
                }
            }
            console.error(`[NavigateTool][Issue #2/#7/#9] fatal navigation error=${errorStr}`);
            throw e;
        }
    }

    getSchema() {
        return {
            name: 'navigate',
            description: 'NAVIGATION: Go to a URL. Use this FIRST to open any website. Example: navigate to "https://google.com" before searching.',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'Full URL including https://' },
                    timeout: { type: 'number', description: 'Max wait time in ms (default: 30000)' }
                },
                required: ['url']
            }
        };
    }
}
