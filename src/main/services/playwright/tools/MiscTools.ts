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
        const timeout = typeof args.timeout === 'number' ? args.timeout : 30000;
        const loadStates: Array<'domcontentloaded' | 'load' | 'networkidle'> = ['domcontentloaded', 'load', 'networkidle'];

        for (const state of loadStates) {
            try {
                await page.waitForLoadState(state, { timeout });
                return { result: `Navigation/Load complete (${state})` };
            } catch (error) {
                const msg = String(error);
                // Keep trying progressively stricter states; dynamic pages often
                // never reach networkidle even though interaction is possible.
                if (!msg.includes('Timeout')) {
                    throw error;
                }
            }
        }

        return {
            result: null,
            error:
                `Timeout waiting for navigation after ${timeout}ms.\n\n` +
                `💡 RECOVERY HINT: The page may be interactive even without network idle. ` +
                `Try get_state(), wait_for_element(), or interact with visible elements.`
        };
    }
}
