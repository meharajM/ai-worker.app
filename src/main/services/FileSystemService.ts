import { promises as fs } from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { randomUUID } from 'crypto'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * File Change Record
 * Tracks a pending file operation in the shadow filesystem
 */
export interface FileChange {
    id: string                          // Unique change identifier (UUID)
    originalPath: string                // Target file path
    shadowPath: string                  // Temporary staging path
    type: 'create' | 'modify' | 'delete' // Operation type
    content?: string                    // Preview (first 10KB) for small files
    timestamp: number                   // Unix timestamp (ms) when staged
    
    // Remote Approval Metadata (Additive)
    approvalChannel: 'desktop' | 'whatsapp'
    approvalToken?: string              // 4-character secure token
    status: 'pending' | 'approved' | 'rejected' | 'expired'
    createdAt: number
    resolvedAt?: number
    resolvedBy?: 'ui' | 'wa'            // User (UI) or WhatsApp
}

/**
 * MCP Tool Schema Definition
 */
interface ToolSchema {
    name: string
    description: string
    inputSchema: {
        type: string
        properties: Record<string, unknown>
        required?: string[]
    }
}

/**
 * Tool Call Response
 */
interface ToolCallResponse {
    result: any
    error?: string
}

/**
 * Safe Mode Settings
 */
interface SafeModeSettings {
    safeMode?: boolean
}

// ============================================================================
// TOOL DEFINITIONS (MCP Schema)
// ============================================================================

/**
 * Filesystem tools exposed to AI agents
 */
const FILESYSTEM_TOOLS: ToolSchema[] = [
    {
        name: 'fs_write_file',
        description: 'Write content to a file. In Safe Mode, changes are staged for user approval before being applied.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Absolute file path'
                },
                content: {
                    type: 'string',
                    description: 'File content (text)'
                }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'fs_read_file',
        description: 'Read content from a file.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Absolute file path'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'fs_list_directory',
        description: 'List all files and subdirectories in a directory.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Absolute directory path'
                }
            },
            required: ['path']
        }
    }
]

// ===========================================================================
// FILESYSTEM SERVICE (Singleton + Shadow Write Layer)
// ============================================================================

/**
 * FileSystemService - Safe Filesystem with Shadow Writes
 * 
 * Provides filesystem access for AI agents with an optional "Safe Mode" that
 * requires user approval before file modifications are committed.
 * 
 * Architecture:
 * - Singleton pattern for global access
 * - Shadow directory for staging writes (userData/fs-staging/)
 * - Session-based change tracking
 * - Safe Mode toggle via electron-store
 * 
 * Safe Mode Flow:
 *   1. AI calls fs_write_file
 *   2. Content written to shadow directory
 *   3. User reviews change in UI
 *   4. User approves → commitChange() → Real file updated
 *   5. User rejects → discardChange() → Shadow file deleted
 * 
 * Usage:
 *   const fs = FileSystemService.getInstance()
 *   const change = await fs.stageWrite('/path/to/file.txt', 'content')
 *   await fs.commitChange(change.id)  // After user approval
 */
export class FileSystemService {
    private static instance: FileSystemService
    private shadowDir: string
    private pendingChanges: Map<string, FileChange> = new Map()
    private sessionChanges: Map<string, string[]> = new Map()
    private pendingResolvers: Map<string, { resolve: (status: 'approved' | 'rejected') => void }> = new Map()
    private fallbackTimers: Map<string, NodeJS.Timeout> = new Map()

    private whatsappTimeoutMs = (() => {
        const parsed = Number(process.env.AIW_WA_APPROVAL_TIMEOUT_MS)
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 60 * 1000
    })()

    private constructor() {
        // Shadow directory in app user data
        this.shadowDir = path.join(app.getPath('userData'), 'fs-staging')
        this.initialize()
        this.setupWhatsAppListener()
    }

    /**
     * Get the singleton instance
     */
    static getInstance(): FileSystemService {
        if (!FileSystemService.instance) {
            FileSystemService.instance = new FileSystemService()
        }
        return FileSystemService.instance
    }

