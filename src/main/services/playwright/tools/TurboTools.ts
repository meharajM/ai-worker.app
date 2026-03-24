import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult, PlaywrightContext } from '../PlaywrightTool';
import { BROWSER_ACTION_SEQUENCE_SCHEMA, WEB_SEARCH_SCHEMA, FILL_FORM_SCHEMA } from '../../../../shared/browser-tool-schemas';

export class BrowserActionSequenceTool extends PlaywrightTool {
    name = 'browser_action_sequence';

    getSchema() {
        return BROWSER_ACTION_SEQUENCE_SCHEMA;
    }

    async execute(page: Page, args: any, context?: PlaywrightContext): Promise<ToolResult> {
        if (!context) throw new Error('No playwright context');
        const steps: any[] = args.steps;
        if (!Array.isArray(steps) || steps.length === 0) {
            return { result: null, error: 'browser_action_sequence: steps must be a non-empty array' };
        }

        const validationErrors: string[] = [];
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (step.action === 'navigate' || step.action === 'reload') break;

            if (step.action === 'click' && step.selector) {
                const check = await context.validateAndCorrectSelector(step.selector, step.text, page);
                if (!check.valid) {
                    if (check.correction === 'click_text') {
                        step.action = 'click_text';
                        step.text = step.text || step.selector;
                        delete step.selector;
                    } else {
                        validationErrors.push(`Step ${i + 1} (${step.action}) PRECONDITION FAILED: ${check.error}`);
                    }
                }
            }

            if (['fill', 'hover', 'wait_for_element', 'type'].includes(step.action) && step.selector) {
                const check = await context.validateAndCorrectSelector(step.selector, undefined, page);
                if (!check.valid) {
                    validationErrors.push(`Step ${i + 1} (${step.action}) PRECONDITION FAILED: ${check.error} (Did you forget to call get_interactive_elements?)`);
                }
            }
        }

        if (validationErrors.length > 0) {
            return {
                result: null,
                error: `Sequence Aborted by Runtime Guard:\n${validationErrors.join('\n')}\n\n💡 RECOVERY: Call get_interactive_elements() to find the correct valid selectors.`
            };
        }

        const results: string[] = [];
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const { action, ...stepArgs } = step;
            try {
                const stepResult = await context.callTool(action, { ...stepArgs, tabId: args.tabId });
                if (stepResult.error) {
                    results.push(`Step ${i + 1} (${action}): FAILED — ${stepResult.error}`);
                    return {
                        result: `Sequence halted at step ${i + 1}/${steps.length}.\n${results.join('\n')}`,
                        error: `Step ${i + 1} (${action}) failed: ${stepResult.error}`
                    };
                }
                const summary = typeof stepResult.result === 'string' ? stepResult.result : JSON.stringify(stepResult.result);
                results.push(`Step ${i + 1} (${action}): OK — ${summary.substring(0, 120)}`);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                results.push(`Step ${i + 1} (${action}): FAILED — ${msg}`);
                return {
                    result: `Sequence halted at step ${i + 1}/${steps.length}.\n${results.join('\n')}`,
                    error: `Step ${i + 1} (${action}) threw: ${msg}`
                };
            }
        }
        return { result: `All ${steps.length} steps completed.\n${results.join('\n')}` };
    }
}

export class WebSearchTool extends PlaywrightTool {
    name = 'web_search';

    getSchema() {
        return WEB_SEARCH_SCHEMA;
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const query = args.query;
        if (!query) return { result: null, error: 'web_search: query is required' };

        const SEARCH_ENGINES: Record<string, string> = {
            google: 'https://www.google.com/search?q={q}&hl=en',
            bing: 'https://www.bing.com/search?q={q}',
            duckduckgo: 'https://duckduckgo.com/?q={q}',
            brave: 'https://search.brave.com/search?q={q}',
        };

        const engine = 'google'; // Hardcoded for now, mimicking simple logic
        const urlTemplate = SEARCH_ENGINES[engine] || SEARCH_ENGINES.bing;
        const searchUrl = urlTemplate.replace('{q}', encodeURIComponent(query));

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);

