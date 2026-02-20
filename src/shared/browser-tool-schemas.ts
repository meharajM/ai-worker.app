/**
 * Shared Browser Tool Schemas
 * 
 * SINGLE SOURCE OF TRUTH for browser_action_sequence, web_search, and fill_form.
 * Imported by both:
 *   - src/renderer/src/lib/client-tools.ts  (LLM-facing shims)
 *   - src/main/services/PlaywrightService.ts (server-side listTools)
 * 
 * This prevents description drift and avoids bugs like quote collisions 
 * when editing descriptions in two places.
 */

export interface ToolSchema {
    name: string
    description: string
    inputSchema: {
        type: string
        properties: Record<string, unknown>
        required?: string[]
    }
}

// ─── browser_action_sequence ───────────────────────────────────────────

export const BROWSER_ACTION_SEQUENCE_SCHEMA: ToolSchema = {
    name: 'browser_action_sequence',
    description:
        "TURBO: Execute multiple browser actions in a single call. " +
        "PRECONDITIONS: (1) You MUST have called get_interactive_elements or get_state first to know the real selectors — NEVER guess selectors. " +
        "(2) Prefer click_text over click when possible (resilient to DOM changes). " +
        "(3) Use this only when ALL steps and selectors are confirmed from prior observation. " +
        "If any selector is uncertain, use individual tool calls instead for self-correction. " +
        "Each step runs in order; if one fails the sequence halts. " +
        "Actions: navigate, click, click_text, fill, type, press, scroll, wait_for_element, wait_for_navigation, hover, screenshot.",
    inputSchema: {
        type: 'object',
        properties: {
            steps: {
                type: 'array',
                description: 'Ordered list of actions to execute',
                items: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', description: 'One of: navigate, click, click_text, fill, type, press, scroll, wait_for_element, wait_for_navigation, hover, screenshot' },
                        url: { type: 'string', description: 'For navigate action' },
                        selector: { type: 'string', description: 'CSS selector - for click, fill, type, hover, wait_for_element' },
                        text: { type: 'string', description: 'For click_text: visible text to click. For type: text to type' },
                        value: { type: 'string', description: 'For fill: text to fill into input' },
                        key: { type: 'string', description: 'For press: key name (Enter, Escape, Tab, etc.)' },
                        direction: { type: 'string', description: 'For scroll: up/down/top/bottom' },
                        amount: { type: 'number', description: 'For scroll: pixels to scroll' },
                        timeout: { type: 'number', description: 'For wait_for_element/wait_for_navigation: ms timeout' },
                        delay: { type: 'number', description: 'For type: ms between keystrokes' },
                        exact: { type: 'boolean', description: 'For click_text: exact match (default false)' }
                    },
                    required: ['action']
                }
            }
        },
        required: ['steps']
    }
}

// ─── web_search ────────────────────────────────────────────────────────

export const WEB_SEARCH_SCHEMA: ToolSchema = {
    name: 'web_search',
    description:
        "RECIPE: Search the web and return formatted top results in one shot. " +
        "NO preconditions — this tool handles everything internally (navigation, waiting, extraction). " +
        "Use this as the DEFAULT for any web search instead of manually navigating to Google. " +
        "Returns titles, URLs, and snippets.",
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query to look up' },
            num_results: { type: 'number', description: 'Number of top results to return (default: 5, max: 10)' }
        },
        required: ['query']
    }
}

// ─── fill_form ─────────────────────────────────────────────────────────

export const FILL_FORM_SCHEMA: ToolSchema = {
    name: 'fill_form',
    description:
        "RECIPE: Fill and submit a web form in one shot. " +
        "PRECONDITIONS: (1) You MUST have called get_interactive_elements on the target page FIRST to obtain real CSS selectors for each field — NEVER guess selectors. " +
        "(2) Prefer submit_text over submit_selector (finds button by visible text, more resilient). " +
        "(3) If you don't know the exact selectors, use individual fill + click calls instead. " +
        "This tool saves roundtrips ONLY when all selectors are confirmed.",
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL of the page containing the form (omit if already on the page)' },
            fields: {
                type: 'array',
                description: 'Fields to fill in order',
                items: {
                    type: 'object',
                    properties: {
                        selector: { type: 'string', description: 'CSS selector of the input field' },
                        value: { type: 'string', description: 'Text to fill into the field' },
                        type: { type: 'string', enum: ['fill', 'type', 'select'], description: 'fill=instant (default), type=simulated keystrokes, select=dropdown' }
                    },
                    required: ['selector', 'value']
                }
            },
            submit_selector: { type: 'string', description: 'CSS selector of the submit button (if omitted, presses Enter on the last field)' },
            submit_text: { type: 'string', description: 'Alternative: click by visible button text instead of selector' },
            wait_after_submit: { type: 'boolean', description: 'Wait for navigation after submitting (default: true)' }
        },
        required: ['fields']
    }
}

/**
 * All browser turbo/recipe tool schemas in one array.
 * Use this for easy iteration in listTools() or client-tools exports.
 */
export const BROWSER_TURBO_SCHEMAS: ToolSchema[] = [
    BROWSER_ACTION_SEQUENCE_SCHEMA,
    WEB_SEARCH_SCHEMA,
    FILL_FORM_SCHEMA,
]
