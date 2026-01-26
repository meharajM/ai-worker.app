# Implementation Plan: MCP Performance & Memory Architecture

**Updated**: January 26, 2026  
**Status**: Ready to Implement

## Summary

**Goals:**
1. ✅ Bundle MCP servers (playwright, filesystem) - DONE
2. 🚀 Implement flexible memory architecture (NEW)
3. 🔒 Add privacy-first automatic memory system
4. 📊 Enable seamless scaling (server-memory → memento-mcp)
5. 🎨 Create MCP Preferences UI

**Key Decision**: Start with `@modelcontextprotocol/server-memory`, design abstraction layer for future migration to `memento-mcp`.

---

## Phase 1: Memory Architecture Foundation (Week 1-2)

### 1.1 Backend Abstraction Layer

#### [NEW] `UnifiedMemoryBackend.ts`
> `src/main/services/memory/UnifiedMemoryBackend.ts`

**Purpose**: Define interface that both server-memory and memento-mcp will implement.

```typescript
export interface UnifiedMemoryBackend {
  // Core operations
  initialize(): Promise<void>
  
  // Entity operations
  createEntity(entity: CreateEntityInput): Promise<Entity>
  getEntity(id: string): Promise<Entity | null>
  updateEntity(id: string, updates: Partial<Entity>): Promise<Entity>
  deleteEntity(id: string): Promise<void>
  
  // Search
  search(query: string, options?: SearchOptions): Promise<Entity[]>
  
  // Relations
  createRelation(relation: CreateRelationInput): Promise<Relation>
  deleteRelation(id: string): Promise<void>
  
  // Utility
  getStats(): Promise<MemoryStats>
  exportAll(): Promise<ExportData>
  importAll(data: ExportData): Promise<void>
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
  storageSize: number      // bytes
  avgSearchLatency: number  // ms
}
```

**Why**: This abstraction allows swapping backends without changing app code.

---

#### [NEW] `ServerMemoryAdapter.ts`
> `src/main/services/memory/adapters/ServerMemoryAdapter.ts`

**Purpose**: Wrap `@modelcontextprotocol/server-memory` to implement our interface.

```typescript
import { MemoryServer } from '@modelcontextprotocol/server-memory'
import { UnifiedMemoryBackend } from '../UnifiedMemoryBackend'

export class ServerMemoryAdapter implements UnifiedMemoryBackend {
  private server: MemoryServer
  private storagePath: string
  
  constructor(config: { storagePath: string }) {
    this.storagePath = config.storagePath
  }
  
  async initialize() {
    this.server = new MemoryServer({
      storagePath: this.storagePath
    })
    await this.server.start()
  }
  
  async createEntity(input: CreateEntityInput): Promise<Entity> {
    const result = await this.server.callTool('create_entities', {
      entities: [{
        name: input.name,
        entityType: input.type,
        observations: input.observations || []
      }]
    })
    return this.mapToEntity(result.entities[0])
  }
  
  async search(query: string, options?: SearchOptions) {
    const result = await this.server.callTool('search_nodes', {
      query,
      limit: options?.limit || 10
    })
    
    let entities = result.nodes.map(n => this.mapToEntity(n))
    
    // Apply context filtering
    if (options?.context) {
      entities = entities.filter(e => 
        this.matchesContext(e, options.context)
      )
    }
    
    return entities
  }
  
  // ... other methods
}
```

---

#### [NEW] `MementoMCPAdapter.ts` (Skeleton for Future)
> `src/main/services/memory/adapters/MementoMCPAdapter.ts`

**Purpose**: Pre-define memento-mcp adapter (implement later when migrating).

```typescript
import { UnifiedMemoryBackend } from '../UnifiedMemoryBackend'

/**
 * Memento-MCP Adapter (Future Implementation)
 * 
 * This adapter will be implemented when:
 * - Entity count exceeds 10,000
 * - Search latency exceeds 100ms
 * - User requests advanced features (semantic search)
 * 
 * Installation required:
 * - npm install memento-mcp
 * - Docker: docker run -p 7687:7687 neo4j
 */
export class MementoMCPAdapter implements UnifiedMemoryBackend {
  // TODO: Implement when migrating
  async initialize() {
    throw new Error('MementoMCPAdapter not yet implemented. Install memento-mcp first.')
  }
  
  // Stub methods for type-checking
  async createEntity() { throw new Error('Not implemented') }
  async search() { throw new Error('Not implemented') }
  // ... other methods
}
```

