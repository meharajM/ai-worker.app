import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

export class ClickTextTool extends PlaywrightTool {
    name = 'click_text';

    getSchema() {
        return {
            name: 'click_text',
            description: 'INTERACTION: Click by visible text - PREFERRED over "click" when you see text like "Login", "Submit", "Next". More reliable than CSS selectors. Use exact=true for buttons with common words.',
            inputSchema: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: 'Visible text on the element (e.g., "Sign In", "Add to Cart")' },
                    exact: { type: 'boolean', description: 'true=exact match, false=partial match (default)' },
                    tag: { type: 'string', description: 'Limit to tag type: button, a, div, span, etc.' },
                    timeout: { type: 'number', description: 'Max wait in ms (default: 8000, capped to 15000)' }
                },
                required: ['text']
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const safeArgs = args ?? {};
        const textFindError = this.requireParam(safeArgs, 'text');
        if (textFindError) return { result: null, error: textFindError };

        const textToFind = String(safeArgs.text);
        const exactMatch = Boolean(safeArgs.exact);
        const tagFilter = safeArgs.tag ? String(safeArgs.tag).toLowerCase() : null;
        const rawTimeout = typeof safeArgs.timeout === 'number' ? safeArgs.timeout : 8000;
        const timeout = Math.max(1500, Math.min(15000, rawTimeout));
        const normalized = textToFind.replace(/\s+/g, ' ').trim();

        const clickUsingText = async (text: string, exact: boolean): Promise<boolean> => {
            try {
                const locator = tagFilter
                    ? page.locator(tagFilter).getByText(text, { exact }).first()
                    : page.getByText(text, { exact }).first();
                await locator.click({ timeout });
                return true;
            } catch {
                return false;
            }
        };

        if (await clickUsingText(normalized, exactMatch)) {
            return { result: `Clicked element with text "${textToFind}"` };
        }

        // Recovery path: exact phrases on dynamic news/ecommerce cards often include
        // hidden punctuation/line breaks; try compact partial matching before failing.
        const compactFallback = normalized.length > 52 ? normalized.slice(0, 52) : normalized;
        if (exactMatch && compactFallback.length >= 8 && await clickUsingText(compactFallback, false)) {
            return { result: `Clicked element with partial text fallback "${compactFallback}" (from exact request)` };
        }

        const keywordFallback = normalized
            .split(/\s+/)
            .filter((part: string) => part.length >= 4)
            .slice(0, 4)
            .join(' ');
        if (keywordFallback.length >= 8 && await clickUsingText(keywordFallback, false)) {
            return { result: `Clicked element with keyword fallback "${keywordFallback}"` };
        }

        return {
            result: null,
            error:
                `Timeout: The element '${textToFind}' was not found within ${timeout}ms.\n\n` +
                `💡 RECOVERY HINT: Try a shorter visible label, use exact=false, or call get_interactive_elements().`
        };
    }
}
