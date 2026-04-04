/**
 * playwright/PlaywrightTool.ts — Base abstractions for browser tools.
 *
 * Responsibilities:
 *   1. Interface Definition: Defines the contracts for ToolResult and PlaywrightContext.
 *   2. Base Tool Class: Provides a foundation for all executable browser tools.
 *   3. Shared Utilities: Includes helper methods (like requireParam) used by all tools.
 *
 * Design decision: By using an abstract base class, we enforce a consistent
 *   interface across all browser interactions while allowing each tool to inherit
 *   common validation logic.
 *
 * Consumed by: PlaywrightService, ToolRegistry, all files in tools/ directory.
 */

import { BrowserContext, Page } from 'playwright-core';
import { ToolSchema } from '../../../shared/browser-tool-schemas';

/**
 * The standard structure returned by all browser tools.
 */
export interface ToolResult {
    result: any;
    error?: string;
    /**
     * Optional structured metadata for downstream orchestration/retry logic.
     * Serialized by the IPC bridge when present.
     */
    meta?: Record<string, unknown>;
}

/**
 * Shared context provided to tools to allow them to interact with the broader
 * browser environment (switching tabs, calling other tools, etc.)
 */
export interface PlaywrightContext {
    context: BrowserContext | null;
    page: Page | null;
    pagesMap: Map<number, Page>;
    registerPage(page: Page): number;
    setPage(page: Page): void;
    callTool(name: string, args: any): Promise<ToolResult>;
    validateAndCorrectSelector(selector: string, text?: string, page?: Page): Promise<{ valid: boolean; correction?: string; error?: string }>;
    surfaceBrowser?: () => Promise<void>;
}

/**
 * Abstract base class for all Playwright-based interaction tools.
 *
 * Each tool is self-describing: it owns its name, schema, and optional aliases.
 * PlaywrightService collects these at registration time — no manual duplication.
 */
export abstract class PlaywrightTool {
    abstract name: string;

    /**
     * Optional alternate names this tool responds to.
     * Example: NavigateTool declares `aliases = ['browser_navigate']`.
     * PlaywrightService registers these automatically.
     */
    aliases: string[] = [];

    /**
     * Returns the MCP-compatible schema for this tool.
     * This is the single source of truth for the tool's description and input shape.
     */
    abstract getSchema(): ToolSchema;

    /**
     * Executes the tool's core logic.
     *
     * @param page - The active Playwright Page instance.
     * @param args - Input arguments for the tool.
     * @param context - Optional shared context for cross-tool orchestration.
     * @returns A promise resolving to the execution result or an error.
     */
    abstract execute(page: Page, args: any, context?: PlaywrightContext): Promise<ToolResult>;

    /**
     * Helper to validate that a required parameter exists and has the correct type.
     *
     * @param args - The arguments object to check.
     * @param paramName - The name of the parameter.
     * @param paramType - The expected type ('string' or 'number').
     * @returns An error string if validation fails, or null if it passes.
     */
    protected requireParam(args: any, paramName: string, paramType: string = 'string'): string | null {
        const value = args[paramName]
        if (value === undefined || value === null) {
            return `Missing required parameter: ${paramName}`
        }
        if (paramType === 'string' && typeof value !== 'string') {
            return `Parameter ${paramName} must be a string, got ${typeof value}`
        }
        if (paramType === 'number' && typeof value !== 'number') {
            return `Parameter ${paramName} must be a number, got ${typeof value}`
        }
        return null
    }
}