---

#### [NEW] `MemoryServiceFactory.ts`
> `src/main/services/memory/MemoryServiceFactory.ts`

**Purpose**: Choose backend based on config.

```typescript
import { UnifiedMemoryBackend } from './UnifiedMemoryBackend'
import { ServerMemoryAdapter } from './adapters/ServerMemoryAdapter'
import { MementoMCPAdapter } from './adapters/MementoMCPAdapter'

export interface MemoryConfig {
  backend: 'server-memory' | 'memento-mcp'
  serverMemory?: {
    storagePath: string
  }
  memento?: {
    neo4jUri: string
    username: string
    password: string
  }
}

export class MemoryServiceFactory {
  static create(config: MemoryConfig): UnifiedMemoryBackend {
    switch (config.backend) {
      case 'server-memory':
        return new ServerMemoryAdapter(config.serverMemory!)
        
      case 'memento-mcp':
        return new MementoMCPAdapter(config.memento!)
        
      default:
        throw new Error(`Unknown backend: ${config.backend}`)
    }
  }
  
  static loadConfig(): MemoryConfig {
    // Load from electron-store or config file
    const Store = require('electron-store')
    const store = new Store()
    
    return store.get('memory.config', {
      backend: 'server-memory',  // Default
      serverMemory: {
        storagePath: app.getPath('userData') + '/memory'
      }
    })
  }
}
```

---

### 1.2 Privacy & Security Layer

#### [NEW] `PIIDetector.ts`
> `src/main/services/memory/privacy/PIIDetector.ts`

**Purpose**: Detect personally identifiable information before storing.

```typescript
export class PIIDetector {
  private patterns = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/,
    creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/
  }
  
  detect(text: string): { found: boolean; types: string[] } {
    const types: string[] = []
    
    for (const [type, pattern] of Object.entries(this.patterns)) {
      if (pattern.test(text)) {
        types.push(type)
      }
    }
    
    return { found: types.length > 0, types }
  }
  
  redact(text: string): string {
    let redacted = text
    for (const [type, pattern] of Object.entries(this.patterns)) {
      redacted = redacted.replace(pattern, `[${type.toUpperCase()}_REDACTED]`)
    }
    return redacted
  }
}
```

---

#### [NEW] `SecretRedactor.ts`
> `src/main/services/memory/privacy/SecretRedactor.ts`

**Purpose**: Detect and block API keys, passwords, tokens.

```typescript
export class SecretRedactor {
  private patterns = {
    apiKey: /\b(sk|pk)_[a-zA-Z0-9]{32,}\b/,
    jwt: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/,
    githubToken: /\bghp_[a-zA-Z0-9]{36}\b/,
    password: /password\s*[:=]\s*['"]([^'"]+)['"]/i
  }
  
  detect(text: string): boolean {
    return Object.values(this.patterns).some(p => p.test(text))
  }
  
  // Throws error instead of redacting (secrets should NEVER be stored)
  check(text: string): void {
    for (const [type, pattern] of Object.entries(this.patterns)) {
      if (pattern.test(text)) {
        throw new Error(
          `Secret detected (${type}). Secrets must not be stored in memory. ` +
          `Please remove sensitive data before saving.`
        )
      }
    }
  }
}
```

---

### 1.3 Metrics & Migration Detection

#### [NEW] `MetricsCollector.ts`
> `src/main/services/memory/MetricsCollector.ts`

**Purpose**: Track usage to determine when to suggest migration.

