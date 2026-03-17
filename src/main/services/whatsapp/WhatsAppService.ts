import { makeWASocket, DisconnectReason } from '@whiskeysockets/baileys'
import type { WASocket } from '@whiskeysockets/baileys'
import type { Boom } from '@hapi/boom'
import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

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

export interface WhatsAppConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  qrCode: string | null
  error: string | null
  phoneNumber: string | null
}

const AUTH_DIR = path.join(app.getPath('userData'), 'whatsapp-auth')

class WhatsAppService {
  private socket: WASocket | null = null
  private connectionState: WhatsAppConnectionState = {
    status: 'disconnected',
    qrCode: null,
    error: null,
    phoneNumber: null
  }
  
  private targetNumber: string = ''
  private onMessageCallbacks: ((message: WhatsAppMessage) => void)[] = []
  private onConnectionChangeCallbacks: ((state: WhatsAppConnectionState) => void)[] = []
  private mainWindow: BrowserWindow | null = null

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  private ensureAuthDir() {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true })
    }
  }

  private async getAuthState(): Promise<any> {
    this.ensureAuthDir()
    
    const credsFile = path.join(AUTH_DIR, 'creds.json')
    const keysDir = path.join(AUTH_DIR, 'keys')
    
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true })
    }

    let creds: any = {}
    if (fs.existsSync(credsFile)) {
      try {
        creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'))
      } catch (e) {
        console.error('[WhatsApp] Failed to load creds:', e)
      }
    }

    return {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const keyFile = path.join(keysDir, `${type}-${ids.join('-')}.json`)
          if (fs.existsSync(keyFile)) {
            try {
              return JSON.parse(fs.readFileSync(keyFile, 'utf-8'))
            } catch (e) {
              return {}
            }
          }
          return {}
        },
        set: async (type: string, data: any) => {
          for (const [id, value] of Object.entries(data)) {
            const keyFile = path.join(keysDir, `${type}-${id}.json`)
            fs.writeFileSync(keyFile, JSON.stringify(value))
          }
        }
      }
    }
  }

  private async saveCreds() {
    if (!this.socket?.authState?.creds) return
    
    this.ensureAuthDir()
    const credsFile = path.join(AUTH_DIR, 'creds.json')
    fs.writeFileSync(credsFile, JSON.stringify(this.socket.authState.creds))
  }

  private updateConnectionState(state: Partial<WhatsAppConnectionState>) {
    this.connectionState = { ...this.connectionState, ...state }
    this.onConnectionChangeCallbacks.forEach(cb => cb(this.connectionState))
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('whatsapp:connection-state', this.connectionState)
    }
  }

  private notifyOnMessage(message: WhatsAppMessage) {
    this.onMessageCallbacks.forEach(cb => cb(message))
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('whatsapp:message', message)
    }
  }

  async connect(targetNumber: string): Promise<void> {
    if (this.connectionState.status === 'connected') {
      return
    }
    
    this.targetNumber = targetNumber
    
    this.updateConnectionState({ 
      status: 'connecting', 
      error: null,
      phoneNumber: targetNumber
    })
    
    try {
      if (this.socket) {
        try {
          this.socket.end(undefined)
        } catch (e) {
          // Ignore
        }
        this.socket = null
      }

      const auth = await this.getAuthState()
      
      this.socket = makeWASocket({
        auth,
        printQRInTerminal: false,
        browser: ["Agent Worker", "Chrome", "1.0.0"]
      })

      this.socket.ev.on('creds.update', () => this.saveCreds())

      this.socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
          this.updateConnectionState({ qrCode: String(qr) })
        }
        
        if (connection === 'open') {
          this.updateConnectionState({ 
            status: 'connected', 
            qrCode: null,
            error: null
          })
          this.setupMessageListeners()
        }
        
        if (connection === 'close') {
          const err = lastDisconnect?.error as Boom | undefined
          const statusCode = err?.output?.statusCode
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut
          
          if (!shouldReconnect) {
            this.updateConnectionState({ 
              status: 'disconnected',
              qrCode: null
            })
          } else {
            setTimeout(() => {
              if (this.targetNumber) {
                this.connect(this.targetNumber)
              }
            }, 5000)
          }
        }
        
        if (lastDisconnect?.error) {
          const error = lastDisconnect.error as Error
          console.error('[WhatsApp] Connection error:', error.message)
          this.updateConnectionState({ 
            status: 'error',
            error: error.message
          })
        }
      })
    } catch (error) {
      console.error('[WhatsApp] Failed to connect:', error)
      this.updateConnectionState({ 
        status: 'error', 
        error: error instanceof Error ? error.message : String(error) 
      })
    }
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      try {
        this.socket.end(undefined)
        this.updateConnectionState({ 
          status: 'disconnected',
          qrCode: null,
          error: null
        })
      } catch (error) {
        console.error('[WhatsApp] Error disconnecting:', error)
      } finally {
        this.socket = null
      }
    }
  }

  async sendMessage(to: string, content: string): Promise<void> {
    if (!this.socket || this.connectionState.status !== 'connected') {
      throw new Error('WhatsApp is not connected')
    }
    
    const jid = `${to}@s.whatsapp.net`
    await this.socket.sendMessage(jid, { text: content })
  }

  onMessage(callback: (message: WhatsAppMessage) => void): () => void {
    this.onMessageCallbacks.push(callback)
    return () => {
      this.onMessageCallbacks = this.onMessageCallbacks.filter(cb => cb !== callback)
    }
  }

  onConnectionChange(callback: (state: WhatsAppConnectionState) => void): () => void {
    this.onConnectionChangeCallbacks.push(callback)
    return () => {
      this.onConnectionChangeCallbacks = this.onConnectionChangeCallbacks.filter(cb => cb !== callback)
    }
  }

  getConnectionState(): WhatsAppConnectionState {
    return { ...this.connectionState }
  }

  private setupMessageListeners() {
    if (!this.socket) return
    
    this.socket.ev.on('messages.upsert', (mssg) => {
      try {
        for (const msg of mssg.messages) {
          if (msg.key.fromMe) continue
          
          let content = ''
          let type: WhatsAppMessage['type'] = 'text'
          let caption: string | undefined
          
          if (msg.message) {
            const messageType = Object.keys(msg.message)[0] as keyof typeof msg.message
            
            switch (messageType) {
              case 'conversation':
                content = msg.message.conversation ?? ''
                break
              case 'extendedTextMessage':
                content = msg.message.extendedTextMessage?.text ?? ''
                break
              case 'imageMessage':
                type = 'image'
                caption = msg.message.imageMessage?.caption ?? undefined
                break
              case 'videoMessage':
                type = 'video'
                caption = msg.message.videoMessage?.caption ?? undefined
                break
              case 'documentMessage':
                type = 'document'
                caption = msg.message.documentMessage?.caption ?? undefined
                break
              case 'audioMessage':
                type = 'audio'
                break
              default:
                content = '[Unsupported message type]'
            }
          }
          
          const from = msg.key.remoteJid?.replace('@s.whatsapp.net', '') || ''
          
          const whatsappMessage: WhatsAppMessage = {
            id: msg.key.id ?? Date.now().toString(),
            from,
            to: this.targetNumber,
            content,
            type,
            isFromMe: false,
            timestamp: typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Math.floor(Date.now() / 1000),
            caption
          }
          
          this.notifyOnMessage(whatsappMessage)
        }
      } catch (err) {
        console.error('[WhatsApp] Error processing message:', err)
      }
    })
  }
}

export const whatsAppService = new WhatsAppService()

export function setupWhatsAppIPC() {
  ipcMain.handle('whatsapp:connect', async (_, targetNumber: string) => {
    await whatsAppService.connect(targetNumber)
  })

  ipcMain.handle('whatsapp:disconnect', async () => {
    await whatsAppService.disconnect()
  })

  ipcMain.handle('whatsapp:sendMessage', async (_, to: string, content: string) => {
    await whatsAppService.sendMessage(to, content)
  })

  ipcMain.handle('whatsapp:getConnectionState', () => {
    return whatsAppService.getConnectionState()
  })
}
