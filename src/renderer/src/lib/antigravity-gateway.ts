/**
 * Antigravity Gateway — request/response helpers for Google's Antigravity IDE gateway.
 *
 * The Antigravity gateway (`cloudcode-pa.googleapis.com`) proxies Gemini API requests
 * with higher rate limits via the Cloud Code Assist API. It requires:
 *   1. A different endpoint URL (`/v1internal:<action>`)
 *   2. Bearer auth (OAuth token from AntigravityAuthService)
 *   3. Requests wrapped in an envelope with mandatory metadata:
 *      `{ project, model, request, requestType: 'agent', userAgent: 'antigravity' }`
 *   4. Clean tool schemas (no `$schema`, `title` meta-properties)
 *
 * This module is consumed by llm.ts and isolates all gateway-specific logic.
 */

// ── Gateway Endpoints ────────────────────────────────────────────────────────

/** Antigravity gateway endpoints in priority order. */
export const GATEWAY_ENDPOINTS = {
    daily: 'https://daily-cloudcode-pa.sandbox.googleapis.com',
    autopush: 'https://autopush-cloudcode-pa.sandbox.googleapis.com',
    prod: 'https://cloudcode-pa.googleapis.com',
} as const

/** Models verified to work via the Antigravity gateway. */
export const SUPPORTED_GATEWAY_MODELS = [
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash-lite-preview-02-05',
    'gemini-2.0-pro-exp-02-05',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-3-pro-low',
    'gemini-3-pro-high',
    'gemini-3-flash',
] as const

/** Default project ID when the gateway doesn't return one (personal accounts). */
const DEFAULT_PROJECT_ID = 'rising-fact-p41fc'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AntigravityCredentials {
    oauthToken: string
    oauthHeaders: Record<string, string> | null
    projectId: string | null
}

export interface GatewayRequest {
    url: string
    headers: Record<string, string>
    body: string
}

// ── Schema Sanitisation ──────────────────────────────────────────────────────

/**
 * Recursively strips JSON Schema meta-properties (`$schema`, `title`) that the
 * Antigravity gateway rejects as unknown fields.  MCP tool definitions often
 * include these, but the gateway is stricter than the public Gemini API.
 */
export function sanitizeToolSchema(obj: unknown): unknown {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(sanitizeToolSchema)

    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (key === '$schema' || key === 'title') continue
        cleaned[key] = sanitizeToolSchema(value)
    }
    return cleaned
}

// ── Request Envelope ─────────────────────────────────────────────────────────

/**
 * Generate a unique request ID for the gateway envelope.
 * Matches the library's format: `agent-<uuid>`
 */
function generateRequestId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    return `agent-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Build a gateway-ready request (URL, headers, body) from a standard Gemini
 * payload.  The payload is wrapped in the Antigravity envelope format:
 *
 * ```json
 * {
 *   "project": "<id>",
 *   "model": "<model>",
 *   "request": { <geminiPayload> },
 *   "requestType": "agent",
 *   "userAgent": "antigravity",
 *   "requestId": "agent-<uuid>"
 * }
 * ```
 *
 * The `requestType`, `userAgent`, and `requestId` fields are required by the
 * gateway for authorization — without them the API returns 403
 * `IAM_PERMISSION_DENIED` on `cloudaicompanion.companions.generateChat`.
 *
 * @param action  Gemini API action, e.g. `"generateContent"` or `"streamGenerateContent"`
 */
export function buildGatewayRequest(
    credentials: AntigravityCredentials,
    model: string,
    geminiPayload: Record<string, unknown>,
    action = 'generateContent',
): GatewayRequest {
    const endpoint = GATEWAY_ENDPOINTS.daily

    return {
        url: `${endpoint}/v1internal:${action}`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${credentials.oauthToken}`,
            ...(credentials.oauthHeaders || {}),
        },
        body: JSON.stringify({
            project: credentials.projectId || DEFAULT_PROJECT_ID,
            model,
            request: geminiPayload,
            // These fields are mandatory for the Antigravity gateway authorization.
            // Without them, the gateway returns 403 PERMISSION_DENIED.
            requestType: 'agent',
            userAgent: 'antigravity',
            requestId: generateRequestId(),
        }),
    }
}

// ── Response Unwrapping ──────────────────────────────────────────────────────

/**
 * The Antigravity gateway may wrap the Gemini response in an envelope:
 * `{ response: { candidates: [...] } }`.  This function transparently
 * unwraps it so callers always see the standard Gemini response shape.
 */
export function unwrapGatewayResponse(data: Record<string, unknown>): Record<string, unknown> {
    if (data.response && !data.candidates) {
        return data.response as Record<string, unknown>
    }
    return data
}

// ── Credential Fetching ──────────────────────────────────────────────────────

/**
 * Fetch Antigravity credentials (OAuth token + project ID) from the main
 * process via IPC.  Returns `null` if not signed in or unavailable.
 */
export async function getAntigravityCredentials(): Promise<AntigravityCredentials | null> {
    try {
        const electron = (await import('./electron')).default
        if (!electron.antigravity) return null

        const tokenResult = await electron.antigravity.getToken()
        if (!tokenResult?.token) return null

        const status = await electron.antigravity.getStatus()

        return {
            oauthToken: tokenResult.token,
            oauthHeaders: tokenResult.headers || null,
            projectId: status?.projectId || null,
        }
    } catch {
        return null
    }
}

/**
 * Check whether Antigravity OAuth is currently signed in (without fetching a
 * token — useful for UI status checks).
 */
export async function isAntigravityAvailable(): Promise<boolean> {
    try {
        const electron = (await import('./electron')).default
        if (!electron.antigravity) return false
        const status = await electron.antigravity.getStatus()
        return status?.signedIn ?? false
    } catch {
        return false
    }
}
