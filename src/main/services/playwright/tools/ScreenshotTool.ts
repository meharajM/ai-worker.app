import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class ScreenshotTool extends PlaywrightTool {
    name = 'screenshot';

    getSchema() {
        return {
            name: 'screenshot',
            description: 'VISION: Capture the current page as an image. Use when you need to see the page visually or save visual evidence. For perceiving page state, prefer get_state instead.',
            inputSchema: {
                type: 'object',
                properties: {
                    fullPage: { type: 'boolean', description: 'true=capture entire scrollable page, false=visible viewport only' }
                }
            }
        };
    }
    async execute(page: Page, args: any): Promise<ToolResult> {
        const buffer = await page.screenshot({ fullPage: args.fullPage || false });
        return {
            result: {
                type: 'image',
                data: buffer.toString('base64'),
                mimeType: 'image/png'
            }
        };
    }
}
