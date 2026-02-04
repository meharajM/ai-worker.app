# Memory Server: Leak Risks & Scaling Strategy

**Critical Analysis**: Security, Privacy, and Future-Proofing  
**Date**: January 26, 2026

---

## Part 1: Memory Leak Risks in @modelcontextprotocol/server-memory

### 1.1 Data Privacy Leaks

#### Risk 1: JSON File Exposure
```typescript
// server-memory stores data in plain JSON
// Location: ~/.mcp/memory/graph.json

{
  "entities": [
    {
      "name": "John Doe",
      "entityType": "person",
      "observations": [
        "Email: john@company.com",        // ❌ PII LEAK
        "API Key: sk_live_abc123xyz",     // ❌ SECRET LEAK
        "Works on classified Project X"   // ❌ CONFIDENTIAL LEAK
      ]
    }
  ]
}
```

**Severity**: 🔴 HIGH

**Attack Vectors:**
1. **File System Access**: Anyone with file access can read JSON
2. **Backup Leaks**: JSON files backed up to cloud (Dropbox, iCloud)
3. **Developer Tools**: Easy to inspect during development
4. **Malware**: Simple file read operation exposes everything

**Mitigation Strategies:**

```typescript
// Strategy 1: Encrypt JSON files
import { encrypt, decrypt } from 'node:crypto'
import { readFileSync, writeFileSync } from 'fs'

class EncryptedMemoryServer extends MemoryServer {
  private encryptionKey: Buffer
  
  async saveGraph(graph: Graph) {
    const json = JSON.stringify(graph)
    const encrypted = encrypt(json, this.encryptionKey)
    await writeFileSync(this.storagePath, encrypted)
  }
  
  async loadGraph(): Promise<Graph> {
    const encrypted = await readFileSync(this.storagePath)
    const json = decrypt(encrypted, this.encryptionKey)
    return JSON.parse(json)
  }
}

// Strategy 2: PII Detection Before Storage
class SafeMemoryServer extends EncryptedMemoryServer {
  async createEntity(entity: Entity) {
    // Detect PII patterns
    if (this.detectPII(entity.observations)) {
      throw new Error('PII detected. Please redact before storing.')
    }
    
    // Detect secrets
    if (this.detectSecrets(entity.observations)) {
      throw new Error('Secret detected. Never store credentials.')
    }
    
    return super.createEntity(entity)
  }
  
  private detectPII(text: string): boolean {
    const piiPatterns = [
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,  // Email
      /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,                        // Phone
      /\b\d{3}-\d{2}-\d{4}\b/,                                // SSN
    ]
    return piiPatterns.some(p => p.test(text))
  }
  
  private detectSecrets(text: string): boolean {
    const secretPatterns = [
      /sk_[a-zA-Z0-9]{32,}/,           // API keys
      /eyJ[a-zA-Z0-9_-]+\./,            // JWT tokens
      /ghp_[a-zA-Z0-9]{36}/,            // GitHub tokens
      /password\s*[:=]\s*['"][^'"]+/i  // Passwords
    ]
    return secretPatterns.some(p => p.test(text))
  }
}
```

**Effectiveness:**
- ✅ Encryption prevents file system leaks
- ✅ PII detection blocks sensitive data
- ✅ Secret detection prevents credential storage
- ⚠️ Requires key management (use electron safeStorage)

---

#### Risk 2: Cross-Context Contamination

```typescript
// Scenario: Work and personal contexts mixed
Work Session:
  createEntity({
    name: "Production DB",
    observations: ["Connection: prod.example.com:5432"]
  })

Personal Session (same user):
  search("database") 
  → Returns work database credentials ❌ LEAK
```

**Severity**: 🟡 MEDIUM

**Mitigation**:

