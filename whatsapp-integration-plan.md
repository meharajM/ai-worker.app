# WhatsApp Integration Plan

## Executive Summary
Replace the current WhatsApp MCP server implementation with a direct Baileys integration. The new implementation will support bidirectional communication between WhatsApp and the AI agent, with a toggle in the chat input to enable WhatsApp mode.

## Architecture Overview

### Current State (WhatsApp MCP)
- Uses `@mhrj/whatsapp-mcp` NPM package via npx
- MCP server connects to WhatsApp Web via Baileys internally
- Communication via MCP tool calls (`connect`, `send_message`, `ask_question`, `get_status`)
- Auto-connect disabled by default (requires user action)

### Target State (Direct Baileys)
- Direct integration of `@whiskeysockets/baileys` package
- WhatsApp service layer encapsulated in `whatsappService.ts`
- Toggle control in chat input to enable WhatsApp mode
- Bidirectional messaging: messages sent/received via WhatsApp appear in chat

## Implementation Details

### Phase 1: Core Infrastructure

#### 1.1 Remove MCP Server Configuration
**File:** `src/renderer/src/stores/mcpStore.ts`
- Remove `whatsapp-mcp` entry from `DEFAULT_MCP_SERVERS` array
- Remove enforcement code that sets `autoConnect: false` for WhatsApp

#### 1.2 Create WhatsApp Service
**File:** `src/renderer/src/lib/whatsappService.ts`

```typescript
// Core interfaces
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
```

**Key Methods:**
- `connect(targetNumber: string): Promise<void>` - Initiates WhatsApp connection with QR code
- `disconnect(): Promise<void>` - Disconnects from WhatsApp
- `sendMessage(to: string, content: string): Promise<void>` - Sends message via WhatsApp
- `onMessage(callback): () => void` - Subscribe to incoming messages
- `onConnectionChange(callback): () => void` - Subscribe to connection state changes
- `getConnectionState(): WhatsAppConnectionState` - Get current state

**Implementation Notes:**
- Use `useMultiFileAuthState` from Baileys for authentication persistence
- Store auth in `userData/whatsapp-auth` directory (Electron) or localStorage (browser)
- Handle QR code generation and display
- Set up message listeners for incoming WhatsApp messages

#### 1.3 Extend Chat Store
**File:** `src/renderer/src/stores/chatStore.ts`

Add to interface:
```typescript
interface ChatState {
  // ... existing fields
  whatsappEnabled: boolean
  setWhatsAppEnabled: (enabled: boolean) => void
}
```

### Phase 2: UI Components

#### 2.1 WhatsApp Connection Dialog
**File:** `src/renderer/src/components/WhatsAppConnectionDialog.tsx`

**Current Flow (MCP-based):**
1. User enters phone number
2. MCP tool `connect` is called
3. QR code parsed from MCP response
4. Poll MCP tool `get_status` for connection

**New Flow (Baileys-based):**
1. User enters phone number
2. Call `whatsappService.connect(phoneNumber)`
3. Subscribe to connection state changes
4. Display QR code from service state
5. On connection, close dialog and enable toggle

**UI States:**
- `idle`: Phone number input
- `connecting`: Loading spinner while connecting
- `qr`: QR code display with scan instructions
- `connected`: Success message with checkmark

#### 2.2 Chat Input Toggle
**File:** `src/renderer/src/components/input/ChatInput.tsx`

Add WhatsApp toggle button beside file attachment:
- Position: Right of attachment icon, left of voice input
- Icon: WhatsApp logo (green) when enabled, outlined when disabled
- Tooltip: "Send via WhatsApp" / "Send via app"
- State: Controlled by `chatStore.whatsappEnabled`

```tsx
// Toggle button component
<button 
  onClick={() => setWhatsAppEnabled(!whatsappEnabled)}
  className={whatsappEnabled ? 'text-green-500' : 'text-gray-400'}
  title={whatsappEnabled ? 'WhatsApp mode active' : 'Click to enable WhatsApp'}
>
  <MessageCircle size={20} />
</button>
```

#### 2.3 Message Sending Logic
**File:** Modify message sending in chat components

When `whatsappEnabled` is true:
1. Get message content from input
2. Call `whatsappService.sendMessage(targetNumber, content)`
3. Also add message to chat store (so it appears in UI)
4. Trigger agent processing as normal

When `whatsappEnabled` is false:
1. Current behavior unchanged (LLM-powered chat)

#### 2.4 Incoming Message Handling
When WhatsApp message received:
1. Service emits event via `onMessage` callback
2. If `whatsappEnabled`, add message to chat store
3. Message appears as user message in chat
4. Agent can respond (optionally via WhatsApp too)

### Phase 3: Integration Points

#### 3.1 Command Palette
**File:** `src/renderer/src/components/CommandPalette.tsx`

Add commands:
- "Connect WhatsApp" - Opens connection dialog
- "Disconnect WhatsApp" - Disconnects service
- "Start WhatsApp Chat" - Enables WhatsApp mode + focuses input
- "Switch to App Chat" - Disables WhatsApp mode

