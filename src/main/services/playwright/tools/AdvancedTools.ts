import { Page } from 'playwright';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class EvaluateTool extends PlaywrightTool {
    name = 'evaluate';
    async execute(page: Page, args: any): Promise<ToolResult> {
        const result = await page.evaluate(args.script);
        return { result };
    }
}

export class HandleDialogTool extends PlaywrightTool {
    name = 'handle_dialog';
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
    async execute(page: Page, args: any): Promise<ToolResult> {
        const wErr = this.requireParam(args, 'width', 'number');
        if (wErr) return { result: null, error: wErr };
        const hErr = this.requireParam(args, 'height', 'number');
        if (hErr) return { result: null, error: hErr };

        await page.setViewportSize({ width: args.width, height: args.height });
        return { result: `Viewport set to ${args.width}x${args.height}` };
    }
}
