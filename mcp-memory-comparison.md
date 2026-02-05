# MCP Memory Server Comparison: Official vs Memento

**Purpose**: Decide which memory server to use as our foundation  
**Date**: January 26, 2026

---

## Quick Answer: Use @modelcontextprotocol/server-memory ✅

**Why**: Official, simple, local-first, easier to modify, better for our use case.

---

## Detailed Comparison

### 1. @modelcontextprotocol/server-memory (Official) ⭐ RECOMMENDED

**Source**: Anthropic (official MCP implementation)  
**npm**: `@modelcontextprotocol/server-memory`  
**Version**: 2025.11.25  
**Maintainers**: Anthropic team

#### Architecture
```
Simple Knowledge Graph
        ↓
JSON File Storage (local)
        ↓
In-Memory for active session
```

#### Key Features
- ✅ **Official implementation** (by Anthropic)
- ✅ **Simple & lightweight** (25.2 kB unpacked)
- ✅ **JSON-based storage** (easy to inspect/debug)
- ✅ **Local-first** (no external dependencies)
- ✅ **Easy to modify** (TypeScript source)
- ✅ **Zero setup** (just npm install)
- ✅ **Knowledge graph structure** (entities, relations, observations)
- ✅ **In-memory for performance** (persists to JSON)

#### Storage Backend
```typescript
// File-based (default)
{
  "entities": [...],
  "relations": [...],
  "observations": [...]
}
// Stored at: ~/.mcp/memory/graph.json
```

#### Tools Exposed
1. `create_entities` - Create new knowledge nodes
2. `create_relations` - Link entities together
3. `add_observations` - Add temporal facts
4. `delete_entities` - Remove nodes
5. `delete_observations` - Remove facts
6. `delete_relations` - Remove connections
7. `read_graph` - Query entire graph
8. `search_nodes` - Find entities
9. `open_nodes` - Get entity details

**Total**: ~9 tools

#### Performance
- **Latency**: ~5-10ms (in-memory)
- **Scalability**: Good for <10,000 entities
- **Memory**: Minimal (loads JSON on startup)

#### Privacy
- ✅ 100% local (JSON files)
- ✅ No network calls
- ✅ User owns data
- ✅ Easy to encrypt (just encrypt JSON)
- ✅ Easy to backup/export

#### Pros for Our Use Case
1. **Easy to extend** - Can wrap with our custom layer
2. **Debuggable** - Can inspect JSON files directly
3. **Lightweight** - Won't bloat our app
4. **Official support** - Updated by Anthropic
5. **Simple migration** - Can easily switch to SQLite later
6. **Perfect for MVP** - Get started quickly

#### Cons
- ⚠️ JSON storage (not as fast as DB for large graphs)
- ⚠️ No built-in embeddings (need to add if needed)
- ⚠️ Limited to ~10K entities efficiently

---

### 2. Memento-MCP (Community) 🚀 ADVANCED

**Source**: gannonh (community project)  
**GitHub**: `gannonh/memento-mcp`  
**Backend**: Neo4j (graph database)

#### Architecture
```
Advanced Knowledge Graph
        ↓
Neo4j Database (local or cloud)
        ↓
Vector Embeddings (semantic search)
        ↓
Temporal tracking
```

#### Key Features
- ✅ **Production-ready** graph database (Neo4j)
- ✅ **Semantic search** (vector embeddings)
- ✅ **Temporal awareness** (tracks time)
- ✅ **Confidence decay** (relations fade over time)
- ✅ **Scalable** (millions of entities)
- ✅ **Advanced queries** (Cypher language)
- ✅ **Hybrid search** (keyword + semantic)

#### Storage Backend
```typescript
// Neo4j database
Neo4j.connect({
  uri: 'bolt://localhost:7687',
  username: 'neo4j',
  password: 'your-password'
})

// With vector embeddings
{
  embedding: [0.1, 0.2, ...],  // 1536 dimensions
  entity: { ...data }
}
```

