import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class SelectOptionTool extends PlaywrightTool {
    name = 'select_option';

    getSchema() {
        return {
            name: 'select_option',
            description: 'INPUT: Choose an option from a <select> dropdown menu. REQUIRED: You MUST provide "selector" AND "value". Value should be the option value attribute or visible text.',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of <select> element' },
                    value: { type: 'string', description: 'Option value attribute OR visible text label' }
                },
                required: ['selector', 'value']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const selErr = this.requireParam(args, 'selector');
        if (selErr) return { result: null, error: selErr };
        const valErr = this.requireParam(args, 'value');
        if (valErr) return { result: null, error: valErr };

        await page.selectOption(args.selector, args.value);
        return { result: `Selected "${args.value}" in ${args.selector}` };
    }
}

export class UploadFileTool extends PlaywrightTool {
    name = 'upload_file';

    getSchema() {
        return {
            name: 'upload_file',
            description: 'INPUT: Upload a file to a file input (<input type="file">). Use for document uploads, image uploads, CSV imports.',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of file input element' },
                    filePath: { type: 'string', description: 'Absolute path to file on disk' }
                },
                required: ['selector', 'filePath']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const selErr = this.requireParam(args, 'selector');
        if (selErr) return { result: null, error: selErr };
        const pathErr = this.requireParam(args, 'filePath');
        if (pathErr) return { result: null, error: pathErr };

        await page.setInputFiles(args.selector, args.filePath);
        return { result: `Uploaded file to ${args.selector}` };
    }
}

export class HoverTool extends PlaywrightTool {
    name = 'hover';

    getSchema() {
        return {
            name: 'hover',
            description: 'INTERACTION: Move mouse over an element without clicking. Use to reveal dropdown menus, tooltips, or trigger hover states before clicking sub-items.',
            inputSchema: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of element to hover' }
                },
                required: ['selector']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const selErr = this.requireParam(args, 'selector');
        if (selErr) return { result: null, error: selErr };
        await page.hover(args.selector);
        return { result: `Hovered over ${args.selector}` };
    }
}

export class PressTool extends PlaywrightTool {
    name = 'press';
    aliases = ['browser_press_key'];

    getSchema() {
        return {
            name: 'press',
            description: 'KEYBOARD: Press a single key. Use for Enter (submit forms), Escape (close dialogs), Tab (navigate fields), ArrowDown/Up (navigate lists). Common keys: Enter, Escape, Tab, Space, Backspace, ArrowUp/Down/Left/Right.',
            inputSchema: {
                type: 'object',
                properties: {
                    key: { type: 'string', description: 'Key name: Enter, Escape, Tab, Space, ArrowDown, etc.' }
                },
                required: ['key']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const keyErr = this.requireParam(args, 'key');
        if (keyErr) return { result: null, error: keyErr };
        await page.keyboard.press(args.key);
        return { result: `Pressed ${args.key}` };
    }
}

export class ScrollTool extends PlaywrightTool {
    name = 'scroll';

    getSchema() {
        return {
            name: 'scroll',
            description: 'NAVIGATION: Scroll the page to see more content. Use "down" to load more items, "top" to return to beginning, "bottom" to reach footer/end of page.',
            inputSchema: {
                type: 'object',
                properties: {
                    direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'up/down=scroll by amount, top/bottom=jump to edge' },
                    amount: { type: 'number', description: 'Pixels to scroll (default: 500). Only used for up/down.' }
                },
                required: ['direction']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const dirErr = this.requireParam(args, 'direction');
        if (dirErr) return { result: null, error: dirErr };

        if (args.direction === 'top') await page.evaluate(() => window.scrollTo(0, 0));
        else if (args.direction === 'bottom') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        else if (args.direction === 'up') await page.mouse.wheel(0, -(args.amount || 500));
        else if (args.direction === 'down') await page.mouse.wheel(0, args.amount || 500);

        return { result: `Scrolled ${args.direction}` };
    }
}

export class DragDropTool extends PlaywrightTool {
    name = 'drag_drop';

    getSchema() {
        return {
            name: 'drag_drop',
            description: 'INTERACTION: Drag one element onto another. Use for sortable lists, kanban boards, file drop zones, slider handles.',
            inputSchema: {
                type: 'object',
                properties: {
                    sourceSelector: { type: 'string', description: 'CSS selector of element to drag' },
                    targetSelector: { type: 'string', description: 'CSS selector of drop destination' }
                },
                required: ['sourceSelector', 'targetSelector']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const srcErr = this.requireParam(args, 'sourceSelector');
        if (srcErr) return { result: null, error: srcErr };
        const destErr = this.requireParam(args, 'targetSelector');
        if (destErr) return { result: null, error: destErr };

        await page.dragAndDrop(args.sourceSelector, args.targetSelector);
        return { result: `Dragged ${args.sourceSelector} to ${args.targetSelector}` };
    }
}
