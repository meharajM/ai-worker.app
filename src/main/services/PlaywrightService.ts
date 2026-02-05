import { chromium, firefox, webkit, BrowserContext, Page } from 'playwright'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import Store from 'electron-store'

interface ToolSchema {
    name: string
    description: string
    inputSchema: {
        type: string
        properties: Record<string, unknown>
        required?: string[]
    }
}

// Define the shape of our settings
interface PlaywrightSettings {
    browser?: 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'msedge'
    headless?: boolean
    blockAds?: boolean
}

export class PlaywrightService {
    private static instance: PlaywrightService
    // Browser instance is managed through the context for persistent contexts
    private context: BrowserContext | null = null
    private page: Page | null = null
    private store: Store<Record<string, unknown>>

    private constructor() {
        this.store = new Store<Record<string, unknown>>()
    }

    static getInstance(): PlaywrightService {
        if (!PlaywrightService.instance) {
            PlaywrightService.instance = new PlaywrightService()
        }
        return PlaywrightService.instance
    }

    async initialize(): Promise<void> {
        // Initialization is now lazy - browser launches on first usage
        console.log('[PlaywrightService] Service initialized (browser will launch on demand)')
    }

    private initializationPromise: Promise<void> | null = null

    private async ensureBrowser(): Promise<void> {
        if (this.context) return

        // If already initializing, wait for it to complete
        if (this.initializationPromise) {
            return this.initializationPromise
        }

        this.initializationPromise = (async () => {
            try {
                console.log('[PlaywrightService] Launching browser...')
                const userDataDir = path.join(app.getPath('userData'), 'playwright_data')

                // Ensure directory exists
                if (!fs.existsSync(userDataDir)) {
                    fs.mkdirSync(userDataDir, { recursive: true })
                }

                const settings = ((this.store as any).get?.('mcpPlaywright') || {}) as PlaywrightSettings

                // OS-specific default browser selection
                const getDefaultBrowser = (): PlaywrightSettings['browser'] => {
                    const platform = process.platform
                    switch (platform) {
                        case 'win32': return 'msedge'   // Windows: Edge is pre-installed
                        case 'darwin': return 'chrome'  // macOS: Chrome is most common
                        case 'linux': return 'chrome'   // Linux: Chrome or Firefox
                        default: return 'chrome'
                    }
                }

                const browserType = settings.browser || getDefaultBrowser()
                console.log(`[PlaywrightService] OS: ${process.platform}, Default browser: ${browserType}`)
                const headless = settings.headless !== undefined ? settings.headless : false // Default to headed as per stealth strategy
                const blockAds = settings.blockAds !== undefined ? settings.blockAds : true

                console.log(`[PlaywrightService] Launching ${browserType} (Headless: ${headless})`)

                const launchOptions = {
                    headless: headless,
                    viewport: { width: 1280, height: 800 },
                    args: [
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-infobars',
                        '--window-position=0,0',
                        '--ignore-certificate-errors',
                        '--ignore-certificate-errors-spki-list',
                        // Additional stealth args
                        '--disable-accelerated-2d-canvas',
                        '--disable-gpu',
                    ]
                }

                // Note: The fallback loop below handles browser selection dynamically

                // Launch persistent context for state preservation
                // Smart fallback order based on OS
                const getFallbackOrder = (): string[] => {
                    const platform = process.platform
                    switch (platform) {
                        case 'win32': return ['msedge', 'chrome', 'firefox']  // Windows: Edge -> Chrome -> Firefox
                        case 'darwin': return ['chrome', 'webkit', 'firefox'] // macOS: Chrome -> Safari -> Firefox
                        case 'linux': return ['chrome', 'firefox', 'chromium'] // Linux: Chrome -> Firefox -> Chromium
                        default: return ['chrome', 'msedge', 'firefox']
                    }
                }
                const fallbackBrowsers = getFallbackOrder()
                let lastError: Error | null = null

                for (const tryBrowser of [browserType, ...fallbackBrowsers.filter(b => b !== browserType)]) {
                    try {
                        let tryLauncher = chromium
                        const tryOptions = { ...launchOptions }

                        if (tryBrowser === 'firefox') {
                            tryLauncher = firefox
                            delete (tryOptions as any).channel
                        } else if (tryBrowser === 'webkit') {
                            tryLauncher = webkit
                            delete (tryOptions as any).channel
                        } else if (tryBrowser === 'chromium') {
                            // Bundled Chromium - no channel needed
                            tryLauncher = chromium
                            delete (tryOptions as any).channel
                        } else {
                            // Chrome or Edge - use channel
                            (tryOptions as any).channel = tryBrowser
                        }

                        console.log(`[PlaywrightService] Trying to launch: ${tryBrowser}...`)
                        this.context = await tryLauncher.launchPersistentContext(userDataDir, tryOptions)

                        // Handle unexpected closure
                        this.context.on('close', () => {
                            console.log('[PlaywrightService] Browser context closed')
                            this.context = null
                            this.page = null
                        })

                        console.log(`[PlaywrightService] Successfully launched: ${tryBrowser}`)
                        break // Success!
                    } catch (error) {
                        lastError = error as Error
                        const isMissingExecutable = String(error).includes('Executable doesn\'t exist') ||
                            String(error).includes('No executable path')
                        if (isMissingExecutable) {
                            console.warn(`[PlaywrightService] ${tryBrowser} not found, trying next...`)
                            continue
                        } else {
                            // Non-executable error, don't try more browsers
                            throw error
                        }
                    }
                }

                if (!this.context) {
                    throw lastError || new Error('No browser available. Please install Chrome, Edge, or Firefox.')
                }

                // Stealth: Remove navigator.webdriver
                if (this.context) {
                    await this.context.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', {
                            get: () => undefined,
                        })
                    })
                }

