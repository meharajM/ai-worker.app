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

export class RequestHumanInterventionTool extends PlaywrightTool {
    name = 'request_human_intervention';
    async execute(_page: Page, args: any, context?: PlaywrightContext): Promise<ToolResult> {
        const rErr = this.requireParam(args, 'reason');
        if (rErr) return { result: null, error: rErr };

        if (!context?.surfaceBrowser) {
            return { result: null, error: 'surfaceBrowser capability is not available in this context.' };
        }

        try {
            await context.surfaceBrowser();
            
            // This specific message string is designed to instruct the LLM agent on how to proceed.
            // When the agent reads this result, it should stop its loop and use its native chat mechanics 
            // (e.g. notify_user) to ask the user to solve the issue on screen.
            return { 
                result: `SYSTEM: I have surfaced the browser window to the user. ` +
                        `DO NOT execute any more tools right now. ` +
                        `IMMEDIATELY send a message to the human user asking them to resolve the issue: "${args.reason}". ` +
                        `Ask them to reply to you once they have completed it. ` +
                        `Only resume your task after they have replied.` 
            };
        } catch (error) {
            return { result: null, error: `Failed to surface browser: ${String(error)}` };
        }
    }
}