```typescript
export class MetricsCollector {
  private stats = {
    entityCount: 0,
    searchCount: 0,
    totalSearchLatency: 0,
    storageSize: 0
  }
  
  increment(metric: 'entityCount' | 'searchCount', value: number = 1) {
    this.stats[metric] += value
  }
  
  recordLatency(latency: number) {
    this.stats.searchCount++
    this.stats.totalSearchLatency += latency
  }
  
  async getStats(): Promise<MemoryStats> {
    return {
      entityCount: this.stats.entityCount,
      relationCount: 0, // TODO
      storageSize: await this.calculateStorageSize(),
      avgSearchLatency: this.stats.totalSearchLatency / this.stats.searchCount || 0
    }
  }
  
  async shouldSuggestMigration(): Promise<boolean> {
    const stats = await this.getStats()
    
    return (
      stats.entityCount > 10000 ||
      stats.avgSearchLatency > 100 ||
      stats.storageSize > 50 * 1024 * 1024  // 50MB
    )
  }
}
```

---

#### [NEW] `MigrationService.ts`
> `src/main/services/memory/MigrationService.ts`

**Purpose**: Handle migration from server-memory to memento-mcp.

```typescript
export class MigrationService {
  private notificationShown = false
  
  async checkAndNotify(metrics: MetricsCollector) {
    if (this.notificationShown) return
    
    if (await metrics.shouldSuggestMigration()) {
      this.showMigrationSuggestion()
      this.notificationShown = true
    }
  }
  
  private showMigrationSuggestion() {
    // IPC to renderer for UI notification
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getFocusedWindow()
    
    win?.webContents.send('memory:suggest-migration', {
      title: 'Upgrade Memory Backend?',
      message: 'Your memory has grown! Upgrade to Memento-MCP for better performance.',
      currentStats: {
        entities: '10,000+',
        backend: 'server-memory'
      }
    })
  }
  
  async migrateToMemento() {
    // 1. Export from current backend
    const oldBackend = new ServerMemoryAdapter(...)
    const data = await oldBackend.exportAll()
    
    // 2. Check Neo4j availability
    await this.ensureNeo4j()
    
    // 3. Import to new backend
    const newBackend = new MementoMCPAdapter(...)
    await newBackend.importAll(data)
    
    // 4. Update config
    await this.updateConfig({ backend: 'memento-mcp' })
    
    // 5. Notify success
    return { success: true, message: 'Migration complete!' }
  }
}
```

---

## Phase 2: Main Memory Service (Week 2-3)

### 2.1 Unified Memory Service

#### [MODIFY] `MemoryService.ts`
> `src/main/services/MemoryService.ts`

**Changes**: Refactor to use factory pattern and add privacy checks.

```typescript
import { MemoryServiceFactory } from './memory/MemoryServiceFactory'
import { PIIDetector } from './memory/privacy/PIIDetector'
import { SecretRedactor } from './memory/privacy/SecretRedactor'
import { MetricsCollector } from './memory/MetricsCollector'
import { MigrationService } from './memory/MigrationService'

export class MemoryService {
  private static instance: MemoryService
  private backend: UnifiedMemoryBackend
  private pii: PIIDetector
  private secrets: SecretRedactor
  private metrics: MetricsCollector
  private migration: MigrationService
  
  private constructor() {
    // Load backend from config
    const config = MemoryServiceFactory.loadConfig()
    this.backend = MemoryServiceFactory.create(config)
    
    // Initialize privacy layers
    this.pii = new PIIDetector()
    this.secrets = new SecretRedactor()
    this.metrics = new MetricsCollector()
    this.migration = new MigrationService()
  }
  
  static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService()
    }
    return MemoryService.instance
  }
  
  async initialize() {
    await this.backend.initialize()
  }
  
  async createEntity(input: CreateEntityInput, context?: Context): Promise<Entity> {
    // 1. Privacy checks
    const piiCheck = this.pii.detect(input.description)
    if (piiCheck.found) {
      throw new Error(`PII detected: ${piiCheck.types.join(', ')}. Please redact before storing.`)
    }
    
    // 2. Secret check (throws if found)
    this.secrets.check(input.description)
    
    // 3. Add context metadata
    const entityWithContext = {
      ...input,
      metadata: {
        ...input.metadata,
        context
      }
    }
    
    // 4. Store via backend
    const entity = await this.backend.createEntity(entityWithContext)
    
    // 5. Track metrics
    this.metrics.increment('entityCount')
    
    // 6. Check if migration needed
    await this.migration.checkAndNotify(this.metrics)
    
    return entity
  }
  
  async search(query: string, options?: SearchOptions): Promise<Entity[]> {
    const startTime = Date.now()
    
    const results = await this.backend.search(query, options)
    
    const latency = Date.now() - startTime
    this.metrics.recordLatency(latency)
    
    return results
  }
  
  // Expose backend for tool calls
  listTools() {
    return this.backend.listTools()
  }
  
  async callTool(name: string, args: any) {
    return this.backend.callTool(name, args)
  }
}
```

