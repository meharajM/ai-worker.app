/**
 * playwright/tools/GetStateTool.ts — Perception tool for browser state.
 *
 * Responsibility: Captures the current visual and structural state of the page.
 *   Provides modes for fast text extraction, full DOM tree serialization,
 *   and "vision" mode with a labeled screenshot for multimodal LLMs.
 *
 * Consumed by: PlaywrightService (via ToolRegistry)
 */

import { Page } from 'playwright-core';
import { PlaywrightTool, ToolResult } from '../PlaywrightTool';

/**
 * Perception tool that helps the agent understand what is on the screen.
 */
export class GetStateTool extends PlaywrightTool {
    name = 'get_state';
    aliases = ['browser_snapshot'];

    getSchema() {
        return {
            name: 'get_state',
            description: 'PERCEPTION: Understand what is on the current page. Use this AFTER navigation to see page elements. Modes: "fast"=quick text list (recommended), "full"=detailed DOM tree, "vision"=screenshot with labeled elements.',
            inputSchema: {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: ['fast', 'full', 'vision'], description: 'fast=elements only (fastest, lowest tokens), full=elements+DOM tree, vision=screenshot+numbered elements' },
                    screenshot: { type: 'boolean', description: 'Force include screenshot (auto in vision mode)' },
                    tree: { type: 'boolean', description: 'Force include DOM tree (auto in full mode)' },
                    highlight: { type: 'boolean', description: 'Draw numbered boxes on interactive elements in screenshot' }
                }
            }
        };
    }

    async execute(page: Page, args: any): Promise<ToolResult> {
        const safeArgs = args ?? {};
        const withNavigationRecovery = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    return await fn()
                } catch (error) {
                    const msg = String(error)
                    const navigationRace = msg.includes('Execution context was destroyed') || msg.includes('Cannot find context with specified id')
                    if (!navigationRace || attempt === 3) {
                        if (!navigationRace && msg.includes('Target page, context or browser has been closed')) {
                            return fallback
                        }
                        if (navigationRace) {
                            console.warn(`[GetStateTool][Issue #10] navigation race unresolved after attempt ${attempt}, returning fallback.`);
                        }
                        return fallback
                    }
                    console.warn(`[GetStateTool][Issue #10] navigation race detected. retrying attempt=${attempt + 1}`);
                    await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {});
                }
            }
            return fallback
        }

        const mode = safeArgs.mode || 'fast';
        console.info(`[GetStateTool][Issue #10/#7] start mode=${mode} includeScreenshot=${Boolean(safeArgs.screenshot)} includeTree=${Boolean(safeArgs.tree)} url=${page.url()}`);
        const includeScreenshot = safeArgs.screenshot ?? (mode === 'vision');
        const includeTree = safeArgs.tree ?? (mode === 'full');
        const useHighlighting = safeArgs.highlight ?? includeScreenshot;
        await page.waitForLoadState('domcontentloaded', { timeout: 1500 }).catch(() => {});

        const state: any = {
            url: page.url(),
            title: await withNavigationRecovery(() => page.title(), '(loading...)'),
            mode: mode,
        };

        let elementMap: Record<number, string> = {};

        if (useHighlighting && includeScreenshot) {
            try {
                elementMap = await withNavigationRecovery(() => page.evaluate(() => {
                    const interactiveSelectors = [
                        'a[href]', 'button', 'input', 'textarea', 'select', '[role="button"]', '[role="link"]', '[onclick]'
                    ].join(',');

                    const elements = document.querySelectorAll(interactiveSelectors);
                    const map: Record<number, string> = {};
                    const overlayId = 'ai-worker-highlight-overlay';

                    document.getElementById(overlayId)?.remove();

                    const overlayContainer = document.createElement('div');
                    overlayContainer.id = overlayId;
                    overlayContainer.style.position = 'absolute';
                    overlayContainer.style.top = '0';
                    overlayContainer.style.left = '0';
                    overlayContainer.style.width = '100%';
                    overlayContainer.style.height = '100%';
                    overlayContainer.style.pointerEvents = 'none';
                    overlayContainer.style.zIndex = '2147483647';

                    let counter = 1;
                    elements.forEach((el) => {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden') {
                            const label = counter++;
                            const box = document.createElement('div');
                            box.style.position = 'absolute';
                            box.style.border = '2px solid #ff0000';
                            box.style.left = `${rect.left + window.scrollX}px`;
                            box.style.top = `${rect.top + window.scrollY}px`;
                            box.style.width = `${rect.width}px`;
                            box.style.height = `${rect.height}px`;

                            const tag = document.createElement('span');
                            tag.style.position = 'absolute';
                            tag.style.top = '-20px';
                            tag.style.left = '0';
                            tag.style.backgroundColor = '#ff0000';
                            tag.style.color = 'white';
                            tag.style.padding = '2px 4px';
                            tag.style.fontSize = '12px';
                            tag.style.fontWeight = 'bold';
                            tag.innerText = String(label);

                            box.appendChild(tag);
                            overlayContainer.appendChild(box);

                            let selector = el.tagName.toLowerCase();
                            if (el.id) selector += `#${el.id}`;
                            else if (el.className) selector += `.${el.className.split(' ')[0]}`;

                            map[label] = selector;
                        }
                    });

                    document.body.appendChild(overlayContainer);
                    return map;
                }), {} as Record<number, string>);

                state.interactableElements = elementMap;
            } catch (e) {
                console.warn('Failed to apply highlights:', e);
            }
        }

        if (includeTree) {
            try {
                const domTree = await withNavigationRecovery(() => page.evaluate(() => {
                    function extractNode(el: Element, depth: number = 0): any {
                        if (depth > 5) return null;
                        const tagName = el.tagName.toLowerCase();
                        const role = el.getAttribute('role') || tagName;
                        const text = (el as HTMLElement).innerText?.substring(0, 100) || '';
                        const children: any[] = [];

                        for (const child of Array.from(el.children)) {
                            const childNode = extractNode(child, depth + 1);
                            if (childNode) children.push(childNode);
                        }

                        const isInteractive = ['a', 'button', 'input', 'textarea', 'select'].includes(tagName) ||
                            el.getAttribute('onclick') || el.getAttribute('role');
                        const hasContent = text.trim().length > 0 || children.length > 0;

                        if (!isInteractive && !hasContent && children.length === 0) return null;

                        return {
                            role,
                            name: el.getAttribute('aria-label') || el.getAttribute('title') || (isInteractive ? text.substring(0, 50) : ''),
                            children: children.length > 0 ? children : undefined
                        };
                    }
                    return extractNode(document.body);
                }), null as any);
                state.domTree = domTree;
            } catch (e) {
                state.domTreeError = String(e);
            }
        }

        if (includeScreenshot) {
            try {
                const buffer = await page.screenshot({
                    fullPage: false,
                    type: 'jpeg',
                    quality: 70
                });
                state.screenshot = buffer.toString('base64');
            } catch (e) {
                state.screenshotError = String(e);
            }
        }

        if (useHighlighting && includeScreenshot) {
            await withNavigationRecovery(() => page.evaluate(() => {
                document.getElementById('ai-worker-highlight-overlay')?.remove();
            }), null);
        }

        if (mode === 'fast' && !state.interactableElements) {
            const quickElements = await withNavigationRecovery(() => page.evaluate(() => {
                const selectors = 'a[href],button,input,textarea,select,[role="button"],[role="link"]';
                const els = document.querySelectorAll(selectors);
                const list: string[] = [];
                let i = 1;
                els.forEach(el => {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0 && i <= 30) {
                        const t = ((el as HTMLElement).innerText || (el as HTMLInputElement).placeholder || '').substring(0, 30).trim();
                        const tag = el.tagName.toLowerCase();
                        list.push(`[${i++}] ${tag}: ${t || '(empty)'}`);
                    }
                });
                return list;
            }), [] as string[]);
            state.elements = quickElements;
        }

        return { result: state };
    }
}
