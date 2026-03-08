import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';
import { createCursor } from 'ghost-cursor';

export class TypeTool extends PlaywrightTool {
    name = 'type';

    async execute(page: Page, args: any): Promise<ToolResult> {
        const selectorError = this.requireParam(args, 'selector');
        if (selectorError) return { result: null, error: selectorError };

        const textError = this.requireParam(args, 'text');
        if (textError) return { result: null, error: textError };

        const cursor = createCursor(page);
        try {
            await page.waitForSelector(args.selector, { state: 'attached', timeout: 5000 });
            await cursor.click(args.selector);
        } catch (e) {
            // fallback if ghost-cursor fails
            await page.click(args.selector);
        }

        const baseDelay = args.delay || 50;
        for (const char of args.text) {
            // Adds variable human delay up to +50ms per keystroke
            await page.keyboard.type(char, { delay: baseDelay + Math.random() * 50 });
        }

        return { result: `Typed "${args.text}" into ${args.selector}` };
    }
}