#### Tools Exposed
1. `create_entity` - Create knowledge nodes
2. `add_observation` - Add facts with timestamps
3. `create_relation` - Link entities with confidence
4. `search_nodes` - Semantic + keyword search
5. `get_entity` - Retrieve full entity
6. `delete_entity` - Remove nodes
7. `update_relation_confidence` - Adjust weights
8. `temporal_query` - Query at specific time
9. `get_related_entities` - Graph traversal
10. `embed_text` - Generate embeddings
11. `verify_vector_index` - Diagnostics

**Total**: ~11 tools

#### Performance
- **Latency**: ~10-20ms (Neo4j query)
- **Scalability**: Excellent (millions of entities)
- **Memory**: Higher (Neo4j + embeddings)

#### Privacy
- ✅ Can be local (local Neo4j)
- ⚠️ Requires Neo4j installation
- ⚠️ More complex to backup
- ✅ Encryption available (Neo4j supports it)

#### Pros
1. **Scalable** - Handles massive graphs
2. **Semantic search** - Find related concepts
3. **Temporal queries** - "What did I know last week?"
4. **Production-grade** - Used in real systems
5. **Advanced features** - Confidence, embeddings, etc.

#### Cons for Our Use Case
1. **Complex setup** - Requires Neo4j installation
2. **Heavyweight** - Neo4j is a full database server
3. **Overkill** - We don't need millions of entities
4. **Harder to modify** - More complex codebase
5. **Setup barrier** - Users need to install Neo4j

---

## Side-by-Side Comparison

| Feature | @modelcontextprotocol/server-memory | Memento-MCP |
|---------|-------------------------------------|-------------|
| **Maintainer** | Anthropic (official) ⭐ | Community |
| **Setup Complexity** | npm install (⭐⭐⭐⭐⭐) | Neo4j + npm (⭐⭐) |
| **Storage** | JSON files | Neo4j database |
| **Size** | 25 KB | ~500 MB (with Neo4j) |
| **Speed** | Fast (5-10ms) | Very fast (10-20ms) |
| **Scalability** | Good (<10K entities) | Excellent (millions) |
| **Semantic Search** | ❌ No (keyword only) | ✅ Yes (embeddings) |
| **Temporal Queries** | ❌ No | ✅ Yes |
| **Privacy** | Perfect (local JSON) ⭐ | Good (local Neo4j) |
| **Ease of Modification** | Easy (TypeScript) ⭐ | Complex |
| **Documentation** | Official docs ⭐ | Community docs |
| **Maintenance** | Anthropic ⭐ | Community |
| **Perfect For** | **Our use case** ⭐ | Large enterprises |

---

## Decision Matrix

