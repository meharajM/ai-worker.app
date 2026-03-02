import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class ClickTool extends PlaywrightTool {
    name = 'click';

    async execute(page: Page, args: any): Promise<ToolResult> {
        const clickError = this.requireParam(args, 'selector');
        if (clickError) return { result: null, error: clickError };

        try {
            await page.click(args.selector, { timeout: 5000 });
            return { result: `Clicked ${args.selector}` };
        } catch (error) {
            const errorStr = String(error);
            const isSimpleText = !args.selector.includes('#') && !args.selector.includes('.') && args.selector.includes(' ');

            if (isSimpleText || errorStr.includes('Timeout')) {
                console.log(`[PlaywrightService] Click failed. Trying fallback click_text("${args.selector}")`);
                try {
                    const textWithQuotes = `text="${args.selector}"`;
                    await page.click(textWithQuotes, { timeout: 5000 });
                    return { result: `Clicked by Text "${args.selector}" (Fallback from failed selector)` };
                } catch (e2) {
                    // Fallback failed
                }
            }

            if (errorStr.includes('Timeout')) {
                return {
                    result: null,
                    error: `Timeout clicking '${args.selector}'. \n\n💡 RECOVERY HINT: Selector failed. Try:\n1. click_text("Visible Text")\n2. get_interactive_elements() to find the ID/Class\n3. screenshot() to check if it's covered/hidden.`
                };
            }
            throw error;
        }
    }
}
