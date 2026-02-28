/**
 * BrowserManager.ts — Low-level browser lifecycle engine for the Playwright Service.
 *
 * Capabilities:
 *   1. Context Persistence: Manages Chromium's 'launchPersistentContext' for session storage.
 *   2. Stealth Tactics: Injected init scripts to bypass bot detection (removes navigator.webdriver).
 *   3. Ad-Blocking: Intercepts network routes to prevent heavy resource loads; saves bandwidth and tokens.
 *   4. Tab Tracker: Maintains an ID-to-Page map so agents can switch between tabs without losing state.
 *   5. Popup Isolation: Forces '_blank' links to open in the current tab to prevent tab-explosion.
 *   6. OS-Smart Fallback: Tries the preferred browser first, then falls back in a platform-specific order.
 *
 * Design decision: All "mechanics" of launching and configuring the browser live here.
 *   This ensures that UI settings (like ad-blocking) are applied uniformly to all tabs.
 *
 * Consumed by: PlaywrightService (PlaywrightService.ts)
 */

import { chromium, firefox, webkit, BrowserContext, Page } from 'playwright';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import Store from 'electron-store';

/**
 * Configuration schema for the Playwright browser settings (persisted via electron-store).
 */
export interface PlaywrightSettings {
    browser?: 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'msedge';
    headless?: boolean;
    blockAds?: boolean;
}

/**
 * Manages the underlying Playwright browser, its context, and tab state.
 * Implements persistent data directories to keep cookies and session state between runs.
 * Uses an OS-smart fallback loop: if the preferred browser fails to launch,
 * it tries the next best option for the current platform before giving up.
 */
export class BrowserManager {
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private pagesMap = new Map<number, Page>();
    private nextTabId = 1;
    private store: Store<Record<string, unknown>>;
    /** Ensures concurrent callTool calls don't trigger multiple browser launches */
    private initializationPromise: Promise<void> | null = null;

    constructor() {
        this.store = new Store<Record<string, unknown>>();
    }

    /**
     * Lazily initializes the Playwright browser context if it doesn't exist.
     * Uses an OS-smart fallback order: tries the user's preferred browser first,
     * then falls back to platform defaults if that launch fails.
     *
     * blockAds defaults to TRUE (matching original service behaviour) unless
     * explicitly set to false in the user's MCP settings.
     *
     * @returns A promise resolving to the active BrowserContext.
     */
    async ensureBrowser(): Promise<BrowserContext> {
        if (this.context) return this.context;

        // Serialize concurrent ensureBrowser() calls behind a single promise
        if (this.initializationPromise) {
            await this.initializationPromise;
            return this.context!;
        }

        this.initializationPromise = (async () => {
            try {
                console.log('[BrowserManager] Launching browser...');
                const userDataDir = path.join(app.getPath('userData'), 'playwright_data');

                if (!fs.existsSync(userDataDir)) {
                    fs.mkdirSync(userDataDir, { recursive: true });
                }

                const settings = ((this.store as any).get('mcpPlaywright') || {}) as PlaywrightSettings;
                const browserType = settings.browser || this.getDefaultBrowser();
                const headless = settings.headless ?? false;
                // Default blockAds to TRUE — matches the original PlaywrightService default
                const blockAds = settings.blockAds !== undefined ? settings.blockAds : true;

                console.log(`[BrowserManager] OS: ${process.platform}, target browser: ${browserType}`);

                // Full set of stealth + stability args — restored from original PlaywrightService
                const launchArgs = [
                    '--disable-blink-features=AutomationControlled', // Remove automation flag from navigator
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-infobars',                            // Remove "Chrome is being controlled" bar
                    '--window-position=0,0',
                    '--ignore-certificate-errors',                   // Allow self-signed SSL sites
                    '--ignore-certificate-errors-spki-list',
                    '--disable-accelerated-2d-canvas',               // Stealth: reduce GPU fingerprinting surface
                    '--disable-gpu',
                    '--disable-dev-shm-usage',                       // Stability: avoid /dev/shm exhaustion in containers
                ];

                // OS-smart browser fallback order.
                // If the preferred browser fails (not installed, corrupt profile, etc.),
                // we try the next most compatible option for the current platform.
                const getFallbackOrder = (): string[] => {
                    switch (process.platform) {
                        case 'win32': return ['msedge', 'chrome', 'firefox'];   // Windows: Edge (pre-installed) → Chrome → Firefox
                        case 'darwin': return ['chrome', 'webkit', 'firefox'];  // macOS: Chrome → Safari/WebKit → Firefox
                        case 'linux': return ['chrome', 'firefox', 'chromium']; // Linux: Chrome → Firefox → bundled Chromium
                        default: return ['chrome', 'msedge', 'firefox'];
                    }
                };

                const fallbackOrder = getFallbackOrder();
                // User preference always goes first; deduplication removes it from fallbacks
                const browserAttempts = [browserType, ...fallbackOrder.filter(b => b !== browserType)];

                let lastError: Error | null = null;

                for (const tryBrowser of browserAttempts) {
                    try {
                        // Select the right Playwright launcher and channel for each browser type
                        let launcher: any = chromium;
                        const tryOptions: Record<string, any> = {
                            headless,
                            args: launchArgs,
                            viewport: { width: 1280, height: 800 },
                        };

                        if (tryBrowser === 'firefox') {
                            launcher = firefox;
                            delete tryOptions.channel; // firefox doesn't support channel option
                        } else if (tryBrowser === 'webkit') {
                            launcher = webkit;
                            delete tryOptions.channel; // webkit doesn't support channel option
                        } else if (tryBrowser === 'chromium') {
                            // Bundled Chromium — no channel key needed
                        } else {
                            // Named channel: 'chrome', 'msedge'
                            tryOptions.channel = tryBrowser;
                        }

                        console.log(`[BrowserManager] Trying browser: ${tryBrowser}...`);
                        this.context = await launcher.launchPersistentContext(userDataDir, tryOptions);

                        // Inject stealth init script to hide webdriver property from sites
                        await this.context!.addInitScript(() => {
                            Object.defineProperty(navigator, 'webdriver', {
                                get: () => undefined,
                            });
                        });

                        const pages = this.context!.pages();
                        if (pages.length > 0) {
                            this.page = pages[0];
                            this.registerPage(this.page);
                        }

                        // Apply ad/resource blocking to all current and future pages
                        if (blockAds) {
                            this.context!.on('page', (newPage) => {
                                this.enableResourceBlocking(newPage);
                            });
                            for (const page of this.context!.pages()) {
                                await this.enableResourceBlocking(page);
                            }
                        }

                        console.log(`[BrowserManager] ✅ Browser launched: ${tryBrowser}`);
                        return; // Success — exit fallback loop
                    } catch (err) {
                        lastError = err instanceof Error ? err : new Error(String(err));
                        console.warn(`[BrowserManager] Browser '${tryBrowser}' failed: ${lastError.message}. Trying next...`);
                        this.context = null;
                    }
                }

                // All browsers in the fallback chain failed
                throw lastError || new Error('[BrowserManager] All browser launch attempts failed.');
            } catch (error) {
                console.error('[BrowserManager] Failed to launch browser:', error);
                this.initializationPromise = null; // Allow retry on next call
                throw error;
            }
        })();

        await this.initializationPromise;
        return this.context!;
    }

