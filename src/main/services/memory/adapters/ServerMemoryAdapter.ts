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

function extractJsonFromText(text: string): string {
  const stripped = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()

  // Fast path for pure JSON payloads.
  try {
    JSON.parse(stripped)
    return stripped
  } catch {
    // continue with bounded extraction
  }

  const start = stripped.search(/[{[]/)
  if (start === -1) return stripped

  const stack: string[] = []
  let inString = false
  let escaping = false

  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }
      if (ch === '\\') {
        escaping = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }

    if (ch === '}' || ch === ']') {
      const top = stack[stack.length - 1]
      if ((ch === '}' && top === '{') || (ch === ']' && top === '[')) {
        stack.pop()
        if (stack.length === 0) {
          return stripped.slice(start, i + 1)
        }
      }
    }
  }

  // Fallback to prior behavior if payload is malformed but bracketed.
  const lastBrace = stripped.lastIndexOf('}')
  const lastBracket = stripped.lastIndexOf(']')
  const end = Math.max(lastBrace, lastBracket)
  if (end > start) {
    const bounded = stripped.substring(start, end + 1)
    try {
      JSON.parse(bounded)
      return bounded
    } catch {
      // continue
    }
  }

  // Last resort: walk backward and return the longest valid JSON prefix.
  for (let i = stripped.length; i > start; i--) {
    const candidate = stripped.slice(start, i).trim()
    if (!candidate) continue
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // keep shrinking
    }
  }

  return stripped
}

function parseEntityLikePayload(text: string): Record<string, unknown> | null {
  const pureJson = extractJsonFromText(text)
  const parsed = JSON.parse(pureJson)

  if (Array.isArray(parsed)) {
    return (parsed[0] && typeof parsed[0] === 'object') ? parsed[0] as Record<string, unknown> : null
  }

  if (parsed && typeof parsed === 'object') {
    const asObj = parsed as Record<string, unknown>
    const entities = asObj.entities
    if (Array.isArray(entities)) {
      const first = entities[0]
      return first && typeof first === 'object' ? first as Record<string, unknown> : null
    }
    return asObj
  }

  return null
}

function previewText(value: string, limit = 160): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit)}...`
}

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
    const normalizedDescription = input.description?.trim() || ''
    const observations = [
      ...(normalizedDescription ? [normalizedDescription] : []),
      ...(input.observations || [])
    ].filter((obs, idx, arr) => Boolean(obs) && arr.indexOf(obs) === idx)

    const result = await this.callTool('create_entities', {
      entities: [
        {
          name: input.name,
          entityType: input.type,
          observations
        }
      ]
    })

    if (result.error) {
      throw new Error(`Failed to create entity: ${result.error}`)
    }

    // Parse MCP content best-effort. If response shape drifts or comes back empty,
    // do not fail the write path — we still return a stable entity shape so the
    // agent can continue operating without entering retry loops.
    const content = result.result
    let entityData: Record<string, unknown> | null = null
    if (content && Array.isArray(content) && content.length > 0) {
      const textContent = content
        .map((c: Record<string, unknown>) => (typeof c?.text === 'string' ? c.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim()

      if (textContent) {
        try {
          entityData = parseEntityLikePayload(textContent)
        } catch (error) {
          console.warn(
            `[ServerMemoryAdapter] Failed to parse create_entities response, using fallback entity: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      } else {
        console.warn('[ServerMemoryAdapter] create_entities returned no text content, using fallback entity')
      }
    } else {
      console.warn('[ServerMemoryAdapter] create_entities returned empty content envelope, using fallback entity')
    }

    const entity: Entity = {
      id: (typeof entityData?.name === 'string' && entityData.name.trim().length > 0
        ? entityData.name
        : input.name), // server-memory typically uses name as ID
      name: input.name,
      type: input.type,
      description: input.description,
      observations: (Array.isArray(entityData?.observations)
        ? entityData.observations.filter((o): o is string => typeof o === 'string')
        : observations) || [],
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

    const textContent = content
      .map((c: Record<string, unknown>) => (typeof c?.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim()
    if (!textContent) {
        console.warn('[ServerMemoryAdapter] search_nodes returned empty text payload')
        return []
    }

    let nodes: Record<string, unknown>[] = []
    try {
        const pureJson = extractJsonFromText(textContent)
        const parsed = JSON.parse(pureJson);
        // Handle both direct array and { nodes: [...] } object
        if (Array.isArray(parsed)) {
            nodes = parsed
        } else if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.nodes)) {
                nodes = parsed.nodes;
            } else if (Array.isArray(parsed.entities)) {
                nodes = parsed.entities;
            } else {
                console.warn('[ServerMemoryAdapter] Unexpected search response structure:', parsed)
            }
        }
    } catch (error) {
        // Fall back to line-wise extraction because some memory servers append
        // trailing prose/log lines after the JSON payload.
        for (const segment of textContent.split('\n')) {
          const trimmed = segment.trim()
          if (!trimmed) continue
          try {
            const parsed = JSON.parse(extractJsonFromText(trimmed))
            if (Array.isArray(parsed)) {
              nodes = parsed as Record<string, unknown>[]
              break
            }
            if (parsed && typeof parsed === 'object') {
              const asObj = parsed as Record<string, unknown>
              if (Array.isArray(asObj.nodes)) {
                nodes = asObj.nodes as Record<string, unknown>[]
                break
              }
              if (Array.isArray(asObj.entities)) {
                nodes = asObj.entities as Record<string, unknown>[]
                break
              }
            }
          } catch {
            // keep scanning
          }
        }
        if (nodes.length === 0) {
          console.warn(
            `[ServerMemoryAdapter] Failed to parse search response, returning empty result set: ${error instanceof Error ? error.message : String(error)}; preview="${previewText(textContent)}"`
          )
          return []
        }
    }

    let entities = nodes.map((node: Record<string, unknown>) =>
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
  listTools(): { tools: Record<string, unknown>[] } {
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

  // --- Helper Methods ---

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
