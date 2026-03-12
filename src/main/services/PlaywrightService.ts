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

import { ToolSchema } from '../../shared/browser-tool-schemas';
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
            // Register tool-declared aliases (e.g., browser_navigate → navigate)
            for (const alias of tool.aliases) {
                this.tools.set(alias, tool);
            }
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

            // Ensure background_scrape always uses our managed headless context
            if (name === 'background_scrape') {
                args = { ...args, _headless: true };
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
        // Auto-collect schemas from self-describing tools.
        // Each tool owns its schema via getSchema(); aliases get copies with the aliased name.
        const seen = new Set<string>();
        const schemas: ToolSchema[] = [];

        for (const tool of this.tools.values()) {
            if (seen.has(tool.name)) continue;
            seen.add(tool.name);

            schemas.push(tool.getSchema());

            // Publish alias schemas so the LLM can discover them
            for (const alias of tool.aliases) {
                schemas.push({ ...tool.getSchema(), name: alias });
            }
        }

        return { tools: schemas };
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
