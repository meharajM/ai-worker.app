import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult, PlaywrightContext } from '../PlaywrightTool';

export class GetCookiesTool extends PlaywrightTool {
    name = 'get_cookies';
    async execute(_page: Page, _args: any, context?: PlaywrightContext): Promise<ToolResult> {
        if (!context?.context) throw new Error('No browser context');
        const cookies = await context.context.cookies();
        return { result: { cookies } };
    }
}

export class SetCookieTool extends PlaywrightTool {
    name = 'set_cookie';
    async execute(page: Page, args: any, context?: PlaywrightContext): Promise<ToolResult> {
        if (!context?.context) throw new Error('No browser context');

        const nErr = this.requireParam(args, 'name');
        if (nErr) return { result: null, error: nErr };
        const vErr = this.requireParam(args, 'value');
        if (vErr) return { result: null, error: vErr };

        const url = page.url();
        const domain = args.domain || new URL(url).hostname;

        await context.context.addCookies([{
            name: args.name,
            value: args.value,
            domain: domain,
            path: args.path || '/'
        }]);

        return { result: `Set cookie ${args.name}` };
    }
}
