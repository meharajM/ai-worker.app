/**
 * AntigravityAuthService — OAuth flow for Google's Antigravity IDE gateway.
 *
 * Replicates the OAuth approach from opencode-antigravity-auth (MIT-licensed)
 * to give users access to Gemini models via Antigravity's higher rate limits,
 * without requiring a manual API key.
 *
 * Flow:
 *   1. User clicks "Sign in with Google" → opens Google OAuth consent screen
 *   2. Google redirects to localhost:51121/oauth-callback with auth code
 *   3. Code is exchanged for access + refresh tokens at oauth2.googleapis.com
 *   4. Project ID is fetched from cloudcode-pa.googleapis.com
 *   5. Tokens are stored in safeStorage (via SecureStore IPC)
 *   6. callGemini() uses Bearer auth on the Antigravity gateway endpoint
 *
 * Consumed by: ipc/antigravity.ts
 */

import { shell } from 'electron'
import * as http from 'node:http'
import * as crypto from 'node:crypto'

// ── Constants (extracted from opencode-antigravity-auth, MIT-licensed) ────────

const ANTIGRAVITY_CLIENT_ID =
    '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
const ANTIGRAVITY_CLIENT_SECRET = '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'
const ANTIGRAVITY_REDIRECT_URI = 'http://localhost:51121/oauth-callback'
const ANTIGRAVITY_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
]

const CALLBACK_PORT = 51121
const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000

/** Antigravity gateway endpoints in fallback order (daily → autopush → prod). */
export const ANTIGRAVITY_ENDPOINTS = {
    daily: 'https://daily-cloudcode-pa.sandbox.googleapis.com',
    autopush: 'https://autopush-cloudcode-pa.sandbox.googleapis.com',
    prod: 'https://cloudcode-pa.googleapis.com',
} as const

/** Default project ID when Antigravity doesn't return one (business accounts). */
const DEFAULT_PROJECT_ID = 'rising-fact-p41fc'

const ANTIGRAVITY_VERSION = '1.18.3'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AntigravityAuthState {
    signedIn: boolean
    email: string | null
    projectId: string | null
    accessToken: string | null
    accessTokenExpiry: number | null
    refreshToken: string | null
}

interface TokenResponse {
    access_token: string
    expires_in: number
    refresh_token?: string
    token_type: string
}

interface UserInfo {
    email?: string
    name?: string
    picture?: string
}

// ── PKCE Helpers ─────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url')
}

// ── Service ──────────────────────────────────────────────────────────────────

export class AntigravityAuthService {
    private state: AntigravityAuthState = {
        signedIn: false,
        email: null,
        projectId: null,
        accessToken: null,
        accessTokenExpiry: null,
        refreshToken: null,
    }

    private callbackServer: http.Server | null = null

    // Injected store functions for persistent token storage
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

    /**
     * Restore tokens from persistent storage on app startup.
     */
    async initialize(): Promise<void> {
        try {
            const refreshResult = await this.secureGet('antigravity_refresh_token')
            const emailResult = await this.secureGet('antigravity_email')
            const projectResult = await this.secureGet('antigravity_project_id')

            if (refreshResult.value) {
                this.state.refreshToken = refreshResult.value
                this.state.email = emailResult.value || null
                this.state.projectId = projectResult.value || DEFAULT_PROJECT_ID
                this.state.signedIn = true
                console.log(`[Antigravity] Restored session for ${this.state.email || 'unknown'}`)
            }
        } catch (err) {
            console.error('[Antigravity] Failed to restore session:', err)
        }
    }

    /**
     * Start the full OAuth sign-in flow.
     * Opens a BrowserWindow to Google's consent screen, waits for the redirect callback.
     */
    async signIn(): Promise<AntigravityAuthState> {
        const verifier = generateCodeVerifier()
        const challenge = generateCodeChallenge(verifier)

        // Build Google OAuth URL
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', ANTIGRAVITY_CLIENT_ID)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('redirect_uri', ANTIGRAVITY_REDIRECT_URI)
        authUrl.searchParams.set('scope', ANTIGRAVITY_SCOPES.join(' '))
        authUrl.searchParams.set('code_challenge', challenge)
        authUrl.searchParams.set('code_challenge_method', 'S256')
        authUrl.searchParams.set('access_type', 'offline')
        authUrl.searchParams.set('prompt', 'consent')

        // Start local callback server FIRST (don't await — it resolves when callback arrives)
        const codePromise = this.waitForCallback()

        // Open the consent screen in the system browser
        shell.openExternal(authUrl.toString())

        // Now wait for the auth code from callback
        const authCode = await codePromise
        if (!authCode) {
            throw new Error('OAuth flow was cancelled or failed to receive auth code')
        }

        // Exchange code for tokens
        const tokens = await this.exchangeCode(authCode, verifier)

        // Get user info
        const userInfo = await this.fetchUserInfo(tokens.access_token)

        // Get project ID
        const projectId = await this.fetchProjectId(tokens.access_token)

        // Update state
        this.state = {
            signedIn: true,
            email: userInfo.email || null,
            projectId: projectId || DEFAULT_PROJECT_ID,
            accessToken: tokens.access_token,
            accessTokenExpiry: Date.now() + (tokens.expires_in * 1000),
            refreshToken: tokens.refresh_token || null,
        }

        // Persist tokens
        await this.persistTokens()

        console.log(`[Antigravity] Sign-in successful: ${this.state.email}, project: ${this.state.projectId}`)
        return this.getStatus()
    }

