import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class SelectOptionTool extends PlaywrightTool {
    name = 'select_option';
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
    async execute(page: Page, args: any): Promise<ToolResult> {
        const selErr = this.requireParam(args, 'selector');
        if (selErr) return { result: null, error: selErr };
        await page.hover(args.selector);
        return { result: `Hovered over ${args.selector}` };
    }
}

export class PressTool extends PlaywrightTool {
    name = 'press';
    async execute(page: Page, args: any): Promise<ToolResult> {
        const keyErr = this.requireParam(args, 'key');
        if (keyErr) return { result: null, error: keyErr };
        await page.keyboard.press(args.key);
        return { result: `Pressed ${args.key}` };
    }
}

export class ScrollTool extends PlaywrightTool {
    name = 'scroll';
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
    async execute(page: Page, args: any): Promise<ToolResult> {
        const srcErr = this.requireParam(args, 'sourceSelector');
        if (srcErr) return { result: null, error: srcErr };
        const destErr = this.requireParam(args, 'targetSelector');
        if (destErr) return { result: null, error: destErr };

        await page.dragAndDrop(args.sourceSelector, args.targetSelector);
        return { result: `Dragged ${args.sourceSelector} to ${args.targetSelector}` };
    }
}
