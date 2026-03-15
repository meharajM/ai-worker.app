/**
 * MiscTools.ts — Utility navigation helpers.
 * 
 * Logic:
 *   1. go_back/go_forward: History stack manipulation.
 *   2. wait_for_navigation: Synchronization tool to wait for idle network after clicks.
 */

import { Page, Frame } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class GoBackTool extends PlaywrightTool {
    name = 'go_back';

    getSchema() {
        return {
            name: 'go_back',
            description: 'NAVIGATION: Click browser back button. Use to return to previous page after viewing details or search results.',
            inputSchema: { type: 'object', properties: {} }
        };
    }

    async execute(page: Page): Promise<ToolResult> {
        await page.goBack();
        return { result: 'Navigated back' };
    }
}

export class GoForwardTool extends PlaywrightTool {
    name = 'go_forward';

    getSchema() {
        return {
            name: 'go_forward',
            description: 'NAVIGATION: Click browser forward button. Use after go_back to return to where you were.',
            inputSchema: { type: 'object', properties: {} }
        };
    }

    async execute(page: Page): Promise<ToolResult> {
        await page.goForward();
        return { result: 'Navigated forward' };
    }
}

export class WaitForNavigationTool extends PlaywrightTool {
    name = 'wait_for_navigation';

    getSchema() {
        return {
            name: 'wait_for_navigation',
            description: 'TIMING: Wait for page to fully load after clicking a link. Use after actions that trigger page changes. Waits for network to be idle.',
            inputSchema: {
                type: 'object',
                properties: {
                    timeout: { type: 'number', description: 'Max wait in ms (default: 30000)' }
                }
            }
        };
    }

    async execute(page: Page | Frame, args: any): Promise<ToolResult> {
        await page.waitForLoadState('networkidle', {
            timeout: args.timeout || 10000
        });
        return { result: 'Navigation/Load complete' };
    }
}