---

## Phase 3: UI & Preferences (Week 3-4)

### 3.1 MCP Preferences Panel

#### [MODIFY] `McpPreferencesPanel.tsx`
> `src/renderer/src/components/settings/McpPreferencesPanel.tsx`

**Changes**: Add Memory Backend section.

**New Section: Memory Backend Configuration**

```typescript
<Section title="Memory Backend">
  <BackendSelector
    current={settings.memory.backend}
    onChange={handleBackendChange}
  />
  
  {settings.memory.backend === 'server-memory' && (
    <ServerMemoryConfig
      path={settings.memory.serverMemory.storagePath}
      stats={memoryStats}
    />
  )}
  
  {settings.memory.backend === 'memento-mcp' && (
    <MementoConfig
      uri={settings.memory.memento.neo4jUri}
      status={neo4jStatus}
    />
  )}
  
  {migrationSuggestion && (
    <MigrationCard
      suggestion={migrationSuggestion}
      onMigrate={handleMigrate}
      onDismiss={handleDismiss}
    />
  )}
</Section>
```

---

### 3.2 Settings Store

#### [MODIFY] `settingsStore.ts`
> `src/renderer/src/stores/settingsStore.ts`

**Add**:
```typescript
memory: {
  backend: 'server-memory' | 'memento-mcp',
  serverMemory: {
    storagePath: string
  },
  memento: {
    neo4jUri: string,
    username: string,
    password: string
  },
  autoMigration: {
    enabled: boolean,
    thresholds: {
      entityCount: number,
      searchLatency: number,
      fileSize: number
    }
  }
}
```

---

## Phase 4: Integration (Week 4)

### 4.1 IPC Handlers

#### [NEW] `memory.ts` (IPC)
> `src/main/ipc/memory.ts`

```typescript
import { ipcMain } from 'electron'
import { MemoryService } from '../services/MemoryService'

export function registerMemoryHandlers() {
  const memory = MemoryService.getInstance()
  
  // Get backend stats
  ipcMain.handle('memory:get-stats', async () => {
    return await memory.backend.getStats()
  })
  
  // Trigger migration
  ipcMain.handle('memory:migrate', async () => {
    const migration = new MigrationService()
    return await migration.migrateToMemento()
  })
  
  // Get migration suggestion
  ipcMain.handle('memory:check-migration', async () => {
    const metrics = memory.metrics
    return await metrics.shouldSuggestMigration()
  })
}
```

---

## Verification Plan

| Test | Expected | Status |
|------|----------|--------|
| **Install & Start** | server-memory loads, no errors | [ ] |
| **Create Entity** | Entity created, PII blocked | [ ] |
| **Search** | Results returned in <50ms | [ ] |
| **10K Entities** | Migration suggestion appears | [ ] |
| **Auto-Migration** | Data exported, memento imports | [ ] |
| **Backend Switch** | Config change = backend swap | [ ] |
| **Rollback** | Can downgrade to server-memory | [ ] |

---

## Timeline

**Week 1**: Abstraction layer + ServerMemoryAdapter  
**Week 2**: Privacy layer + MetricsCollector  
**Week 3**: UI + MigrationService  
**Week 4**: Testing + Documentation

**Total: 4 weeks to MVP** ✅

**Future (when needed): 1 week to implement MementoMCPAdapter**

---

## Success Metrics

- [ ] Ship with zero user setup
- [ ] <10ms search latency (server-memory)
- [ ] Zero PII/secrets stored
- [ ] Auto-suggest migration at 10K entities
- [ ] One-click migration works
- [ ] Backend swap requires zero code changes

---

**End of Implementation Plan**

