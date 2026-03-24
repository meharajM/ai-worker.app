import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class GetPageContentTool extends PlaywrightTool {
    name = 'get_page_content';

    getSchema() {
        return {
            name: 'get_page_content',
            description: 'EXTRACTION: Get all readable text from the page. Use to read articles, extract information, or understand page content. Returns title + body text.',
            inputSchema: {
                type: 'object',
                properties: {}
            }
        };
    }

    async execute(page: Page): Promise<ToolResult> {
        const title = await page.title();
        const content = await page.evaluate(() => document.body.innerText);
        return { result: `Title: ${title}\n\n${content.substring(0, 5000)}...` };
    }
}

export class ExtractDataTool extends PlaywrightTool {
    name = 'extract_data';

    getSchema() {
        return {
            name: 'extract_data',
            description: 'EXTRACTION: Pull structured data from page. REQUIRED: "type" is mandatory. If type="custom", "fields" is also required.',
            inputSchema: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['table', 'list', 'custom'], description: 'table=HTML table, list=ul/ol items, custom=define your own fields' },
                    selector: { type: 'string', description: 'CSS selector of container (optional for table/list)' },
                    fields: { type: 'object', description: 'For custom type: {"fieldName": "CSS selector", ...}' }
                },
                required: ['type']
            }
        };
    }

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

    getSchema() {
        return {
            name: 'background_scrape',
            description: 'EXTRACTION: Silently opens a URL in a temporary headless browser, extracts data, and closes the browser immediately. Useful for quick fetch operations without disturbing the user\'s visible browser.',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to scrape' },
                    extractType: { type: 'string', enum: ['table', 'list', 'text'], description: 'What to extract: table, list, or text' },
                    selector: { type: 'string', description: 'Optional CSS selector to target specific area' }
                },
                required: ['url', 'extractType']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const bgUrlErr = this.requireParam(args, 'url');
        if (bgUrlErr) return { result: null, error: bgUrlErr };
        const bgTypeErr = this.requireParam(args, 'extractType');
        if (bgTypeErr) return { result: null, error: bgTypeErr };

        console.log(`[BackgroundScrapeTool] Using managed headless session for URL: ${args.url}`);
        try {
            await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            let data: any = null;
            if (args.extractType === 'table') {
                data = await page.evaluate((sel: string | undefined) => {
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
                data = await page.evaluate((sel: string | undefined) => {
                    const list = sel ? document.querySelector(sel) : document.querySelector('ul, ol');
                    if (!list) return null;
                    const items: string[] = [];
                    list.querySelectorAll('li').forEach(li => items.push((li as HTMLElement).innerText.trim()));
                    return items;
                }, args.selector);
            } else {
                data = await page.evaluate((sel: string | undefined) => {
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
        }
    }
}
