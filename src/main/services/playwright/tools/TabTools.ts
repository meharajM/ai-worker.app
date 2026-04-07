/**
 * playwright/tools/TabTools.ts — Tools for multi-tab management.
 *
 * Responsibility: Provides tools for creating, switching, closing, and listing
 *   browser tabs. Manages the synchronization between Playwright's page list
 *   and the service's internal tab tracking.
 *
 * Consumed by: PlaywrightService (via ToolRegistry)
 */

import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult, PlaywrightContext } from '../PlaywrightTool';

/**
 * Opens a new tab and optional URL.
 */
export class NewTabTool extends PlaywrightTool {
    name = 'new_tab';

    getSchema() {
        return {
            name: 'new_tab',
            description: 'TABS: Open a new browser tab. Use to keep current page open while checking another URL. Optionally provide URL to navigate immediately.',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to open (optional - opens blank tab if omitted)' }
                }
            }
        };
    }

    async execute(_page: Page, args: any, context?: PlaywrightContext): Promise<ToolResult> {
        if (!context?.context) throw new Error('No browser context');
        const newPage = await context.context.newPage();
        if (args.url) {
            await newPage.goto(args.url, { waitUntil: 'domcontentloaded' });
        }
        context.setPage(newPage);
        const newTabIndex = context.registerPage(newPage);
        return { result: { message: `Opened new tab${args.url ? ` at ${args.url}` : ''}`, tabId: newTabIndex } };
    }
}

/**
 * Switches focus to an existing tab by its ID.
 */
export class SwitchTabTool extends PlaywrightTool {
    name = 'switch_tab';

    getSchema() {
        return {
            name: 'switch_tab',
            description: 'TABS: Switch focus to a different tab. Use get_tabs first to see available tabs and their indices.',
            inputSchema: {
                type: 'object',
                properties: {
                    index: { type: 'number', description: 'Tab index from get_tabs (0 = first tab)' }
                },
                required: ['index']
            }
        };
    }

    async execute(_page: Page, args: any, context?: PlaywrightContext): Promise<ToolResult> {
        if (!context) throw new Error('No playwright context');
        const targetTab = context.pagesMap.get(args.index);
        if (!targetTab) {
            return { result: null, error: `Tab ID ${args.index} not found` };
        }
        context.setPage(targetTab);
        await targetTab.bringToFront();
        return { result: `Switched to tab ${args.index}: ${await targetTab.title()}` };
    }
}

/**
 * Closes the current or specified tab.
 */
export class CloseTabTool extends PlaywrightTool {
    name = 'close_tab';

    getSchema() {
        return {
            name: 'close_tab',
            description: 'TABS: Close the current tab. Automatically switches to another open tab. If this is the last remaining tab, this tool is a safe no-op.',
            inputSchema: { type: 'object', properties: {} }
        };
    }

    async execute(page: Page, args: any, context?: PlaywrightContext): Promise<ToolResult> {
        if (!context?.context) throw new Error('No browser context');
        // If a tab id/index was requested, resolve it explicitly from pagesMap.
        // This prevents accidental closure of the current page when a stale tabId
        // is passed and BrowserManager falls back to the active page.
        let pageToClose = page;
        const requestedTabId = typeof args?.tabId === 'number'
            ? args.tabId
            : (typeof args?.index === 'number' ? args.index : undefined);
        if (requestedTabId !== undefined) {
            const requestedPage = context.pagesMap.get(requestedTabId);
            if (!requestedPage || requestedPage.isClosed()) {
                return { result: null, error: `Tab ID ${requestedTabId} not found` };
            }
            pageToClose = requestedPage;
        }
        const forceCloseLastTab = args?.force === true;

        const openPages = context.context.pages().filter(p => !p.isClosed());
        if (openPages.length <= 1 && !forceCloseLastTab) {
            return { result: 'Skipped close_tab: last tab remains open' };
        }

        await pageToClose.close();

        if (context.page === pageToClose || context.page?.isClosed()) {
            const remaining = context.context.pages().filter(p => !p.isClosed());
            if (remaining.length > 0) {
                context.setPage(remaining[remaining.length - 1]);
            }
        }

        return { result: 'Closed tab' };
    }
}

/**
 * Lists all open tabs with their IDs, titles, and URLs.
 */
export class GetTabsTool extends PlaywrightTool {
    name = 'get_tabs';

    getSchema() {
        return {
            name: 'get_tabs',
            description: 'TABS: List all open tabs with their index, title, and URL. Use before switch_tab to find the right tab.',
            inputSchema: { type: 'object', properties: {} }
        };
    }

    async execute(_page: Page, _args: any, context?: PlaywrightContext): Promise<ToolResult> {
        if (!context) throw new Error('No playwright context');
        const tabList = await Promise.all(
            Array.from(context.pagesMap.entries()).map(async ([id, p]) => ({
                index: id,
                title: await p.title().catch(() => 'Unknown'),
                url: p.url(),
                active: p === context.page
            }))
        );
        return { result: { tabs: tabList } };
    }
}