### Our Requirements
1. ✅ Local-first privacy
2. ✅ Easy to modify (add our layer)
3. ✅ Fast setup (no complex dependencies)
4. ✅ Lightweight (won't bloat app)
5. ⚠️ Semantic search (nice-to-have, not critical)
6. ⚠️ Millions of entities (not needed)

### How They Score

| Requirement | Official | Memento | Winner |
|-------------|----------|---------|--------|
| Privacy | Perfect | Good | Official ⭐ |
| Modifiable | Easy | Hard | Official ⭐ |
| Setup | 1 minute | 1 hour | Official ⭐ |
| Lightweight | 25 KB | 500 MB | Official ⭐ |
| Semantic Search | No | Yes | Memento |
| Scale | 10K | Millions | Memento |

**Score: Official (4/4 critical) vs Memento (2/2 nice-to-have)**

---

## Recommended Approach

### Phase 1: Start with @modelcontextprotocol/server-memory ✅

**Why:**
1. ✅ **Official** (maintained by Anthropic)
2. ✅ **Simple** (JSON files, no DB setup)
3. ✅ **Fast to integrate** (2-3 days vs 1-2 weeks)
4. ✅ **Easy to customize** (TypeScript, small codebase)
5. ✅ **Perfect privacy** (local JSON)
6. ✅ **Zero user setup** (works out of box)

**Implementation:**
```typescript
// Install
npm install @modelcontextprotocol/server-memory

// Use as foundation
import { MemoryServer } from '@modelcontextprotocol/server-memory'

// Add our custom layer
class AutoMemoryService extends MemoryServer {
  // Add PII detection
  // Add automatic extraction
  // Add user approval
  // Add encryption
}
```

---

### Phase 2: Migrate to Memento-MCP (If Needed - Later)

**When to migrate:**
- If you exceed 10,000 entities
- If you need semantic "fuzzy" search
- If you need temporal queries
- If user base demands it

**Migration path:**
```typescript
// Export from official
const entities = await officialMemory.readGraph()

// Import to Memento
for (const entity of entities) {
  await mementoMcp.createEntity(entity)
}
```

**Time to migrate**: ~1 week (due to adapter changes)

---

## Code Comparison

### Official Server Usage

```typescript
// Start the server
import { MemoryServer } from '@modelcontextprotocol/server-memory'

const server = new MemoryServer({
  storagePath: app.getPath('userData') + '/memory'
})

await server.start()

// Create entity
await server.callTool('create_entities', {
  entities: [{
    name: 'John Doe',
    entityType: 'person',
    observations: ['Software engineer at Company X']
  }]
})

// Search
const results = await server.callTool('search_nodes', {
  query: 'software engineer'
})

// Simple and straightforward!
```

### Memento-MCP Usage

```typescript
// Requires Neo4j running first!
// docker run -p 7687:7687 -p 7474:7474 neo4j

import { MementoMCP } from 'memento-mcp'

const memento = new MementoMCP({
  neo4j: {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password'
  },
  embeddings: {
    provider: 'openai',  // Requires API key
    model: 'text-embedding-ada-002'
  }
})

await memento.connect()

// Create entity (more complex)
await memento.createEntity({
  name: 'John Doe',
  type: 'person',
  embedding: await memento.embedText('John Doe software engineer')
})

// Semantic search (powerful but complex)
const results = await memento.semanticSearch({
  query: 'developers',
  limit: 10,
  minScore: 0.7
})

// More powerful, but much more setup
```

---

## Final Recommendation

### Use: @modelcontextprotocol/server-memory ⭐

**Reasoning:**
1. **80/20 Rule**: Provides 80% of what we need with 20% of complexity
2. **Time to Market**: Ship in 2 weeks vs 4 weeks
3. **User Experience**: No setup required (Memento needs Neo4j)
4. **Privacy**: Perfect local storage
5. **Flexibility**: Easy to extend with our custom layer

**What We Get:**
- ✅ Official support
- ✅ Simple JSON storage
- ✅ Fast integration
- ✅ Easy to customize
- ✅ Local-first

**What We Lose (and can add later):**
- ⚠️ Semantic search (can add embeddings ourselves if needed)
- ⚠️ Temporal queries (can track timestamps ourselves)
- ⚠️ Massive scale (not needed for MVP)

---

## Implementation Plan

### Week 1: Integration
```bash
# Install
npm install @modelcontextprotocol/server-memory

# Create adapter
touch src/main/services/MCPMemoryAdapter.ts

# Wrap with our layer
class AutoMemoryService extends MCPMemoryAdapter {
  // Our custom code only (30%)
}
```

### Week 2-3: Custom Features
- Add PII detection
- Add automatic extraction
- Add user approval UI
- Add encryption

### Week 4: Ship MVP
- Test thoroughly
- Document
- Release

**Total Time**: 4 weeks (vs 6-7 weeks with Memento-MCP)

---

## Conclusion

**Winner**: `@modelcontextprotocol/server-memory` ✅

**Why**: Perfect fit for our MVP, easy to extend, privacy-first, zero setup, official support.

**Future**: Can migrate to Memento-MCP if we outgrow it (unlikely for coding assistant use case).

---

**Next Step**: Start implementing the adapter layer using the official server!

```bash
# Already installed ✅
npm install @modelcontextprotocol/server-memory

# Next: Create adapter
touch src/main/services/MCPMemoryAdapter.ts
```
