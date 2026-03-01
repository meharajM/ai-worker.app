import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class FillTool extends PlaywrightTool {
    name = 'fill';

    async execute(page: Page, args: any): Promise<ToolResult> {
        const selectorError = this.requireParam(args, 'selector');
        if (selectorError) return { result: null, error: selectorError };

        const valueError = this.requireParam(args, 'value');
        if (valueError) return { result: null, error: valueError };

        await page.fill(args.selector, args.value);
        return { result: `Filled ${args.selector} with "${args.value}"` };
    }
}
