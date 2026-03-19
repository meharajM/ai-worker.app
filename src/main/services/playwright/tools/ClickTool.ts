import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';
import { humanizedClick } from '../humanMouse';

export class ClickTool extends PlaywrightTool {
    name = 'click';
    aliases = ['browser_click'];

    getSchema() {
        return {
            name: 'click',
            description: 'INTERACTION: Click an element using CSS selector. Use when you know the exact selector (e.g., "#submit-btn", ".login-button"). If you only know the text, use click_text instead.',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector like #id, .class, or tag[attr="value"]' }
                },
                required: ['selector']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const clickError = this.requireParam(args, 'selector');
        if (clickError) return { result: null, error: clickError };

        try {
            await page.waitForSelector(args.selector, { state: 'attached', timeout: 5000 });
            await humanizedClick(page, args.selector);
            return { result: `Clicked ${args.selector} with humanized cursor` };
        } catch (error) {
            const errorStr = String(error);
            const isSimpleText = !args.selector.includes('#') && !args.selector.includes('.') && args.selector.includes(' ');

            if (isSimpleText || errorStr.includes('Timeout') || errorStr.includes('Waiting for selector')) {
                console.log(`[PlaywrightService] Click failed. Trying fallback click_text("${args.selector}")`);
                try {
                    const textWithQuotes = `text="${args.selector}"`;
                    await page.waitForSelector(textWithQuotes, { state: 'attached', timeout: 5000 });
                    await humanizedClick(page, textWithQuotes);
                    return { result: `Clicked by Text "${args.selector}" (Fallback from failed selector)` };
                } catch (e2) {
                    // Fallback failed
                }
            }

            if (errorStr.includes('Timeout') || errorStr.includes('Waiting for selector')) {
                return {
                    result: null,
                    error: `Timeout clicking '${args.selector}'. \n\n💡 RECOVERY HINT: Selector failed. Try:\n1. click_text("Visible Text")\n2. get_interactive_elements() to find the ID/Class\n3. screenshot() to check if it's covered/hidden.`
                };
            }
            throw error;
        }
    }
}