    /**
     * Sign out — clear tokens from memory and storage.
     */
    async signOut(): Promise<void> {
        this.state = {
            signedIn: false,
            email: null,
            projectId: null,
            accessToken: null,
            accessTokenExpiry: null,
            refreshToken: null,
        }

        await this.secureDelete('antigravity_refresh_token')
        await this.secureDelete('antigravity_email')
        await this.secureDelete('antigravity_project_id')
        console.log('[Antigravity] Signed out')
    }

    /**
     * Get a valid access token, refreshing if expired.
     * Returns null if not signed in.
     */
    async getToken(): Promise<string | null> {
        if (!this.state.signedIn || !this.state.refreshToken) {
            return null
        }

        // Check if current token is still valid (with 60s buffer)
        if (
            this.state.accessToken &&
            this.state.accessTokenExpiry &&
            this.state.accessTokenExpiry > Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS
        ) {
            return this.state.accessToken
        }

        // Refresh the token
        try {
            const tokens = await this.refreshAccessToken(this.state.refreshToken)
            this.state.accessToken = tokens.access_token
            this.state.accessTokenExpiry = Date.now() + (tokens.expires_in * 1000)

            // If a new refresh token was issued, persist it
            if (tokens.refresh_token) {
                this.state.refreshToken = tokens.refresh_token
                await this.secureSet('antigravity_refresh_token', tokens.refresh_token)
            }

            return this.state.accessToken
        } catch (err) {
            console.error('[Antigravity] Token refresh failed:', err)
            // If refresh fails, mark as signed out
            this.state.signedIn = false
            this.state.accessToken = null
            return null
        }
    }

    /**
     * Get the current auth status (safe to expose to renderer).
     */
    getStatus(): AntigravityAuthState {
        return {
            signedIn: this.state.signedIn,
            email: this.state.email,
            projectId: this.state.projectId,
            // Don't expose raw tokens to renderer — only whether signed in
            accessToken: null,
            accessTokenExpiry: null,
            refreshToken: null,
        }
    }

    /**
     * Get Antigravity-specific headers for API calls.
     * These mimic the Antigravity IDE client to route through the gateway.
     */
    getHeaders(): Record<string, string> {
        const platform = process.platform === 'win32' ? 'WINDOWS' : 'MACOS'
        return {
            'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${ANTIGRAVITY_VERSION} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`,
            'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
            'Client-Metadata': JSON.stringify({
                ideType: 'ANTIGRAVITY',
                platform,
                pluginType: 'GEMINI',
            }),
        }
    }

    /**
     * Proxy a request to the Antigravity gateway from the main process.
     * This is necessary because some headers (like User-Agent) are restricted
     * in the renderer's fetch() and are required by the gateway for auth.
     */
    async callGateway(url: string, headers: Record<string, string>, body: string): Promise<any> {
        const fullHeaders = {
            ...this.getHeaders(),
            ...headers,
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: fullHeaders,
                body: body,
            })

            const status = response.status
            const statusText = response.statusText
            let data: any = {}

            try {
                data = await response.json()
            } catch {
                const text = await response.text()
                data = { _rawText: text }
            }

            if (!response.ok) {
                console.error(`[Antigravity] Gateway call failed: ${status} ${statusText}`, data)
                throw new Error(`Antigravity gateway error (${status}): ${JSON.stringify(data)}`)
            }

