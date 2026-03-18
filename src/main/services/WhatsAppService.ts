/**
 * WhatsAppService.ts — Main-process WhatsApp service using Baileys.
 *
 * Runs entirely in the Node.js main process. Exposes methods that the
 * IPC handler thin-routes to from the renderer via the preload bridge.
 *
 * Auth state is persisted in the user-data directory under
 * `whatsapp-auth/` so the user does not need to re-scan the QR code
 * on every app launch.
 */

import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { WASocket } from '@whiskeysockets/baileys'
import { formatWhatsAppJid } from '../utils/whatsapp'

// Types we expose over IPC — mirrored in the renderer's whatsappStore.ts
export interface WhatsAppConnectionState {
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    qrCode: string | null
    error: string | null
    phoneNumber: string | null
}

export interface WhatsAppMessage {
    id: string
    from: string
    to: string
    content: string
    timestamp: number
    type: 'text' | 'image' | 'video' | 'document' | 'audio'
    isFromMe: boolean
    mediaUrl?: string
    caption?: string
}

export class WhatsAppService extends EventEmitter {
    private connectionState: WhatsAppConnectionState = {
        status: 'disconnected',
        qrCode: null,
        error: null,
        phoneNumber: null,
    }

    private socket: WASocket | null = null
    private authDir: string
    private lastMessageTime = 0
    private readonly MESSAGE_RATE_LIMIT_MS = 1000 // 1 message per second

    constructor() {
        super()
        this.authDir = path.join(app.getPath('userData'), 'whatsapp-auth')
    }

    // ── Public API ──────────────────────────────────────────────────────────

    async init(): Promise<void> {
        try {
            const credsFile = path.join(this.authDir, 'creds.json')
            const phoneFile = path.join(this.authDir, 'phone.txt')
            
            // Just log that we found credentials - don't auto-connect
            // Let user explicitly connect to handle any credential issues
            if (fs.existsSync(credsFile)) {
                let savedPhone = ''
                if (fs.existsSync(phoneFile)) {
                    savedPhone = fs.readFileSync(phoneFile, 'utf8').trim()
                }
                console.log('[WhatsAppService] Found existing auth credentials. User can connect when ready.')
                
                // Set the saved phone number in state but don't connect
                if (savedPhone) {
                    this._setState({
                        status: 'disconnected',
                        qrCode: null,
                        error: null,
                        phoneNumber: savedPhone,
                    })
                }
            }
        } catch (error) {
            console.error('[WhatsAppService] Init error:', error)
        }
    }

    getConnectionState(): WhatsAppConnectionState {
        return { ...this.connectionState }
    }

    async connect(targetPhoneNumber: string): Promise<void> {
        if (this.connectionState.status === 'connected') return
        if (this.connectionState.status === 'connecting') return

        this._setState({
            status: 'connecting',
            qrCode: null,
            error: null,
            phoneNumber: targetPhoneNumber,
        })

        // Don't clear auth here - it breaks the QR scan flow!
        // Auth is only cleared on explicit disconnect or Stream Error
        
        try {
            // Dynamically import Baileys to avoid bundling issues
            const {
                default: makeWASocket,
                useMultiFileAuthState,
                DisconnectReason,
                fetchLatestBaileysVersion,
            } = await import('@whiskeysockets/baileys')

            // Ensure auth directory exists
            fs.mkdirSync(this.authDir, { recursive: true })
            
            if (targetPhoneNumber) {
                fs.writeFileSync(path.join(this.authDir, 'phone.txt'), targetPhoneNumber)
            }

            // eslint-disable-next-line react-hooks/rules-of-hooks
            const { state, saveCreds } = await useMultiFileAuthState(this.authDir)

            const { version } = await fetchLatestBaileysVersion()

            const silentLogger = {
                level: 'silent' as const,
                trace: () => {},
                debug: () => {},
                info: () => {},
                warn: (obj: unknown, msg?: string) => console.warn('[Baileys]', msg, obj),
                error: (obj: unknown, msg?: string) => console.error('[Baileys]', msg, obj),
                fatal: (obj: unknown, msg?: string) => console.error('[Baileys FATAL]', msg, obj),
                child: () => silentLogger,
            }

            // Use default Baileys WebSocket with proper configuration
            const sock = makeWASocket({
                version,
                auth: state,
                logger: silentLogger,
                printQRInTerminal: false,
                // Browser identification - helps with WhatsApp server stability
                browser: ['AI-Worker', 'Chrome', '120.0.0'],
                // Connection options for better stability
                connectTimeoutMs: 60000,
            })

            this.socket = sock

            // QR code and connection state events
            // Use 'any' because Baileys exposes a complex union type that doesn't
            // match our simplified typed update object cleanly.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sock.ev.on('connection.update', (update: any) => {
                const { connection, lastDisconnect, qr } = update as {
                    connection?: string
                    lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string }; reason?: string }
                    qr?: string
                }

