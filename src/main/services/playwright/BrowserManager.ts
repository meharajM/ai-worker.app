/**
 * playwright/BrowserManager.ts — Lifecycle and state manager for Playwright.
 *
 * Responsibilities:
 *   1. Context Lifecycle: Launches and manages a persistent browser context (chromium).
 *   2. Tab Management: Tracks multiple open pages/tabs and enables switching between them.
 *   3. Stealth & Security: Disables navigator.webdriver and applies stealth init scripts.
 *   4. Ad-Blocking: Manages resource interceptors to block ads, media, and fonts via Electron store settings.
 *   5. Popup Handling: Intercepts 'target="_blank"' popups to force them into the current managed tab.
 *
 * Design decision: This class encapsulates all "mechanisms" of Playwright (creation,
 *   interception, stealth). By separating lifecycle from interaction tool logic,
 *   we ensure that browser configurations are consistent regardless of which
 *   tool is being executed.
 *
 * Consumed by: PlaywrightService (PlaywrightService.ts)
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import Store from 'electron-store';

/**
 * Configuration schema for the Playwright browser.
 */
export interface PlaywrightSettings {
    browser?: 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'msedge';
    headless?: boolean;
    blockAds?: boolean;
}

/**
 * Manages the underlying Playwright browser, its context, and tab state.
 * Implements persistent data directories to keep cookies and session state between runs.
 */
export class BrowserManager {
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private pagesMap = new Map<number, Page>();
    private nextTabId = 1;
    private store: Store<Record<string, unknown>>;
    private initializationPromise: Promise<void> | null = null;

    constructor() {
        this.store = new Store<Record<string, unknown>>();
    }

    /**
     * Lazily initializes the Playwright browser context if it doesn't exist.
     * Starts a persistent Chromium context with stealth and ad-blocking configured.
     *
     * @returns A promise resolving to the active BrowserContext.
     */
    async ensureBrowser(): Promise<BrowserContext> {
        if (this.context) return this.context;

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

                const settings = ((this.store as any).get('mcpPlaywright')) || {};
                const browserType = settings.browser || this.getDefaultBrowser();

                this.context = await chromium.launchPersistentContext(userDataDir, {
                    headless: settings.headless ?? false,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-blink-features=AutomationControlled',
                        '--disable-gpu',
                        '--disable-dev-shm-usage'
                    ],
                    viewport: { width: 1280, height: 800 }
                });

                await this.context.addInitScript(() => {
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                    });
                });

                const pages = this.context.pages();
                if (pages.length > 0) {
                    this.page = pages[0];
                    this.registerPage(this.page);
                }

                if (settings.blockAds) {
                    this.context.on('page', (page) => {
                        this.enableResourceBlocking(page);
                    });
                    for (const page of this.context.pages()) {
                        await this.enableResourceBlocking(page);
                    }
                }

                console.log(`[BrowserManager] Browser launched: ${browserType}`);
            } catch (error) {
                console.error('[BrowserManager] Failed to launch browser:', error);
                this.initializationPromise = null;
                throw error;
            }
        })();

        await this.initializationPromise;
        return this.context!;
    }

    /**
     * Enables network interception to block images, media, and fonts.
     * This saves bandwidth and improves performance for text-based agents.
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

    private getDefaultBrowser(): PlaywrightSettings['browser'] {
        const platform = process.platform;
        if (platform === 'win32') return 'msedge';
        if (platform === 'darwin') return 'chrome';
        return 'chromium';
    }

    /**
     * Registers a new Playwright Page into the managed tab tracking system.
     * Sets up listeners for tag closing and popup interception.
     *
     * @param page - The Playwright Page instance to track.
     * @returns The unique ID assigned to this tab.
     */
    registerPage(page: Page): number {
        for (const [id, p] of this.pagesMap.entries()) {
            if (p === page) return id;
        }
        const id = this.nextTabId++;
        this.pagesMap.set(id, page);

        page.on('close', () => {
            this.pagesMap.delete(id);
            if (this.page === page) {
                const remaining = Array.from(this.pagesMap.values());
                this.page = remaining.length > 0 ? remaining[remaining.length - 1] : null;
            }
        });

        // Popup logic from old service
        page.on('popup', async (popup) => {
            try {
                const url = popup.url();
                await popup.close().catch(() => { });
                if (url && url !== 'about:blank') {
                    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => { });
                }
            } catch {
                // Ignore
            }
        });

        return id;
    }

    /**
     * Returns an active Page instance, optionally switching to a specific tab.
     * If no page is active, it creates a new one.
     *
     * @param args - Arguments which may include `tabId`.
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

    async close() {
        if (this.context) {
            await this.context.close();
            this.context = null;
            this.page = null;
            this.pagesMap.clear();
        }
    }
}