```typescript
// Context Isolation
interface Context {
  workspace: string   // "work" | "personal"
  project: string     // "ai-worker" | "side-project"
}

class ContextAwareMemoryServer extends SafeMemoryServer {
  async createEntity(entity: Entity, context: Context) {
    // Tag with context
    const contextualEntity = {
      ...entity,
      metadata: {
        ...entity.metadata,
        workspace: context.workspace,
        project: context.project
      }
    }
    
    return super.createEntity(contextualEntity)
  }
  
  async search(query: string, context: Context) {
    const all = await super.search(query)
    
    // Filter by context
    return all.filter(e => 
      e.metadata.workspace === context.workspace &&
      e.metadata.project === context.project
    )
  }
}
```

---

### 1.2 Performance Leaks (Memory/Disk Bloat)

#### Risk 3: Unbounded Growth

```typescript
// Problem: No limits on entities
for (let i = 0; i < 1000000; i++) {
  await memory.createEntity({
    name: `Entity ${i}`,
    observations: ['...']
  })
}

// Result:
// - graph.json grows from 10KB → 500MB
// - Load time: 0.1s → 30s
// - Search time: 5ms → 5000ms
// - App becomes unusable ❌
```

**Severity**: 🟠 MEDIUM-HIGH

**Mitigation**:

```typescript
class BoundedMemoryServer extends ContextAwareMemoryServer {
  private readonly MAX_ENTITIES = 10000
  private readonly MAX_AGE_DAYS = 90
  
  async createEntity(entity: Entity) {
    // Check limit
    const count = await this.getEntityCount()
    if (count >= this.MAX_ENTITIES) {
      // Auto-prune old entities
      await this.pruneOldEntities()
    }
    
    return super.createEntity(entity)
  }
  
  async pruneOldEntities() {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - this.MAX_AGE_DAYS)
    
    const graph = await this.loadGraph()
    
    // Remove old, unused entities
    graph.entities = graph.entities.filter(e => {
      const created = new Date(e.createdAt)
      const accessed = new Date(e.lastAccessedAt || e.createdAt)
      
      // Keep if recently accessed OR less than 90 days old
      return accessed > cutoffDate || created > cutoffDate
    })
    
    await this.saveGraph(graph)
  }
}
```

**Effectiveness:**
- ✅ Prevents unbounded growth
- ✅ Automatic cleanup
- ✅ Keeps most relevant data
- ⚠️ User should be notified of pruning

---

#### Risk 4: JSON Load Performance

```typescript
// Problem: Entire JSON loaded into memory on startup
// At 10,000 entities: ~10MB JSON
// Parse time: ~500ms (blocks UI)

await memory.start()  // ← Blocks for 500ms
```

**Severity**: 🟡 MEDIUM (only affects startup)

**Mitigation**:

```typescript
class LazyMemoryServer extends BoundedMemoryServer {
  private graphCache: Graph | null = null
  private indexCache: Map<string, Entity> = new Map()
  
  async start() {
    // Load index only (entity IDs + names)
    this.indexCache = await this.loadIndex()
    // Don't load full graph yet
  }
  
  async search(query: string) {
    // Search index first (fast)
    const ids = this.indexCache.search(query)
    
    // Load only matching entities (lazy)
    return await this.loadEntitiesById(ids)
  }
  
  private async loadIndex() {
    const indexPath = this.storagePath + '.index'
    // Much smaller file: just IDs + names
    return JSON.parse(await readFileSync(indexPath, 'utf8'))
  }
}
```

---

### 1.3 Summary: Leak Risk Assessment

| Risk Type | Severity | Mitigation | Effort |
|-----------|----------|------------|--------|
| **JSON File Exposure** | 🔴 HIGH | Encryption | 1 day |
| **PII Storage** | 🔴 HIGH | Detection | 2 days |
| **Secret Leaks** | 🔴 HIGH | Pattern matching | 1 day |
| **Cross-Context** | 🟡 MEDIUM | Context isolation | 2 days |
| **Unbounded Growth** | 🟠 MEDIUM-HIGH | Auto-pruning | 1 day |
| **Load Performance** | 🟡 MEDIUM | Lazy loading | 2 days |

