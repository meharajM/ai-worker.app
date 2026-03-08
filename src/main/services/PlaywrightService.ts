/**
 * PlaywrightService.ts — Facade for Playwright-based browser automation.
 *
 * Responsibilities:
 *   1. Tool Dispatching: Delegates incoming browser tool calls (click, navigate, etc.)
 *      to specialized PlaywrightTool classes.
 *   2. Lifecycle Coordination: Orchestrates between the BrowserManager (lifecycle)
 *      and the individual Tool classes (execution).
 *   3. Error Handling: Normalizes Playwright-specific errors into user-friendly
 *      messages and actionable suggestions.
 *   4. State Validation: Provides helper methods for validating DOM state before
 *      and after interactions.
 *
 * Design decision: This service follows the Facade pattern. The monolithic logic
 *   of the original service was decomposed into a modular tool-based architecture
 *   to solve the "God Object" problem, making browser automation extensible and
 *   independently testable.
 *
 * Consumed by: AgentRuntime, AppMain (IPC handlers)
 */

import { ToolSchema, BROWSER_TURBO_SCHEMAS } from '../../shared/browser-tool-schemas';
import { Page } from 'playwright-core';
import { BrowserManager } from './playwright/BrowserManager';
import { PlaywrightTool, ToolResult, PlaywrightContext } from './playwright/PlaywrightTool';
import { getPlaywrightTools } from './playwright/ToolRegistry';

/**
 * Main service responsible for browser orchestration and tool execution.
 * Uses a singleton pattern to ensure a consistent browser state across the app.
 */
export class PlaywrightService {
    private static instance: PlaywrightService;
    private browserManager: BrowserManager;
    private tools = new Map<string, PlaywrightTool>();

    private constructor() {
        this.browserManager = new BrowserManager();
        this.registerTools();
    }

    /**
     * Retrieves the singleton instance of PlaywrightService.
     * @returns The active PlaywrightService instance.
     */
    public static getInstance(): PlaywrightService {
        if (!PlaywrightService.instance) {
            PlaywrightService.instance = new PlaywrightService();
        }
        return PlaywrightService.instance;
    }

    /**
     * Initializes the Playwright service.
     * Currently a placeholder as browser launch is lazy (handled on first tool call).
     */
    async initialize(): Promise<void> {
        console.log('[PlaywrightService] Service initialized (browser will launch on demand)');
    }

    private registerTools() {
        const toolList = getPlaywrightTools();
        for (const tool of toolList) {
            this.tools.set(tool.name, tool);
        }
    }

    /**
     * Executes a browser-based tool operation.
     *
     * This method automatically ensures a browser context is active and selects
     * the appropriate page/tab before delegating execution to the tool class.
     *
     * @param name - The unique name of the tool (e.g., 'click', 'navigate').
     * @param args - The arguments for the tool, typically conforming to its schema.
     * @returns A promise resolving to the tool's result or an error message.
     * @throws Does not throw; catches internal errors and returns a ToolResult with an `error`.
     */
    async callTool(name: string, args: any): Promise<ToolResult> {
        try {
            const tool = this.tools.get(name);
            if (!tool) {
                return { result: null, error: `Tool ${name} not found` };
            }

            const page = await this.browserManager.getPage(args);
            const context: PlaywrightContext = {
                context: this.browserManager.getContext(),
                page: this.browserManager.getCurrentPage(),
                pagesMap: this.browserManager.getPagesMap(),
                registerPage: (p) => this.browserManager.registerPage(p),
                setPage: (p) => this.browserManager.setPage(p),
                callTool: (n, a) => this.callTool(n, a),
                validateAndCorrectSelector: (s, t, p) => this.validateAndCorrectSelector(s, t, p || page),
                surfaceBrowser: () => this.browserManager.surfaceBrowser()
            };

            return await tool.execute(page, args, context);
        } catch (error) {
            console.error(`[PlaywrightService] Error calling tool ${name}:`, error);
            let errorMessage = error instanceof Error ? error.message : String(error);

            if (errorMessage.includes('Timeout') && errorMessage.includes('exceeded')) {
                const selectorMatch = errorMessage.match(/waiting for locator\(['"]([^'"]+)['"]\)/);
                const selector = selectorMatch ? selectorMatch[1] : 'element';
                errorMessage = `Timeout: The element '${selector}' was not found within the time limit.\n` +
                    `Suggestion: The selector might be incorrect or the page structure changed.\n` +
                    `1. Try using 'get_interactive_elements' to see what IS on the page.\n` +
                    `2. Try a different selector (e.g. text content or aria-label).`;
            }

            return { result: null, error: errorMessage };
        }
    }

