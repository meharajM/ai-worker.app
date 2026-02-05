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
     * Check if Safe Mode is enabled
     * @private
     */
    private async isSafeModeEnabled(): Promise<boolean> {
        try {
            const Store = (await import('electron-store')).default
            const store = new Store<Record<string, any>>()
            const settings = ((store as any).get('mcpFileSystem', {}) as any) as SafeModeSettings
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
        return ids.map(id => this.pendingChanges.get(id)!).filter(Boolean)
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
                    const isSafeMode = await this.isSafeModeEnabled()

                    if (isSafeMode) {
                        // Safe Mode: Stage for user review
                        const change = await this.stageWrite(args.path, args.content)
                        return {
                            result: {
                                status: 'staged',
                                changeId: change.id,
                                message: `File write STAGED for review. Change ID: ${change.id}. User must approve before changes are applied.`
                            }
                        }
                    } else {
                        // Direct write (Safe Mode disabled)
                        await fs.mkdir(path.dirname(args.path), { recursive: true })
                        await fs.writeFile(args.path, args.content, 'utf8')
                        return {
                            result: {
                                status: 'written',
                                path: args.path,
                                message: `File written to ${args.path}`
                            }
                        }
                    }
                }

                case 'fs_read_file': {
                    const content = await fs.readFile(args.path, 'utf8')
                    return { result: content }
                }

                case 'fs_list_directory': {
                    const files = await fs.readdir(args.path)
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
