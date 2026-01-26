import Database from 'better-sqlite3'
import { app } from 'electron'
import * as path from 'path'
import { randomUUID } from 'crypto'

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
 * Knowledge Graph Entity
 * Represents a node in the memory graph (person, concept, project, etc.)
 */
export interface Entity {
    id: string                          // Unique identifier (UUID)
    name: string                        // Display name
    type: string                        // Entity type (e.g., "person", "project", "concept")
    description: string                 // Detailed description
    metadata: Record<string, any>       // Additional structured data
    created_at: string                  // Creation timestamp
    updated_at: string                  // Last updated timestamp
}

/**
 * Knowledge Graph Relation
 * Represents an edge between two entities in the memory graph
 */
export interface Relation {
    id: string                          // Unique identifier (UUID)
    from_entity_id: string              // Source entity UUID
    to_entity_id: string                // Target entity UUID
    relation_type: string               // Type of relationship (e.g., "works_on", "author_of")
    description: string                 // Description of the relationship
    weight: number                      // Relationship strength (0.0 to 1.0)
}

/**
 * Tool Call Response
 * Standard response format for MCP tool calls
 */
interface ToolCallResponse {
    result: any
    error?: string
}

// ============================================================================
// TOOL DEFINITIONS (MCP Schema)
// ============================================================================

/**
 * Tool schemas define how AI agents can interact with the memory system.
 * These are exposed via MCP (Model Context Protocol).
 */
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
    }
]

// ============================================================================
// MEMORY SERVICE (Singleton)
// ============================================================================

/**
 * MemoryService - In-Process Knowledge Graph
 * 
 * Provides long-term memory for AI agents using SQLite with full-text search.
 * Implements a knowledge graph with entities and relations.
 * 
 * Architecture:
 * - Singleton pattern for global access
 * - SQLite database with WAL mode for concurrency
 * - FTS5 virtual table for full-text search
 * - Automatic triggers to sync FTS index
 * 
 * Usage:
 *   const memory = MemoryService.getInstance()
 *   memory.initialize()
 *   const entity = memory.createEntity('John Doe', 'person', 'Software engineer')
 */
export class MemoryService {
    private static instance: MemoryService
    private db: Database.Database | null = null
    private dbPath: string

    private constructor() {
        this.dbPath = path.join(app.getPath('userData'), 'memory.db')
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
     * Initialize the database and create schema if needed
     * Safe to call multiple times (idempotent)
     */
    initialize(): void {
        if (this.db) return

        try {
            console.log(`[MemoryService] Initializing database at ${this.dbPath}`)
            this.db = new Database(this.dbPath)
            this.db.pragma('journal_mode = WAL')  // Enable write-ahead logging for better concurrency
            this.setupSchema()
            console.log('[MemoryService] Database initialized successfully')
        } catch (error) {
            console.error('[MemoryService] Failed to initialize database:', error)
            throw error
        }
    }

    /**
     * Create database schema with FTS5 integration
     * @private
     */
    private setupSchema(): void {
        if (!this.db) return

        const schema = `
            -- Main entities table
            CREATE TABLE IF NOT EXISTS entities (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT,
                description TEXT,
                metadata JSON,
                search_text TEXT GENERATED ALWAYS AS (name || ' ' || description) VIRTUAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- FTS5 virtual table for full-text search
            CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
                name, 
                description, 
                type, 
                content='entities', 
                content_rowid='rowid'
            );

            -- FTS sync triggers
            DROP TRIGGER IF EXISTS entities_ai;
            CREATE TRIGGER entities_ai AFTER INSERT ON entities BEGIN
                INSERT INTO entities_fts(rowid, name, description, type) 
                VALUES (new.rowid, new.name, new.description, new.type);
            END;

            DROP TRIGGER IF EXISTS entities_ad;
            CREATE TRIGGER entities_ad AFTER DELETE ON entities BEGIN
                INSERT INTO entities_fts(entities_fts, rowid, name, description, type) 
                VALUES('delete', old.rowid, old.name, old.description, old.type);
            END;

            DROP TRIGGER IF EXISTS entities_au;
            CREATE TRIGGER entities_au AFTER UPDATE ON entities BEGIN
                INSERT INTO entities_fts(entities_fts, rowid, name, description, type) 
                VALUES('delete', old.rowid, old.name, old.description, old.type);
                INSERT INTO entities_fts(rowid, name, description, type) 
                VALUES (new.rowid, new.name, new.description, new.type);
            END;

            -- Relations table (graph edges)
            CREATE TABLE IF NOT EXISTS relations (
                id TEXT PRIMARY KEY,
                from_entity_id TEXT NOT NULL,
                to_entity_id TEXT NOT NULL,
                relation_type TEXT NOT NULL,
                description TEXT,
                weight REAL DEFAULT 1.0,
                FOREIGN KEY(from_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
                FOREIGN KEY(to_entity_id) REFERENCES entities(id) ON DELETE CASCADE
            );

            -- Indexes for efficient graph traversal
            CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity_id);
            CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity_id);
        `

        this.db.exec(schema)
    }

    /**
     * Parse raw database row into Entity object with JSON metadata
     * @private
     */
    private parseEntity(row: any): Entity {
        return {
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) : {}
        }
    }