    /**
     * Initialize shadow directory
     * @private
     */
    private async initialize() {
        try {
            await fs.mkdir(this.shadowDir, { recursive: true })
        } catch (error) {
            console.error('[FileSystemService] Failed to create shadow dir:', error)
        }
    }

    private setupWhatsAppListener() {
        try {
            // Import dynamically or lazily to avoid circular dependencies if any
            const { whatsappService } = require('./WhatsAppService')
            
            whatsappService.on('message', async (msg: { from: string; content?: string; isFromMe: boolean }) => {
                if (msg.isFromMe) return; // Ignore outgoing messages

                const result = await this.handleApprovalCommand((msg.content || '').trim(), 'wa')
                if (!result.handled) return

                if (result.ok) {
                    whatsappService.sendMessage(msg.from, result.message).catch((e: Error) =>
                        console.error('[FileSystemService] Failed to send approval response on WhatsApp:', e)
                    )
                } else {
                    whatsappService.sendMessage(msg.from, `❌ ${result.message}`).catch((e: Error) =>
                        console.error('[FileSystemService] Failed to send rejection response on WhatsApp:', e)
                    )
                }
            })

            whatsappService.on('connectionChange', (state: { status?: string }) => {
                if (state?.status !== 'connected') {
                    this.fallbackRemoteApprovalsToDesktop('disconnect')
                }
            })
        } catch (error) {
            console.error('[FileSystemService] Failed to setup WhatsApp listener:', error)
        }
    }

    private parseApprovalCommand(input: string): { action: 'approve' | 'reject'; token: string } | null {
        const normalized = input.trim().toUpperCase()
        const match = normalized.match(/^(APPROVE|REJECT)\s+([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})$/)
        if (!match) return null
        return {
            action: match[1] === 'APPROVE' ? 'approve' : 'reject',
            token: match[2]
        }
    }

    private findPendingRemoteChangeByToken(token: string): FileChange | undefined {
        return Array.from(this.pendingChanges.values()).find((change) =>
            change.approvalToken === token &&
            change.approvalChannel === 'whatsapp' &&
            change.status === 'pending'
        )
    }

    private async resolveApprovalByToken(token: string, action: 'approve' | 'reject', resolvedBy: 'ui' | 'wa'): Promise<{ ok: boolean; message: string }> {
        const change = this.findPendingRemoteChangeByToken(token)
        if (!change) {
            return { ok: false, message: `No pending change found for token ${token}.` }
        }

        try {
            if (action === 'approve') {
                await this.commitChange(change.id, resolvedBy)
                return {
                    ok: true,
                    message: `Approved file write: ${path.basename(change.originalPath)}`
                }
            }

            await this.discardChange(change.id, resolvedBy)
            return {
                ok: true,
                message: `Rejected file write: ${path.basename(change.originalPath)}`
            }
        } catch (error) {
            return {
                ok: false,
                message: error instanceof Error ? error.message : String(error)
            }
        }
    }

    async handleApprovalCommand(input: string, resolvedBy: 'ui' | 'wa' = 'wa'): Promise<{ handled: boolean; ok: boolean; message: string }> {
        const parsed = this.parseApprovalCommand(input)
        if (!parsed) {
            return { handled: false, ok: false, message: 'Command ignored. Use APPROVE <token> or REJECT <token>.' }
        }

        const result = await this.resolveApprovalByToken(parsed.token, parsed.action, resolvedBy)
        return { handled: true, ...result }
    }