**Total Mitigation Time**: ~2 weeks

**Recommendation**: Implement HIGH severity mitigations first (encryption, PII detection).

---

## Part 2: Future Scaling Strategy

### 2.1 Current Limits of server-memory

```typescript
// What server-memory handles well
✅ 1-10,000 entities
✅ Simple keyword search
✅ JSON file storage
✅ Single-user, single-device

// Where it struggles
❌ >10,000 entities (slow)
❌ Semantic search (no embeddings)
❌ Multi-device sync
❌ Real-time collaboration
❌ Complex graph queries
```

---

### 2.2 Scaling Thresholds

| Entities | server-memory | Action Required |
|----------|---------------|-----------------|
| **0-1,000** | ✅ Perfect | None |
| **1,000-5,000** | ✅ Good | Add indexing |
| **5,000-10,000** | ⚠️ OK | Optimize + prune |
| **10,000-50,000** | 🟠 Slow | **Migrate to SQLite** |
| **50,000-500,000** | 🔴 Fails | **Migrate to PostgreSQL** |
| **500,000+** | ❌ Not viable | **Migrate to Neo4j/Memento** |

---

### 2.3 Migration Path (Design for Scale from Day 1)

#### Strategy: Abstract Storage Layer

```typescript
/**
 * Storage Interface
 * Allows swapping backends without changing app code
 */
interface MemoryStorage {
  createEntity(entity: Entity): Promise<Entity>
  getEntity(id: string): Promise<Entity | null>
  search(query: string, limit: number): Promise<Entity[]>
  deleteEntity(id: string): Promise<void>
  createRelation(relation: Relation): Promise<Relation>
}

/**
 * Implementation 1: JSON (Day 1 - MVP)
 */
class JSONStorage implements MemoryStorage {
  private graph: Graph
  
  async createEntity(entity: Entity) {
    this.graph.entities.push(entity)
    await this.persist()
    return entity
  }
  
  async search(query: string, limit: number) {
    // Simple in-memory filter
    return this.graph.entities
      .filter(e => e.name.includes(query))
      .slice(0, limit)
  }
  
  private async persist() {
    await writeFile('graph.json', JSON.stringify(this.graph))
  }
}

/**
 * Implementation 2: SQLite (When >10K entities)
 */
class SQLiteStorage implements MemoryStorage {
  private db: Database
  
  async createEntity(entity: Entity) {
    await this.db.run(
      'INSERT INTO entities (id, name, type, observations) VALUES (?, ?, ?, ?)',
      [entity.id, entity.name, entity.type, JSON.stringify(entity.observations)]
    )
    return entity
  }
  
  async search(query: string, limit: number) {
    // Use FTS5 for fast search
    return this.db.all(`
      SELECT * FROM entities 
      WHERE entities_fts MATCH ? 
      ORDER BY rank 
      LIMIT ?
    `, [query, limit])
  }
}

/**
 * Implementation 3: Neo4j (If enterprise scale)
 */
class Neo4jStorage implements MemoryStorage {
  private driver: Driver
  
  async createEntity(entity: Entity) {
    const session = this.driver.session()
    await session.run(`
      CREATE (e:Entity {id: $id, name: $name, type: $type})
      RETURN e
    `, entity)
    await session.close()
    return entity
  }
  
  async search(query: string, limit: number) {
    const session = this.driver.session()
    const result = await session.run(`
      CALL db.index.fulltext.queryNodes('entityIndex', $query) 
      YIELD node, score
      RETURN node 
      LIMIT $limit
    `, { query, limit })
    await session.close()
    return result.records.map(r => r.get('node'))
  }
}

/**
 * Unified Interface (App Code)
 */
class MemoryService {
  private storage: MemoryStorage
  
  constructor(backend: 'json' | 'sqlite' | 'neo4j' = 'json') {
    switch (backend) {
      case 'json':
        this.storage = new JSONStorage()
        break
      case 'sqlite':
        this.storage = new SQLiteStorage()
        break
      case 'neo4j':
        this.storage = new Neo4jStorage()
        break
    }
  }
  
  // App code uses this, doesn't care about backend
  async remember(fact: string) {
    return this.storage.createEntity({ name: fact, ... })
  }
}

// Easy migration!
// Day 1:     const memory = new MemoryService('json')
// Month 6:   const memory = new MemoryService('sqlite')
// Year 2:    const memory = new MemoryService('neo4j')
```

