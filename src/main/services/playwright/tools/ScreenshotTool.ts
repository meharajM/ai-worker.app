import { Page } from 'playwright';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class ScreenshotTool extends PlaywrightTool {
    name = 'screenshot';

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