    private generateToken(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars (0, 1, I, O)
        let token = '';
        for (let i = 0; i < 4; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    private startFallbackTimer(changeId: string) {
        this.clearFallbackTimer(changeId)
        const timer = setTimeout(() => {
            const change = this.pendingChanges.get(changeId);
            if (change && change.approvalChannel === 'whatsapp' && change.status === 'pending') {
                console.log(`[FileSystemService] WhatsApp approval timeout for ${changeId}. Falling back to desktop.`);
                change.status = 'expired'
                change.approvalChannel = 'desktop';
                change.approvalToken = undefined
                this.fallbackTimers.delete(changeId);
            }
        }, this.whatsappTimeoutMs);
        this.fallbackTimers.set(changeId, timer);
    }

    private fallbackRemoteApprovalsToDesktop(reason: 'timeout' | 'disconnect') {
        for (const change of this.pendingChanges.values()) {
            if (change.approvalChannel === 'whatsapp' && change.status === 'pending') {
                change.approvalChannel = 'desktop'
                change.status = 'expired'
                change.approvalToken = undefined
                this.clearFallbackTimer(change.id)
                console.log(`[FileSystemService] Falling back remote approval for ${change.id} to desktop (${reason}).`)
            }
        }
    }

    private clearFallbackTimer(changeId: string) {
        const timer = this.fallbackTimers.get(changeId);
        if (timer) {
            clearTimeout(timer);
            this.fallbackTimers.delete(changeId);
        }
    }

    /**
     * Check if a file exists
     * @private
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath)
            return true
        } catch {
            return false
        }
    }

    /**
     * Check if Safe Mode is enabled
     * @private
     */
    private async isSafeModeEnabled(): Promise<boolean> {
        try {
            const Store = (await import('electron-store')).default
            const store = new Store<Record<string, unknown>>() as unknown as { get: (key: string, def?: unknown) => unknown }
            const settings = (store.get('mcpFileSystem', {}) as unknown) as SafeModeSettings
            return settings.safeMode !== false  // Default to true
        } catch (error) {
            console.warn('[FileSystemService] Failed to check safe mode, defaulting to enabled:', error)
            return true  // Fail-safe to protect user files
        }
    }

    // ========================================================================
    // SHADOW WRITE OPERATIONS
    // ========================================================================

    /**
     * Stage a file write in the shadow directory
     * @param filePath Target file path
     * @param content File content
     * @param sessionId Session identifier (default: 'default')
     * @returns Change record with staging info
     */
    async stageWrite(
        filePath: string,
        content: string,
        sessionId: string = 'default'
    ): Promise<FileChange> {
        const changeId = randomUUID()
        const shadowPath = path.join(this.shadowDir, sessionId, changeId)
        const type = await this.fileExists(filePath) ? 'modify' : 'create'

        // Write to shadow location
        await fs.mkdir(path.dirname(shadowPath), { recursive: true })
        await fs.writeFile(shadowPath, content, 'utf8')

        const change: FileChange = {
            id: changeId,
            originalPath: filePath,
            shadowPath,
            type,
            content: content.length < 10000 ? content : undefined,  // Preview for small files
            timestamp: Date.now(),
            approvalChannel: 'desktop',
            status: 'pending',
            createdAt: Date.now()
        }

        // Track change
        this.pendingChanges.set(changeId, change)
        const sessionList = this.sessionChanges.get(sessionId) || []
        sessionList.push(changeId)
        this.sessionChanges.set(sessionId, sessionList)

        console.log(`[FileSystemService] Staged ${type} for ${filePath} (ID: ${changeId})`)
        return change
    }

    /**
     * Commit a staged change (user approved)
     * @param changeId Change UUID
     */
    async commitChange(changeId: string, resolvedBy: 'ui' | 'wa' = 'ui'): Promise<void> {
        const change = this.pendingChanges.get(changeId)
        if (!change) {
            throw new Error(`Change ${changeId} not found in pending changes`)
        }
        if (resolvedBy === 'ui' && change.approvalChannel === 'whatsapp' && change.status === 'pending') {
            throw new Error('This change is currently locked for WhatsApp approval. Wait for timeout/disconnect or approve via token.')
        }

        try {
            // Ensure parent directory exists
            await fs.mkdir(path.dirname(change.originalPath), { recursive: true })

            // Copy shadow file to real location
            await fs.copyFile(change.shadowPath, change.originalPath)

            // Cleanup
            await fs.rm(change.shadowPath)
            change.status = 'approved'
            change.resolvedAt = Date.now()
            change.resolvedBy = resolvedBy
            this.pendingChanges.delete(changeId)
            this.clearFallbackTimer(changeId)
            
            // Cleanup session tracking
            for (const [, ids] of this.sessionChanges.entries()) {
                const index = ids.indexOf(changeId)
                if (index !== -1) {
                    ids.splice(index, 1)
                }
            }

            console.log(`[FileSystemService] ✓ Committed ${change.type} to ${change.originalPath} (By: ${resolvedBy})`)

            // Notify pendings API so tool call unblocks
            const resolver = this.pendingResolvers.get(changeId)
            if (resolver) {
                resolver.resolve('approved')
                this.pendingResolvers.delete(changeId)
            }
        } catch (error) {
            console.error(`[FileSystemService] ✗ Failed to commit ${changeId}:`, error)
            throw error
        }
    }

    /**
     * Discard a staged change (user rejected)
     * @param changeId Change UUID
     */
    async discardChange(changeId: string, resolvedBy: 'ui' | 'wa' = 'ui'): Promise<void> {
        const change = this.pendingChanges.get(changeId)
        if (!change) return // Already discarded
        if (resolvedBy === 'ui' && change.approvalChannel === 'whatsapp' && change.status === 'pending') {
            throw new Error('This change is currently locked for WhatsApp rejection. Wait for timeout/disconnect or reject via token.')
        }

        try {
            await fs.rm(change.shadowPath)
            change.status = 'rejected'
            change.resolvedAt = Date.now()
            change.resolvedBy = resolvedBy
            this.pendingChanges.delete(changeId)
            this.clearFallbackTimer(changeId)
            
            // Cleanup session tracking
            for (const [, ids] of this.sessionChanges.entries()) {
                const index = ids.indexOf(changeId)
                if (index !== -1) {
                    ids.splice(index, 1)
                }
            }

            console.log(`[FileSystemService] ✗ Discarded ${change.type} for ${change.originalPath} (By: ${resolvedBy})`)

            // Notify pendings API so tool call unblocks
            const resolver = this.pendingResolvers.get(changeId)
            if (resolver) {
                resolver.resolve('rejected')
                this.pendingResolvers.delete(changeId)
            }
        } catch (error) {
            console.error(`[FileSystemService] Failed to discard ${changeId}:`, error)
        }
    }

    /**
     * Get all pending changes for a session
     * @param sessionId Session identifier
     * @returns Array of pending changes
     */
    getPendingChanges(sessionId: string = 'default'): FileChange[] {
        const ids = this.sessionChanges.get(sessionId) || []
        return ids.map(id => this.pendingChanges.get(id)!).filter(Boolean)
    }

    async approveByToken(token: string, resolvedBy: 'ui' | 'wa' = 'wa'): Promise<{ success: boolean; error?: string }> {
        const result = await this.resolveApprovalByToken(token.toUpperCase(), 'approve', resolvedBy)
        return result.ok ? { success: true } : { success: false, error: result.message }
    }

    async rejectByToken(token: string, resolvedBy: 'ui' | 'wa' = 'wa'): Promise<{ success: boolean; error?: string }> {
        const result = await this.resolveApprovalByToken(token.toUpperCase(), 'reject', resolvedBy)
        return result.ok ? { success: true } : { success: false, error: result.message }
    }

    forceRemoteApprovalForTesting(changeId: string, token?: string): { success: boolean; token?: string; error?: string } {
        const change = this.pendingChanges.get(changeId)
        if (!change) return { success: false, error: 'Change not found' }
        const approvalToken = (token || this.generateToken()).toUpperCase()
        change.approvalChannel = 'whatsapp'
        change.status = 'pending'
        change.approvalToken = approvalToken
        this.startFallbackTimer(changeId)
        return { success: true, token: approvalToken }
    }

    // ========================================================================
    // MCP TOOL INTERFACE
    // ========================================================================

    /**
     * List available tools for MCP
     */
    listTools(): { tools: ToolSchema[] } {
        return { tools: FILESYSTEM_TOOLS }
    }

    /**
     * Execute a tool call from AI agent
     * Respects Safe Mode setting for write operations
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResponse> {
        try {
            switch (name) {
                case 'fs_write_file': {
                    const filePath = typeof args.path === 'string' ? args.path : ''
                    const content = typeof args.content === 'string' ? args.content : ''
                    if (!filePath) {
                        return { result: null, error: 'Missing required parameter: path' }
                    }
                    if (typeof args.content !== 'string') {
                        return { result: null, error: 'Missing required parameter: content' }
                    }

                    const isSafeMode = await this.isSafeModeEnabled()

                    if (isSafeMode) {
                        // Safe Mode: Stage for user review and block tool call
                        const change = await this.stageWrite(filePath, content)
                        
                        // Notify via WhatsApp if connected
                        try {
                            const { whatsappService } = require('./WhatsAppService')
                            const state = whatsappService.getConnectionState()
                            if (state.status === 'connected' && state.phoneNumber) {
                                const token = this.generateToken()
                                change.approvalToken = token
                                change.approvalChannel = 'whatsapp'
                                change.status = 'pending'
                                this.startFallbackTimer(change.id)

                                const fileName = path.basename(filePath)
                                const sessionHint = change.id.slice(0, 8)
                                const msg = `⚠️ *Agent wants to modify a file:*\n📄 \`${fileName}\`\n🆔 ${sessionHint}\n\nReply *APPROVE ${token}* to apply or *REJECT ${token}* to cancel.`
                                const sent = await whatsappService.sendMessage(state.phoneNumber, msg)
                                if (!sent?.success) {
                                    this.fallbackRemoteApprovalsToDesktop('disconnect')
                                }
                            }
                        } catch (waError) {
                            console.error('[FileSystemService] WhatsApp notification skipped', waError)
                        }

                        // Block until Approved or Rejected
                        return new Promise((resolve) => {
                            this.pendingResolvers.set(change.id, {
                                resolve: (status: 'approved' | 'rejected') => {
                                    if (status === 'approved') {
                                        resolve({
                                            result: {
                                                status: 'written',
                                                path: filePath,
                                                message: `File successfully written to ${filePath} (Approved via Safe Mode)`
                                            }
                                        })
                                    } else {
                                         resolve({
                                            result: null,
                                            error: `User REJECTED the file write to ${filePath}. Abort your attempt to modify this file.`
                                         })
                                    }
                                }
                            })
                        })
                    } else {
                        // Direct write (Safe Mode disabled)
                        await fs.mkdir(path.dirname(filePath), { recursive: true })
                        await fs.writeFile(filePath, content, 'utf8')
                        return {
                            result: {
                                status: 'written',
                                path: filePath,
                                message: `File written to ${filePath}`
                            }
                        }
                    }
                }

                case 'fs_read_file': {
                    const filePath = typeof args.path === 'string' ? args.path : ''
                    if (!filePath) {
                        return { result: null, error: 'Missing required parameter: path' }
                    }
                    const readContent = await fs.readFile(filePath, 'utf8')
                    return { result: readContent }
                }

                case 'fs_list_directory': {
                    const directoryPath = typeof args.path === 'string' ? args.path : ''
                    if (!directoryPath) {
                        return { result: null, error: 'Missing required parameter: path' }
                    }
                    const files = await fs.readdir(directoryPath)
                    return { result: files }
                }

                default:
                    return {
                        result: null,
                        error: `Unknown tool: ${name}. Available tools: ${FILESYSTEM_TOOLS.map(t => t.name).join(', ')}`
                    }
            }
        } catch (error) {
            return {
                result: null,
                error: error instanceof Error ? error.message : String(error)
            }
        }
    }
}
