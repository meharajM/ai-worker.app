import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class WaitForElementTool extends PlaywrightTool {
    name = 'wait_for_element';

    async execute(page: Page, args: any): Promise<ToolResult> {
        const originalSelector = args.selector;
        const timeout = args.timeout || 5000;

        try {
            await page.waitForSelector(originalSelector, { timeout });
            return { result: `Element ${originalSelector} appeared` };
        } catch (error) {
            const fallbacks: string[] = [];

            if (originalSelector.startsWith('#')) {
                const coreId = originalSelector.substring(1).replace(/-\d+$/, '');
                if (coreId.length > 3) {
                    fallbacks.push(`[id*="${coreId}"]`);
                }
            }

            if (originalSelector.startsWith('.')) {
                const classes = originalSelector.split('.').filter(c => c);
                classes.forEach(c => {
                    if (c.length > 4) fallbacks.push(`[class*="${c}"]`);
                });
            }

            for (const fallback of fallbacks) {
                try {
                    await page.waitForSelector(fallback, { timeout: 2000 });
                    return { result: `Element appeared (auto-recovered using fallback: ${fallback})` };
                } catch (e) {
                    // Fallback failed
                }
            }

            const errorStr = String(error);
            if (errorStr.includes('Timeout')) {
                return {
                    result: null,
                    error: `Timeout waiting for '${originalSelector}'. \n\n💡 RECOVERY HINT: The selector might be dynamic or incorrect.\n1. Try finding it by text: click_text("label")\n2. Use get_interactive_elements() to see real selectors.\n3. Take a screenshot to verify visibility.`
                };
            }
            throw error;
        }
    }
}