    /**
     * Enables network interception to block images, media, and fonts.
     * This saves bandwidth and reduces agent context token usage per page.
     *
     * @param page - The page to apply blocking to.
     */
    private async enableResourceBlocking(page: Page): Promise<void> {
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'media', 'font'].includes(type)) {
                return route.abort();
            }
            return route.continue();
        });
    }

    /**
     * Returns the OS-appropriate default browser when the user hasn't configured one.
     * Matches the original PlaywrightService getDefaultBrowser() logic.
     */
    private getDefaultBrowser(): PlaywrightSettings['browser'] {
        const platform = process.platform;
        if (platform === 'win32') return 'msedge';
        if (platform === 'darwin') return 'chrome';
        return 'chromium';
    }

    /**
     * Registers a new Playwright Page into the managed tab tracking system.
     * Sets up listeners for tab close cleanup and popup interception.
     *
     * Popup isolation: when a page spawns a target="_blank" popup, we redirect
     * the ORIGINATING tab to that URL instead of letting an unmanaged popup
     * accumulate outside the pagesMap. This prevents orphaned tabs the agent
     * cannot track or interact with.
     *
     * @param page - The Playwright Page instance to track.
     * @returns The unique integer ID assigned to this tab.
     */
    registerPage(page: Page): number {
        // Prevent double-registration
        for (const [id, p] of this.pagesMap.entries()) {
            if (p === page) return id;
        }
        const id = this.nextTabId++;
        this.pagesMap.set(id, page);

        // Auto-cleanup when tab is closed
        page.on('close', () => {
            this.pagesMap.delete(id);
            if (this.page === page) {
                const remaining = Array.from(this.pagesMap.values());
                this.page = remaining.length > 0 ? remaining[remaining.length - 1] : null;
            }
        });

        // Force popup into the same tab (same-tab redirect)
        page.on('popup', async (popup) => {
            try {
                const url = popup.url();
                await popup.close().catch(() => { });
                if (url && url !== 'about:blank') {
                    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => { });
                }
            } catch {
                // Silently ignore — popup may already be closed or not navigable
            }
        });

        return id;
    }

    /**
     * Returns an active Page instance, optionally switching to a specific tab.
     * If no page is active, it creates a new one within the current context.
     *
     * @param args - Arguments which may include `tabId` to target a specific tab.
     * @returns A promise resolving to the active Page.
     */
    async getPage(args: any): Promise<Page> {
        await this.ensureBrowser();

        if (args.tabId !== undefined) {
            const target = this.pagesMap.get(args.tabId);
            if (target) {
                this.page = target;
                return target;
            }
        }

        if (!this.page || this.page.isClosed()) {
            const pages = this.context!.pages().filter(p => !p.isClosed());
            if (pages.length > 0) {
                this.page = pages[pages.length - 1];
            } else {
                this.page = await this.context!.newPage();
                this.registerPage(this.page);
            }
        }

        return this.page;
    }

    setPage(page: Page) {
        this.page = page;
    }

    getCurrentPage(): Page | null {
        return this.page;
    }

    getContext(): BrowserContext | null {
        return this.context;
    }

    getPagesMap(): Map<number, Page> {
        return this.pagesMap;
    }

    /**
     * Closes all browser contexts and resets internal tracking state.
     */
    async close() {
        if (this.context) {
            await this.context.close();
            this.context = null;
            this.page = null;
            this.pagesMap.clear();
        }
    }
}
