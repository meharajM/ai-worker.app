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
 * MementoMCPAdapter - Future Implementation
 * 
 * This adapter will be implemented when the app scales beyond server-memory's capabilities.
 * 
 * WHEN TO MIGRATE:
 * - Entity count exceeds 10,000
 * - Average search latency exceeds 100ms
 * - Storage size exceeds 50MB
 * - User requests semantic search or graph queries
 * 
 * SETUP REQUIRED:
 * 1. Install memento-mcp:
 *    ```bash
 *    npm install memento-mcp
 *    ```
 * 
 * 2. Start Neo4j (via Docker):
 *    ```bash
 *    docker run -p 7687:7687 -p 7474:7474 \
 *      -e NEO4J_AUTH=neo4j/password \
 *      neo4j:latest
 *    ```
 * 
 * 3. Configure in settings:
 *    ```typescript
 *    {
 *      backend: 'memento-mcp',
 *      memento: {
 *        neo4jUri: 'bolt://localhost:7687',
 *        username: 'neo4j',
 *        password: 'password'
 *      }
 *    }
 *    ```
 * 
 * BENEFITS:
 * - Semantic search using embeddings
 * - Graph traversal queries (find related entities)
 * - Better performance at scale (100K+ entities)
 * - Advanced queries (find all entities related to X within 2 hops)
 * 
 * MIGRATION PATH:
 * - Call `exportAll()` on ServerMemoryAdapter
 * - Initialize MementoMCPAdapter
 * - Call `importAll(data)` on MementoMCPAdapter
 * - Update config to use 'memento-mcp' backend
 * - Restart app
 */
export class MementoMCPAdapter implements UnifiedMemoryBackend {
  private config: {
    neo4jUri: string
    username: string
    password: string
  }

  constructor(config: { neo4jUri: string; username: string; password: string }) {
    this.config = config
  }

  // --- Lifecycle ---

  async initialize(): Promise<void> {
    throw new Error(
      'MementoMCPAdapter not yet implemented.\n\n' +
        'To use this adapter:\n' +
        '1. Install memento-mcp: npm install memento-mcp\n' +
        '2. Setup Neo4j database\n' +
        '3. Implement this adapter based on memento-mcp API\n\n' +
        'For now, use ServerMemoryAdapter (default).'
    )
  }

  async shutdown(): Promise<void> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  // --- Entity Operations ---

  async createEntity(_input: CreateEntityInput): Promise<Entity> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  async getEntity(_id: string): Promise<Entity | null> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  async updateEntity(_id: string, _updates: Partial<Entity>): Promise<Entity> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  async deleteEntity(_id: string): Promise<void> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  async listEntities(_options?: { limit?: number; offset?: number }): Promise<Entity[]> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  // --- Search ---

  async search(_query: string, _options?: SearchOptions): Promise<Entity[]> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  // --- Relations ---

  async createRelation(_input: CreateRelationInput): Promise<Relation> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  async getRelation(_id: string): Promise<Relation | null> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  async deleteRelation(_id: string): Promise<void> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  async listRelations(_entityId: string): Promise<Relation[]> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  // --- Utility ---

  async getStats(): Promise<MemoryStats> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  async exportAll(): Promise<ExportData> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  async importAll(_data: ExportData): Promise<void> {
    throw new Error('MementoMCPAdapter not implemented')
  }

  // --- MCP Tool Interface ---

  listTools(): { tools: any[] } {
    throw new Error('MementoMCPAdapter not implemented')
  }

  async callTool(_name: string, _args: any): Promise<{ result: any; error?: string }> {
    throw new Error('MementoMCPAdapter not implemented')
  }
}
