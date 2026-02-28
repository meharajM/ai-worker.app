import { Page } from 'playwright';
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
    async execute(page: Page, args: any): Promise<ToolResult> {
        await page.waitForNavigation({
            waitUntil: 'networkidle',
            timeout: args.timeout || 30000
        });
        return { result: 'Navigation complete' };
    }
}
