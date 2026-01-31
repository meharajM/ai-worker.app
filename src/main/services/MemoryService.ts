import Database from 'better-sqlite3'
import { app } from 'electron'
import * as path from 'path'
import { MemoryServiceFactory } from './memory/MemoryServiceFactory'
import { PIIDetector } from './memory/privacy/PIIDetector'
import { SecretRedactor } from './memory/privacy/SecretRedactor'
import { MetricsCollector } from './memory/MetricsCollector'
import { MigrationService } from './memory/MigrationService'
import type { UnifiedMemoryBackend, CreateEntityInput, Entity as BackendEntity, ExportData } from './memory/UnifiedMemoryBackend'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * MCP Tool Schema Definition
 * Describes the structure of tools exposed to AI agents
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
 * Knowledge Graph Entity (Legacy SQLite format)
 * Kept for backward compatibility during migration
 */
export interface Entity {
    id: string
    name: string
    type: string
    description: string
    metadata: Record<string, any>
    created_at: string
    updated_at: string
}

/**
 * Knowledge Graph Relation (Legacy SQLite format)
 */
export interface Relation {
    id: string
    from_entity_id: string
    to_entity_id: string
    relation_type: string
    description: string
    weight: number
}

/**
 * Tool Call Response
 */
interface ToolCallResponse {
    result: any
    error?: string
}

// ============================================================================
// TOOL DEFINITIONS (MCP Schema)
// ============================================================================

const MEMORY_TOOLS: ToolSchema[] = [
    {
        name: 'memory_create_entity',
        description: 'Create a new entity in the knowledge graph. Use this to remember people, concepts, files, or projects.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { 
                    type: 'string', 
                    description: 'Display name of the entity' 
                },
                type: { 
                    type: 'string', 
                    description: 'Category: person, project, concept, file, etc.' 
                },
                description: { 
                    type: 'string', 
                    description: 'Detailed description for context and searchability' 
                },
                metadata: { 
                    type: 'object', 
                    description: 'Optional structured data (JSON object)' 
                }
            },
            required: ['name', 'type', 'description']
        }
    },
    {
        name: 'memory_create_relation',
        description: 'Create a relationship between two entities. Connect concepts in the knowledge graph.',
        inputSchema: {
            type: 'object',
            properties: {
                from_entity_id: { 
                    type: 'string', 
                    description: 'UUID of the source entity' 
                },
                to_entity_id: { 
                    type: 'string', 
                    description: 'UUID of the target entity' 
                },
                relation_type: { 
                    type: 'string', 
                    description: 'Relationship type: works_on, author_of, relates_to, etc.' 
                },
                description: { 
                    type: 'string', 
                    description: 'Context about this relationship' 
                },
                weight: { 
                    type: 'number', 
                    description: 'Relationship strength from 0.0 (weak) to 1.0 (strong)' 
                }
            },
            required: ['from_entity_id', 'to_entity_id', 'relation_type']
        }
    },
    {
        name: 'memory_search',
        description: 'Search the knowledge graph using full-text search. Returns matching entities.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { 
                    type: 'string', 
                    description: 'Search query (natural language)' 
                },
                limit: { 
                    type: 'number', 
                    description: 'Maximum results to return (default: 10)' 
                }
            },
            required: ['query']
        }
    },
    {
        name: 'memory_update_entity',
        description: 'Update an existing entity. Use this to correct facts or add new observations to existing entities.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { 
                    type: 'string', 
                    description: 'The UUID of the entity to update (from search results)' 
                },
                description: { 
                    type: 'string', 
                    description: 'New or updated description' 
                },
                observation: {
                    type: 'string',
                    description: 'A new observation to append to the list'
                },
                metadata: { 
                    type: 'object', 
                    description: 'Merged metadata updates' 
                }
            },
            required: ['id']
        }
    }
]

// ============================================================================
// MEMORY SERVICE (Refactored with UnifiedMemoryBackend)
// ============================================================================

