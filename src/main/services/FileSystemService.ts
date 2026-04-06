import { promises as fs } from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { Store } from '../lib/store-wrapper'

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
    meta?: Record<string, unknown>
}

/**
 * Safe Mode Settings
 */
interface SafeModeSettings {
    safeMode?: boolean
    autoApprove?: boolean
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

    private constructor() {
        // Shadow directory in app user data
        this.shadowDir = path.join(app.getPath('userData'), 'fs-staging')
        this.initialize()
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
     * Remove a change ID from all session index lists.
     * Prevents stale session references from accumulating indefinitely.
     */
    private removeChangeFromSessions(changeId: string): void {
        for (const [sessionId, ids] of this.sessionChanges.entries()) {
            const next = ids.filter(id => id !== changeId)
            if (next.length > 0) {
                this.sessionChanges.set(sessionId, next)
            } else {
                this.sessionChanges.delete(sessionId)
            }
        }
    }

    /**
     * Find an existing pending change for the same target path in a session.
     */
    private findPendingChangeForPath(filePath: string, sessionId: string): FileChange | undefined {
        const ids = this.sessionChanges.get(sessionId) || []
        for (const id of ids) {
            const change = this.pendingChanges.get(id)
            if (change && change.originalPath === filePath) return change
        }
        return undefined
    }

    /**
     * Check if Safe Mode is enabled
     * @private
     */
    private async getSafeModeSettings(): Promise<{ safeMode: boolean; autoApprove: boolean }> {
        try {
            // Must use the same store namespace as ipc/store.ts and settingsStore.
            const store = new Store<Record<string, any>>({
                name: 'ai-worker-store',
                defaults: {},
            })
            const settings = ((store as any).get('mcpFileSystem', {}) as any) as SafeModeSettings
            return {
                safeMode: settings.safeMode !== false, // Default to true
                autoApprove: settings.autoApprove === true, // Default to false
            }
        } catch (error) {
            console.warn('[FileSystemService] Failed to check safe mode, defaulting to enabled:', error)
            return {
                safeMode: true, // Fail-safe to protect user files
                autoApprove: false,
            }
        }
    }

    private normalizePathForCompare(value: string): string {
        return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    }

    private isPathWithin(rootPath: string, targetPath: string): boolean {
        const normalizedRoot = this.normalizePathForCompare(rootPath)
        const normalizedTarget = this.normalizePathForCompare(targetPath)
        return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
    }

    private resolveWorkspaceForUserOps(workspacePath: unknown): string {
        if (typeof workspacePath !== 'string' || workspacePath.trim() === '') {
            throw new Error('WORKSPACE REQUIRED: Select a workspace folder before filesystem operations.')
        }

        const resolvedWorkspace = path.resolve(workspacePath.trim())
        return resolvedWorkspace
    }

    private resolveWorkspaceScopedTargetPath(
        targetPath: unknown,
        workspacePath: unknown,
        toolName: string
    ): string {
        if (typeof targetPath !== 'string' || targetPath.trim() === '') {
            throw new Error(`Missing required path for ${toolName}.`)
        }

        const resolvedWorkspace = this.resolveWorkspaceForUserOps(workspacePath)
        const rawTargetPath = targetPath.trim()
        const resolvedTarget = path.isAbsolute(rawTargetPath)
            ? path.resolve(rawTargetPath)
            : path.resolve(resolvedWorkspace, rawTargetPath)

        if (!this.isPathWithin(resolvedWorkspace, resolvedTarget)) {
            throw new Error(
                `SECURITY VIOLATION: Access denied. Path '${resolvedTarget}' is outside the active workspace '${resolvedWorkspace}'.`
            )
        }

        return resolvedTarget
    }

    /**
     * Internal tracking files are written by the app itself and should not
     * require staged user approval even when Safe Mode is enabled.
     */
    private isInternalTrackingFile(filePath: string): boolean {
        const fileName = path.basename(filePath).toLowerCase()
        if (fileName !== 'tasks.json' && fileName !== 'execution-plan.json') return false

        const internalRoot = path.resolve(path.join(app.getPath('home'), '.ai-worker', 'system-workspace'))
        return this.isPathWithin(internalRoot, path.resolve(filePath))
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
        // Coalesce repeated writes to the same file into one pending entry.
        // This prevents the review panel from growing with duplicate looped writes.
        const existing = this.findPendingChangeForPath(filePath, sessionId)
        if (existing) {
            await fs.mkdir(path.dirname(existing.shadowPath), { recursive: true })
            await fs.writeFile(existing.shadowPath, content, 'utf8')
            existing.type = await this.fileExists(filePath) ? 'modify' : 'create'
            existing.content = content.length < 10000 ? content : undefined
            existing.timestamp = Date.now()
            this.pendingChanges.set(existing.id, existing)
            console.log(`[FileSystemService] Updated staged ${existing.type} for ${filePath} (ID: ${existing.id})`)
            return existing
        }

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
            timestamp: Date.now()
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
    async commitChange(changeId: string): Promise<void> {
        const change = this.pendingChanges.get(changeId)
        if (!change) {
            throw new Error(`Change ${changeId} not found in pending changes`)
        }

        try {
            // Ensure parent directory exists
            await fs.mkdir(path.dirname(change.originalPath), { recursive: true })

            // Copy shadow file to real location
            await fs.copyFile(change.shadowPath, change.originalPath)

            // Cleanup
            await fs.rm(change.shadowPath)
            this.pendingChanges.delete(changeId)
            this.removeChangeFromSessions(changeId)

            console.log(`[FileSystemService] ✓ Committed ${change.type} to ${change.originalPath}`)
        } catch (error) {
            console.error(`[FileSystemService] ✗ Failed to commit ${changeId}:`, error)
            throw error
        }
    }

    /**
     * Discard a staged change (user rejected)
     * @param changeId Change UUID
     */
    async discardChange(changeId: string): Promise<void> {
        const change = this.pendingChanges.get(changeId)
        if (!change) return // Already discarded

        try {
            await fs.rm(change.shadowPath)
            this.pendingChanges.delete(changeId)
            this.removeChangeFromSessions(changeId)
            console.log(`[FileSystemService] ✗ Discarded ${change.type} for ${change.originalPath}`)
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
        const resolved: FileChange[] = []
        const aliveIds: string[] = []

        for (const id of ids) {
            const change = this.pendingChanges.get(id)
            if (!change) continue
            resolved.push(change)
            aliveIds.push(id)
        }

        // Heal stale session index entries opportunistically.
        if (aliveIds.length !== ids.length) {
            if (aliveIds.length > 0) this.sessionChanges.set(sessionId, aliveIds)
            else this.sessionChanges.delete(sessionId)
        }

        return resolved
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
    async callTool(name: string, args: any): Promise<ToolCallResponse> {
        try {
            switch (name) {
                case 'fs_write_file': {
                    const { safeMode: isSafeMode, autoApprove } = await this.getSafeModeSettings()
                    const resolvedPath = this.resolveWorkspaceScopedTargetPath(args?.path, args?.workspacePath, name)
                    const isInternalTrackingWrite = this.isInternalTrackingFile(resolvedPath)
                    const sessionId =
                        typeof args?._sessionId === 'string' && args._sessionId.trim() !== ''
                            ? args._sessionId.trim()
                            : 'default'
                    const hasSessionAutoApproveOverride = typeof args?._sessionAutoApprove === 'boolean'
                    const sessionAutoApprove = args?._sessionAutoApprove === true
                    const effectiveAutoApprove = hasSessionAutoApproveOverride
                        ? sessionAutoApprove
                        : autoApprove

                    if (isSafeMode && !effectiveAutoApprove && !isInternalTrackingWrite) {
                        // Safe Mode: Stage for user review
                        const change = await this.stageWrite(resolvedPath, args.content, sessionId)
                        return {
                            result: {
                                status: 'staged',
                                changeId: change.id,
                                message: `File write STAGED for review. Change ID: ${change.id}. User must approve before changes are applied.`
                            }
                        }
                    } else {
                        // Direct write:
                        // - Safe Mode disabled OR
                        // - Auto-approve enabled OR
                        // - Internal tracking file
                        await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
                        await fs.writeFile(resolvedPath, args.content, 'utf8')
                        const status = isInternalTrackingWrite
                            ? 'written_internal'
                            : sessionAutoApprove
                                ? 'written_session_auto_approved'
                                : autoApprove
                                ? 'written_auto_approved'
                                : 'written'
                        return {
                            result: {
                                status,
                                path: resolvedPath,
                                message: isInternalTrackingWrite
                                    ? `Internal tracking file updated: ${resolvedPath}`
                                    : sessionAutoApprove
                                        ? `File written with session auto-approval: ${resolvedPath}`
                                    : autoApprove
                                        ? `File written with auto-approval: ${resolvedPath}`
                                    : `File written to ${resolvedPath}`
                            }
                        }
                    }
                }

                case 'fs_read_file': {
                    const resolvedPath = this.resolveWorkspaceScopedTargetPath(args?.path, args?.workspacePath, name)
                    const content = await fs.readFile(resolvedPath, 'utf8')
                    return { result: content }
                }

                case 'fs_list_directory': {
                    const resolvedPath = this.resolveWorkspaceScopedTargetPath(args?.path, args?.workspacePath, name)
                    const files = await fs.readdir(resolvedPath)
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
