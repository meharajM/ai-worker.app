import { useChatStore } from '../stores/chatStore'

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

declare global {
  interface Window {
    electron: {
      whatsapp: {
        connect: (targetNumber: string) => Promise<void>
        disconnect: () => Promise<void>
        sendMessage: (to: string, content: string) => Promise<void>
        getConnectionState: () => Promise<WhatsAppConnectionState>
        onConnectionState: (callback: (state: WhatsAppConnectionState) => void) => () => void
        onMessage: (callback: (message: WhatsAppMessage) => void) => () => void
      }
    }
  }
}

class WhatsAppService {
  private onMessageCallbacks: ((message: WhatsAppMessage) => void)[] = []
  private onConnectionChangeCallbacks: ((state: WhatsAppConnectionState) => void)[] = []
  private unsubscribers: (() => void)[] = []

  constructor() {
    this.setupIPCListeners()
  }

  private setupIPCListeners() {
    const connUnsub = window.electron.whatsapp.onConnectionState((state) => {
      this.onConnectionChangeCallbacks.forEach(cb => cb(state))
      
      if (state.status === 'connected') {
        useChatStore.getState().setWhatsAppEnabled(true)
      } else if (state.status === 'disconnected') {
        useChatStore.getState().setWhatsAppEnabled(false)
      }
    })
    this.unsubscribers.push(connUnsub)

    const msgUnsub = window.electron.whatsapp.onMessage((message) => {
      this.onMessageCallbacks.forEach(cb => cb(message))
      
      const chatStore = useChatStore.getState()
      if (chatStore.whatsappEnabled) {
        chatStore.addMessage({
          role: 'user',
          content: message.content,
        })
      }
    })
    this.unsubscribers.push(msgUnsub)
  }

  async connect(targetNumber: string): Promise<void> {
    await window.electron.whatsapp.connect(targetNumber)
  }

  async disconnect(): Promise<void> {
    await window.electron.whatsapp.disconnect()
  }

  async sendMessage(to: string, content: string): Promise<void> {
    await window.electron.whatsapp.sendMessage(to, content)
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

  async getConnectionState(): Promise<WhatsAppConnectionState> {
    return window.electron.whatsapp.getConnectionState()
  }
}

export const whatsappService = new WhatsAppService()
