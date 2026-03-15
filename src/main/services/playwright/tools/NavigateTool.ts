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

        try {
            await page.goto(args.url, { waitUntil: 'domcontentloaded' });

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
            if (errorStr.includes('ERR_NAME_NOT_RESOLVED') || errorStr.includes('ERR_CONNECTION_REFUSED')) {
                const fallbackUrl = `https://google.com/search?q=${encodeURIComponent(args.url)}`;
                console.log(`[PlaywrightService] Navigation failed (${errorStr}). Falling back to Google Search: ${fallbackUrl}`);
                try {
                    await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded' });
                    return { result: `Navigation failed for '${args.url}', so I searched Google instead. Now at: ${page.url()}` };
                } catch (fallbackError) {
                    return { result: null, error: `Navigation failed: ${errorStr}` };
                }
            }
            throw e;
        }
    }

    getSchema() {
        return {
            name: 'navigate',
            description: 'NAVIGATION: Go to a URL. Use this FIRST to open any website. Example: navigate to "https://google.com" before searching.',
            inputSchema: {
                type: 'object',
                properties: { url: { type: 'string', description: 'Full URL including https://' } },
                required: ['url']
            }
        };
    }
}