        const pageText = await page.evaluate(() => document.body.innerText);
        const MAX_CHARS = 3000;
        const trimmedText = pageText.length > MAX_CHARS ? pageText.substring(0, MAX_CHARS) + '\n\n... (truncated)' : pageText;

        const searchLinks = await page.evaluate(() => {
            const links = document.querySelectorAll('a[href]');
            const list: string[] = [];
            let i = 1;
            links.forEach(link => {
                const r = link.getBoundingClientRect();
                const t = (link as HTMLElement).innerText?.substring(0, 60).trim();
                const href = (link as HTMLAnchorElement).href;
                if (r.width > 0 && r.height > 0 && t && t.length > 5 && i <= 10 &&
                    href.startsWith('http') && !href.includes('google.com/search') &&
                    !href.includes('accounts.google') && !href.includes('support.google')) {
                    list.push(`[${i++}] "${t}" → ${href}`);
                }
            });
            return list;
        }).catch(() => [] as string[]);

        const pageTitle = await page.title();
        return {
            result: `Search results for "${query}" (via ${engine}):\n` +
                `Page: ${pageTitle}\n` +
                `URL: ${page.url()}\n\n` +
                trimmedText +
                (searchLinks.length > 0 ? `\n\n--- Clickable Result Links (${searchLinks.length}) ---\n${searchLinks.join('\n')}` : '')
        };
    }
}

export class FillFormTool extends PlaywrightTool {
    name = 'fill_form';

    getSchema() {
        return FILL_FORM_SCHEMA;
    }

    async execute(page: Page, args: any, context?: PlaywrightContext): Promise<ToolResult> {
        if (!context) throw new Error('No playwright context');
        const { url: formUrl, fields, submit_selector, submit_text, wait_after_submit = true } = args;
        if (!Array.isArray(fields) || fields.length === 0) {
            return { result: null, error: 'fill_form: fields array is required and must not be empty' };
        }

        if (formUrl) {
            await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
        }

        const formErrors: string[] = [];
        for (const field of fields) {
            const check = await context.validateAndCorrectSelector(field.selector);
            if (!check.valid) {
                formErrors.push(`Field '${field.selector}' PRECONDITION FAILED: ${check.error}`);
            }
        }

        let effectiveSubmitSelector = submit_selector;
        let effectiveSubmitText = submit_text;

        if (submit_selector) {
            const check = await context.validateAndCorrectSelector(submit_selector, submit_text);
            if (!check.valid) {
                if (check.correction === 'click_text') {
                    effectiveSubmitText = submit_text || submit_selector;
                    effectiveSubmitSelector = undefined;
                } else {
                    formErrors.push(`Submit button '${submit_selector}' PRECONDITION FAILED: ${check.error}`);
                }
            }
        }

        if (formErrors.length > 0) {
            return {
                result: null,
                error: `Form Fill Aborted by Runtime Guard:\n${formErrors.join('\n')}\n\n💡 RECOVERY: Call get_interactive_elements() to find the correct valid selectors.`
            };
        }

        for (const field of fields) {
            const { selector, value, type: fillType = 'fill' } = field;
            await page.waitForSelector(selector, { timeout: 5000 }).catch(() => null);
            if (fillType === 'type') {
                await page.click(selector).catch(() => null);
                await page.type(selector, value, { delay: 30 });
            } else if (fillType === 'select') {
                await page.selectOption(selector, value);
            } else {
                await page.fill(selector, value);
            }
        }

        if (effectiveSubmitSelector) {
            await page.click(effectiveSubmitSelector);
        } else if (effectiveSubmitText) {
            await page.getByText(effectiveSubmitText, { exact: false }).first().click();
        } else {
            const lastSelector = fields[fields.length - 1].selector;
            await page.press(lastSelector, 'Enter');
        }

        if (wait_after_submit) {
            await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
        }

        return { result: `Form submitted. Now at: ${await page.title()} (${page.url()})` };
    }
}