            return data
        } catch (error) {
            console.error('[Antigravity] Proxy request failed:', error)
            throw error
        }
    }

    // ── Private Methods ──────────────────────────────────────────────────────

    /**
     * Start a temporary HTTP server to listen for the OAuth callback.
     * Returns a promise that resolves with the auth code.
     */
    private waitForCallback(): Promise<string | null> {
        return new Promise((resolve) => {
            // Clean up any existing server
            if (this.callbackServer) {
                this.callbackServer.close()
                this.callbackServer = null
            }

            const server = http.createServer((req, res) => {
                const url = new URL(req.url || '/', `http://localhost:${CALLBACK_PORT}`)

                if (url.pathname === '/oauth-callback') {
                    const code = url.searchParams.get('code')
                    const error = url.searchParams.get('error')

                    // Respond with success page
                    res.writeHead(200, { 'Content-Type': 'text/html' })
                    res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>AI-Worker - Authentication</title></head>
            <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f1115; color: white;">
              <div style="text-align: center;">
                <h1 style="color: #4fd1c5;">${error ? '❌ Authentication Failed' : '✅ Authentication Successful!'}</h1>
                <p>${error ? `Error: ${error}` : 'You can close this window and return to AI-Worker.'}</p>
              </div>
            </body>
            </html>
          `)

                    // Shutdown server after response
                    server.close()
                    this.callbackServer = null

                    if (error || !code) {
                        console.error(`[Antigravity] OAuth error: ${error || 'no code received'}`)
                        resolve(null)
                    } else {
                        resolve(code)
                    }
                } else {
                    res.writeHead(404)
                    res.end('Not Found')
                }
            })

            // Timeout: close server after 2 minutes if no response
            const timeout = setTimeout(() => {
                console.warn('[Antigravity] OAuth callback timeout')
                server.close()
                this.callbackServer = null
                resolve(null)
            }, 120_000)

            server.on('close', () => clearTimeout(timeout))

            server.listen(CALLBACK_PORT, () => {
                console.log(`[Antigravity] Callback server listening on port ${CALLBACK_PORT}`)
            })

            server.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`[Antigravity] Port ${CALLBACK_PORT} is in use. Trying alternative...`)
                }
                resolve(null)
            })

            this.callbackServer = server
        })
    }

    /**
     * Exchange authorization code for access + refresh tokens.
     */
    private async exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'Accept': '*/*',
            },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: ANTIGRAVITY_REDIRECT_URI,
                code_verifier: verifier,
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Token exchange failed: ${response.status} ${errorText}`)
        }

        return (await response.json()) as TokenResponse
    }

    /**
     * Refresh an expired access token using the refresh token.
     */
    private async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Token refresh failed: ${response.status} ${errorText}`)
        }

        return (await response.json()) as TokenResponse
    }

    /**
     * Fetch the authenticated user's email from Google's userinfo endpoint.
     */
    private async fetchUserInfo(accessToken: string): Promise<UserInfo> {
        try {
            const response = await fetch(
                'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
                { headers: { Authorization: `Bearer ${accessToken}` } }
            )
            if (response.ok) {
                return (await response.json()) as UserInfo
            }
        } catch (err) {
            console.warn('[Antigravity] Failed to fetch user info:', err)
        }
        return {}
    }

    /**
     * Fetch the Antigravity project ID via the Cloud Code Assist API.
     * Falls back to the default project ID if the endpoint is unreachable.
     */
    private async fetchProjectId(accessToken: string): Promise<string> {
        const platform = process.platform === 'win32' ? 'WINDOWS' : 'MACOS'
        const headers: Record<string, string> = {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': `google-api-nodejs-client/9.15.1`,
            'Client-Metadata': JSON.stringify({
                ideType: 'ANTIGRAVITY',
                platform,
                pluginType: 'GEMINI',
            }),
        }

        const endpoints = [
            ANTIGRAVITY_ENDPOINTS.prod,
            ANTIGRAVITY_ENDPOINTS.daily,
            ANTIGRAVITY_ENDPOINTS.autopush,
        ]

        for (const endpoint of endpoints) {
            try {
                const controller = new AbortController()
                const timeout = setTimeout(() => controller.abort(), 10_000)

                const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
                    method: 'POST',
                    headers,
                    signal: controller.signal,
                    body: JSON.stringify({
                        metadata: {
                            ideType: 'ANTIGRAVITY',
                            platform,
                            pluginType: 'GEMINI',
                        },
                    }),
                })

                clearTimeout(timeout)

                if (response.ok) {
                    const data = await response.json() as Record<string, unknown>
                    const project = data.cloudaicompanionProject
                    if (typeof project === 'string' && project) {
                        console.log(`[Antigravity] Project ID resolved: ${project}`)
                        return project
                    }
                    if (project && typeof (project as Record<string, unknown>).id === 'string') {
                        const id = (project as Record<string, string>).id
                        console.log(`[Antigravity] Project ID resolved: ${id}`)
                        return id
                    }
                }
            } catch {
                // Try next endpoint
            }
        }

        console.log(`[Antigravity] Using default project ID: ${DEFAULT_PROJECT_ID}`)
        return DEFAULT_PROJECT_ID
    }

    /**
     * Persist tokens to encrypted secure storage.
     */
    private async persistTokens(): Promise<void> {
        if (this.state.refreshToken) {
            await this.secureSet('antigravity_refresh_token', this.state.refreshToken)
        }
        if (this.state.email) {
            await this.secureSet('antigravity_email', this.state.email)
        }
        if (this.state.projectId) {
            await this.secureSet('antigravity_project_id', this.state.projectId)
        }
    }
}