/**
 * MemoryService - Knowledge Graph with Unified Backend
 * 
 * ARCHITECTURE:
 * - Uses UnifiedMemoryBackend interface for swappable backends
 * - Default: ServerMemoryAdapter (@modelcontextprotocol/server-memory)
 * - Future: MementoMCPAdapter (Neo4j) for scaling
 * - Privacy: PII/Secret detection before storage
 * - Metrics: Auto-track usage for migration suggestions
 * 
 * MIGRATION PATH:
 * - Existing SQLite data → Export to JSON
 * - Import to ServerMemoryAdapter
 * - When scaling needed → Migrate to MementoMCP
 * 
 * Usage:
 *   const memory = MemoryService.getInstance()
 *   await memory.initialize()
 *   const entity = await memory.createEntity('John Doe', 'person', 'Engineer')
 */
export class MemoryService {
    private static instance: MemoryService
    
    // New architecture components
    private backend: UnifiedMemoryBackend | null = null
    private piiDetector: PIIDetector
    private secretRedactor: SecretRedactor
    private metricsCollector: MetricsCollector
    private migrationService: MigrationService
    
    // Legacy SQLite (for migration fallback)
    private legacyDb: Database.Database | null = null
    private legacyDbPath: string
    
    private initialized = false

    private constructor() {
        this.legacyDbPath = path.join(app.getPath('userData'), 'memory.db')
        
        // Initialize privacy and metrics layers
        this.piiDetector = new PIIDetector()
        this.secretRedactor = new SecretRedactor()
        this.metricsCollector = new MetricsCollector()
        this.migrationService = new MigrationService()
    }

    /**
     * Get the singleton instance
     */
    static getInstance(): MemoryService {
        if (!MemoryService.instance) {
            MemoryService.instance = new MemoryService()
        }
        return MemoryService.instance
    }

    /**
     * Initialize the memory system
     * - Loads backend from config (server-memory or memento-mcp)
     * - Migrates legacy SQLite data if needed
     * - Sets up privacy checks and metrics
     */
    async initialize(): Promise<void> {
        if (this.initialized) return

        try {
            console.log('[MemoryService] Initializing with UnifiedMemoryBackend architecture...')
            
            // Create backend from factory
            this.backend = MemoryServiceFactory.create()
            await this.backend.initialize()
            
            console.log(`[MemoryService] Backend initialized: ${MemoryServiceFactory.getCurrentBackend()}`)
            
            // Check if legacy SQLite data exists and needs migration
            await this.migrateLegacyDataIfNeeded()
            
            this.initialized = true
            console.log('[MemoryService] Initialization complete')
        } catch (error) {
            console.error('[MemoryService] Failed to initialize:', error)
            throw error
        }
    }

    /**
     * Migrate legacy SQLite data to new backend if needed
     * @private
     */
    private async migrateLegacyDataIfNeeded(): Promise<void> {
        try {
            // Check if legacy SQLite database exists
            const fs = await import('fs/promises')
            try {
                await fs.access(this.legacyDbPath)
            } catch {
                // No legacy database, skip migration
                console.log('[MemoryService] No legacy SQLite database found, skipping migration')
                return
            }

            // Check if backend already has data
            const stats = await this.backend!.getStats()
            if (stats.entityCount > 0) {
                console.log('[MemoryService] Backend already has data, skipping migration')
                return
            }

            console.log('[MemoryService] Migrating legacy SQLite data to new backend...')
            
            // Export from SQLite
            const legacyData = await this.exportLegacySQLiteData()
            
            if (legacyData.entities.length === 0) {
                console.log('[MemoryService] No legacy data to migrate')
                return
            }

            // Import to new backend
            await this.backend!.importAll(legacyData)
            
            console.log(`[MemoryService] Migrated ${legacyData.entities.length} entities and ${legacyData.relations.length} relations`)
            
            // Archive legacy database
            await fs.rename(this.legacyDbPath, this.legacyDbPath + '.backup')
            console.log('[MemoryService] Legacy database archived as memory.db.backup')
        } catch (error) {
            console.error('[MemoryService] Legacy migration failed (non-critical):', error)
        }
    }

