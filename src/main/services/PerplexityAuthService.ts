/**
 * PerplexityAuthService — Handles session token linking for Perplexity AI.
 * 
 * Uses a BrowserWindow to display the Perplexity login page and captures
 * the `__Secure-next-auth.session-token` cookie directly.
 * 
 * Flow:
 *   1. User clicks "Link Perplexity" → opens BrowserWindow to perplexity.ai/login
 *   2. User logs in (via email, Google, etc.)
 *   3. Service monitors cookies for the session token.
 *   4. Once captured, the token is stored in safeStorage (via secure IPC)
 *   5. Token is available for use via the unlock-perplexity library
 */

import { BrowserWindow } from 'electron'
import { PerplexityApp } from 'unlock-perplexity'

export interface PerplexityAuthState {
    signedIn: boolean
    hasToken: boolean
}

export class PerplexityAuthService {
    private state: PerplexityAuthState = {
        signedIn: false,
        hasToken: false,
    }

    private token: string | null = null
    // The unlock-perplexity app instance
    private appInstance: typeof PerplexityApp | null = null

    private secureGet: (key: string) => Promise<{ value: string | null }>
    private secureSet: (key: string, value: string) => Promise<void>
    private secureDelete: (key: string) => Promise<void>

    constructor(deps: {
        secureGet: (key: string) => Promise<{ value: string | null }>
        secureSet: (key: string, value: string) => Promise<void>
        secureDelete: (key: string) => Promise<void>
    }) {
        this.secureGet = deps.secureGet
        this.secureSet = deps.secureSet
        this.secureDelete = deps.secureDelete
    }

    async initialize(): Promise<void> {
        try {
            const tokenResult = await this.secureGet('perplexity_session_token')
            if (tokenResult.value) {
                this.token = tokenResult.value
                this.state.signedIn = true
                this.state.hasToken = true
                this.appInstance = new PerplexityApp(this.token, { silent: true })
                console.log(`[Perplexity] Restored session`)
            }
        } catch (err) {
            console.error('[Perplexity] Failed to restore session:', err)
        }
    }

    async signIn(): Promise<PerplexityAuthState> {
        return new Promise((resolve, reject) => {
            const win = new BrowserWindow({
                width: 1000,
                height: 800,
                show: true,
                webPreferences: {
                    contextIsolation: true,   // REQUIRED
                    nodeIntegration: false,   // REQUIRED
                    sandbox: true,            // PREFERRED
                },
                alwaysOnTop: true
            })

            // Clean up navigation / remove standard menu
            win.setMenuBarVisibility(false)

            const checkCookie = async () => {
                if (win.isDestroyed()) return

                try {
                    const cookies = await win.webContents.session.cookies.get({
                        url: 'https://www.perplexity.ai'
                    })

                    const sessionCookie = cookies.find(c => c.name === '__Secure-next-auth.session-token')

                    if (sessionCookie && sessionCookie.value) {
                        this.token = sessionCookie.value

                        // Persist the token
                        await this.secureSet('perplexity_session_token', this.token)

                        this.state.signedIn = true
                        this.state.hasToken = true
                        this.appInstance = new PerplexityApp(this.token, { silent: true })

                        console.log('[Perplexity] Sign-in successful')
                        win.close()
                        resolve(this.getStatus())
                    }
                } catch (error) {
                    // Ignore errors during check
                }
            }

            // We poll every 2 seconds
            const interval = setInterval(checkCookie, 2000)

            win.on('closed', () => {
                clearInterval(interval)
                // If closed without signing in
                if (!this.state.signedIn) {
                    reject(new Error('Perplexity sign in was cancelled or closed.'))
                }
            })

            // Load the perplexity login URL
            win.loadURL('https://www.perplexity.ai/login').catch(err => {
                clearInterval(interval)
                win.close()
                reject(err)
            })
        })
    }

    async signOut(): Promise<void> {
        this.state = {
            signedIn: false,
            hasToken: false,
        }
        this.token = null
        if (this.appInstance) {
            this.appInstance.logout(false)
            this.appInstance = null
        }
        await this.secureDelete('perplexity_session_token')
        console.log('[Perplexity] Signed out')
    }

    getStatus(): PerplexityAuthState {
        return {
            signedIn: this.state.signedIn,
            hasToken: this.state.hasToken,
        }
    }

    /** 
     * Direct query interface leveraging the unlock-perplexity lib 
     * Exposes ask functionality for main process consumption.
     */
    async ask(prompt: string, opts?: any): Promise<any> {
        if (!this.appInstance) {
            throw new Error('Not signed in to Perplexity')
        }
        return await this.appInstance.ask(prompt, null, opts)
    }
}