    // ========================================================================
    // ENTITY OPERATIONS
    // ========================================================================

    /**
     * Create a new entity in the knowledge graph
     * @param name Display name
     * @param type Entity category (person, project, concept, etc.)
     * @param description Detailed description
     * @param metadata Optional structured data
     * @returns Created entity with UUID
     */
    createEntity(
        name: string, 
        type: string, 
        description: string, 
        metadata: Record<string, any> = {}
    ): Entity {
        if (!this.db) this.initialize()
        
        const id = randomUUID()
        const metaStr = JSON.stringify(metadata)
        
        const stmt = this.db!.prepare(`
            INSERT INTO entities (id, name, type, description, metadata)
            VALUES (?, ?, ?, ?, ?)
        `)
        
        stmt.run(id, name, type, description, metaStr)
        
        return this.getEntity(id)!
    }

    /**
     * Retrieve an entity by ID
     * @param id Entity UUID
     * @returns Entity or undefined if not found
     */
    getEntity(id: string): Entity | undefined {
        if (!this.db) this.initialize()
        const stmt = this.db!.prepare('SELECT * FROM entities WHERE id = ?')
        const row = stmt.get(id)
        return row ? this.parseEntity(row) : undefined
    }

    /**
     * Search entities using full-text search
     * @param query Search query (natural language)
     * @param limit Maximum results (default: 10)
     * @returns Array of matching entities, ordered by relevance
     */
    search(query: string, limit: number = 10): Entity[] {
        if (!this.db) this.initialize()

        const stmt = this.db!.prepare(`
            SELECT * FROM entities 
            WHERE rowid IN (
                SELECT rowid 
                FROM entities_fts 
                WHERE entities_fts MATCH ? 
                ORDER BY rank
            )
            LIMIT ?
        `)
        
        // Sanitize query for FTS5 (escape double quotes)
        const sanitizedQuery = query.replace(/"/g, '""')
        const rows = stmt.all(sanitizedQuery, limit)
        return rows.map(row => this.parseEntity(row))
    }

    // ========================================================================
    // RELATION OPERATIONS
    // ========================================================================

    /**
     * Create a relationship between two entities
     * @param fromId Source entity UUID
     * @param toId Target entity UUID
     * @param relationType Type of relationship (e.g., "works_on", "author_of")
     * @param description Optional description of the relationship
     * @param weight Relationship strength (0.0 to 1.0, default: 1.0)
     * @returns Created relation
     */
    createRelation(
        fromId: string, 
        toId: string, 
        relationType: string, 
        description: string = '', 
        weight: number = 1.0
    ): Relation {
        if (!this.db) this.initialize()

        const id = randomUUID()
        const stmt = this.db!.prepare(`
            INSERT INTO relations (id, from_entity_id, to_entity_id, relation_type, description, weight)
            VALUES (?, ?, ?, ?, ?, ?)
        `)
        
        stmt.run(id, fromId, toId, relationType, description, weight)
        
        return { 
            id, 
            from_entity_id: fromId, 
            to_entity_id: toId, 
            relation_type: relationType, 
            description, 
            weight 
        }
    }

    // ========================================================================
    // MCP TOOL INTERFACE
    // ========================================================================

    /**
     * List available tools for MCP
     * @returns Tool schemas for AI agents
     */
    listTools(): { tools: ToolSchema[] } {
        return { tools: MEMORY_TOOLS }
    }

    /**
     * Execute a tool call from AI agent
     * @param name Tool name
     * @param args Tool arguments
     * @returns Tool execution result or error
     */
    async callTool(name: string, args: any): Promise<ToolCallResponse> {
        try {
            this.initialize()
            
            switch (name) {
                case 'memory_create_entity': {
                    const entity = this.createEntity(
                        args.name, 
                        args.type, 
                        args.description, 
                        args.metadata
                    )
                    return { result: entity }
                }

                case 'memory_create_relation': {
                    const relation = this.createRelation(
                        args.from_entity_id, 
                        args.to_entity_id, 
                        args.relation_type, 
                        args.description, 
                        args.weight
                    )
                    return { result: relation }
                }

                case 'memory_search': {
                    const results = this.search(args.query, args.limit)
                    return { result: results }
                }

                default:
                    return { 
                        result: null, 
                        error: `Unknown tool: ${name}. Available tools: ${MEMORY_TOOLS.map(t => t.name).join(', ')}` 
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