#### 3.2 Connections Panel
**File:** `src/renderer/src/components/ConnectionsPanel.tsx`

Update WhatsApp section:
- Replace MCP server status with direct service status
- Show connection state (connected/disconnected/error)
- Connect/Disconnect buttons

#### 3.3 Empty State
**File:** `src/renderer/src/components/chat/EmptyState.tsx`

Add CTA for WhatsApp:
- "Connect WhatsApp for remote control"
- Click triggers WhatsApp connection dialog

#### 3.4 Header Status
**File:** `src/renderer/src/components/Header.tsx`

Add WhatsApp status indicator:
- Green dot when connected
- "WhatsApp Active" / "WhatsApp Ready" text

### Phase 4: Agent Integration

#### 4.1 System Prompt Updates
**File:** `src/renderer/src/lib/llm/prompts.ts`

Update prompt to include:
- WhatsApp connection status
- Available WhatsApp tools (if connected)
- Instructions for sending via WhatsApp when enabled

#### 4.2 Tool Integration (Future)
When agent needs to send notifications/approvals:
- Check if WhatsApp is connected
- If connected and user preference is set, send via WhatsApp
- Also show in-app notification

## User Flows

### Flow 1: Initial Setup
1. User opens app → sees Empty State or Command Palette
2. User clicks "Connect WhatsApp" or uses Command Palette
3. WhatsAppConnectionDialog opens
4. User enters phone number (with country code)
5. QR code displayed
6. User scans with WhatsApp phone
7. Connection established → dialog closes
8. WhatsApp toggle appears in chat input

### Flow 2: Send Message via WhatsApp
1. User types message in chat input
2. User clicks WhatsApp toggle (or it's already enabled)
3. User sends message (Enter or click send)
4. Message sent via WhatsApp service
5. Message appears in chat as "sent via WhatsApp"
6. Agent processes message normally
7. Agent response appears in chat

### Flow 3: Receive Message from WhatsApp
1. WhatsApp message received by service
2. If WhatsApp mode enabled:
   - Message added to chat store
   - Message appears in chat as incoming
3. If WhatsApp mode disabled:
   - Message queued or ignored
   - User can view in WhatsApp app directly

### Flow 4: Agent-Initiated WhatsApp
1. Agent completes task or needs approval
2. Agent uses `sendMessage` or `ask_question` tool
3. Tool checks WhatsApp connection
4. If connected: message sent via WhatsApp
5. User receives on phone
6. User responds → message comes back to chat
7. Agent receives response and continues

## File Changes Summary

### New Files
- `src/renderer/src/lib/whatsappService.ts` - Core WhatsApp service

### Modified Files
| File | Changes |
|------|---------|
| `mcpStore.ts` | Remove WhatsApp MCP config |
| `chatStore.ts` | Add whatsappEnabled state |
| `WhatsAppConnectionDialog.tsx` | Use Baileys service instead of MCP |
| `ChatInput.tsx` | Add WhatsApp toggle button |
| `CommandPalette.tsx` | Add WhatsApp commands |
| `ConnectionsPanel.tsx` | Update WhatsApp status |
| `EmptyState.tsx` | Add WhatsApp CTA |
| `Header.tsx` | Add WhatsApp status indicator |
| `prompts.ts` | Update system prompt for WhatsApp |

## Error Handling

### Connection Errors
- QR code timeout (5 minutes) → Show retry option
- Authentication failure → Show new QR code
- Disconnection → Auto-reconnect with backoff
- Network error → Show offline state

### Message Errors
- Send failure → Show error in chat, allow retry
- Delivery failure → Show delivery status

## Testing Strategy

### Unit Tests
- WhatsApp service methods
- State management
- Message formatting

### Integration Tests
- Connection flow
- Message sending/receiving
- Toggle behavior

### E2E Tests
- Complete user flows
- Error scenarios

## Security Considerations

1. **Auth Token Storage**
   - Use electron-store with encryption
   - Or OS keychain (keytar)

2. **Phone Number Validation**
   - Validate format before storage
   - Don't log full numbers

3. **Message Content**
   - Sanitize incoming messages
   - Escape special characters

## Future Enhancements

1. **Media Support**
   - Send/receive images, videos, documents
   - Voice messages

2. **Notifications**
   - Desktop notifications for WhatsApp messages
   - Sound alerts

3. **Multiple Contacts**
   - Support multiple WhatsApp contacts
   - Contact management UI

4. **Groups**
   - WhatsApp group support
   - Group message handling

5. **Typing Indicators**
   - Show typing indicator when remote user is typing
   - Send typing status when composing

## Migration Path

For existing users who set up WhatsApp via MCP:
1. Detect existing WhatsApp MCP config on startup
2. Prompt user to re-authenticate with new Baileys integration
3. Clear old MCP configuration
4. Establish new direct connection

## Dependencies

```json
{
  "@whiskeysockets/baileys": "^7.0.0"
}
```

Note: Baileys handles WhatsApp Web protocol directly - no browser or Selenium needed.
