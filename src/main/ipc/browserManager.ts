import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { chromium, firefox, webkit } from 'playwright'

const execAsync = promisify(exec)

export type PlaywrightBrowserType = 'chrome' | 'msedge' | 'firefox' | 'webkit' | 'chromium'

interface BrowserStatus {
    browser: PlaywrightBrowserType
    installed: boolean
    version?: string
    error?: string
}

// Check if a browser is installed via Playwright
async function checkBrowserStatus(browser: PlaywrightBrowserType): Promise<BrowserStatus> {
    try {
        let executablePath: string | undefined

        switch (browser) {
            case 'chromium':
                executablePath = chromium.executablePath()
                break
            case 'firefox':
                executablePath = firefox.executablePath()
                break
            case 'webkit':
                executablePath = webkit.executablePath()
                break
            case 'chrome':
                // Chrome uses system installation via channel
                try {
                    // Try to launch with chrome channel to verify
                    const testContext = await chromium.launchPersistentContext('', {
                        channel: 'chrome',
                        headless: true,
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    })
                    await testContext.close()
                    return { browser, installed: true, version: 'system' }
                } catch {
                    return { browser, installed: false }
                }
            case 'msedge':
                // Edge uses system installation via channel
                try {
                    const testContext = await chromium.launchPersistentContext('', {
                        channel: 'msedge',
                        headless: true,
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    })
                    await testContext.close()
                    return { browser, installed: true, version: 'system' }
                } catch {
                    return { browser, installed: false }
                }
            default:
                return { browser, installed: false, error: 'Unknown browser type' }
        }

        // For bundled browsers (chromium, firefox, webkit), check if executable exists
        if (executablePath) {
            const fs = await import('fs')
            if (fs.existsSync(executablePath)) {
                return { browser, installed: true, version: 'bundled' }
            } else {
                return { browser, installed: false }
            }
        }

        return { browser, installed: false }
    } catch (error) {
        return {
            browser,
            installed: false,
            error: error instanceof Error ? error.message : String(error)
        }
    }
}

// Check status of all browsers
async function checkAllBrowserStatuses(): Promise<BrowserStatus[]> {
    const browsers: PlaywrightBrowserType[] = ['chrome', 'msedge', 'firefox', 'webkit', 'chromium']
    const results = await Promise.all(
        browsers.map(browser => checkBrowserStatus(browser))
    )
    return results
}

// Install a browser via npx playwright install
async function installBrowser(browser: PlaywrightBrowserType): Promise<{ success: boolean; output: string; error?: string }> {
    try {
        let installCommand: string

        switch (browser) {
            case 'firefox':
                installCommand = 'npx playwright install firefox'
                break
            case 'webkit':
                installCommand = 'npx playwright install webkit'
                break
            case 'chromium':
                installCommand = 'npx playwright install chromium'
                break
            case 'chrome':
                installCommand = 'npx playwright install chrome'
                break
            case 'msedge':
                installCommand = 'npx playwright install msedge'
                break
            default:
                return { success: false, output: '', error: 'Unknown browser type' }
        }

        console.log(`[BrowserManager] Installing ${browser}...`)
        const { stdout, stderr } = await execAsync(installCommand, {
            timeout: 300000, // 5 minute timeout
            maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        })

        const output = stdout + (stderr ? `\n${stderr}` : '')
        console.log(`[BrowserManager] Install output:`, output)

        // Verify installation
        const status = await checkBrowserStatus(browser)
        if (status.installed) {
            return { success: true, output }
        } else {
            return { success: false, output, error: 'Installation verification failed' }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`[BrowserManager] Install failed:`, errorMessage)
        return {
            success: false,
            output: '',
            error: errorMessage
        }
    }
}

// Register IPC handlers
export function registerBrowserManagerHandlers(): void {
    // Check if a specific browser is installed
    ipcMain.handle('browser:check-status', async (_event, browser: PlaywrightBrowserType) => {
        console.log(`[BrowserManager] Checking status for ${browser}`)
        return await checkBrowserStatus(browser)
    })

    // Check status of all browsers
    ipcMain.handle('browser:check-all-statuses', async () => {
        console.log('[BrowserManager] Checking all browser statuses')
        return await checkAllBrowserStatuses()
    })

    // Install a browser
    ipcMain.handle('browser:install', async (_event, browser: PlaywrightBrowserType) => {
        console.log(`[BrowserManager] Installing ${browser}`)
        return await installBrowser(browser)
    })

    // Get installation command for a browser (for manual install)
    ipcMain.handle('browser:get-install-command', (_event, browser: PlaywrightBrowserType) => {
        switch (browser) {
            case 'firefox':
                return { command: 'npx playwright install firefox' }
            case 'webkit':
                return { command: 'npx playwright install webkit' }
            case 'chromium':
                return { command: 'npx playwright install chromium' }
            case 'chrome':
            case 'msedge':
                return { command: 'npx playwright install-deps' }
            default:
                return { command: 'npx playwright install' }
        }
    })
}
