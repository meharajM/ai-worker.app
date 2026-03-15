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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private socket: any = null
    private authDir: string

    constructor() {
        super()
        this.authDir = path.join(app.getPath('userData'), 'whatsapp-auth')
    }

    // ── Public API ──────────────────────────────────────────────────────────

    async init(): Promise<void> {
        try {
            const credsFile = path.join(this.authDir, 'creds.json')
            const phoneFile = path.join(this.authDir, 'phone.txt')
            if (fs.existsSync(credsFile)) {
                let savedPhone = ''
                if (fs.existsSync(phoneFile)) {
                    savedPhone = fs.readFileSync(phoneFile, 'utf8').trim()
                }
                console.log('[WhatsAppService] Found existing auth, auto-connecting...')
                this.connect(savedPhone).catch((e) => console.error('[WhatsAppService] Auto-connect failed:', e))
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

            const sock = makeWASocket({
                version,
                auth: state,
                logger: silentLogger,
                printQRInTerminal: false,
            })

            this.socket = sock

            // QR code and connection state events
            // Use 'any' because Baileys exposes a complex union type that doesn't
            // match our simplified typed update object cleanly.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sock.ev.on('connection.update', (update: any) => {
                const { connection, lastDisconnect, qr } = update as {
                    connection?: string
                    lastDisconnect?: { error?: { output?: { statusCode?: number } } }
                    qr?: string
                }

                if (qr) {
                    this._setState({ ...this.connectionState, status: 'connecting', qrCode: qr })
                }

                if (connection === 'open') {
                    this._setState({
                        status: 'connected',
                        qrCode: null,
                        error: null,
                        phoneNumber: targetPhoneNumber,
                    })
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode
                    const loggedOutCode = DisconnectReason.loggedOut

                    if (statusCode !== loggedOutCode) {
                        this._setState({
                            status: 'error',
                            qrCode: null,
                            error: 'Connection closed unexpectedly. Please reconnect.',
                            phoneNumber: targetPhoneNumber,
                        })
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

    async disconnect(): Promise<void> {
        if (this.socket) {
            try {
                await this.socket.logout()
            } catch {
                // ignore logout errors
            }
            this.socket = null
        }
        this._clearAuth()
        this._setState({
            status: 'disconnected',
            qrCode: null,
            error: null,
            phoneNumber: null,
        })
    }

    async sendMessage(to: string, content: string): Promise<{ success: boolean; error?: string }> {
        if (!this.socket || this.connectionState.status !== 'connected') {
            return { success: false, error: 'WhatsApp not connected' }
        }
        try {
            // Format JID
            const jid = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`
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
            const jid = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`
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
                fs.rmSync(this.authDir, { recursive: true, force: true })
            }
        } catch {
            // non-fatal
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
