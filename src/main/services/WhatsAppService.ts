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
    isVerified: boolean
    /** Phone number from the device that scanned the QR (for verification) */
    connectedPhoneNumber: string | null
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
        isVerified: false,
        connectedPhoneNumber: null,
    }

    private socket: WASocket | null = null
    private authDir: string
    private lastMessageTime = 0
    private readonly MESSAGE_RATE_LIMIT_MS = 1000 // 1 message per second
    private isConnecting = false
    /** The verified personal number JID — only messages from this JID trigger the agent */
    private targetPhoneJid: string | null = null

    constructor() {
        super()
        this.authDir = path.join(app.getPath('userData'), 'whatsapp-auth')
    }

    // ── Public API ──────────────────────────────────────────────────────────

    async init(): Promise<void> {
        try {
            const credsFile = path.join(this.authDir, 'creds.json')
            const phoneFile = path.join(this.authDir, 'phone.txt')
            const workerPhoneFile = path.join(this.authDir, 'worker_phone.txt')
            
            if (fs.existsSync(credsFile)) {
                let savedPhone = ''
                if (fs.existsSync(phoneFile)) {
                    savedPhone = fs.readFileSync(phoneFile, 'utf8').trim()
                }
                let savedWorkerPhone: string | null = null
                if (fs.existsSync(workerPhoneFile)) {
                    savedWorkerPhone = fs.readFileSync(workerPhoneFile, 'utf8').trim()
                }
                
                console.log('[WhatsAppService] Found existing auth credentials. Auto-reconnecting...')
                
                if (savedPhone) {
                    let isVerified = true
                    if (savedWorkerPhone) {
                        const savedDigits = savedPhone.replace(/\D/g, '')
                        const workerDigits = savedWorkerPhone.replace(/\D/g, '')
                        if (savedDigits.slice(-10) === workerDigits.slice(-10)) {
                            console.warn('[WhatsAppService] Same number for worker and user detected. Requiring re-verification.')
                            isVerified = false
                        }
                    }

                    // Restore the message filter JID from saved phone
                    if (isVerified) {
                        this.targetPhoneJid = formatWhatsAppJid(savedPhone)
                        console.log('[WhatsAppService] Restored target JID filter:', this.targetPhoneJid)
                    }

                    // Set initial state so UI can show 'connecting' immediately
                    this._setState({
                        status: 'connecting',
                        qrCode: null,
                        error: null,
                        phoneNumber: savedPhone,
                        isVerified: isVerified,
                        connectedPhoneNumber: savedWorkerPhone,
                    })
                }

                // Auto-reconnect using saved credentials — non-blocking
                this.connect(savedPhone || null).catch((err) => {
                    console.error('[WhatsAppService] Auto-reconnect failed:', err)
                    this._setState({
                        status: 'disconnected',
                        qrCode: null,
                        error: 'Auto-reconnect failed. Click Connect to retry.',
                        phoneNumber: this.connectionState.phoneNumber,
                        isVerified: false,
                        connectedPhoneNumber: null,
                    })
                })
            }
        } catch (error) {
            console.error('[WhatsAppService] Init error:', error)
        }
    }

    getConnectionState(): WhatsAppConnectionState {
        return { ...this.connectionState }
    }

    async connect(targetPhoneNumber: string | null): Promise<void> {
        if (this.connectionState.status === 'connected') return
        if (this.isConnecting) return
        
        this.isConnecting = true
        this._setState({
            status: 'connecting',
            qrCode: null,
            error: null,
            phoneNumber: targetPhoneNumber || this.connectionState.phoneNumber,
            isVerified: false,
            connectedPhoneNumber: null,
        })
        
        try {
            const {
                default: makeWASocket,
                useMultiFileAuthState,
                DisconnectReason,
                fetchLatestBaileysVersion,
            } = await import('@whiskeysockets/baileys')

            fs.mkdirSync(this.authDir, { recursive: true })
            if (targetPhoneNumber) {
                fs.writeFileSync(path.join(this.authDir, 'phone.txt'), targetPhoneNumber)
            }

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

            const sock = makeWASocket({
                version,
                auth: state,
                logger: silentLogger,
                printQRInTerminal: false,
                browser: ['AI-Worker', 'Chrome', '120.0.0'],
                connectTimeoutMs: 60000,
            })

            this.socket = sock

            sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update
                console.log('[WhatsAppService] Connection update:', { connection, qr: !!qr })

                if (qr) {
                    this._setState({ ...this.connectionState, status: 'connecting', qrCode: qr })
                }

                if (connection === 'open') {
                    const userId = sock.user?.id
                    let connectedPhoneNumber: string | null = null
                    if (userId) {
                        connectedPhoneNumber = userId.split('@')[0]
                        try {
                            fs.writeFileSync(path.join(this.authDir, 'worker_phone.txt'), connectedPhoneNumber)
                        } catch (err) {
                            console.error('[WhatsAppService] Error saving worker phone:', err)
                        }
                    }
                    
                    this._setState({
                        status: 'connected',
                        qrCode: null,
                        error: null,
                        phoneNumber: this.connectionState.phoneNumber,
                        isVerified: this.connectionState.isVerified,
                        connectedPhoneNumber: connectedPhoneNumber,
                    })
                }

                if (connection === 'close') {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
                    const errorMessage = lastDisconnect?.error?.message || 'Unknown reason'
                    const loggedOutCode = DisconnectReason.loggedOut
                    
                    console.log('[WhatsAppService] Connection closed:', { statusCode, errorMessage })
                    this.socket = null

                    if (statusCode !== loggedOutCode) {
                        const isStreamError = errorMessage?.toLowerCase().includes('stream errored') || 
                                            errorMessage?.toLowerCase().includes('restart required')
                        
                        if (isStreamError) {
                            this._setState({
                                status: 'disconnected',
                                qrCode: null,
                                error: 'Stream error. Please reconnect.',
                                phoneNumber: this.connectionState.phoneNumber,
                                isVerified: this.connectionState.isVerified,
                                connectedPhoneNumber: this.connectionState.connectedPhoneNumber,
                            })
                        } else {
                            this._setState({
                                status: 'error',
                                qrCode: null,
                                error: `Connection failed: ${errorMessage}`,
                                phoneNumber: this.connectionState.phoneNumber,
                                isVerified: this.connectionState.isVerified,
                                connectedPhoneNumber: this.connectionState.connectedPhoneNumber,
                            })
                        }
                    } else {
                        this._clearAuth()
                        this._setState({
                            status: 'disconnected',
                            qrCode: null,
                            error: null,
                            phoneNumber: null,
                            isVerified: false,
                            connectedPhoneNumber: null,
                        })
                    }
                }
            })

            sock.ev.on('creds.update', saveCreds)

            sock.ev.on('messages.upsert', ({ messages, type }) => {
                if (type !== 'notify') return
                for (const raw of messages) {
                    const msg = this._parseMessage(raw)
                    if (msg) {
                        if (!msg.isFromMe && raw.key) {
                            sock.readMessages([raw.key]).catch(() => {})
                        }
                        
                        // ── Security: only forward messages from the verified personal number ──
                        // If targetPhoneJid is set, silently drop messages from other numbers
                        // (group chats, other contacts, spam, etc.)
                        if (!msg.isFromMe && this.targetPhoneJid) {
                            // Strip resource/device suffix for comparison (JID format: number@s.whatsapp.net)
                            const fromBase = msg.from.split('@')[0]
                            const targetBase = this.targetPhoneJid.split('@')[0]
                            if (fromBase !== targetBase) {
                                console.log('[WhatsAppService] Dropping message from non-target sender:', fromBase)
                                continue
                            }
                        }
                        
                        this.emit('message', msg)
                    }
                }
            })
        } catch (error) {
            this.socket = null
            this._setState({
                status: 'error',
                qrCode: null,
                error: error instanceof Error ? error.message : String(error),
                phoneNumber: this.connectionState.phoneNumber,
                isVerified: this.connectionState.isVerified,
                connectedPhoneNumber: this.connectionState.connectedPhoneNumber,
            })
            throw error
        } finally {
            this.isConnecting = false
        }
    }

    async disconnect(clearAuth = true): Promise<void> {
        if (this.socket) {
            try {
                if (clearAuth) await this.socket.logout()
                else await (this.socket as any).end(undefined)
            } catch (err) {
                console.warn('[WhatsAppService] Disconnect warning:', err)
            }
            this.socket = null
        }
        
        if (clearAuth) {
            this._clearAuth()
            this._setState({
                status: 'disconnected',
                qrCode: null,
                error: null,
                phoneNumber: null,
                isVerified: false,
                connectedPhoneNumber: null,
            })
        } else {
            this._setState({
                ...this.connectionState,
                status: 'disconnected',
                qrCode: null,
            })
        }
    }

    setTargetNumber(phoneNumber: string): void {
        if (this.connectionState.connectedPhoneNumber) {
            const connectedDigits = this.connectionState.connectedPhoneNumber.replace(/\D/g, '')
            const targetDigits = phoneNumber.replace(/\D/g, '')
            if (targetDigits.slice(-10) === connectedDigits.slice(-10)) {
                throw new Error('Cannot use the same number for both Worker and Personal.')
            }
        }

        fs.writeFileSync(path.join(this.authDir, 'phone.txt'), phoneNumber)
        
        // Build the JID for message filtering (use top-level import, not require)
        this.targetPhoneJid = formatWhatsAppJid(phoneNumber)
        console.log('[WhatsAppService] Target JID set for message filtering:', this.targetPhoneJid)
        
        this._setState({
            ...this.connectionState,
            phoneNumber: phoneNumber,
            isVerified: true,
        })
    }

    async sendMessage(to: string, content: string): Promise<{ success: boolean; error?: string }> {
        if (!this.socket || this.connectionState.status !== 'connected') {
            return { success: false, error: 'WhatsApp not connected' }
        }

        const now = Date.now()
        if (now - this.lastMessageTime < this.MESSAGE_RATE_LIMIT_MS) {
            return { success: false, error: 'Rate limit exceeded.' }
        }
        this.lastMessageTime = now

        try {
            const jid = formatWhatsAppJid(to)
            if (!jid) {
                console.error('[WhatsAppService] Invalid JID for:', to)
                return { success: false, error: 'Invalid phone format' }
            }
            
            console.log('[WhatsAppService] Sending message to:', jid)
            await this.socket.sendMessage(jid, { text: content })
            console.log('[WhatsAppService] Message sent successfully to:', jid)
            return { success: true }
        } catch (error) {
            console.error('[WhatsAppService] Send error:', error)
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    }

    async sendPresence(to: string, state: 'unavailable' | 'available' | 'composing' | 'recording' | 'paused'): Promise<{ success: boolean; error?: string }> {
        if (!this.socket || this.connectionState.status !== 'connected') {
             return { success: false, error: 'WhatsApp not connected' }
        }
        try {
            const jid = formatWhatsAppJid(to)
            if (!jid) return { success: false, error: 'Invalid phone format' }
            await this.socket.sendPresenceUpdate(state, jid)
            return { success: true }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    }

    private _setState(state: WhatsAppConnectionState): void {
        this.connectionState = state
        this.emit('connectionChange', state)
    }

    private _clearAuth(): void {
        try {
            if (fs.existsSync(this.authDir)) {
                fs.rmSync(this.authDir, { recursive: true, force: true })
            }
            fs.mkdirSync(this.authDir, { recursive: true })
        } catch (err) {
            console.error('[WhatsAppService] Error clearing auth:', err)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _parseMessage(raw: any): WhatsAppMessage | null {
        try {
            if (!raw?.key || !raw?.message) return null
            const msg = raw.message
            const textContent = msg.conversation || msg.extendedTextMessage?.text || 
                              msg.imageMessage?.caption || msg.videoMessage?.caption || 
                              msg.documentMessage?.caption
            if (!textContent) return null

            const type: WhatsAppMessage['type'] = msg.imageMessage ? 'image' : 
                                                msg.videoMessage ? 'video' : 
                                                msg.documentMessage ? 'document' : 
                                                msg.audioMessage ? 'audio' : 'text'

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

export const whatsappService = new WhatsAppService()
