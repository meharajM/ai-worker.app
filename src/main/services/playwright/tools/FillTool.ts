import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class FillTool extends PlaywrightTool {
    name = 'fill';
    aliases = ['browser_fill'];

    getSchema() {
        return {
            name: 'fill',
            description: 'INPUT: Instantly fill a text input, textarea, or contenteditable field. Use for forms, search boxes, login fields. Replaces existing content. For character-by-character typing, use "type" instead.',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of the input field' },
                    value: { type: 'string', description: 'Text to enter' }
                },
                required: ['selector', 'value']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const selectorError = this.requireParam(args, 'selector');
        if (selectorError) return { result: null, error: selectorError };

        const valueError = this.requireParam(args, 'value');
        if (valueError) return { result: null, error: valueError };

        await page.fill(args.selector, args.value);
        return { result: `Filled ${args.selector} with "${args.value}"` };
    }
}
