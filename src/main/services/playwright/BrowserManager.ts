/**
 * BrowserManager.ts — Low-level browser lifecycle engine for the Playwright Service.
 *
 * Capabilities:
 *   1. Context Persistence: Manages Chromium's 'launchPersistentContext' for session storage.
 *   2. Stealth Tactics: Injected init scripts to bypass bot detection.
 *   3. Ad-Blocking: Intercepts network routes to prevent heavy resource loads.
 *   4. Tab Tracker: Maintains an ID-to-Page map.
 *   5. Popup Isolation: Forces '_blank' links to open in the current tab.
 *   6. OS-Smart Fallback: Platform-specific browser selection loop.
 *
 * Consumed by: PlaywrightService (PlaywrightService.ts)
 */

import { addExtra } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { BrowserContext, Page, Browser } from 'playwright-core';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import Store from 'electron-store';

// Modern User Agent to avoid detection on sites like LinkedIn/Google
const MODERN_CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// playwright-core is required at runtime to avoid bundler inlining its internals
// eslint-disable-next-line @typescript-eslint/no-require-imports
const playwrightCore = require('playwright-core') as typeof import('playwright-core');
const stealthChromium: ReturnType<typeof addExtra> = addExtra(playwrightCore.chromium as never);
stealthChromium.use(stealth());

/**
 * Configuration schema for the Playwright browser settings.
 */
export interface PlaywrightSettings {
    browser?: 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'msedge';
    headless?: boolean;
    blockAds?: boolean;
}

/**
 * Manages the underlying Playwright browser, its context, and tab state.
 */
export class BrowserManager {
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private pagesMap = new Map<number, Page>();
    private nextTabId = 1;
    private store: Store<Record<string, unknown>>;
    private initializationPromise: Promise<void> | null = null;

