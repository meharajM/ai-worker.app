import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class TypeTool extends PlaywrightTool {
    name = 'type';

    async execute(page: Page, args: any): Promise<ToolResult> {
        const selectorError = this.requireParam(args, 'selector');
        if (selectorError) return { result: null, error: selectorError };

        const textError = this.requireParam(args, 'text');
        if (textError) return { result: null, error: textError };

        await page.click(args.selector);
        await page.type(args.selector, args.text, { delay: args.delay || 50 });
        return { result: `Typed "${args.text}" into ${args.selector}` };
    }
}
