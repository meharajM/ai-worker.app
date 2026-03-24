import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class ClickTextTool extends PlaywrightTool {
    name = 'click_text';

    getSchema() {
        return {
            name: 'click_text',
            description: 'INTERACTION: Click by visible text - PREFERRED over "click" when you see text like "Login", "Submit", "Next". More reliable than CSS selectors. Use exact=true for buttons with common words.',
            inputSchema: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: 'Visible text on the element (e.g., "Sign In", "Add to Cart")' },
                    exact: { type: 'boolean', description: 'true=exact match, false=partial match (default)' },
                    tag: { type: 'string', description: 'Limit to tag type: button, a, div, span, etc.' }
                },
                required: ['text']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const textFindError = this.requireParam(args, 'text');
        if (textFindError) return { result: null, error: textFindError };

        const textToFind = args.text;
        const exactMatch = args.exact || false;
        const tagFilter = args.tag ? args.tag.toLowerCase() : null;

        const clickTextSelector = tagFilter
            ? `${tagFilter}:has-text("${textToFind}")`
            : `text=${exactMatch ? `"${textToFind}"` : textToFind}`;

        await page.click(clickTextSelector);
        return { result: `Clicked element with text "${textToFind}"` };
    }
}