    /**
     * Returns a list of all available browser tools and their JSON schemas.
     *
     * This is used by the LLM (and UI) to discover what actions the agent can
     * perform in the browser.
     *
     * @returns An object containing an array of tool schemas.
     */
    listTools(): { tools: ToolSchema[] } {
        return {
            tools: [
                {
                    name: 'navigate',
                    description: 'NAVIGATION: Go to a URL. Use this FIRST to open any website. Example: navigate to "https://google.com" before searching.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'Full URL including https://' }
                        },
                        required: ['url']
                    }
                },
                {
                    name: 'screenshot',
                    description: 'VISION: Capture the current page as an image. Use when you need to see the page visually or save visual evidence. For perceiving page state, prefer get_state instead.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            fullPage: { type: 'boolean', description: 'true=capture entire scrollable page, false=visible viewport only' }
                        }
                    }
                },
                {
                    name: 'click',
                    description: 'INTERACTION: Click an element using CSS selector. Use when you know the exact selector (e.g., "#submit-btn", ".login-button"). If you only know the text, use click_text instead.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            selector: { type: 'string', description: 'CSS selector like #id, .class, or tag[attr="value"]' }
                        },
                        required: ['selector']
                    }
                },
                {
                    name: 'fill',
                    description: 'INPUT: Instantly fill a text input, textarea, or contenteditable field. Use for forms, search boxes, login fields. Replaces existing content. For character-by-character typing, use "type" instead.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            selector: { type: 'string', description: 'CSS selector of the input field' },
                            value: { type: 'string', description: 'Text to enter' }
                        },
                        required: ['selector', 'value']
                    }
                },
                {
                    name: 'hover',
                    description: 'INTERACTION: Move mouse over an element without clicking. Use to reveal dropdown menus, tooltips, or trigger hover states before clicking sub-items.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            selector: { type: 'string', description: 'CSS selector of element to hover' }
                        },
                        required: ['selector']
                    }
                },
                {
                    name: 'press',
                    description: 'KEYBOARD: Press a single key. Use for Enter (submit forms), Escape (close dialogs), Tab (navigate fields), ArrowDown/Up (navigate lists). Common keys: Enter, Escape, Tab, Space, Backspace, ArrowUp/Down/Left/Right.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            key: { type: 'string', description: 'Key name: Enter, Escape, Tab, Space, ArrowDown, etc.' }
                        },
                        required: ['key']
                    }
                },
                {
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
                },
                {
                    name: 'evaluate',
                    description: 'ADVANCED: Execute raw JavaScript code on the page. Use as a last resort when no other tool can accomplish the task. Can access DOM, modify page, or extract complex data. NOTE: document.querySelectorAll returns a NodeList, not Array. Use Array.from() before .map(), .filter(), or .slice(). if any issues occurs while executing the script, try to google the error and fix it.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            script: { type: 'string', description: 'JavaScript code to execute. Return value will be included in result.' }
                        },
                        required: ['script']
                    }
                },
                {
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
                },
                {
                    name: 'get_interactive_elements',
                    description: 'PERCEPTION: Get a compact list of clickable elements (buttons, links, inputs) with their text and selectors. FASTEST way to understand page structure. Use this to find what to click.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            limit: { type: 'number', description: 'Max elements to return (default: 50, use lower for speed)' },
                            viewport_only: { type: 'boolean', description: 'Only visible elements (default: true)' }
                        }
                    }
                },
                {
                    name: 'get_page_content',
                    description: 'EXTRACTION: Get all readable text from the page. Use to read articles, extract information, or understand page content. Returns title + body text.',
                    inputSchema: {
                        type: 'object',
                        properties: {}
                    }
                },
                {
                    name: 'wait_for_element',
                    description: 'TIMING: Wait for an element to appear. Use after clicking if the next page/section loads dynamically. Essential for SPAs and AJAX-loaded content.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            selector: { type: 'string', description: 'CSS selector to wait for' },
                            timeout: { type: 'number', description: 'Max wait time in ms (default: 5000)' }
                        },
                        required: ['selector']
                    }
                },
                {
                    name: 'type',
                    description: 'INPUT: Type text character-by-character with delays (simulates human typing). Use when websites detect instant input as bots. For normal form filling, use "fill" instead (faster).',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            selector: { type: 'string', description: 'CSS selector of input field' },
                            text: { type: 'string', description: 'Text to type' },
                            delay: { type: 'number', description: 'Delay between keys in ms (default: 50)' }
                        },
                        required: ['selector', 'text']
                    }
                },
                {
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
                },
                {
                    name: 'go_back',
                    description: 'NAVIGATION: Click browser back button. Use to return to previous page after viewing details or search results.',
                    inputSchema: { type: 'object', properties: {} }
                },
                {
                    name: 'go_forward',
                    description: 'NAVIGATION: Click browser forward button. Use after go_back to return to where you were.',
                    inputSchema: { type: 'object', properties: {} }
                },
                {
                    name: 'new_tab',
                    description: 'TABS: Open a new browser tab. Use to keep current page open while checking another URL. Optionally provide URL to navigate immediately.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'URL to open (optional - opens blank tab if omitted)' }
                        }
                    }
                },
                {
                    name: 'switch_tab',
                    description: 'TABS: Switch focus to a different tab. Use get_tabs first to see available tabs and their indices.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            index: { type: 'number', description: 'Tab index from get_tabs (0 = first tab)' }
                        },
                        required: ['index']
                    }
                },
                {
                    name: 'close_tab',
                    description: 'TABS: Close the current tab. Automatically switches to another open tab. Cannot close the last remaining tab.',
                    inputSchema: { type: 'object', properties: {} }
                },
                {
                    name: 'get_tabs',
                    description: 'TABS: List all open tabs with their index, title, and URL. Use before switch_tab to find the right tab.',
                    inputSchema: { type: 'object', properties: {} }
                },
                {
                    name: 'click_text',
                    description: 'INTERACTION: Click by visible text - PREFERRED over "click" when you see text like "Login", "Submit", "Next". More reliable than CSS selectors. Use exact=true for buttons with common words.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: 'Visible text on the element (e.g., "Sign In", "Add to Cart")' },
                            exact: { type: 'boolean', description: 'true=exact match, false=partial match (default)' },
                            tag: { type: 'string', description: 'Limit to tag type: button, a, div, span, etc.' }
                        },
                        required: ['text']
                    }
                },
                {
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
                },
                {
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
                },
                {
                    name: 'get_cookies',
                    description: 'SESSION: Get all cookies for the current domain. Use to check login state, session tokens, or debug authentication issues.',
                    inputSchema: { type: 'object', properties: {} }
                },
                {
                    name: 'set_cookie',
                    description: 'SESSION: Set a browser cookie. Use to maintain login sessions, set preferences, or bypass cookie consent (if legal).',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Cookie name' },
                            value: { type: 'string', description: 'Cookie value' },
                            domain: { type: 'string', description: 'Domain (defaults to current site)' },
                            path: { type: 'string', description: 'Path scope (default: /)' }
                        },
                        required: ['name', 'value']
                    }
                },
                {
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
                },
                {
                    name: 'switch_frame',
                    description: 'ADVANCED: Switch context to an iframe (embedded page). Required for interacting with elements inside iframes. Omit selector to return to main page.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            selector: { type: 'string', description: 'CSS selector of iframe (omit to return to main frame)' }
                        }
                    }
                },
                {
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
                },
                {
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
                },
                {
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
                },
                {
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
                },
                {
                    name: 'wait_for_navigation',
                    description: 'TIMING: Wait for page to fully load after clicking a link. Use after actions that trigger page changes. Waits for network to be idle.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            timeout: { type: 'number', description: 'Max wait in ms (default: 30000)' }
                        }
                    }
                },
                {
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
                },
                {
                    name: 'request_human_intervention',
                    description: 'FALLBACK: Use this when you are completely blocked by a CAPTCHA, Turnstile, or OTP that you cannot bypass. This surfaces the invisible browser window to the human user so they can manually solve it for you.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            reason: { type: 'string', description: 'Why you are stuck (e.g. "Cloudflare Turnstile CAPTCHA detected")' }
                        },
                        required: ['reason']
                    }
                },
                ...BROWSER_TURBO_SCHEMAS
            ] as ToolSchema[]
        };
    }

    /**
     * Validates if a CSS selector exists on the given page and suggests
     * alternatives if it doesn't.
     *
     * @param selector - The CSS selector to check.
     * @param text - Optional text content associated with the element.
     * @param page - The Playwright Page instance to check against.
     * @returns Validation result with boolean `valid` and optional `correction`.
     */
    private async validateAndCorrectSelector(selector: string, text?: string, page?: Page): Promise<{ valid: boolean; correction?: string; error?: string }> {
        if (!page) return { valid: false, error: 'Page not initialized' };
        try {
            const exists = await page.$(selector).then(res => !!res).catch(() => false);
            if (exists) return { valid: true };
            if (text) {
                const textExists = await page.getByText(text, { exact: false }).isVisible().catch(() => false);
                if (textExists) return { valid: false, correction: 'click_text', error: `Selector '${selector}' not found, but text '${text}' is visible.` };
            }
            return { valid: false, error: `Selector '${selector}' not found in DOM.` };
        } catch (e) {
            return { valid: false, error: `Invalid selector '${selector}': ${String(e)}` };
        }
    }

    async close() {
        await this.browserManager.close();
    }
}
