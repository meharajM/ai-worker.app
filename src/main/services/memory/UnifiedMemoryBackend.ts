/**
 * UnifiedMemoryBackend - Interface for memory storage backends
 * 
 * This interface allows swapping between different memory implementations:
 * - @modelcontextprotocol/server-memory (MVP: 0-10K entities)
 * - memento-mcp (Scale: 10K+ entities, semantic search)
 * - Custom implementations (future)
 * 
 * Design Principle: Write once, swap backends via config
 */

export interface CreateEntityInput {
  name: string
  type: string
  description: string
  observations?: string[]
  metadata?: Record<string, any>
}

export interface Entity {
  id: string
  name: string
  type: string
  description: string
  observations: string[]
  metadata: Record<string, any>
  createdAt: string
  updatedAt?: string
}

export interface CreateRelationInput {
  fromEntityId: string
  toEntityId: string
  relationType: string
  description?: string
  metadata?: Record<string, any>
}

export interface Relation {
  id: string
  fromEntityId: string
  toEntityId: string
  relationType: string
  description?: string
  metadata?: Record<string, any>
}

export interface SearchOptions {
  limit?: number
  context?: {
    workspace?: string
    project?: string
  }
}

export interface MemoryStats {
  entityCount: number
  relationCount: number
  storageSize: number        // bytes
  avgSearchLatency: number   // milliseconds
  backend: string            // 'server-memory' | 'memento-mcp'
}

export interface ExportData {
  entities: Entity[]
  relations: Relation[]
  metadata: {
    exportedAt: string
    version: string
    backend: string
  }
}

/**
 * UnifiedMemoryBackend Interface
 * 
 * All memory backends must implement this interface.
 * This ensures app code remains unchanged when swapping backends.
 */
export interface UnifiedMemoryBackend {
  // Lifecycle
  initialize(): Promise<void>
  shutdown?(): Promise<void>
  
  // Entity Operations (CRUD)
  createEntity(input: CreateEntityInput): Promise<Entity>
  getEntity(id: string): Promise<Entity | null>
  updateEntity(id: string, updates: Partial<Entity>): Promise<Entity>
  deleteEntity(id: string): Promise<void>
  listEntities(options?: { limit?: number; offset?: number }): Promise<Entity[]>
  
  // Search
  search(query: string, options?: SearchOptions): Promise<Entity[]>
  
  // Relations
  createRelation(input: CreateRelationInput): Promise<Relation>
  getRelation(id: string): Promise<Relation | null>
  deleteRelation(id: string): Promise<void>
  listRelations(entityId: string): Promise<Relation[]>
  
  // Utility
  getStats(): Promise<MemoryStats>
  exportAll(): Promise<ExportData>
  importAll(data: ExportData): Promise<void>
  
  // MCP Tool Interface (for compatibility with MCP protocol)
  listTools(): { tools: any[] }
  callTool(name: string, args: any): Promise<{ result: any; error?: string }>
}
