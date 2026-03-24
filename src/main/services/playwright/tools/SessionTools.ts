import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult, PlaywrightContext } from '../PlaywrightTool';
import { REQUEST_HUMAN_INTERVENTION_SCHEMA } from '../../../../shared/browser-tool-schemas';

export class GetCookiesTool extends PlaywrightTool {
    name = 'get_cookies';

    getSchema() {
        return {
            name: 'get_cookies',
            description: 'SESSION: Get all cookies for the current domain. Use to check login state, session tokens, or debug authentication issues.',
            inputSchema: { type: 'object', properties: {} }
        };
    }

    async execute(_page: Page, _args: any, context?: PlaywrightContext): Promise<ToolResult> {
        if (!context?.context) throw new Error('No browser context');
        const cookies = await context.context.cookies();
        return { result: { cookies } };
    }
}

export class SetCookieTool extends PlaywrightTool {
    name = 'set_cookie';

    getSchema() {
        return {
            name: 'set_cookie',
            description: 'SESSION: Set a browser cookie. Use to maintain login sessions, set preferences, or bypass cookie consent (if legal).',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Cookie name' },
                    value: { type: 'string', description: 'Cookie value' },
                    domain: { type: 'string', description: 'Domain (defaults to current site)' },
                    path: { type: 'string', description: 'Path scope (default: /)' }
                },
                required: ['name', 'value']
            }
        };
    }

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

    getSchema() {
        return REQUEST_HUMAN_INTERVENTION_SCHEMA;
    }

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