                console.log('[WhatsAppService] Connection update:', { connection, qr: !!qr, lastDisconnect })

                if (qr) {
                    this._setState({ ...this.connectionState, status: 'connecting', qrCode: qr })
                }

                if (connection === 'open') {
                    console.log('[WhatsAppService] Connection opened successfully!')
                    this._setState({
                        status: 'connected',
                        qrCode: null,
                        error: null,
                        phoneNumber: targetPhoneNumber,
                    })
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode
                    const errorMessage = lastDisconnect?.error?.message || lastDisconnect?.reason || 'Unknown reason'
                    const loggedOutCode = DisconnectReason.loggedOut
                    
                    console.log('[WhatsAppService] Connection closed:', { statusCode, errorMessage, loggedOutCode })
                    
                    // Check for Stream Error - need to clear auth and retry
                    const isStreamError = errorMessage?.toLowerCase().includes('stream errored') || 
                        errorMessage?.toLowerCase().includes('restart required')
                    
                    // Check if this is a network-related disconnection (not user-initiated)
                    const isNetworkError = statusCode === undefined || 
                        statusCode === 428 || // Server unreachable
                        statusCode === 503 || // Service unavailable  
                        statusCode === 504  // Gateway timeout

                    if (statusCode !== loggedOutCode) {
                        // Handle Stream Error - don't clear auth, just show QR again
                        if (isStreamError) {
                            console.log('[WhatsAppService] Stream error detected, showing QR for re-auth...')
                            this._setState({
                                status: 'disconnected',
                                qrCode: null,
                                error: null,
                                phoneNumber: targetPhoneNumber,
                            })
                            // Don't clear auth - just let user scan QR again with same credentials
                            return
                        }
                        
                        if (isNetworkError && targetPhoneNumber) {
                            // Network issue - try to auto-reconnect after a delay
                            this._setState({
                                status: 'connecting',
                                qrCode: null,
                                error: null,
                                phoneNumber: targetPhoneNumber,
                            })
                            console.log('[WhatsAppService] Network disconnected, attempting auto-reconnect in 5s...')
                            setTimeout(() => {
                                if (this.connectionState.status === 'connecting') {
                                    this.connect(targetPhoneNumber).catch(e => {
                                        console.error('[WhatsAppService] Auto-reconnect failed:', e)
                                        this._setState({
                                            status: 'error',
                                            qrCode: null,
                                            error: 'Failed to reconnect. Please try again.',
                                            phoneNumber: targetPhoneNumber,
                                        })
                                    })
                                }
                            }, 5000)
                        } else {
                            // Provide more specific error message
                            let specificError = 'Connection closed unexpectedly. Please reconnect.'
                            if (errorMessage) {
                                specificError = `Connection failed: ${errorMessage}`
                            } else if (statusCode) {
                                specificError = `Connection failed with status code: ${statusCode}`
                            }
                            
                            console.error('[WhatsAppService] Connection error:', specificError)
                            this._setState({
                                status: 'error',
                                qrCode: null,
                                error: specificError,
                                phoneNumber: targetPhoneNumber,
                            })
                        }
                    } else {
                        // Logged out — clear auth so next connect shows a fresh QR
                        this._clearAuth()
                        this._setState({
                            status: 'disconnected',
                            qrCode: null,
                            error: null,
                            phoneNumber: null,
                        })
                    }
                    this.socket = null
                }
            })

            // Persist credentials on update
            sock.ev.on('creds.update', saveCreds)

            // Incoming messages
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sock.ev.on('messages.upsert', ({ messages, type }: { messages: any[]; type: string }) => {
                if (type !== 'notify') return
                for (const raw of messages) {
                    const msg = this._parseMessage(raw)
                    if (msg) {
                        // Auto-mark as read if it's from someone else
                        if (!msg.isFromMe && raw.key) {
                            try {
                                sock.readMessages([raw.key]).catch(e => console.error('[Baileys] auto-read error:', e))
                            } catch {
                                // ignore
                            }
                        }
                        this.emit('message', msg)
                    }
                }
            })
        } catch (error) {
            this._setState({
                status: 'error',
                qrCode: null,
                error: error instanceof Error ? error.message : String(error),
                phoneNumber: targetPhoneNumber,
            })
            throw error
        }
    }

    async disconnect(clearAuth = true): Promise<void> {
        console.log(`[WhatsAppService] Disconnecting (clearAuth=${clearAuth})...`)
        
        if (this.socket) {
            try {
                if (clearAuth) {
                    await this.socket.logout()
                    console.log('[WhatsAppService] Logged out from WhatsApp')
                } else {
                    await (this.socket as any).end(undefined) // Baileys end session
                    console.log('[WhatsAppService] Session ended (not logged out)')
                }
            } catch (err) {
                console.warn('[WhatsAppService] Disconnect warning:', err)
            }
            this.socket = null
        }
        
        if (clearAuth) {
            // Clear all auth data - this ensures a fresh QR scan on next connect
            this._clearAuth()
            
            // Reset internal state completely
            this._setState({
                status: 'disconnected',
                qrCode: null,
                error: null,
                phoneNumber: null,
            })
            console.log('[WhatsAppService] Disconnect complete - auth cleared')
        } else {
            this._setState({
                ...this.connectionState,
                status: 'disconnected',
                qrCode: null,
            })
            console.log('[WhatsAppService] Disconnect complete - auth preserved')
        }
    }

    async sendMessage(to: string, content: string): Promise<{ success: boolean; error?: string }> {
        if (!this.socket || this.connectionState.status !== 'connected') {
            return { success: false, error: 'WhatsApp not connected' }
        }

        // Rate limiting
        const now = Date.now()
        if (now - this.lastMessageTime < this.MESSAGE_RATE_LIMIT_MS) {
            return { success: false, error: 'Rate limit exceeded. Please wait a moment.' }
        }
        this.lastMessageTime = now

        try {
            // Validate and format JID
            const jid = formatWhatsAppJid(to)
            if (!jid) {
                return { success: false, error: 'Invalid phone number format' }
            }
            
            await this.socket.sendMessage(jid, { text: content })
            return { success: true }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    }

    async sendPresence(to: string, state: 'unavailable' | 'available' | 'composing' | 'recording' | 'paused'): Promise<{ success: boolean; error?: string }> {
        if (!this.socket || this.connectionState.status !== 'connected') {
             return { success: false, error: 'WhatsApp not connected' }
        }
        try {
            const jid = formatWhatsAppJid(to)
            if (!jid) {
                return { success: false, error: 'Invalid phone number format' }
            }
            await this.socket.sendPresenceUpdate(state, jid)
            return { success: true }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    private _setState(state: WhatsAppConnectionState): void {
        this.connectionState = state
        this.emit('connectionChange', state)
    }

    private _clearAuth(): void {
        try {
            if (fs.existsSync(this.authDir)) {
                console.log('[WhatsAppService] Clearing auth directory:', this.authDir)
                fs.rmSync(this.authDir, { recursive: true, force: true })
                console.log('[WhatsAppService] Auth directory cleared')
            } else {
                console.log('[WhatsAppService] No auth directory to clear')
            }
        } catch (err) {
            console.error('[WhatsAppService] Error clearing auth:', err)
        }
        
        // Also ensure the parent directory exists for next connect
        try {
            fs.mkdirSync(this.authDir, { recursive: true })
        } catch {
            // ignore - will be created on next connect
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _parseMessage(raw: any): WhatsAppMessage | null {
        try {
            if (!raw?.key || !raw?.message) return null

            // Extract text content from various message types
            const msg = raw.message
            const textContent: string | null =
                msg.conversation ||
                msg.extendedTextMessage?.text ||
                msg.imageMessage?.caption ||
                msg.videoMessage?.caption ||
                msg.documentMessage?.caption ||
                null

            if (!textContent) return null

            const type: WhatsAppMessage['type'] = msg.imageMessage
                ? 'image'
                : msg.videoMessage
                    ? 'video'
                    : msg.documentMessage
                        ? 'document'
                        : msg.audioMessage
                            ? 'audio'
                            : 'text'

            return {
                id: raw.key.id ?? `wa_${Date.now()}`,
                from: raw.key.remoteJid ?? '',
                to: raw.key.fromMe ? raw.key.remoteJid ?? '' : 'me',
                content: textContent,
                timestamp: (raw.messageTimestamp as number) * 1000 || Date.now(),
                type,
                isFromMe: raw.key.fromMe ?? false,
            }
        } catch {
            return null
        }
    }
}

// Singleton instance — created once in main process
export const whatsappService = new WhatsAppService()