---

### 2.4 Migration Timeline

```
┌─────────────────────────────────────────────────────────────┐
│                   Scaling Roadmap                           │
└─────────────────────────────────────────────────────────────┘

Phase 1: MVP (Month 1-3)
├── Backend: JSON via server-memory
├── Users: 1-100
├── Entities: <1,000
└── Performance: Perfect ✅

Phase 2: Growth (Month 4-6)
├── Backend: Migrate to SQLite
├── Users: 100-1,000
├── Entities: 1,000-10,000
├── Migration: 1 week
└── Performance: Excellent ✅

Phase 3: Scale (Month 7-12)
├── Backend: Consider PostgreSQL
├── Users: 1,000-10,000
├── Entities: 10,000-100,000
├── Migration: 2 weeks
└── Performance: Good ✅

Phase 4: Enterprise (Year 2+)
├── Backend: Migrate to Neo4j/Memento
├── Users: 10,000+
├── Entities: 100,000-1,000,000+
├── Migration: 4 weeks
├── Add: Semantic search, temporal queries
└── Performance: Excellent ✅
```

---

### 2.5 Decision Points

**When to migrate FROM server-memory:**

```typescript
// Metrics to monitor
interface ScaleMetrics {
  entityCount: number
  searchLatency: number      // ms
  startupTime: number        // ms
  fileSize: number           // MB
  userCount: number
}

// Auto-suggest migration
function shouldMigrate(metrics: ScaleMetrics): Migration | null {
  if (metrics.entityCount > 10000) {
    return {
      to: 'sqlite',
      reason: 'Entity count exceeded 10K',
      urgency: 'high'
    }
  }
  
  if (metrics.searchLatency > 100) {
    return {
      to: 'sqlite',
      reason: 'Search is slow (>100ms)',
      urgency: 'medium'
    }
  }
  
  if (metrics.fileSize > 50) {
    return {
      to: 'sqlite',
      reason: 'JSON file exceeds 50MB',
      urgency: 'high'
    }
  }
  
  return null  // Stay on JSON
}

// In app
const migration = shouldMigrate(await getMetrics())
if (migration) {
  console.warn(`Consider migrating to ${migration.to}: ${migration.reason}`)
  // Optionally: await autoMigrate(migration.to)
}
```

---

### 2.6 Hybrid Approach (Best of Both Worlds)

**Recommended**: Use BOTH simultaneously with clear separation

```typescript
/**
 * Tier-Based Storage
 * - Hot data: In-memory (fast)
 * - Warm data: SQLite (fast enough)
 * - Cold data: server-memory JSON (archive)
 */
class TieredMemoryService {
  private hot: Map<string, Entity> = new Map()        // Recent 100
  private warm: SQLiteStorage                         // Recent 10K
  private cold: JSONStorage                           // Everything else
  
  async createEntity(entity: Entity) {
    // Always write to hot
    this.hot.set(entity.id, entity)
    
    // Write to warm (async)
    this.warm.createEntity(entity).catch(console.error)
    
    // Archive to cold (low priority)
    setTimeout(() => {
      this.cold.createEntity(entity)
    }, 60000)  // After 1 minute
    
    return entity
  }
  
  async search(query: string) {
    // Search hot first (instant)
    const hotResults = Array.from(this.hot.values())
      .filter(e => e.name.includes(query))
    
    if (hotResults.length >= 5) {
      return hotResults  // Good enough
    }
    
    // Search warm (fast)
    const warmResults = await this.warm.search(query, 10)
    
    return [...hotResults, ...warmResults].slice(0, 10)
  }
}
```