    /**
     * Export data from legacy SQLite database
     * @private
     */
    private async exportLegacySQLiteData(): Promise<ExportData> {
        this.legacyDb = new Database(this.legacyDbPath)
        
        try {
            // Export entities
            const entitiesStmt = this.legacyDb.prepare('SELECT * FROM entities')
            const entityRows = entitiesStmt.all() as any[]
            
            const entities: BackendEntity[] = entityRows.map(row => ({
                id: row.id,
                name: row.name,
                type: row.type,
                description: row.description || '',
                observations: row.description ? [row.description] : [],
                metadata: row.metadata ? JSON.parse(row.metadata) : {},
                createdAt: row.created_at || new Date().toISOString()
            }))

            // Export relations (convert to new format)
            const relationsStmt = this.legacyDb.prepare('SELECT * FROM relations')
            const relationRows = relationsStmt.all() as any[]
            
            const relations = relationRows.map(row => ({
                id: row.id,
                fromEntityId: row.from_entity_id,
                toEntityId: row.to_entity_id,
                relationType: row.relation_type,
                description: row.description,
                metadata: { weight: row.weight }
            }))

            return {
                entities,
                relations,
                metadata: {
                    exportedAt: new Date().toISOString(),
                    version: '1.0.0',
                    backend: 'legacy-sqlite'
                }
            }
        } finally {
            this.legacyDb.close()
            this.legacyDb = null
        }
    }

    // ========================================================================
    // ENTITY OPERATIONS (with Privacy Checks)
    // ========================================================================

    /**
     * Create a new entity with privacy and security checks
     */
    async createEntity(
        name: string,
        type: string,
        description: string = '',
        metadata: Record<string, any> = {}
    ): Promise<Entity> {
        if (!this.backend) await this.initialize()

        // Ensure string inputs
        const safeDesc = description || ''

        // Privacy Check 1: Detect PII
        const piiCheck = this.piiDetector.detect(safeDesc)
        if (piiCheck.found) {
            throw new Error(
                `PII detected in description: ${piiCheck.types.join(', ')}. ` +
                `Please redact sensitive information before storing.`
            )
        }

        // Privacy Check 2: Detect Secrets
        this.secretRedactor.check(safeDesc)

        // Create entity via backend
        const input: CreateEntityInput = {
            name,
            type,
            description: safeDesc,
            observations: [safeDesc],
            metadata
        }

        const backendEntity = await this.backend!.createEntity(input)

        // Update metrics
        this.metricsCollector.increment('entityCount')
        
        // Check if migration suggestion needed
        await this.migrationService.checkAndNotify(this.metricsCollector)

        // Convert to legacy format for backward compatibility
        return this.convertToLegacyEntity(backendEntity)
    }

    /**
     * Get entity by ID
     */
    async getEntity(id: string): Promise<Entity | undefined> {
        if (!this.backend) await this.initialize()

        const backendEntity = await this.backend!.getEntity(id)
        return backendEntity ? this.convertToLegacyEntity(backendEntity) : undefined
    }

    /**
     * Search entities with metrics tracking
     */
    async search(query: string, limit: number = 10): Promise<Entity[]> {
        if (!this.backend) await this.initialize()

        const startTime = Date.now()
        
        const results = await this.backend!.search(query, { limit })
        
        const latency = Date.now() - startTime
        this.metricsCollector.recordLatency(latency)

        return results.map(e => this.convertToLegacyEntity(e))
    }

    // ========================================================================
    // RELATION OPERATIONS
    // ========================================================================

