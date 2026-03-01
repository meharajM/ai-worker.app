import { Page, chromium } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class GetPageContentTool extends PlaywrightTool {
    name = 'get_page_content';
    async execute(page: Page): Promise<ToolResult> {
        const title = await page.title();
        const content = await page.evaluate(() => document.body.innerText);
        return { result: `Title: ${title}\n\n${content.substring(0, 5000)}...` };
    }
}

export class ExtractDataTool extends PlaywrightTool {
    name = 'extract_data';
    async execute(page: Page, args: any): Promise<ToolResult> {
        const typeErr = this.requireParam(args, 'type');
        if (typeErr) return { result: null, error: typeErr };

        const type = args.type || 'table';
        const selector = args.selector;

        const data = await page.evaluate(({ type, selector, fields }) => {
            if (type === 'table') {
                const table = selector ? document.querySelector(selector) : document.querySelector('table');
                if (!table) return [];
                const rows: string[][] = [];
                table.querySelectorAll('tr').forEach(tr => {
                    const cells: string[] = [];
                    tr.querySelectorAll('td, th').forEach(cell => cells.push((cell as HTMLElement).innerText.trim()));
                    if (cells.length > 0) rows.push(cells);
                });
                return rows;
            } else if (type === 'list') {
                const list = selector ? document.querySelector(selector) : document.querySelector('ul, ol');
                if (!list) return [];
                return Array.from(list.querySelectorAll('li')).map(li => (li as HTMLElement).innerText.trim());
            } else if (type === 'custom' && fields) {
                const container = selector ? document.querySelector(selector) : document.body;
                if (!container) return {};
                const result: any = {};
                for (const [name, sel] of Object.entries(fields)) {
                    const el = container.querySelector(sel as string);
                    result[name] = el ? (el as HTMLElement).innerText.trim() : null;
                }
                return result;
            }
            return null;
        }, { type, selector, fields: args.fields });

        return { result: data };
    }
}

export class BackgroundScrapeTool extends PlaywrightTool {
    name = 'background_scrape';
    async execute(_page: Page, args: any): Promise<ToolResult> {
        const bgUrlErr = this.requireParam(args, 'url');
        if (bgUrlErr) return { result: null, error: bgUrlErr };
        const bgTypeErr = this.requireParam(args, 'extractType');
        if (bgTypeErr) return { result: null, error: bgTypeErr };

        console.log(`[PlaywrightService] Starting temp headless browser for background scrape...`);
        const tempBrowser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
        try {
            const tempPage = await tempBrowser.newPage();
            await tempPage.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            let data: any = null;
            if (args.extractType === 'table') {
                data = await tempPage.evaluate((sel: string | undefined) => {
                    const table = sel ? document.querySelector(sel) : document.querySelector('table');
                    if (!table) return null;
                    const rows: string[][] = [];
                    table.querySelectorAll('tr').forEach(tr => {
                        const cells: string[] = [];
                        tr.querySelectorAll('th, td').forEach(cell => cells.push((cell as HTMLElement).innerText.trim()));
                        if (cells.length > 0) rows.push(cells);
                    });
                    return rows;
                }, args.selector);
            } else if (args.extractType === 'list') {
                data = await tempPage.evaluate((sel: string | undefined) => {
                    const list = sel ? document.querySelector(sel) : document.querySelector('ul, ol');
                    if (!list) return null;
                    const items: string[] = [];
                    list.querySelectorAll('li').forEach(li => items.push((li as HTMLElement).innerText.trim()));
                    return items;
                }, args.selector);
            } else {
                data = await tempPage.evaluate((sel: string | undefined) => {
                    const el = sel ? document.querySelector(sel) : document.body;
                    return el ? (el as HTMLElement).innerText.trim() : null;
                }, args.selector);
            }

            if (!data) {
                return { result: null, error: `ExtractionError: Could not extract ${args.extractType} from ${args.selector || 'page'}.` };
            }
            return { result: { type: args.extractType, data } };
        } catch (err: any) {
            return { result: null, error: err.message || String(err) };
        } finally {
            await tempBrowser.close();
        }
    }
}