**Benefits:**
- ✅ Sub-millisecond search (hot cache)
- ✅ Scales to millions (warm + cold)
- ✅ Disaster recovery (JSON backups)
- ✅ No migration needed (gradual)

---

## Part 3: Recommended Architecture

### Production-Ready System

```typescript
/**
 * Final Architecture: Multi-Layer + Future-Proof
 */
class ProductionMemoryService {
  // Layer 1: Privacy & Security
  private piiDetector: PIIDetector
  private secretRedactor: SecretRedactor
  private encryption: EncryptionService
  
  // Layer 2: Storage (swappable)
  private storage: MemoryStorage  // JSON | SQLite | Neo4j
  
  // Layer 3: Performance
  private cache: Map<string, Entity>
  private indexer: SearchIndexer
  
  // Layer 4: Monitoring
  private metrics: MetricsCollector
  
  async createEntity(entity: Entity, context: Context) {
    // 1. Privacy checks
    if (this.piiDetector.detect(entity.observations)) {
      throw new PrivacyError('PII detected')
    }
    
    entity.observations = this.secretRedactor.redact(entity.observations)
    
    // 2. Context isolation
    entity.metadata.context = context
    
    // 3. Storage (backend-agnostic)
    const stored = await this.storage.createEntity(entity)
    
    // 4. Cache
    this.cache.set(stored.id, stored)
    
    // 5. Index
    this.indexer.add(stored)
    
    // 6. Metrics
    this.metrics.recordCreate(stored)
    
    // 7. Check if migration needed
    if (await this.shouldMigrate()) {
      this.suggestMigration()
    }
    
    return stored
  }
  
  private async shouldMigrate(): Promise<boolean> {
    const metrics = await this.metrics.getStats()
    return metrics.entityCount > 10000 || 
           metrics.searchLatency > 100
  }
  
  private suggestMigration() {
    // Show UI notification
    this.notify('Consider upgrading to SQLite for better performance')
  }
}
```

---

## Part 4: Action Items

### Immediate (Week 1-2)
- [x] Install `@modelcontextprotocol/server-memory` ✅
- [ ] Implement encryption wrapper
- [ ] Add PII detection
- [ ] Add secret redaction
- [ ] Test with 1,000 entities

### Short-term (Week 3-4)
- [ ] Implement context isolation
- [ ] Add auto-pruning
- [ ] Create metrics dashboard
- [ ] Test with 5,000 entities

### Medium-term (Month 2-3)
- [ ] Build storage abstraction layer
- [ ] Prepare SQLite migration script
- [ ] Load test with 10,000 entities
- [ ] Document migration process

### Long-term (Month 6+)
- [ ] Monitor entity count growth
- [ ] Benchmark performance at scale
- [ ] Implement auto-migration
- [ ] Consider Memento-MCP if needed

---

## Conclusion

### Leak Risks: MITIGABLE ✅

**High-risk leaks:**
- ❌ Plain JSON storage → ✅ **Encrypt**
- ❌ PII exposure → ✅ **Detect & block**
- ❌ Secret leaks → ✅ **Redact**

**Result**: With proper safeguards, server-memory is **secure** for production.

---

### Scaling: FUTURE-PROOF ✅

**Migration path:**
```
JSON (today) → SQLite (Month 6) → PostgreSQL (Year 1) → Neo4j (Year 2+)
```

**Design principle**: Abstract storage layer = swap backends easily.

**Result**: Start simple, scale when needed, **no rewrite required**.

---

### Final Verdict

✅ **Use server-memory TODAY with safeguards**  
✅ **Design for scale from DAY ONE** (abstraction layer)  
✅ **Monitor metrics** to know when to migrate  
✅ **No risk** - easy migration path exists

**Ship fast, scale later!** 🚀