    /**
     * Create a relationship between entities
     */
    async createRelation(
        fromId: string,
        toId: string,
        relationType: string,
        description: string = '',
        weight: number = 1.0
    ): Promise<Relation> {
        if (!this.backend) await this.initialize()

        const relation = await this.backend!.createRelation({
            fromEntityId: fromId,
            toEntityId: toId,
            relationType,
            description,
            metadata: { weight }
        })

        this.metricsCollector.increment('relationCount')

        return {
            id: relation.id,
            from_entity_id: relation.fromEntityId,
            to_entity_id: relation.toEntityId,
            relation_type: relation.relationType,
            description: relation.description || '',
            weight: relation.metadata?.weight || 1.0
        }
    }

    // ========================================================================
    // MCP TOOL INTERFACE
    // ========================================================================

    /**
     * List available MCP tools
     */
    listTools(): { tools: ToolSchema[] } {
        return { tools: MEMORY_TOOLS }
    }

    /**
     * Execute MCP tool call
     */
    async callTool(name: string, args: any): Promise<ToolCallResponse> {
        try {
            if (!this.backend) await this.initialize()

            switch (name) {
                case 'memory_create_entity': {
                    const entity = await this.createEntity(
                        args.name,
                        args.type,
                        args.description,
                        args.metadata
                    )
                    return { result: entity }
                }

                case 'memory_create_relation': {
                    const relation = await this.createRelation(
                        args.from_entity_id,
                        args.to_entity_id,
                        args.relation_type,
                        args.description,
                        args.weight
                    )
                    return { result: relation }
                }

                case 'memory_search': {
                    const results = await this.search(args.query, args.limit)
                    return { result: results }
                }

                case 'memory_update_entity': {
                    // Check if updateEntity exists on backend (it should via UnifiedMemoryBackend)
                    if (this.backend && 'updateEntity' in this.backend) {
                        try {
                            const updated = await this.backend.updateEntity(args.id, {
                                description: args.description,
                                observations: args.observation ? [args.observation] : undefined,
                                metadata: args.metadata
                            })
                            return { result: this.convertToLegacyEntity(updated) }
                        } catch (e) {
                            return { result: null, error: `Update failed: ${e instanceof Error ? e.message : String(e)}` }
                        }
                    } else {
                        return { result: null, error: 'Backend does not support entity updates' }
                    }
                }

                default:
                    return {
                        result: null,
                        error: `Unknown tool: ${name}. Available: ${MEMORY_TOOLS.map(t => t.name).join(', ')}`
                    }
            }
        } catch (error) {
            return {
                result: null,
                error: error instanceof Error ? error.message : String(error)
            }
        }
    }

    // ========================================================================
    // METRICS & MIGRATION
    // ========================================================================

    /**
     * Get memory statistics
     */
    async getStats() {
        if (!this.backend) await this.initialize()
        return await this.backend!.getStats()
    }

    /**
     * Export all data
     */
    async exportAll(): Promise<ExportData> {
        if (!this.backend) await this.initialize()
        return await this.backend!.exportAll()
    }

    /**
     * Trigger migration to Memento-MCP
     */
    async migrateToMemento() {
        if (!this.backend) await this.initialize()
        return await this.migrationService.migrateToMemento(this.backend!)
    }

    /**
     * Check if migration is suggested based on current metrics
     */
    async shouldSuggestMigration(): Promise<boolean> {
        if (!this.backend) await this.initialize()
        return await this.metricsCollector.shouldSuggestMigration()
    }

    // ========================================================================
    // HELPER METHODS
    // ========================================================================

    /**
     * Convert backend entity to legacy format
     * @private
     */
    private convertToLegacyEntity(backendEntity: BackendEntity): Entity {
        return {
            id: backendEntity.id,
            name: backendEntity.name,
            type: backendEntity.type,
            description: backendEntity.description,
            metadata: backendEntity.metadata,
            created_at: backendEntity.createdAt,
            updated_at: backendEntity.updatedAt || backendEntity.createdAt
        }
    }
}
