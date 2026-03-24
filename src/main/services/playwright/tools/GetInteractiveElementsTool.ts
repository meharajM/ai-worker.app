import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class GetInteractiveElementsTool extends PlaywrightTool {
    name = 'get_interactive_elements';

    getSchema() {
        return {
            name: 'get_interactive_elements',
            description: 'PERCEPTION: Get a compact list of clickable elements (buttons, links, inputs) with their text and selectors. FASTEST way to understand page structure. Use this to find what to click.',
            inputSchema: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Max elements to return (default: 50, use lower for speed)' },
                    viewport_only: { type: 'boolean', description: 'Only visible elements (default: true)' }
                }
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const limit = args.limit || 50;
        const viewportOnly = args.viewport_only !== false;

        const elements = await page.evaluate(({ limit, viewportOnly }) => {
            const interactiveSelectors = [
                'a[href]', 'button', 'input', 'textarea', 'select', '[role="button"]', '[role="link"]', '[onclick]'
            ].join(',');

            const elements = document.querySelectorAll(interactiveSelectors);
            const list: { index: number, text: string, selector: string, type: string }[] = [];

            let counter = 1;
            for (const el of Array.from(elements)) {
                if (list.length >= limit) break;

                const rect = el.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
                const isInViewport = rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;

                if (isVisible && (!viewportOnly || isInViewport)) {
                    let selector = el.tagName.toLowerCase();
                    if (el.id) selector = `#${el.id}`;
                    else if (el.className) selector = `.${el.className.split(' ')[0]}`;

                    let text = (el as HTMLElement).innerText || (el as HTMLInputElement).value || (el as HTMLInputElement).placeholder || (el as HTMLElement).getAttribute('aria-label') || '';
                    text = text.substring(0, 40).replace(/\n/g, ' ').trim();

                    list.push({
                        index: counter++,
                        text: text || '(empty)',
                        selector,
                        type: el.tagName.toLowerCase()
                    });
                }
            }
            return list;
        }, { limit, viewportOnly });

        return { result: { elements, count: elements.length } };
    }
}
