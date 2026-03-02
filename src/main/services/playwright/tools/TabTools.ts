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
    async execute(page: Page, _args: any, context?: PlaywrightContext): Promise<ToolResult> {
        if (!context?.context) throw new Error('No browser context');
        // If args.tabId or args.index is provided, use that, otherwise use current page
        // (PlaywrightService.getPage handles this logic usually, but here we can be explicit)
        const pageToClose = page; // Currently we just close the page passed in

        const openPages = context.context.pages().filter(p => !p.isClosed());
        if (openPages.length <= 1) {
            return { result: null, error: 'Cannot close the last tab' };
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
