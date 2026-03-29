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

import * as playwrightCore from 'playwright-core';
import { addExtra } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { BrowserContext, Page, Browser } from 'playwright-core';

const stealthChromium: any = addExtra(playwrightCore.chromium as any);
stealthChromium.use(stealth());
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

const MODERN_CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

    private headlessBrowser: Browser | null = null;
    private headlessContext: BrowserContext | null = null;
    private headlessPage: Page | null = null;
    private headlessOverride: boolean | null = null;
    /** Ensures concurrent calls to ensureHeadlessPage don't trigger multiple launches */
    private headlessInitializationPromise: Promise<void> | null = null;

    private idleTimer: NodeJS.Timeout | null = null;
    private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    constructor() {
        this.store = new Store<Record<string, unknown>>();
    }

    private resetIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        this.idleTimer = setTimeout(() => {
            console.log(`[BrowserManager] Closing browser after ${this.IDLE_TIMEOUT_MS / 60000} minutes of inactivity to save memory.`);
            this.close().catch(e => console.error('[BrowserManager] Error during idle close:', e));
        }, this.IDLE_TIMEOUT_MS);
    }

    /**
     * Helper to permanently fix profile locks. When the app hot-reloads or a previous instance
     * crashes, Chrome leaves behind a 'SingletonLock' file that blocks future launches.
     * Deleting this securely guarantees the browser can boot up on demand.
     */
    private clearChromeLock(userDataDir: string) {
        try {
            // Aggressive lock cleanup: SingletonLock, SingletonSocket, SingletonCookie
            // Chrome leaves these behind on crash, blocking future launches in persistent mode.
            ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].forEach(lockFile => {
                const lockPath = path.join(userDataDir, lockFile);
                if (fs.existsSync(lockPath)) {
                    try {
                        fs.unlinkSync(lockPath);
                        console.log(`[BrowserManager] 🔓 Cleared stale ${lockFile} at ${lockPath}`);
                    } catch (err) {
                        // Unlink might fail if another process really is using it
                        console.warn(`[BrowserManager] Could not delete ${lockFile} (may be in use):`, err);
                    }
                }
            });
        } catch (e) {
            console.warn(`[BrowserManager] Failed during aggressive lock cleanup:`, e);
        }
    }

    /**
     * Surfaces the browser from headless mode to UI mode to allow the human to intervene.
     * Retains persistent context.
     */
    async surfaceBrowser(): Promise<void> {
        console.log('[BrowserManager] Surfacing browser for human intervention...');
        
        let currentUrl = this.page?.url();
        let useHeadlessData = false;

        // If we have an active headless session, we want to promote its data to the headed browser
        if (this.headlessContext) {
            console.log('[BrowserManager] Detected active headless session. Promoting headless data...');
            currentUrl = this.headlessPage?.url() || currentUrl;
            useHeadlessData = true;
        }

        await this.close();
        
        // This forces ensureBrowser to use headless: false on the next launch
        this.headlessOverride = false;
        
        // If we were promoted from headless, we should point the headed browser to the headless data dir
        (this as any)._useHeadlessDirForHeaded = useHeadlessData;

        // Relaunch immediately
        await this.ensureBrowser();

        if (currentUrl && currentUrl !== 'about:blank') {
            await this.page?.goto(currentUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }

        this.headlessOverride = null;
        (this as any)._useHeadlessDirForHeaded = false;
    }

    /**
     * Lazily initializes the Playwright browser context if it doesn't exist.
     */
    async ensureBrowser(): Promise<BrowserContext> {
        if (this.context && !(this as any)._isContextClosed) return this.context;

        // Serialize concurrent ensureBrowser() calls behind a single promise
        if (this.initializationPromise) {
            await this.initializationPromise;
            if (!this.context || (this as any)._isContextClosed) {
                this.initializationPromise = null;
                (this as any)._isContextClosed = false;
                return this.ensureBrowser();
            }
            return this.context;
        }

        this.initializationPromise = (async () => {
            try {
                console.log('[BrowserManager] Launching browser...');
                const dataDirName = (this as any)._useHeadlessDirForHeaded ? 'playwright_data_headless' : 'playwright_data';
                const userDataDir = path.join(app.getPath('userData'), dataDirName);

                if (!fs.existsSync(userDataDir)) {
                    fs.mkdirSync(userDataDir, { recursive: true });
                }

                const settings = ((this.store as any).get('mcpPlaywright') || {}) as PlaywrightSettings;
                const browserType = settings.browser || this.getDefaultBrowser();
                
                const headless = this.headlessOverride !== null ? this.headlessOverride : (settings.headless ?? false);
                const blockAds = settings.blockAds !== undefined ? settings.blockAds : true;

                const launchArgs = [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-infobars',
                    '--window-position=0,0',
                    '--ignore-certificate-errors',
                    '--ignore-certificate-errors-spki-list',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                ];

                const getFallbackOrder = (): string[] => {
                    switch (process.platform) {
                        case 'win32': return ['msedge', 'chrome', 'firefox'];
                        case 'darwin': return ['chrome', 'webkit', 'firefox'];
                        case 'linux': return ['chrome', 'firefox', 'chromium'];
                        default: return ['chrome', 'msedge', 'firefox'];
                    }
                };

                const fallbackOrder = getFallbackOrder();
                const browserAttempts = [browserType, ...fallbackOrder.filter(b => b !== browserType)];

                let lastError: Error | null = null;

                if (headless) {
                    launchArgs.push('--headless=new');
                }

                for (const tryBrowser of browserAttempts) {
                    try {
                        let launcher: any = stealthChromium;
                        const tryOptions: Record<string, any> = {
                            headless,
                            args: [...launchArgs],
                            viewport: { width: 1280, height: 800 },
                            userAgent: MODERN_CHROME_UA,
                        };

                        if (tryBrowser === 'firefox') {
                            launcher = playwrightCore.firefox;
                            delete tryOptions.channel;
                        } else if (tryBrowser === 'webkit') {
                            launcher = playwrightCore.webkit;
                            delete tryOptions.channel;
                        } else if (tryBrowser === 'chromium') {
                            launcher = stealthChromium;
                            tryOptions.channel = 'chrome';
                        } else {
                            tryOptions.channel = tryBrowser;
                        }

                        console.log(`[BrowserManager] Trying browser: ${tryBrowser}...`);
                        this.clearChromeLock(userDataDir);
                        this.context = await launcher.launchPersistentContext(userDataDir, tryOptions);

                        await this.context!.addInitScript(() => {
                            // 1. Mask webdriver
                            Object.defineProperty(navigator, 'webdriver', {
                                get: () => undefined,
                            });
                            // 2. Mask languages
                            Object.defineProperty(navigator, 'languages', {
                                get: () => ['en-US', 'en'],
                            });
                            // 3. Mask Chrome runtime
                            if (!(window as any).chrome) {
                                (window as any).chrome = { runtime: {} };
                            }
                            // 4. Fix permissions
                            const nav = navigator as any;
                            if (nav.permissions) {
                                const originalQuery = nav.permissions.query;
                                nav.permissions.query = (parameters: any) =>
                                    parameters.name === 'notifications'
                                        ? Promise.resolve({ state: Notification.permission })
                                        : originalQuery(parameters);
                            }
                        });

                        const pages = this.context!.pages();
                        if (pages.length > 0) {
                            this.page = pages[0];
                            this.registerPage(this.page);
                        }

                        if (blockAds) {
                            this.context!.on('page', (newPage) => {
                                this.enableResourceBlocking(newPage);
                            });
                            for (const page of this.context!.pages()) {
                                await this.enableResourceBlocking(page);
                            }
                        }

                        console.log(`[BrowserManager] ✅ Browser launched: ${tryBrowser}`);
                        this.context!.on('close', () => {
                            (this as any)._isContextClosed = true;
                            this.context = null;
                            this.page = null;
                            this.initializationPromise = null;
                        });
                        return; 
                    } catch (err) {
                        lastError = err instanceof Error ? err : new Error(String(err));
                        console.warn(`[BrowserManager] Browser '${tryBrowser}' failed: ${lastError.message}. Trying next...`);
                        this.context = null;
                    }
                }

                throw lastError || new Error('[BrowserManager] All browser launch attempts failed.');
            } catch (error) {
                console.error('[BrowserManager] Failed to launch browser:', error);
                this.initializationPromise = null;
                throw error;
            } finally {
                this.initializationPromise = null;
            }
        })();

        await this.initializationPromise;
        if (!this.context) {
            throw new Error('[BrowserManager] Browser initialization failed to produce a context.');
        }
        return this.context;
    }

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

        page.on('popup', async (popup) => {
            try {
                const url = popup.url();
                await popup.close().catch(() => { });
                if (url && url !== 'about:blank') {
                    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => { });
                }
            } catch {
            }
        });

        return id;
    }

    private async ensureHeadlessPage(): Promise<Page> {
        if (this.headlessPage && !this.headlessPage.isClosed()) return this.headlessPage;

        if (this.headlessInitializationPromise) {
            await this.headlessInitializationPromise;
            if (this.headlessPage && !this.headlessPage.isClosed()) return this.headlessPage;
            this.headlessInitializationPromise = null;
            return this.ensureHeadlessPage();
        }

        this.headlessInitializationPromise = (async () => {
            try {
                if (!this.headlessContext) {
                    console.log('[BrowserManager] Launching persistent headless context with stealth...');
                    const userDataDirHeadless = path.join(app.getPath('userData'), 'playwright_data_headless');

                    if (!fs.existsSync(userDataDirHeadless)) {
                        fs.mkdirSync(userDataDirHeadless, { recursive: true });
                    }

                    const launchArgs = [
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-infobars',
                        '--ignore-certificate-errors',
                        '--disable-accelerated-2d-canvas',
                        '--disable-gpu',
                        '--disable-dev-shm-usage',
                        '--window-size=1920,1080',
                        '--disable-software-rasterizer',
                        '--headless=new'
                    ];

                    const contextOptions = {
                        headless: true,
                        args: launchArgs,
                        viewport: { width: 1920, height: 1080 },
                        locale: 'en-US',
                        timezoneId: 'America/New_York',
                        userAgent: MODERN_CHROME_UA,
                        colorScheme: 'dark',
                        deviceScaleFactor: 2,
                        hasTouch: false,
                        isMobile: false
                    };

                    this.clearChromeLock(userDataDirHeadless);
                    this.headlessContext = await stealthChromium.launchPersistentContext(userDataDirHeadless, contextOptions);

                    await this.headlessContext!.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', {
                            get: () => undefined,
                        });
                        Object.defineProperty(navigator, 'languages', {
                            get: () => ['en-US', 'en'],
                        });
                        Object.defineProperty(navigator, 'hardwareConcurrency', {
                            get: () => 8,
                        });
                        Object.defineProperty(navigator, 'deviceMemory', {
                            get: () => 8,
                        });
                    });

                    const pages = this.headlessContext!.pages();
                    if (pages.length > 0) {
                        this.headlessPage = pages[0];
                    }
                }

                if (!this.headlessPage || this.headlessPage.isClosed()) {
                    this.headlessPage = await this.headlessContext!.newPage();
                }
            } catch (error) {
                console.error('[BrowserManager] Failed to launch headless browser:', error);
                this.headlessInitializationPromise = null;
                throw error;
            }
        })();

        await this.headlessInitializationPromise;
        if (!this.headlessContext) {
            this.headlessInitializationPromise = null;
            return this.ensureHeadlessPage();
        }
        return this.headlessPage!;
    }

    async getPage(args: any): Promise<Page> {
        this.resetIdleTimer();

        // Handle headless mode execution request for background tools
        if (args && args._headless) {
            const page = await this.ensureHeadlessPage();
            if (!page || page.isClosed()) {
                throw new Error('[BrowserManager] Failed to obtain valid headless page');
            }
            return page;
        }

        await this.ensureBrowser();

        if (!this.context) {
            throw new Error('[BrowserManager] Browser context is null after initialization. This is a critical state error.');
        }

        if (args && args.tabId !== undefined) {
            const target = this.pagesMap.get(args.tabId);
            if (target) {
                this.page = target;
                return target;
            }
        }

        if (!this.page || this.page.isClosed()) {
            if (!this.context) {
                throw new Error('[BrowserManager] Cannot get page: Context is null after ensureBrowser.');
            }
            const pages = this.context.pages().filter(p => !p.isClosed());
            if (pages.length > 0) {
                this.page = pages[pages.length - 1];
            } else {
                this.page = await this.context.newPage();
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
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        // Reset promises to ensure subsequent calls don't await stale ones
        this.initializationPromise = null;
        this.headlessInitializationPromise = null;

        if (this.context) {
            await this.context.close().catch(e => console.error('[BrowserManager] Error closing context:', e));
            this.context = null;
            this.page = null;
            this.pagesMap.clear();
        }
        if (this.headlessBrowser) {
            await this.headlessBrowser.close().catch(e => console.error('[BrowserManager] Error closing headless browser:', e));
            this.headlessBrowser = null;
            this.headlessContext = null;
            this.headlessPage = null;
        }
        if (this.headlessContext) {
            await this.headlessContext.close().catch(e => console.error('[BrowserManager] Error closing headless context:', e));
            this.headlessContext = null;
            this.headlessPage = null;
        }
    }
}
