import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';
import { humanizedClick } from '../humanMouse';

export class TypeTool extends PlaywrightTool {
    name = 'type';
    aliases = ['browser_type'];

    getSchema() {
        return {
            name: 'type',
            description: 'INPUT: Type text character-by-character with delays (simulates human typing). Use when websites detect instant input as bots. For normal form filling, use "fill" instead (faster).',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of input field' },
                    text: { type: 'string', description: 'Text to type' },
                    delay: { type: 'number', description: 'Delay between keys in ms (default: 50)' }
                },
                required: ['selector', 'text']
            }
        };
    }

    async execute(page: Page, args: Record<string, unknown>): Promise<ToolResult> {
        const selectorError = this.requireParam(args, 'selector');
        if (selectorError) return { result: null, error: selectorError };

        const textError = this.requireParam(args, 'text');
        if (textError) return { result: null, error: textError };

        try {
            await page.waitForSelector(args.selector as string, { state: 'attached', timeout: 15000 });
            await humanizedClick(page, args.selector as string);
        } catch {
            // fallback if humanized click fails
            await page.click(args.selector as string);
        }

        const baseDelay = typeof args.delay === 'number' ? args.delay : 50;
        const textToType = args.text as string;
        for (const char of textToType) {
            // Adds variable human delay up to +50ms per keystroke
            await page.keyboard.type(char, { delay: baseDelay + Math.random() * 50 });
        }

        return { result: `Typed "${args.text}" into ${args.selector}` };
    }
}