                // Get the default page or create one
                if (this.context) {
                    const pages = this.context.pages()
                    this.page = pages.length > 0 ? pages[0] : await this.context.newPage()
                }

                // Enable resource blocking if requested
                if (blockAds && this.page) {
                    await this.enableResourceBlocking(this.page)
                }

                console.log('[PlaywrightService] Browser initialized successfully')
            } catch (error) {
                console.error('[PlaywrightService] Initialization error:', error)
                throw error
            } finally {
                this.initializationPromise = null
            }
        })()

        return this.initializationPromise
    }

    private async enableResourceBlocking(page: Page): Promise<void> {
        await page.route('**/*', (route) => {
            const type = route.request().resourceType()
            // Block ads, trackers, and heavy media
            if (['image', 'media', 'font'].includes(type)) {
                return route.abort()
            }
            return route.continue()
        })
    }

    async ensurePage(): Promise<Page> {
        // 1. Ensure browser context exists
        if (!this.context) {
            await this.ensureBrowser()
        }

        // 2. Ensure page exists and is not closed
        if (!this.page || this.page.isClosed()) {
            try {
                // Double check context is alive
                if (!this.context) throw new Error('Context initialization failed')

                // Reuse existing page if any (e.g. from manual user interaction)
                const pages = this.context.pages()
                const validPage = pages.find(p => !p.isClosed())

                if (validPage) {
                    this.page = validPage
                } else {
                    this.page = await this.context.newPage()
                }

                // Re-apply settings
                const settings = ((this.store as any).get?.('mcpPlaywright') || {}) as PlaywrightSettings
                if (settings.blockAds !== false) {
                    await this.enableResourceBlocking(this.page)
                }
            } catch (error) {
                // Detect "Target page, context or browser has been closed"
                const msg = error instanceof Error ? error.message : String(error)
                console.warn('[PlaywrightService] Error in ensurePage:', msg)

                if (msg.includes('closed') || msg.includes('Session closed')) {
                    console.log('[PlaywrightService] Context appears dead. Restarting browser...')
                    this.context = null
                    this.page = null

                    // Retry initialization
                    await this.ensureBrowser()

                    // After ensureBrowser, verify context state
                    if (!this.context) {
                        throw new Error('Failed to restart browser context')
                    }

                    // Capture verified context in local variable
                    // TypeScript can't track that ensureBrowser() reassigns this.context
                    const context = this.context as BrowserContext

                    // Re-create page if needed (after browser restart)
                    // Get existing pages from the fresh context
                    const existingPages = context.pages()
                    const validPage = existingPages.find(p => !p.isClosed())

                    if (validPage) {
                        this.page = validPage
                    } else {
                        this.page = await context.newPage()
                    }

                    // Re-apply settings to the page
                    const settings = ((this.store as any).get?.('mcpPlaywright') || {}) as PlaywrightSettings
                    if (settings.blockAds !== false && this.page) {
                        await this.enableResourceBlocking(this.page)
                    }
                } else {
                    throw error
                }
            }
        }

        return this.page!
    }

    private async getPage(args: any): Promise<Page> {
        // If tabId is explicitly provided, use key-based access
        if (typeof args.tabId === 'number') {
            if (!this.context) await this.ensureBrowser();
            if (!this.context) throw new Error('Browser context not initialized');

            const pages = this.context.pages();
            if (args.tabId >= 0 && args.tabId < pages.length) {
                const targetPage = pages[args.tabId];
                if (targetPage.isClosed()) throw new Error(`Tab ${args.tabId} is closed`);
                return targetPage;
            }
            throw new Error(`Tab index ${args.tabId} not found (Open tabs: ${pages.length})`);
        }

        // Fallback to default "active" page logic
        return this.ensurePage();
    }

    async close(): Promise<void> {
        if (this.context) {
            await this.context.close()
            this.context = null
            this.page = null
        }
    }

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
                }
            ]
        }
    }

    async callTool(name: string, args: any): Promise<{ result: any; error?: string }> {
        // Detailed logging for bridge debugging
        console.log(`[PlaywrightService] Request: ${name}`, {
            args: JSON.stringify(args),
            argKeys: Object.keys(args || {}),
            timestamp: new Date().toISOString()
        })

        try {
            // Allow empty objects {} but reject null/undefined - default to empty object
            const safeArgs = args ?? {}

            // Helper to validate required parameters
            const requireParam = (paramName: string, paramType: string = 'string'): string | null => {
                const value = safeArgs[paramName]
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

            const page = await this.getPage(safeArgs)

            switch (name) {
                case 'navigate':
                    const navError = requireParam('url')
                    if (navError) return { result: null, error: navError }
                    try {
                        await page.goto(safeArgs.url, { waitUntil: 'domcontentloaded' })
                        return { result: `Navigated to ${safeArgs.url}` }
                    } catch (e) {
                        // AUTO-FALLBACK: Google Search
                        // If we failed to resolve the name, it might be a typo or a non-url search query
                        const errorStr = String(e);
                        if (errorStr.includes('ERR_NAME_NOT_RESOLVED') || errorStr.includes('ERR_CONNECTION_REFUSED')) {
                            const fallbackUrl = `https://google.com/search?q=${encodeURIComponent(safeArgs.url)}`;
                            console.log(`[PlaywrightService] Navigation failed (${errorStr}). Falling back to Google Search: ${fallbackUrl}`);
                            try {
                                await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded' });
                                return { result: `Navigation failed for '${safeArgs.url}', so I searched Google instead. Now at: ${page.url()}` };
                            } catch (fallbackError) {
                                // If fallback also fails, return original error
                                return { result: null, error: `Navigation failed: ${errorStr}` };
                            }
                        }
                        throw e;
                    }

                case 'screenshot':
                    const buffer = await page.screenshot({ fullPage: safeArgs.fullPage || false })
                    return {
                        result: {
                            type: 'image',
                            data: buffer.toString('base64'),
                            mimeType: 'image/png'
                        }
                    }

                case 'get_state':
                    // Mode-based defaults for performance optimization
                    const mode = safeArgs.mode || 'fast'
                    const includeScreenshot = safeArgs.screenshot ?? (mode === 'vision')
                    const includeTree = safeArgs.tree ?? (mode === 'full')
                    const useHighlighting = safeArgs.highlight ?? includeScreenshot // Only highlight when taking screenshot

                    const state: any = {
                        url: page.url(),
                        title: await page.title(),
                        mode: mode, // Include mode in response for transparency
                    }

                    // Element map to store interactive elements found during highlighting
                    let elementMap: Record<number, string> = {}

                    if (useHighlighting && includeScreenshot) {
                        try {
                            // Inject script to highlight interactive elements with numbered boxes
                            elementMap = await page.evaluate(() => {
                                const interactiveSelectors = [
                                    'a[href]', 'button', 'input', 'textarea', 'select', '[role="button"]', '[role="link"]', '[onclick]'
                                ].join(',')

                                const elements = document.querySelectorAll(interactiveSelectors)
                                const map: Record<number, string> = {}
                                const overlayId = 'ai-worker-highlight-overlay'

                                // Remove existing overlay if any
                                document.getElementById(overlayId)?.remove()

                                const overlayContainer = document.createElement('div')
                                overlayContainer.id = overlayId
                                overlayContainer.style.position = 'absolute'
                                overlayContainer.style.top = '0'
                                overlayContainer.style.left = '0'
                                overlayContainer.style.width = '100%'
                                overlayContainer.style.height = '100%'
                                overlayContainer.style.pointerEvents = 'none'
                                overlayContainer.style.zIndex = '2147483647' // Max z-index

                                let counter = 1
                                elements.forEach((el) => {
                                    const rect = el.getBoundingClientRect()
                                    if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden') {
                                        const label = counter++
                                        const box = document.createElement('div')
                                        box.style.position = 'absolute'
                                        box.style.border = '2px solid #ff0000'
                                        box.style.left = `${rect.left + window.scrollX}px`
                                        box.style.top = `${rect.top + window.scrollY}px`
                                        box.style.width = `${rect.width}px`
                                        box.style.height = `${rect.height}px`

                                        const tag = document.createElement('span')
                                        tag.style.position = 'absolute'
                                        tag.style.top = '-20px'
                                        tag.style.left = '0'
                                        tag.style.backgroundColor = '#ff0000'
                                        tag.style.color = 'white'
                                        tag.style.padding = '2px 4px'
                                        tag.style.fontSize = '12px'
                                        tag.style.fontWeight = 'bold'
                                        tag.innerText = String(label)

                                        box.appendChild(tag)
                                        overlayContainer.appendChild(box)

                                        // Store minimal selector info (heuristic)
                                        let selector = el.tagName.toLowerCase()
                                        if (el.id) selector += `#${el.id}`
                                        else if (el.className) selector += `.${el.className.split(' ')[0]}`

                                        map[label] = selector
                                    }
                                })

                                document.body.appendChild(overlayContainer)
                                return map
                            })

                            state.interactableElements = elementMap
                        } catch (e) {
                            console.warn('Failed to apply highlights:', e)
                        }
                    }

                    if (includeTree) {
                        // Get DOM structure as accessibility-like tree (works across all page types)
                        try {
                            const domTree = await page.evaluate(() => {
                                function extractNode(el: Element, depth: number = 0): any {
                                    if (depth > 5) return null // Limit depth for performance
                                    const tagName = el.tagName.toLowerCase()
                                    const role = el.getAttribute('role') || tagName
                                    const text = (el as HTMLElement).innerText?.substring(0, 100) || ''
                                    const children: any[] = []

                                    for (const child of Array.from(el.children)) {
                                        const childNode = extractNode(child, depth + 1)
                                        if (childNode) children.push(childNode)
                                    }

                                    // Only include meaningful nodes
                                    const isInteractive = ['a', 'button', 'input', 'textarea', 'select'].includes(tagName) ||
                                        el.getAttribute('onclick') || el.getAttribute('role')
                                    const hasContent = text.trim().length > 0 || children.length > 0

                                    if (!isInteractive && !hasContent && children.length === 0) return null

                                    return {
                                        role,
                                        name: el.getAttribute('aria-label') || el.getAttribute('title') || (isInteractive ? text.substring(0, 50) : ''),
                                        children: children.length > 0 ? children : undefined
                                    }
                                }
                                return extractNode(document.body)
                            })
                            state.domTree = domTree
                        } catch (e) {
                            state.domTreeError = String(e)
                        }
                    }

                    if (includeScreenshot) {
                        try {
                            const buffer = await page.screenshot({
                                fullPage: false,
                                type: 'jpeg',
                                quality: 70
                            })
                            state.screenshot = buffer.toString('base64')
                        } catch (e) {
                            state.screenshotError = String(e)
                        }
                    }

                    // Clean up highlights after screenshot
                    if (useHighlighting && includeScreenshot) {
                        await page.evaluate(() => {
                            document.getElementById('ai-worker-highlight-overlay')?.remove()
                        })
                    }

                    // Always include quick elements for 'fast' mode (low token, high speed)
                    if (mode === 'fast' && !state.interactableElements) {
                        const quickElements = await page.evaluate(() => {
                            const selectors = 'a[href],button,input,textarea,select,[role="button"],[role="link"]'
                            const els = document.querySelectorAll(selectors)
                            const list: string[] = []
                            let i = 1
                            els.forEach(el => {
                                const r = el.getBoundingClientRect()
                                if (r.width > 0 && r.height > 0 && i <= 30) {
                                    const t = ((el as HTMLElement).innerText || (el as HTMLInputElement).placeholder || '').substring(0, 30).trim()
                                    const tag = el.tagName.toLowerCase()
                                    list.push(`[${i++}] ${tag}: ${t || '(empty)'}`)
                                }
                            })
                            return list
                        })
                        state.elements = quickElements
                    }

                    return { result: state }

                case 'get_interactive_elements':
                    // Ultra-fast tool - lowest token consumption
                    const limit = safeArgs.limit || 50
                    const viewportOnly = safeArgs.viewport_only !== false

                    const elements = await page.evaluate(({ limit, viewportOnly }) => {
                        const interactiveSelectors = [
                            'a[href]', 'button', 'input', 'textarea', 'select', '[role="button"]', '[role="link"]', '[onclick]'
                        ].join(',')

                        const elements = document.querySelectorAll(interactiveSelectors)
                        const list: { index: number, text: string, selector: string, type: string }[] = []

                        let counter = 1
                        for (const el of Array.from(elements)) {
                            if (list.length >= limit) break

                            const rect = el.getBoundingClientRect()
                            const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden'
                            const isInViewport = rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0

                            if (isVisible && (!viewportOnly || isInViewport)) {
                                let selector = el.tagName.toLowerCase()
                                if (el.id) selector = `#${el.id}`
                                else if (el.className) selector = `.${el.className.split(' ')[0]}`

                                // Get meaningful text
                                let text = (el as HTMLElement).innerText || (el as HTMLInputElement).value || (el as HTMLInputElement).placeholder || (el as HTMLElement).getAttribute('aria-label') || ''
                                text = text.substring(0, 40).replace(/\n/g, ' ').trim()

                                list.push({
                                    index: counter++,
                                    text: text || '(empty)',
                                    selector,
                                    type: el.tagName.toLowerCase()
                                })
                            }
                        }
                        return list
                    }, { limit, viewportOnly })
                    return { result: { elements, count: elements.length } }

                case 'click':
                    const clickError = requireParam('selector')
                    if (clickError) return { result: null, error: clickError }
                    try {
                        await page.click(safeArgs.selector, { timeout: 5000 }) // Reduce initial timeout to fail fast for fallback
                        return { result: `Clicked ${safeArgs.selector}` }
                    } catch (error) {
                        const errorStr = String(error);

                        // AUTO-FALLBACK: click_text
                        // Sometimes users pass text as selector or ID changed.
                        // If selector looks like text (has spaces, no #/.), try click_text
                        const isSimpleText = !safeArgs.selector.includes('#') && !safeArgs.selector.includes('.') && safeArgs.selector.includes(' ');

                        if (isSimpleText || errorStr.includes('Timeout')) {
                            console.log(`[PlaywrightService] Click failed. Trying fallback click_text("${safeArgs.selector}")`);
                            try {
                                const textWithQuotes = `text="${safeArgs.selector}"`; // Playwright text selector
                                await page.click(textWithQuotes, { timeout: 5000 });
                                return { result: `Clicked by Text "${safeArgs.selector}" (Fallback from failed selector)` };
                            } catch (e2) {
                                // Fallback failed
                            }
                        }

                        const isTimeOut = errorStr.includes('Timeout');
                        if (isTimeOut) {
                            return {
                                result: null,
                                error: `Timeout clicking '${safeArgs.selector}'. \n\n💡 RECOVERY HINT: Selector failed. Try:\n1. click_text("Visible Text")\n2. get_interactive_elements() to find the ID/Class\n3. screenshot() to check if it's covered/hidden.`
                            };
                        }
                        throw error;
                    }

                case 'fill':
                    const fillSelectorError = requireParam('selector')
                    if (fillSelectorError) return { result: null, error: fillSelectorError }
                    const fillValueError = requireParam('value')
                    if (fillValueError) return { result: null, error: fillValueError }
                    await page.fill(safeArgs.selector, safeArgs.value)
                    return { result: `Filled ${safeArgs.selector} with "${safeArgs.value}"` }

                case 'hover':
                    const hoverError = requireParam('selector')
                    if (hoverError) return { result: null, error: hoverError }
                    await page.hover(safeArgs.selector)
                    return { result: `Hovered over ${safeArgs.selector}` }

                case 'press':
                    const pressError = requireParam('key')
                    if (pressError) return { result: null, error: pressError }
                    await page.keyboard.press(safeArgs.key)
                    return { result: `Pressed ${safeArgs.key}` }

                case 'scroll':
                    const scrollError = requireParam('direction')
                    if (scrollError) return { result: null, error: scrollError }
                    if (safeArgs.direction === 'top') await page.evaluate(() => window.scrollTo(0, 0))
                    else if (safeArgs.direction === 'bottom') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                    else if (safeArgs.direction === 'up') await page.mouse.wheel(0, -(safeArgs.amount || 500))
                    else if (safeArgs.direction === 'down') await page.mouse.wheel(0, safeArgs.amount || 500)
                    return { result: `Scrolled ${safeArgs.direction}` }

                case 'evaluate':
                    const result = await page.evaluate(safeArgs.script)
                    return { result: result }

                case 'get_page_content':
                    // Simple text extraction for now
                    const title = await page.title()
                    const content = await page.evaluate(() => document.body.innerText)
                    return { result: `Title: ${title}\n\n${content.substring(0, 5000)}...` }

                case 'wait_for_element':
                    const originalSelector = safeArgs.selector;
                    const timeout = safeArgs.timeout || 5000;

                    try {
                        await page.waitForSelector(originalSelector, { timeout });
                        return { result: `Element ${originalSelector} appeared` };
                    } catch (error) {
                        // AUTO-FALLBACK: Try resilient alternatives if the specific selector fails
                        const fallbacks: string[] = [];

                        // Strategy 1: Relaxed ID match (e.g. #submit-123 -> [id*="submit"])
                        if (originalSelector.startsWith('#')) {
                            const coreId = originalSelector.substring(1).replace(/-\d+$/, ''); // specific heuristic for trailing numbers
                            if (coreId.length > 3) {
                                fallbacks.push(`[id*="${coreId}"]`);
                            }
                        }

                        // Strategy 2: Relaxed Class match (e.g. .btn.btn-primary -> [class*="btn-primary"])
                        if (originalSelector.startsWith('.')) {
                            const classes = originalSelector.split('.').filter(c => c);
                            classes.forEach(c => {
                                if (c.length > 4) fallbacks.push(`[class*="${c}"]`);
                            });
                        }

                        // Try fallbacks
                        for (const fallback of fallbacks) {
                            try {
                                // Short timeout for fallbacks
                                await page.waitForSelector(fallback, { timeout: 2000 });
                                return { result: `Element appeared (auto-recovered using fallback: ${fallback})` };
                            } catch (e) {
                                // Fallback failed, continue
                            }
                        }

                        // ERROR ENRICHMENT: If all failed, provide helpful hints
                        const isTimeOut = String(error).includes('Timeout');
                        if (isTimeOut) {
                            return {
                                result: null,
                                error: `Timeout waiting for '${originalSelector}'. \n\n💡 RECOVERY HINT: The selector might be dynamic or incorrect.\n1. Try finding it by text: click_text("label")\n2. Use get_interactive_elements() to see real selectors.\n3. Take a screenshot to verify visibility.`
                            };
                        }
                        throw error;
                    }

                case 'type':
                    // Focus and type character by character (simulates real typing)
                    await page.click(safeArgs.selector)
                    await page.type(safeArgs.selector, safeArgs.text, { delay: safeArgs.delay || 50 })
                    return { result: `Typed "${safeArgs.text}" into ${safeArgs.selector}` }

                case 'select_option':
                    const selectSelectorError = requireParam('selector')
                    if (selectSelectorError) return { result: null, error: selectSelectorError }
                    const selectValueError = requireParam('value')
                    if (selectValueError) return { result: null, error: selectValueError }

                    await page.selectOption(safeArgs.selector, safeArgs.value)
                    return { result: `Selected "${safeArgs.value}" in ${safeArgs.selector}` }

                case 'go_back':
                    await page.goBack()
                    return { result: 'Navigated back' }

                case 'go_forward':
                    await page.goForward()
                    return { result: 'Navigated forward' }

                case 'new_tab':
                    if (!this.context) throw new Error('No browser context')
                    const newPage = await this.context.newPage()
                    if (safeArgs.url) {
                        await newPage.goto(safeArgs.url, { waitUntil: 'domcontentloaded' })
                    }
                    this.page = newPage // Switch to new tab
                    const newPages = this.context.pages()
                    const newTabIndex = newPages.indexOf(newPage)
                    return { result: { message: `Opened new tab${safeArgs.url ? ` at ${safeArgs.url}` : ''}`, tabId: newTabIndex } }

                case 'switch_tab':
                    if (!this.context) throw new Error('No browser context')
                    const pages = this.context.pages()
                    if (safeArgs.index < 0 || safeArgs.index >= pages.length) {
                        return { result: null, error: `Tab index ${safeArgs.index} out of range (0-${pages.length - 1})` }
                    }
                    this.page = pages[safeArgs.index]
                    await this.page.bringToFront()
                    return { result: `Switched to tab ${safeArgs.index}: ${await this.page.title()}` }

                case 'close_tab':
                    if (!this.context) throw new Error('No browser context')
                    const pageToClose = await this.getPage(safeArgs)

                    const openPages = this.context.pages().filter(p => !p.isClosed())
                    if (openPages.length <= 1) {
                        return { result: null, error: 'Cannot close the last tab' }
                    }

                    await pageToClose.close()

                    // If we closed the active page, switch to the last available one
                    if (this.page === pageToClose || this.page?.isClosed()) {
                        const remaining = this.context.pages().filter(p => !p.isClosed())
                        this.page = remaining[remaining.length - 1] || null
                    }

                    return { result: 'Closed tab' }

                case 'get_tabs':
                    if (!this.context) throw new Error('No browser context')
                    const tabList = await Promise.all(
                        this.context.pages().map(async (p, i) => ({
                            index: i,
                            title: await p.title().catch(() => 'Unknown'),
                            url: p.url(),
                            active: p === this.page
                        }))
                    )
                    return { result: { tabs: tabList } }

                case 'click_text':
                    const textFindError = requireParam('text')
                    if (textFindError) return { result: null, error: textFindError }

                    const textToFind = safeArgs.text
                    const exactMatch = safeArgs.exact || false
                    const tagFilter = safeArgs.tag ? safeArgs.tag.toLowerCase() : null

                    const clickTextSelector = tagFilter
                        ? `${tagFilter}:has-text("${textToFind}")`
                        : `text=${exactMatch ? `"${textToFind}"` : textToFind}`

                    await page.click(clickTextSelector)
                    return { result: `Clicked element with text "${textToFind}"` }

                case 'extract_data':
                    const extractTypeError = requireParam('type')
                    if (extractTypeError) return { result: null, error: extractTypeError }

                    const extractType = safeArgs.type || 'table'
                    const extractSelector = safeArgs.selector

                    // ERROR: Empty results usually mean bad selector
                    const validateResults = (data: any, type: string) => {
                        let isEmpty = false;
                        if (Array.isArray(data)) {
                            isEmpty = data.length === 0;
                        } else if (typeof data === 'object' && data !== null) {
                            // Check if object values are mostly empty
                            const values = Object.values(data);
                            const emptyValues = values.filter(v => !v || (typeof v === 'string' && v.trim() === ''));
                            isEmpty = emptyValues.length === values.length; // All empty
                        }

                        if (isEmpty) {
                            throw new Error(`ExtractionError: The selector '${extractSelector || 'default'}' found no data. \n\n💡 RECOVERY HINT: The page structure likely doesn't match your selector.\n1. Use 'get_interactive_elements' to find valid selectors.\n2. Use 'scan_page_accessibility' to read the page content.\n3. Verify the page is fully loaded.`);
                        }
                        return data;
                    };

                    if (extractType === 'table') {
                        const tableData = await page.evaluate((sel) => {
                            const table = sel ? document.querySelector(sel) : document.querySelector('table')
                            if (!table) return null

                            const rows: string[][] = []
                            const tableRows = table.querySelectorAll('tr')
                            tableRows.forEach(tr => {
                                const cells: string[] = []
                                tr.querySelectorAll('th, td').forEach(cell => {
                                    cells.push((cell as HTMLElement).innerText.trim())
                                })
                                if (cells.length > 0) rows.push(cells)
                            })
                            return rows
                        }, extractSelector)

                        try { validateResults(tableData, 'table'); } catch (e) { return { result: null, error: (e as Error).message }; }
                        return { result: { type: 'table', data: tableData } }

                    } else if (extractType === 'list') {
                        const listData = await page.evaluate((sel) => {
                            const list = sel ? document.querySelector(sel) : document.querySelector('ul, ol')
                            if (!list) return null

                            const items: string[] = []
                            list.querySelectorAll('li').forEach(li => {
                                items.push((li as HTMLElement).innerText.trim())
                            })
                            return items
                        }, extractSelector)

                        try { validateResults(listData, 'list'); } catch (e) { return { result: null, error: (e as Error).message }; }
                        return { result: { type: 'list', data: listData } }

                    } else if (extractType === 'custom' && safeArgs.fields) {
                        const customData = await page.evaluate((fields) => {
                            const result: Record<string, string> = {}
                            for (const [key, selector] of Object.entries(fields)) {
                                const el = document.querySelector(selector as string)
                                result[key] = el ? (el as HTMLElement).innerText.trim() : ''
                            }
                            return result
                        }, safeArgs.fields)

                        try { validateResults(customData, 'custom'); } catch (e) { return { result: null, error: (e as Error).message }; }
                        return { result: { type: 'custom', data: customData } }
                    }
                    return { result: null, error: 'Invalid extract_data type' }

                case 'upload_file':
                    const upSelectError = requireParam('selector')
                    if (upSelectError) return { result: null, error: upSelectError }
                    const upPathError = requireParam('filePath')
                    if (upPathError) return { result: null, error: upPathError }

                    await page.setInputFiles(safeArgs.selector, safeArgs.filePath)
                    return { result: `Uploaded file to ${safeArgs.selector}` }

                case 'get_cookies':
                    if (!this.context) throw new Error('No browser context')
                    const cookies = await this.context.cookies()
                    return { result: { cookies } }

                case 'set_cookie':
                    const cNameErr = requireParam('name')
                    if (cNameErr) return { result: null, error: cNameErr }
                    const cValErr = requireParam('value')
                    if (cValErr) return { result: null, error: cValErr }

                    if (!this.context) throw new Error('No browser context')
                    const url = page.url()
                    const domain = safeArgs.domain || new URL(url).hostname
                    await this.context.addCookies([{
                        name: safeArgs.name,
                        value: safeArgs.value,
                        domain: domain,
                        path: safeArgs.path || '/'
                    }])
                    return { result: `Set cookie ${safeArgs.name}` }

                case 'handle_dialog':
                    const diagActionErr = requireParam('action')
                    if (diagActionErr) return { result: null, error: diagActionErr }

                    // Set up dialog handler for next dialog
                    page.once('dialog', async dialog => {
                        if (safeArgs.action === 'accept') {
                            await dialog.accept(safeArgs.promptText)
                        } else {
                            await dialog.dismiss()
                        }
                    })
                    return { result: `Dialog handler set to ${safeArgs.action}` }

                case 'switch_frame':
                    if (!safeArgs.selector) {
                        // Switch back to main frame - we just use the main page
                        return { result: 'Switched to main frame' }
                    }
                    const frameElement = await page.$(safeArgs.selector)
                    if (!frameElement) {
                        return { result: null, error: `Frame not found: ${safeArgs.selector}` }
                    }
                    const frame = await frameElement.contentFrame()
                    if (!frame) {
                        return { result: null, error: 'Could not access frame content' }
                    }
                    return { result: `Switched to frame ${safeArgs.selector}` }

                case 'find_by_xpath':
                    const xpErr = requireParam('xpath')
                    if (xpErr) return { result: null, error: xpErr }

                    const xpathAction = safeArgs.action || 'info'
                    const xpathElements = await page.$$(`xpath=${safeArgs.xpath}`)

                    if (xpathElements.length === 0) {
                        return { result: null, error: `No elements found for XPath: ${safeArgs.xpath}` }
                    }

                    if (xpathAction === 'click') {
                        await xpathElements[0].click()
                        return { result: `Clicked first XPath match` }
                    } else if (xpathAction === 'text') {
                        const texts = await Promise.all(
                            xpathElements.slice(0, 10).map(el => el.innerText())
                        )
                        return { result: { texts } }
                    } else {
                        const info = await Promise.all(
                            xpathElements.slice(0, 10).map(async el => ({
                                tag: await el.evaluate(e => e.tagName.toLowerCase()),
                                text: (await el.innerText()).substring(0, 100),
                                visible: await el.isVisible()
                            }))
                        )
                        return { result: { count: xpathElements.length, elements: info } }
                    }

                case 'drag_drop':
                    const ddsErr = requireParam('sourceSelector')
                    if (ddsErr) return { result: null, error: ddsErr }
                    const ddtErr = requireParam('targetSelector')
                    if (ddtErr) return { result: null, error: ddtErr }

                    await page.dragAndDrop(safeArgs.sourceSelector, safeArgs.targetSelector)
                    return { result: `Dragged ${safeArgs.sourceSelector} to ${safeArgs.targetSelector}` }

                case 'check_element':
                    const chkSelErr = requireParam('selector')
                    if (chkSelErr) return { result: null, error: chkSelErr }

                    const checkSelector = safeArgs.selector
                    const property = safeArgs.property || 'exists'
                    const element = await page.$(checkSelector)

                    if (!element) {
                        return { result: { exists: false, property: property, value: null } }
                    }

                    let propValue: any = true
                    switch (property) {
                        case 'exists':
                            propValue = true
                            break
                        case 'visible':
                            propValue = await element.isVisible()
                            break
                        case 'text':
                            propValue = await element.innerText()
                            break
                        case 'value':
                            propValue = await element.inputValue().catch(() => null)
                            break
                        case 'href':
                            propValue = await element.getAttribute('href')
                            break
                        case 'src':
                            propValue = await element.getAttribute('src')
                            break
                        case 'checked':
                            propValue = await element.isChecked()
                            break
                        default:
                            propValue = await element.getAttribute(property)
                    }
                    return { result: { exists: true, property: property, value: propValue } }

                case 'set_viewport':
                    await page.setViewportSize({ width: safeArgs.width, height: safeArgs.height })
                    return { result: `Viewport set to ${safeArgs.width}x${safeArgs.height}` }

                case 'wait_for_navigation':
                    await page.waitForLoadState('networkidle', { timeout: safeArgs.timeout || 30000 })
                    return { result: 'Navigation completed' }

                default:
                    return { result: null, error: `Tool ${name} not implemented` }
            }
        } catch (error) {
            console.error(`[PlaywrightService] Error calling tool ${name}:`, error)
            let errorMessage = error instanceof Error ? error.message : String(error)

            // Clean up common Playwright timeout errors
            if (errorMessage.includes('Timeout') && errorMessage.includes('exceeded')) {
                const selectorMatch = errorMessage.match(/waiting for locator\(['"]([^'"]+)['"]\)/);
                const selector = selectorMatch ? selectorMatch[1] : 'element';
                errorMessage = `Timeout: The element '${selector}' was not found within the time limit.\n` +
                    `Suggestion: The selector might be incorrect or the page structure changed.\n` +
                    `1. Try using 'get_interactive_elements' to see what IS on the page.\n` +
                    `2. Try a different selector (e.g. text content or aria-label).\n` +
                    `3. Be aware that Google Search and other modern sites change IDs effectively randomly. Avoid using IDs like '#lst-ib' or '#tsf'.`;
            }

            return {
                result: null,
                error: errorMessage
            }
        }
    }
}
