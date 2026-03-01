import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class ClickTextTool extends PlaywrightTool {
    name = 'click_text';

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