    private headlessBrowser: Browser | null = null;
    private headlessContext: BrowserContext | null = null;
    private headlessPage: Page | null = null;
    private headlessOverride: boolean | null = null;
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
            console.log(`[BrowserManager] Closing browser after ${this.IDLE_TIMEOUT_MS / 60000} minutes of inactivity.`);
            this.close().catch(e => console.error('[BrowserManager] Error during idle close:', e));
        }, this.IDLE_TIMEOUT_MS);
    }

    /**
     * Aggressively clears stale profile locks.
     */
    private clearChromeLock(userDataDir: string) {
        try {
            // Aggressive lock cleanup: SingletonLock, SingletonSocket, SingletonCookie, Default/LOCK
            const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'LOCK'];
            lockFiles.forEach(lockFile => {
                const lockPath = path.join(userDataDir, lockFile);
                const defaultLockPath = path.join(userDataDir, 'Default', lockFile);
                
                [lockPath, defaultLockPath].forEach(p => {
                    if (fs.existsSync(p)) {
                        try {
                            fs.unlinkSync(p);
                            console.log(`[BrowserManager] 🔓 Cleared stale lock at ${p}`);
                        } catch (err) {
                            try {
                                fs.rmSync(p, { force: true, recursive: true });
                                console.log(`[BrowserManager] 🔨 Force removed lock at ${p}`);
                            } catch (e) {}
                        }
                    }
                });
            });
        } catch (e) {
            console.warn(`[BrowserManager] Failed during aggressive lock cleanup:`, e);
        }
    }

    /**
     * Surfaces a headless session to the UI.
     */
    async surfaceBrowser(): Promise<void> {
        console.log('[BrowserManager] Surfacing browser for human intervention...');
        
        let currentUrl = this.page?.url();
        let useHeadlessData = false;

        if (this.headlessContext) {
            console.log('[BrowserManager] Promoting headless data...');
            currentUrl = this.headlessPage?.url() || currentUrl;
            useHeadlessData = true;
        }

        await this.close();
        this.headlessOverride = false;
        (this as any)._useHeadlessDirForHeaded = useHeadlessData;

        await this.ensureBrowser();

        if (currentUrl && currentUrl !== 'about:blank') {
            await this.page?.goto(currentUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }

        this.headlessOverride = null;
        (this as any)._useHeadlessDirForHeaded = false;
    }

    /**
     * Lazily initializes the browser.
     */
    async ensureBrowser(): Promise<BrowserContext> {
        if (this.context && !(this as any)._isContextClosed) return this.context;

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

                        // Mask automation markers
                        await this.context!.addInitScript(() => {
                            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                            if (!(window as any).chrome) {
                                (window as any).chrome = { runtime: {} };
                            }
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
                        console.warn(`[BrowserManager] Browser '${tryBrowser}' failed: ${lastError.message}.`);
                        this.context = null;
                    }
                }

                throw lastError || new Error('[BrowserManager] All attempts failed.');
            } catch (error) {
                console.error('[BrowserManager] Launch failed:', error);
                this.initializationPromise = null;
                throw error;
            } finally {
                this.initializationPromise = null;
            }
        })();

        await this.initializationPromise;
        if (!this.context) {
            throw new Error('[BrowserManager] Initialization produced no context.');
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
            } catch { }
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
                    console.log('[BrowserManager] Launching persistent headless context...');
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
                        colorScheme: 'dark' as const,
                        deviceScaleFactor: 2,
                        hasTouch: false,
                        isMobile: false
                    };

                    this.clearChromeLock(userDataDirHeadless);
                    this.headlessContext = await stealthChromium.launchPersistentContext(userDataDirHeadless, contextOptions);

                    const pages = this.headlessContext!.pages();
                    if (pages.length > 0) {
                        this.headlessPage = pages[0];
                    }
                }

                if (!this.headlessPage || this.headlessPage.isClosed()) {
                    this.headlessPage = await this.headlessContext!.newPage();
                }
            } catch (error) {
                console.error('[BrowserManager] Failed to launch headless:', error);
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

        if (args && args._headless) {
            const page = await this.ensureHeadlessPage();
            if (!page || page.isClosed()) {
                throw new Error('[BrowserManager] Failed to obtain headless page');
            }
            return page;
        }

        await this.ensureBrowser();

        if (!this.context) {
            throw new Error('[BrowserManager] Context is null.');
        }

        if (args && args.tabId !== undefined) {
            const target = this.pagesMap.get(args.tabId);
            if (target) {
                this.page = target;
                return target;
            }
        }

        if (!this.page || this.page.isClosed()) {
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

    private async closeWithTimeout(target: BrowserContext | Browser | null, name: string): Promise<void> {
        if (!target) return;
        
        const timeoutMs = 5000;
        try {
            await Promise.race([
                target.close(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
            ]);
            console.log(`[BrowserManager] Closed ${name}`);
        } catch (e: any) {
            if (e instanceof Error && e.message === 'TIMEOUT') {
                console.warn(`[BrowserManager] Abandoning stuck ${name}.`);
            } else {
                console.error(`[BrowserManager] Error closing ${name}:`, e);
            }
        }
    }

    async close() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        if (this.initializationPromise) {
            try { await this.initializationPromise; } catch { }
        }

        const closePromise = (async () => {
            try {
                if (this.context) {
                    await this.closeWithTimeout(this.context, 'main context');
                    this.context = null;
                    this.page = null;
                    this.pagesMap.clear();
                }
                if (this.headlessBrowser) {
                    await this.closeWithTimeout(this.headlessBrowser, 'headless browser');
                    this.headlessBrowser = null;
                    this.headlessContext = null;
                    this.headlessPage = null;
                }
                if (this.headlessContext) {
                    await this.closeWithTimeout(this.headlessContext, 'headless context');
                    this.headlessContext = null;
                    this.headlessPage = null;
                }
            } finally {
                this.initializationPromise = null;
                this.headlessInitializationPromise = null;
            }
        })();

        this.initializationPromise = closePromise;
        this.headlessInitializationPromise = closePromise;
        await closePromise;
    }
}
