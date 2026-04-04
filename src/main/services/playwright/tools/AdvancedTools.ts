import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class EvaluateTool extends PlaywrightTool {
    name = 'evaluate';
    aliases = ['browser_run_code', 'browser_evaluate'];

    getSchema() {
        return {
            name: 'evaluate',
            description: 'ADVANCED: Execute raw JavaScript code on the page. Use as a last resort when no other tool can accomplish the task. Can access DOM, modify page, or extract complex data. NOTE: document.querySelectorAll returns a NodeList, not Array. Use Array.from() before .map(), .filter(), or .slice(). if any issues occurs while executing the script, try to google the error and fix it.',
            inputSchema: {
                type: 'object',
                properties: {
                    script: { type: 'string', description: 'JavaScript code to execute. Return value will be included in result.' }
                },
                required: ['script']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const script = typeof args?.script === 'string'
            ? args.script
            : (typeof args?.code === 'string' ? args.code : '');
        if (!script.trim()) {
            return { result: null, error: 'Missing required parameter: script' };
        }

        try {
            const result = await page.evaluate(script);
            return { result };
        } catch (error) {
            const primaryError = String(error);
            const hasSyntaxLikeFailure =
                /SyntaxError|Unexpected token|Unexpected identifier|Unexpected string|Unexpected end of input|missing \)|missing \(|Invalid or unexpected token/i.test(primaryError);
            const hasReturnLikeFailure =
                /return statements are only valid inside functions|Illegal return statement|Unexpected token 'return'/i.test(primaryError);
            const genericEvaluateFailureWithReturn =
                primaryError.includes('page.evaluate') && /\breturn\b/.test(script);
            const alreadyIifeWrapped = /^\s*\(\s*(?:\(\)\s*=>|function\b)/.test(script);
            const canRecoverWithIifeWrap = !alreadyIifeWrapped && (hasReturnLikeFailure || hasSyntaxLikeFailure || genericEvaluateFailureWithReturn);

            if (canRecoverWithIifeWrap) {
                const wrappedScript = `(() => {\n${script}\n})()`;
                try {
                    const recoveredResult = await page.evaluate(wrappedScript);
                    return { result: recoveredResult };
                } catch (wrappedError) {
                    return {
                        result: null,
                        error: `Script execution failed: ${primaryError}. Recovery with wrapped IIFE also failed: ${String(wrappedError)}`,
                    };
                }
            }

            return { result: null, error: `Script execution failed: ${primaryError}` };
        }
    }
}

export class HandleDialogTool extends PlaywrightTool {
    name = 'handle_dialog';

    getSchema() {
        return {
            name: 'handle_dialog',
            description: 'DIALOGS: Handle JavaScript alert(), confirm(), or prompt() popups. Call BEFORE the action that triggers the dialog. Use accept for OK, dismiss for Cancel.',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['accept', 'dismiss'], description: 'accept=click OK, dismiss=click Cancel' },
                    promptText: { type: 'string', description: 'Text to enter if dialog is a prompt()' }
                },
                required: ['action']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const actionErr = this.requireParam(args, 'action');
        if (actionErr) return { result: null, error: actionErr };

        page.once('dialog', async dialog => {
            if (args.action === 'accept') {
                await dialog.accept(args.promptText);
            } else {
                await dialog.dismiss();
            }
        });
        return { result: `Dialog handler set to ${args.action}` };
    }
}

export class SwitchFrameTool extends PlaywrightTool {
    name = 'switch_frame';

    getSchema() {
        return {
            name: 'switch_frame',
            description: 'ADVANCED: Switch context to an iframe (embedded page). Required for interacting with elements inside iframes. Omit selector to return to main page.',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of iframe (omit to return to main frame)' }
                }
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        if (!args.selector) {
            return { result: 'Switched to main frame' };
        }
        const frameElement = await page.$(args.selector);
        if (!frameElement) {
            return { result: null, error: `Frame not found: ${args.selector}` };
        }
        const frame = await frameElement.contentFrame();
        if (!frame) {
            return { result: null, error: 'Could not access frame content' };
        }
        return { result: `Switched to frame ${args.selector}` };
    }
}

export class FindByXpathTool extends PlaywrightTool {
    name = 'find_by_xpath';

    getSchema() {
        return {
            name: 'find_by_xpath',
            description: 'ADVANCED: Find elements using XPath expressions. Use when CSS cannot express the query (e.g., selecting by text content, parent-child relationships). Example: //button[contains(text(),"Submit")]',
            inputSchema: {
                type: 'object',
                properties: {
                    xpath: { type: 'string', description: 'XPath expression starting with //' },
                    action: { type: 'string', enum: ['info', 'click', 'text'], description: 'info=element details, click=click first, text=get text content' }
                },
                required: ['xpath']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const xpErr = this.requireParam(args, 'xpath');
        if (xpErr) return { result: null, error: xpErr };

        const xpathAction = args.action || 'info';
        const xpathElements = await page.$$(`xpath=${args.xpath}`);

        if (xpathElements.length === 0) {
            return { result: null, error: `No elements found for XPath: ${args.xpath}` };
        }

        if (xpathAction === 'click') {
            await xpathElements[0].click();
            return { result: `Clicked first XPath match` };
        } else if (xpathAction === 'text') {
            const texts = await Promise.all(
                xpathElements.slice(0, 10).map(el => el.innerText())
            );
            return { result: texts };
        } else {
            return { result: `Found ${xpathElements.length} elements for XPath: ${args.xpath}` };
        }
    }
}

export class CheckElementTool extends PlaywrightTool {
    name = 'check_element';

    getSchema() {
        return {
            name: 'check_element',
            description: 'INSPECTION: Check element state without interacting. Use to verify if login succeeded (check welcome message), if item is in cart, if checkbox is checked, etc.',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of element' },
                    property: { type: 'string', description: 'exists, visible, text, value, href, src, checked, disabled, or any attribute name' }
                },
                required: ['selector']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const selErr = this.requireParam(args, 'selector');
        if (selErr) return { result: null, error: selErr };

        const prop = args.property || 'exists';
        const element = await page.$(args.selector);

        if (!element) {
            return { result: prop === 'exists' ? false : null, error: prop === 'exists' ? undefined : `Element ${args.selector} not found` };
        }

        if (prop === 'exists') return { result: true };
        if (prop === 'visible') return { result: await element.isVisible() };
        if (prop === 'text') return { result: await element.innerText() };
        if (prop === 'value') return { result: await element.inputValue() };
        if (prop === 'checked') return { result: await element.isChecked() };
        if (prop === 'disabled') return { result: await element.isDisabled() };

        const attrValue = await element.getAttribute(prop);
        return { result: attrValue };
    }
}

export class SetViewportTool extends PlaywrightTool {
    name = 'set_viewport';

    getSchema() {
        return {
            name: 'set_viewport',
            description: 'CONFIG: Change browser window size. Use to test mobile layouts (375x667), tablets (768x1024), or desktop (1920x1080).',
            inputSchema: {
                type: 'object',
                properties: {
                    width: { type: 'number', description: 'Width in pixels' },
                    height: { type: 'number', description: 'Height in pixels' }
                },
                required: ['width', 'height']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const wErr = this.requireParam(args, 'width', 'number');
        if (wErr) return { result: null, error: wErr };
        const hErr = this.requireParam(args, 'height', 'number');
        if (hErr) return { result: null, error: hErr };

        await page.setViewportSize({ width: args.width, height: args.height });
        return { result: `Viewport set to ${args.width}x${args.height}` };
    }
}
