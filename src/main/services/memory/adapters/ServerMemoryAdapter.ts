import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
  UnifiedMemoryBackend,
  CreateEntityInput,
  Entity,
  CreateRelationInput,
  Relation,
  SearchOptions,
  MemoryStats,
  ExportData
} from '../UnifiedMemoryBackend'

/**
 * ServerMemoryAdapter
 * 
 * Wraps @modelcontextprotocol/server-memory to implement UnifiedMemoryBackend.
 * This is the default backend for MVP (0-10K entities).
 * 
 * Features:
 * - Simple file-based storage (JSON)
 * - Fast for small datasets (< 10K entities)
 * - Zero setup required
 * - Automatic context filtering
 */
export class ServerMemoryAdapter implements UnifiedMemoryBackend {
  private client: Client | null = null
  private storagePath: string
  private entityCache: Map<string, Entity> = new Map()
  private relationCache: Map<string, Relation> = new Map()

  constructor(config: { storagePath: string }) {
    this.storagePath = config.storagePath
  }

  /**
   * Initialize the server-memory MCP client
   */
  async initialize(): Promise<void> {
    try {
      // Ensure storage directory exists before starting MCP server
      const fs = await import('fs')
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true })
      }

      // Create MCP client to communicate with server-memory
      const transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: {
          ...process.env,
          MEMORY_DATA_PATH: this.storagePath
        }
      })

      this.client = new Client(
        {
          name: 'ai-worker-memory-client',
          version: '1.0.0'
        },
        {
          capabilities: {}
        }
      )

      await this.client.connect(transport)

      console.log(`[ServerMemoryAdapter] Connected to server-memory, storage: ${this.storagePath}`)

      // Load existing entities into cache for fast access
      await this.loadCache()
    } catch (error) {
      console.error('[ServerMemoryAdapter] Failed to initialize:', error)
      throw new Error(`Failed to initialize ServerMemoryAdapter: ${error}`)
    }
  }


  /**
   * Shutdown the client connection
   */
  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
    this.entityCache.clear()
    this.relationCache.clear()
  }

  /**
   * Load entities and relations into cache
   */
  private async loadCache(): Promise<void> {
    // Note: server-memory doesn't have a direct "list all" endpoint
    // We'll populate cache lazily as entities are accessed
    // For now, we can try to search with empty query to get some entities
    try {
      const entities = await this.search('', { limit: 1000 })
      for (const entity of entities) {
        this.entityCache.set(entity.id, entity)
      }
    } catch (error) {
      // If search fails, we'll just start with empty cache
      console.warn('Could not pre-load cache:', error)
    }
  }

  /**
   * Create a new entity
   */
  async createEntity(input: CreateEntityInput): Promise<Entity> {
    this.ensureInitialized()

    const result = await this.callTool('create_entities', {
      entities: [
        {
          name: input.name,
          entityType: input.type,
          observations: input.observations || []
        }
      ]
    })

    if (result.error) {
      throw new Error(`Failed to create entity: ${result.error}`)
    }

    // Parse MCP content
    // result.result is CallToolResult.content (Array<TextContent | ImageContent>)
    const content = result.result
    if (!content || !Array.isArray(content) || content.length === 0) {
      // It might be that server-memory returns empty list if secret redaction happened internally? 
      // But here we are just parsing the output.
      throw new Error('No content returned from create_entities')
    }

    const textContent = content[0].text
    if (!textContent) {
      throw new Error('No text content in create_entities response')
    }

    let createdEntities: any[]
    try {
      createdEntities = JSON.parse(textContent)
    } catch (e) {
      throw new Error(`Failed to parse create_entities response: ${textContent}`)
    }

    const entityData = createdEntities?.[0]
    if (!entityData) {
      throw new Error('No entity data returned from create_entities')
    }

    const entity: Entity = {
      id: entityData.name, // server-memory uses name as ID
      name: input.name,
      type: input.type,
      description: input.description,
      observations: input.observations || [],
      metadata: input.metadata || {},
      createdAt: new Date().toISOString()
    }

    this.entityCache.set(entity.id, entity)
    return entity
  }

  /**
   * Get entity by ID
   */
  async getEntity(id: string): Promise<Entity | null> {
    // Check cache first
    if (this.entityCache.has(id)) {
      return this.entityCache.get(id)!
    }

    // Try to find via search
    const results = await this.search(id, { limit: 1 })
    return results.length > 0 ? results[0] : null
  }

  /**
   * Update entity
   */
  async updateEntity(id: string, updates: Partial<Entity>): Promise<Entity> {
    this.ensureInitialized()

    const existing = await this.getEntity(id)
    if (!existing) {
      throw new Error(`Entity not found: ${id}`)
    }

    // Add observations if provided
    if (updates.observations) {
      await this.callTool('add_observations', {
        entityName: id,
        observations: updates.observations
      })
    }

    const updated: Entity = {
      ...existing,
      ...updates,
      id: existing.id, // Don't allow ID changes
      updatedAt: new Date().toISOString()
    }

    this.entityCache.set(id, updated)
    return updated
  }

  /**
   * Delete entity
   */
  async deleteEntity(id: string): Promise<void> {
    this.ensureInitialized()

    await this.callTool('delete_entities', {
      entityNames: [id]
    })

    this.entityCache.delete(id)
  }

  /**
   * List entities with pagination
   */
  async listEntities(options?: { limit?: number; offset?: number }): Promise<Entity[]> {
    // Convert cache to array and apply pagination
    const entities = Array.from(this.entityCache.values())
    const offset = options?.offset || 0
    const limit = options?.limit || 100

    return entities.slice(offset, offset + limit)
  }

  /**
   * Search entities
   */
  async search(query: string, options?: SearchOptions): Promise<Entity[]> {
    this.ensureInitialized()

    const result = await this.callTool('search_nodes', {
      query,
      ...(options?.limit && { limit: options.limit })
    })

    if (result.error) {
      throw new Error(`Search failed: ${result.error}`)
    }

    // Parse MCP content
    const content = result.result
    if (!content || !Array.isArray(content) || content.length === 0) {
      // Return empty if no content
      return []
    }

    const textContent = content[0].text // Assuming first content block is the result text
    if (!textContent) {
      return []
    }

    let nodes: any[] = []
    try {
      const parsed = JSON.parse(textContent)
      // Handle both direct array and { nodes: [...] } object
      if (Array.isArray(parsed)) {
        nodes = parsed
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.nodes)) {
          nodes = parsed.nodes
        } else if (Array.isArray(parsed.entities)) {
          nodes = parsed.entities
        } else {
          console.warn(`[ServerMemoryAdapter] Unexpected search response structure:`, parsed)
        }
      }
    } catch (e) {
      // If content isn't JSON, it might be an issue or just empty
      console.warn(`[ServerMemoryAdapter] Failed to parse search response: ${textContent}`)
      return []
    }

    let entities = nodes.map((node: any) =>
      this.mapNodeToEntity(node)
    )

    // Apply context filtering if provided
    if (options?.context) {
      entities = entities.filter((e) => this.matchesContext(e, options.context!))
    }

    // Update cache
    entities.forEach((e) => this.entityCache.set(e.id, e))

    return entities
  }

  /**
   * Create a relation between entities
   */
  async createRelation(input: CreateRelationInput): Promise<Relation> {
    this.ensureInitialized()

    const result = await this.callTool('create_relations', {
      relations: [
        {
          from: input.fromEntityId,
          to: input.toEntityId,
          relationType: input.relationType
        }
      ]
    })

    if (result.error) {
      throw new Error(`Failed to create relation: ${result.error}`)
    }

    const relation: Relation = {
      id: `${input.fromEntityId}-${input.relationType}-${input.toEntityId}`,
      fromEntityId: input.fromEntityId,
      toEntityId: input.toEntityId,
      relationType: input.relationType,
      description: input.description,
      metadata: input.metadata || {}
    }

    this.relationCache.set(relation.id, relation)
    return relation
  }

  /**
   * Get relation by ID
   */
  async getRelation(id: string): Promise<Relation | null> {
    return this.relationCache.get(id) || null
  }

  /**
   * Delete relation
   */
  async deleteRelation(id: string): Promise<void> {
    this.ensureInitialized()

    const relation = this.relationCache.get(id)
    if (!relation) {
      throw new Error(`Relation not found: ${id}`)
    }

    await this.callTool('delete_relations', {
      relations: [
        {
          from: relation.fromEntityId,
          to: relation.toEntityId,
          relationType: relation.relationType
        }
      ]
    })

    this.relationCache.delete(id)
  }

  /**
   * List relations for an entity
   */
  async listRelations(entityId: string): Promise<Relation[]> {
    return Array.from(this.relationCache.values()).filter(
      (r) => r.fromEntityId === entityId || r.toEntityId === entityId
    )
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    return {
      entityCount: this.entityCache.size,
      relationCount: this.relationCache.size,
      storageSize: await this.calculateStorageSize(),
      avgSearchLatency: 0, // TODO: Track in MetricsCollector
      backend: 'server-memory'
    }
  }

  /**
   * Export all data
   */
  async exportAll(): Promise<ExportData> {
    return {
      entities: Array.from(this.entityCache.values()),
      relations: Array.from(this.relationCache.values()),
      metadata: {
        exportedAt: new Date().toISOString(),
        version: '1.0.0',
        backend: 'server-memory'
      }
    }
  }

  /**
   * Import data
   */
  async importAll(data: ExportData): Promise<void> {
    // Import entities
    for (const entity of data.entities) {
      await this.createEntity({
        name: entity.name,
        type: entity.type,
        description: entity.description,
        observations: entity.observations,
        metadata: entity.metadata
      })
    }

    // Import relations
    for (const relation of data.relations) {
      await this.createRelation({
        fromEntityId: relation.fromEntityId,
        toEntityId: relation.toEntityId,
        relationType: relation.relationType,
        description: relation.description,
        metadata: relation.metadata
      })
    }
  }

  /**
   * List available MCP tools
   */
  listTools(): { tools: any[] } {
    return {
      tools: [
        {
          name: 'create_entities',
          description: 'Create new entities in memory',
          inputSchema: {
            type: 'object',
            properties: {
              entities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    entityType: { type: 'string' },
                    observations: { type: 'array', items: { type: 'string' } }
                  }
                }
              }
            }
          }
        },
        {
          name: 'search_nodes',
          description: 'Search entities by query',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              limit: { type: 'number' }
            }
          }
        }
        // Add more tools as needed
      ]
    }
  }

  /**
   * Call an MCP tool
   */
  async callTool(name: string, args: any): Promise<{ result: any; error?: string }> {
    this.ensureInitialized()

    try {
      const result = await this.client!.callTool({
        name,
        arguments: args
      })

      return { result: result.content }
    } catch (error: any) {
      return { result: null, error: error.message }
    }
  }

  private ensureInitialized(): void {
    if (!this.client) {
      throw new Error('ServerMemoryAdapter not initialized. Call initialize() first.')
    }
  }

  private mapNodeToEntity(node: any): Entity {
    return {
      id: node.name,
      name: node.name,
      type: node.entityType || 'unknown',
      description: node.observations?.join('\n') || '',
      observations: node.observations || [],
      metadata: {},
      createdAt: new Date().toISOString()
    }
  }

  private matchesContext(entity: Entity, context: { workspace?: string; project?: string }): boolean {
    if (context.workspace && entity.metadata?.workspace !== context.workspace) {
      return false
    }
    if (context.project && entity.metadata?.project !== context.project) {
      return false
    }
    return true
  }

  private async calculateStorageSize(): Promise<number> {
    // Estimate size based on cache
    // In production, this would check actual file size
    const jsonString = JSON.stringify({
      entities: Array.from(this.entityCache.values()),
      relations: Array.from(this.relationCache.values())
    })
    return new Blob([jsonString]).size
  }
}
