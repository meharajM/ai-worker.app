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
import { app, powerSaveBlocker } from 'electron'
import type { WASocket } from '@whiskeysockets/baileys'
import { formatWhatsAppJid } from '../utils/whatsapp'

const loggerForRetry = {
    level: 'silent' as const,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => loggerForRetry,
};

// A simple map cache to store sent messages for retries
class SimpleMessageCache {
    private store = new Map<string, any>()
    private readonly maxSize = 100

    get(key: string) { return this.store.get(key) }
    set(key: string, value: any) {
        if (this.store.size >= this.maxSize) {
            const firstKey = this.store.keys().next().value
            if (firstKey) this.store.delete(firstKey)
        }
        this.store.set(key, value)
    }
}

class SimpleRetryCache {
    private store = new Map<string, number>()
    get<T>(key: string): T | undefined { return this.store.get(key) as unknown as T }
    set<T>(key: string, value: T): void { this.store.set(key, value as unknown as number) }
    del(key: string): void { this.store.delete(key) }
    flushAll(): void { this.store.clear() }
}

const sentMessagesCache = new SimpleMessageCache()
const msgRetryCounterCache = new SimpleRetryCache()

// Types we expose over IPC — mirrored in the renderer's whatsappStore.ts
export interface WhatsAppConnectionState {
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    qrCode: string | null
    error: string | null
    phoneNumber: string | null // Target number
    workerNumber: string | null // Self number (scanned)
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
        workerNumber: null,
    }

    private socket: WASocket | null = null
    private authDir: string
    private lastMessageTime = 0
    private readonly MESSAGE_RATE_LIMIT_MS = 1000 // 1 message per second
    private wakeLockId: number | null = null
    
    // Handshake state
    private pendingHandshake: {
        phoneNumber: string
        code: string
        expires: number
    } | null = null

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
                console.log('[WhatsAppService] Found existing auth credentials. Auto-connecting in background.')
                
                // Set the saved phone number in state but don't connect
                if (savedPhone) {
                    this._setState({
                        status: 'disconnected',
                        qrCode: null,
                        error: null,
                        phoneNumber: savedPhone,
                        workerNumber: null,
                    })
                    
                    console.log('[WhatsAppService] Found existing auth credentials. Auto-reconnecting...')
                    console.log(`[WhatsAppService] Restored target JID filter: ${formatWhatsAppJid(savedPhone)}`)
                    
                    // Auto-connect on launch
                    this.connect(savedPhone).catch(e => console.error('[WhatsAppService] Auto-connect error:', e))
                }
            }
        } catch (error) {
            console.error('[WhatsAppService] Init error:', error)
        }
    }

    getConnectionState(): WhatsAppConnectionState {
        return { ...this.connectionState }
    }

    async connect(targetPhoneNumber?: string): Promise<void> {
        if (this.connectionState.status === 'connected') return
        if (this.connectionState.status === 'connecting') return
        
        // If we have a saved phone number, use it.
        const effectivePhone: string | null = (targetPhoneNumber ?? this.connectionState.phoneNumber) ?? null

        this._setState({
            status: 'connecting',
            qrCode: null,
            error: null,
            phoneNumber: effectivePhone ?? null,
            workerNumber: this.connectionState.workerNumber
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
            
            if (effectivePhone) {
                fs.writeFileSync(path.join(this.authDir, 'phone.txt'), effectivePhone)
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
                // Critical for message delivery retries
                msgRetryCounterCache,
                getMessage: async (key) => {
                    const id = key.id;
                    if (id) {
                        const msg = sentMessagesCache.get(id);
                        if (msg) return msg;
                    }
                    return { conversation: 'Hello, this is fallback text.' };
                },
                markOnlineOnConnect: true,
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
                    
                    const workerJid = sock.user?.id || ''
                    const workerPhone = workerJid.split(':')[0].split('@')[0]
                    
                    if (this.connectionState.phoneNumber) {
                        console.log(`[WhatsAppService] Target JID set for message filtering: ${formatWhatsAppJid(this.connectionState.phoneNumber)}`)
                    }
                    
                    this._setState({
                        status: 'connected',
                        qrCode: null,
                        error: null,
                        phoneNumber: this.connectionState.phoneNumber,
                        workerNumber: workerPhone || null
                    })
                    
                    if (this.wakeLockId === null) {
                        this.wakeLockId = powerSaveBlocker.start('prevent-app-suspension')
                        console.log(`[Main] Wake lock acquired (WhatsApp connected). ID: ${this.wakeLockId}`)
                    }
                }

                if (connection === 'close') {
                    if (this.wakeLockId !== null) {
                        powerSaveBlocker.stop(this.wakeLockId)
                        console.log('[Main] Wake lock released (WhatsApp disconnected).')
                        this.wakeLockId = null
                    }
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
                                phoneNumber: (effectivePhone as string | null) ?? null,
                                workerNumber: this.connectionState.workerNumber
                            })
                            // Don't clear auth - just let user scan QR again with same credentials
                            return
                        }
                        
                        if (isNetworkError && effectivePhone) {
                            // Network issue - try to auto-reconnect after a delay
                            this._setState({
                                status: 'connecting',
                                qrCode: null,
                                error: null,
                                phoneNumber: effectivePhone ?? null,
                                workerNumber: this.connectionState.workerNumber
                            })
                            console.log('[WhatsAppService] Network disconnected, attempting auto-reconnect in 5s...')
                            setTimeout(() => {
                                if (this.connectionState.status === 'connecting') {
                                    this.connect(effectivePhone).catch(e => {
                                        console.error('[WhatsAppService] Auto-reconnect failed:', e)
                                        this._setState({
                                            status: 'error',
                                            qrCode: null,
                                            error: 'Failed to reconnect. Please try again.',
                                            phoneNumber: effectivePhone ?? null,
                                            workerNumber: this.connectionState.workerNumber
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
                                phoneNumber: effectivePhone ?? null,
                                workerNumber: this.connectionState.workerNumber
                            })
                        }
                        // Logged out — clear auth so next connect shows a fresh QR
                        this._clearAuth()
                        this._setState({
                            status: 'disconnected',
                            qrCode: null,
                            error: null,
                            phoneNumber: null,
                            workerNumber: null
                        })
                    }
                    this.socket = null
                }
            })

            // Persist credentials on update
            sock.ev.on('creds.update', saveCreds)

            // Incoming messages
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sock.ev.on('messages.upsert', async (upsert: { messages: any[]; type: string }) => {
                const { messages, type } = upsert
                if (type !== 'notify') return
                
                for (const raw of messages) {
                    const msg = await this._parseMessage(raw, sock)
                    if (msg) {
                        const fromClean = msg.from.split('@')[0].split(':')[0]
                        console.log(`[WhatsAppService] Incoming: from=${msg.from} (clean=${fromClean}) isFromMe=${msg.isFromMe} content="${msg.content.substring(0, 50)}"`)

                        // Handshake Verification Check
                        if (this.pendingHandshake && !msg.isFromMe) {
                            const handshakeClean = this.pendingHandshake.phoneNumber.replace(/\D/g, '')
                            console.log(`[WhatsAppService] Handshake Check: Expected=${handshakeClean}, Received=${fromClean}, CodeMatch=${msg.content.includes(this.pendingHandshake.code)}`)
                            
                            if (fromClean === handshakeClean && msg.content.includes(this.pendingHandshake.code)) {
                                console.log(`[WhatsAppService] Handshake SUCCESS for ${msg.from}!`)
                                const verifiedPhone = fromClean
                                this.pendingHandshake = null
                                
                                // Finalize link
                                this.connectionState.phoneNumber = verifiedPhone
                                fs.mkdirSync(this.authDir, { recursive: true })
                                fs.writeFileSync(path.join(this.authDir, 'phone.txt'), verifiedPhone)
                                
                                this._setState({
                                    ...this.connectionState,
                                    phoneNumber: verifiedPhone
                                })
                                // Message successfully consumed for handshake, stop processing
                                continue
                            }
                            
                            // If time expired, clear it
                            if (Date.now() > this.pendingHandshake.expires) {
                                console.log('[WhatsAppService] Handshake expired.')
                                this.pendingHandshake = null
                            }
                        }

                        // Strict Target Number Verification
                        if (!msg.isFromMe) {
                            if (!this.connectionState.phoneNumber) {
                                console.log('[WhatsAppService] Dropping message: No target/personal phone number verified yet.')
                                continue
                            }
                            
                            const targetClean = this.connectionState.phoneNumber.replace(/\D/g, '')
                            
                            if (fromClean !== targetClean) {
                                console.log(`[WhatsAppService] Dropping message from unknown JID: ${msg.from} (clean=${fromClean}, Expected=${targetClean})`)
                                continue
                            }
                        }

                        // Auto-mark as read if it's from someone else
                        if (!msg.isFromMe && raw.key) {
                            try {
                                sock.readMessages([raw.key]).catch(e => console.error('[Baileys] auto-read error:', e))
                            } catch {
                                // ignore
                            }
                        }
                        this.emit('message', msg)
                    } else {
                        // Log raw message if parsing failed, but only if it's not a protocol message
                        if (raw.message) {
                             console.log(`[WhatsAppService] Failed to parse message from JID: ${raw.key?.remoteJid}`)
                        }
                    }
                }
            })
        } catch (error) {
            this._setState({
                status: 'error',
                qrCode: null,
                error: error instanceof Error ? error.message : String(error),
                phoneNumber: targetPhoneNumber ?? null,
                workerNumber: this.connectionState.workerNumber
            })
            throw error
        }
    }

    async setTargetPhoneNumber(phoneNumber: string): Promise<{ success: boolean; error?: string; handshakeCode?: string }> {
        if (!phoneNumber) return { success: false, error: 'Phone number required' }
        
        const normalized = phoneNumber.trim()
        
        // Check if matching worker (self)
        if (this.connectionState.workerNumber) {
            const workerNormalized = this.connectionState.workerNumber.replace(/\D/g, '')
            const targetNormalized = normalized.replace(/\D/g, '')
            if (workerNormalized === targetNormalized) {
                return { success: false, error: 'Cannot use the same number for both Worker and Personal' }
            }
        }

        try {
            // Generate a 6-digit handshake code
            const code = Math.floor(100000 + Math.random() * 900000).toString()
            this.pendingHandshake = {
                phoneNumber: normalized,
                code,
                expires: Date.now() + (5 * 60 * 1000) // 5 minutes
            }
            
            // Send the handshake message
            // We do NOT send the code in the message. The code is shown on the computer screen.
            // This proves the person at the computer has control over the phone.
            const intro = `🤖 *AI-Worker Verification*\n\nPlease reply to this message with the *6-digit verification code* shown on your computer screen to link this as your personal device.`
            
            const jid = formatWhatsAppJid(normalized)
            console.log(`[WhatsAppService] Attempting handshake to JID: ${jid} (Input: ${normalized})`)
            
            const result = await this.sendMessage(normalized, intro)
            
            if (!result.success) {
                console.error(`[WhatsAppService] Handshake message failed to ${jid}: ${result.error}`)
                return { success: false, error: `Could not send verification message. ${result.error}` }
            }
            
            console.log(`[WhatsAppService] Handshake started successfully for ${normalized}. (Wait for user to reply with code shown in UI)`)
            
            return { success: true, handshakeCode: code }
        } catch (error) {
            console.error('[WhatsAppService] Handshake error:', error)
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    }

    async disconnect(clearAuth = true): Promise<void> {
        console.log(`[WhatsAppService] Disconnecting (clearAuth=${clearAuth})...`)
        
        if (this.wakeLockId !== null) {
            powerSaveBlocker.stop(this.wakeLockId)
            console.log('[Main] Wake lock released (WhatsApp disconnected).')
            this.wakeLockId = null
        }
        
        if (this.socket) {
            try {
                if (clearAuth) {
                    await (this.socket as { logout: () => Promise<void> }).logout()
                    console.log('[WhatsAppService] Logged out from WhatsApp')
                } else {
                    (this.socket as { end: (err: any) => void }).end(undefined) // Baileys end session
                    console.log('[WhatsAppService] Session ended (not logged out)')
                }
            } catch (err: unknown) {
                console.warn('[WhatsAppService] Disconnect warning:', err instanceof Error ? err.message : String(err))
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
                workerNumber: null
            })
            console.log('[WhatsAppService] Auth cleared.')
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
            
            const result = await this.socket.sendMessage(jid, { text: content })
            if (result && result.key && result.key.id && result.message) {
                 sentMessagesCache.set(result.key.id, result.message)
            }
            console.log(`[WhatsAppService] Message sent successfully to: ${jid}. Content: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`)
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

    async sendMediaMessage(
        to: string,
        filePath: string,
        caption?: string,
        type: 'image' | 'video' | 'audio' | 'document' = 'image'
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.socket || this.connectionState.status !== 'connected') {
            return { success: false, error: 'WhatsApp not connected' }
        }

        try {
            const jid = formatWhatsAppJid(to)
            if (!jid) {
                return { success: false, error: 'Invalid phone number format' }
            }

            if (!fs.existsSync(filePath)) {
                return { success: false, error: 'File not found' }
            }

            const buffer = fs.readFileSync(filePath)
            
            let messageContent: any = {}
            if (type === 'image') {
                messageContent = { image: buffer, caption }
            } else if (type === 'video') {
                messageContent = { video: buffer, caption }
            } else if (type === 'audio') {
                // ptt: true sends it as a "Voice Note"
                messageContent = { audio: buffer, ptt: true }
            } else if (type === 'document') {
                const fileName = path.basename(filePath)
                messageContent = { document: buffer, fileName, caption, mimetype: 'application/octet-stream' }
            }

            const result = await this.socket.sendMessage(jid, messageContent)
            
            if (result && result.key && result.key.id && result.message) {
                sentMessagesCache.set(result.key.id, result.message)
            }

            console.log(`[WhatsAppService] Media message (${type}) sent successfully to: ${jid}`)
            return { success: true }
        } catch (error) {
            console.error('[WhatsAppService] Send media error:', error)
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
        } catch (err: unknown) {
            console.error('[WhatsAppService] Error in logout:', err instanceof Error ? err.message : String(err))
        }  
        // Also ensure the parent directory exists for next connect
        try {
            fs.mkdirSync(this.authDir, { recursive: true })
        } catch {
            // ignore - will be created on next connect
        }
    }

    private async _parseMessage(raw: any, socket?: any): Promise<WhatsAppMessage | null> {
        try {
            if (!raw?.key || !raw?.message) return null

            const msg = raw.message
            
            // Comprehensive text extraction
            let textContent: string | null = null
            
            if (msg.conversation) {
                textContent = msg.conversation
            } else if (msg.extendedTextMessage?.text) {
                textContent = msg.extendedTextMessage.text
            } else if (msg.imageMessage?.caption) {
                textContent = msg.imageMessage.caption
            } else if (msg.videoMessage?.caption) {
                textContent = msg.videoMessage.caption
            } else if (msg.documentMessage?.caption) {
                textContent = msg.documentMessage.caption
            } else if (msg.viewOnceMessage?.message?.extendedTextMessage?.text) {
                textContent = msg.viewOnceMessage.message.extendedTextMessage.text
            } else if (msg.viewOnceMessage?.message?.conversation) {
                textContent = msg.viewOnceMessage.message.conversation
            } else if (msg.ephemeralMessage?.message?.extendedTextMessage?.text) {
                textContent = msg.ephemeralMessage.message.extendedTextMessage.text
                textContent = msg.ephemeralMessage.message.conversation
            } else if (msg.stickerMessage) {
                textContent = `[User sent a sticker: ${msg.stickerMessage.mimetype}]`
            } else if (msg.contactMessage) {
                textContent = `[User shared a contact: ${msg.contactMessage.displayName} (${msg.contactMessage.vcard})]`
            } else if (msg.locationMessage) {
                textContent = `[User shared a location: Lat ${msg.locationMessage.degreesLatitude}, Long ${msg.locationMessage.degreesLongitude}]`
            } else if (msg.liveLocationMessage) {
                textContent = `[User shared a live location: Lat ${msg.liveLocationMessage.degreesLatitude}, Long ${msg.liveLocationMessage.degreesLongitude}]`
            }

            const type: WhatsAppMessage['type'] = msg.imageMessage
                ? 'image'
                : msg.videoMessage
                    ? 'video'
                    : msg.documentMessage
                        ? 'document'
                        : msg.audioMessage
                            ? 'audio'
                            : 'text'

            let mediaUrl: string | undefined = undefined;

            if (socket && (msg.imageMessage || msg.videoMessage || msg.audioMessage || msg.documentMessage)) {
                try {
                    const { downloadMediaMessage } = await import('@whiskeysockets/baileys')
                    const buffer = await downloadMediaMessage(
                        raw,
                        'buffer',
                        {},
                        { 
                            logger: console as any,
                            reuploadRequest: socket.updateMediaMessage 
                        }
                    )
                    
                    if (Buffer.isBuffer(buffer)) {
                        let ext = 'bin';
                        if (msg.imageMessage) ext = 'jpg';
                        else if (msg.videoMessage) ext = 'mp4';
                        else if (msg.audioMessage) ext = 'ogg';
                        else if (msg.documentMessage) ext = msg.documentMessage.fileName?.split('.').pop() || 'bin';

                        const tempPath = path.join(app.getPath('temp'), `wa_media_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`);
                        fs.writeFileSync(tempPath, buffer);
                        mediaUrl = `file://${tempPath}`;
                        console.log(`[WhatsAppService] Successfully saved ${type} to ${tempPath}`);
                    }
                } catch (err) {
                    console.error('[WhatsAppService] Failed to download media:', err)
                }
            }

            if (!textContent && !mediaUrl) return null

            // Handle LID vs PN (WhatsApp is moving towards LIDs for some users)
            // senderPn usually contains the actual phone number JID
            const fromJid = raw.key.senderPn || raw.key.remoteJid || ''

            return {
                id: raw.key.id ?? `wa_${Date.now()}`,
                from: fromJid,
                to: raw.key.fromMe ? (raw.key.senderPn || raw.key.remoteJid || '') : 'me',
                content: textContent || '[Media Message]',
                timestamp: (raw.messageTimestamp as number) * 1000 || Date.now(),
                type,
                mediaUrl,
                caption: textContent ?? undefined,
                isFromMe: raw.key.fromMe ?? false,
            }
        } catch (err) {
            console.error('[WhatsAppService] Unhandled parsing error:', err);
            return null
        }
    }
}

// Singleton instance — created once in main process
export const whatsappService = new WhatsAppService()
