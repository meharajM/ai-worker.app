/**
 * MiscTools.ts — Utility navigation helpers.
 * 
 * Logic:
 *   1. go_back/go_forward: History stack manipulation.
 *   2. wait_for_navigation: Synchronization tool to wait for idle network after clicks.
 */

import { Page, Frame } from 'playwright';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class GoBackTool extends PlaywrightTool {
    name = 'go_back';
    async execute(page: Page): Promise<ToolResult> {
        await page.goBack();
        return { result: 'Navigated back' };
    }
}

export class GoForwardTool extends PlaywrightTool {
    name = 'go_forward';
    async execute(page: Page): Promise<ToolResult> {
        await page.goForward();
        return { result: 'Navigated forward' };
    }
}

export class WaitForNavigationTool extends PlaywrightTool {
    name = 'wait_for_navigation';
    async execute(page: Page | Frame, args: any): Promise<ToolResult> {
        await page.waitForLoadState('networkidle', {
            timeout: args.timeout || 10000
        });
        return { result: 'Navigation/Load complete' };
    }
}
