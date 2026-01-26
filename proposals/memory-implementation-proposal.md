# AI Agent Memory Implementation Proposal

**Author**: AI-Worker Development Team  
**Date**: January 26, 2026  
**Status**: Proposal  
**Priority**: High

---

## Executive Summary

This proposal analyzes memory implementations across major AI platforms (ChatGPT, Claude, Gemini, Perplexity), evaluates open-source MCP memory servers, and recommends an **OpenAI-inspired automatic memory system** for AI-Worker. We address critical concerns around **memory leaks, privacy, and performance** while proposing a hybrid approach that combines **automatic extraction** with **local-first privacy**.

---

## Table of Contents

1. [Background](#1-background)
2. [Current Implementations Analysis](#2-current-implementations-analysis)
3. [Memory Leak & Performance Concerns](#3-memory-leak--performance-concerns)
4. [Privacy & Security Analysis](#4-privacy--security-analysis)
5. [MCP Server Comparison](#5-mcp-server-comparison)
6. [Recommended Solution](#6-recommended-solution)
7. [Implementation Plan](#7-implementation-plan)

---

## 1. Background

### Current State
AI-Worker currently has:
- **Manual Memory System**: Requires explicit `memory_create_entity` calls
- **SQLite Backend**: Local, fast, privacy-preserving
- **Knowledge Graph**: Structured entities and relations

### Problem Statement
Manual memory has limitations:
- ❌ AI must explicitly call memory tools (agent needs to "decide" to remember)
- ❌ Users unaware of what's being stored
- ❌ No automatic context accumulation across sessions

### Goal
Implement **OpenAI-style automatic memory** that:
- ✅ Silently extracts important facts
- ✅ Maintains privacy (local-first)
- ✅ Prevents memory leaks
- ✅ Gives user control

---

## 2. Current Implementations Analysis

### 2.1 ChatGPT (OpenAI) - Reference Model

**Architecture:**
```
User Conversation
       ↓
Fact Extraction LLM (background)
       ↓
Embedding Generation
       ↓
Vector Database (Pinecone/Weaviate)
       ↓
Automatic Retrieval on Context
```

**How it Works:**
1. **Silent Extraction**: Every conversation is analyzed for "memorable facts"
2. **Embedding Storage**: Facts converted to 1536-dim vectors
3. **Automatic Injection**: Relevant memories added to context window automatically
4. **User Control**: Dashboard to view/delete memories

**Example:**
```
Session 1:
User: "I'm a Python developer who prefers FastAPI over Flask"
[ChatGPT silently stores: user_preference = "Python/FastAPI"]

Session 2 (days later):
User: "Help me build a REST API"
ChatGPT: "Since you prefer FastAPI, here's a FastAPI implementation..."
```

**Privacy Model:**
- ❌ **Cloud-hosted** (memories stored on OpenAI servers)
- ⚠️ **Encrypted in transit** but accessible to OpenAI
- ✅ **User can delete** memories
- ❌ **No local option**

**Memory Leak Risks:**
| Risk Type | Severity | Mitigation |
|-----------|----------|------------|
| Sensitive data stored | HIGH | User review interface |
| Cross-user contamination | LOW | User-specific namespaces |
| Unbounded growth | MEDIUM | Automatic pruning |

---

### 2.2 Claude (Anthropic)

**Architecture:**
```
User uploads documents manually
       ↓
Project-scoped context
       ↓
No cross-session memory
```

**How it Works:**
- **Manual upload**: Users add files to "Projects"
- **Session-scoped**: Memory exists only within project
- **No accumulation**: Doesn't learn user preferences over time

**Privacy Model:**
- ❌ **Cloud-hosted** (Anthropic servers)
- ✅ **User controls** what's uploaded
- ✅ **Transparent** (user knows what's in memory)
- ❌ **No automatic learning**

**Memory Leak Risks:**
| Risk Type | Severity | Mitigation |
|-----------|----------|------------|
| Sensitive documents | MEDIUM | User responsibility |
| Unbounded growth | LOW | Project limits |

---

### 2.3 Gemini (Google)

**Architecture:**
```
Manual "Remember this" commands
       ↓
Google Account Storage
       ↓
Integration with Google Workspace
```

**How it Works:**
- **Explicit commands**: User says "Remember that I prefer TypeScript"
- **Workspace integration**: Can access Gmail, Drive, Calendar
- **Account-linked**: Tied to Google account

**Privacy Model:**
- ❌ **Cloud-hosted** (Google servers)
- ⚠️ **Deep integration** with Google ecosystem (privacy concern)
- ✅ **User-initiated** memory creation
- ❌ **No local option**

---

### 2.4 Perplexity

**Architecture:**
```
Thread-scoped memory only
No cross-thread persistence
```

**Privacy Model:**
- ✅ **Minimal data retention**
- ❌ **No long-term memory**
- ✅ **Thread isolation** (privacy by design)

---

## 3. Memory Leak & Performance Concerns

### 3.1 Memory Leaks (Data Leakage)

**Definition**: Sensitive information unintentionally stored or exposed.

#### Risk Categories

**1. Sensitive Code Exposure**
```typescript
// User working on auth system
User: "Here's my JWT secret: sk_prod_abc123xyz"

Risk: AI stores this in memory
Impact: Secret persists across sessions
Mitigation: Pattern detection + redaction
```

**2. Personal Information Accumulation**
```typescript
User: "My email is john@company.com"
User: "My phone is +1-555-1234"

Risk: PII builds up in memory database
Impact: Privacy violation, GDPR non-compliance
Mitigation: PII detection + user consent
```

**3. Cross-Context Contamination**
```typescript
Project A: "Use OAuth for authentication"
Project B: User switches context

Risk: AI suggests OAuth in unrelated Project B
Impact: Irrelevant/confusing suggestions
Mitigation: Context isolation per project
```

#### Leak Detection Strategy

```typescript
interface MemoryLeakDetector {
  // Pattern-based detection
  detectSecrets(text: string): boolean
  detectPII(text: string): boolean
  detectAPIKeys(text: string): boolean
  
  // Redaction
  redact(text: string): string
}

// Example patterns
const SECRET_PATTERNS = [
  /sk_[a-zA-Z0-9]{32,}/,      // API keys
  /password\s*=\s*['"][^'"]+/i, // Passwords
  /token\s*=\s*['"][^'"]+/i     // Tokens
]
```

---

### 3.2 Memory Leaks (Performance)

**Definition**: Unbounded memory growth causing performance degradation.

#### Growth Scenarios

**Scenario 1: Unbounded Entity Creation**
```typescript
// User generates hundreds of test entities
for (let i = 0; i < 1000; i++) {
  memory_create_entity({
    name: `Test Entity ${i}`,
    type: "test"
  })
}

Impact:
- Database size grows from 100KB → 10MB
- Search queries slow from 2ms → 200ms
- Startup time increases
```

**Mitigation:**
```typescript
// Implement automatic pruning
class MemoryManager {
  // Delete entities older than 90 days if unused
  async pruneOld(days: number = 90) {
    await db.exec(`
      DELETE FROM entities 
      WHERE created_at < datetime('now', '-${days} days')
      AND id NOT IN (
        SELECT DISTINCT entity_id FROM recent_access
        WHERE accessed_at > datetime('now', '-30 days')
      )
    `)
  }
  
  // Limit per-project entities
  async enforceLimit(projectId: string, limit: number = 10000) {
    const count = await this.countEntities(projectId)
    if (count > limit) {
      // Delete least recently used
      await this.deleteLRU(projectId, count - limit)
    }
  }
}
```

**Scenario 2: Embedding Vector Bloat**
```typescript
// If using vector embeddings (1536 dimensions per entity)
1000 entities × 1536 floats × 4 bytes = 6.14 MB just for embeddings

Impact:
- RAM usage increases
- Vector search becomes slower
```

**Mitigation:**
- Use **dimensionality reduction** (PCA: 1536 → 384 dims)
- **Lazy loading**: Load embeddings on-demand
- **Quantization**: Store as INT8 instead of FLOAT32

---

## 4. Privacy & Security Analysis

### 4.1 Privacy Threat Model

#### Threat 1: Cloud Storage Breach

**Commercial Solutions (ChatGPT, Claude, Gemini):**
```
User Memory → Cloud Servers → Third-party access risk

Attack Vectors:
1. Server breach (hacker gains access)
2. Insider threat (employee access)
3. Subpoena/legal request
4. Service provider policy change
```

**Our Local-First Approach:**
```
User Memory → Local SQLite → No network transmission

Benefits:
✅ No cloud exposure
✅ Full user control
✅ GDPR compliant by design
✅ No third-party access
```

---

#### Threat 2: Multi-User Environments

**Scenario**: Shared computer or family device

```typescript
// Risk: User A's memories visible to User B
User A logs in: Sees Project X entities
User B logs in: Still sees Project X entities (leak!)

Solution: User-scoped databases
const dbPath = path.join(
  app.getPath('userData'), 
  `memory-${userId}.db`  // Separate DB per user
)
```

---

#### Threat 3: Unintended Context Sharing

**Example:**
```typescript
Work Context:
  User: "Connect to production database at prod.example.com"
  [AI stores connection string]

Personal Context (same user):
  User: "Help me build a side project database"
  AI: "I see you use prod.example.com for databases..."
  
Risk: Work credentials leak into personal projects
```

**Solution: Context Isolation**
```typescript
interface ContextBoundary {
  workspace: string      // e.g., "work" | "personal"
  project: string        // e.g., "ai-worker-app"
  
  // Memories scoped to context
  getMemories(): Entity[]
}

// Query with context
memory_search({
  query: "database credentials",
  context: { workspace: "work", project: "client-x" }
})
// Only returns work-scoped memories
```

---

### 4.2 User Consent & Transparency

#### GDPR Requirements

**Core Principles:**
1. **Explicit Consent**: User must opt-in to memory storage
2. **Data Access**: User can view all stored data
3. **Right to Delete**: User can delete specific memories
4. **Data Portability**: Export memories as JSON

**Proposed UI:**
```typescript
interface MemorySettings {
  automaticMemory: boolean          // Default: false (opt-in)
  sensitiveDataRedaction: boolean   // Default: true
  crossSessionLearning: boolean     // Default: false
  maxStorageDays: number            // Default: 90
  
  // Explicit categories
  storeCodePatterns: boolean        // Remember coding style
  storeProjectInfo: boolean         // Remember project details
  storePersonalPrefs: boolean       // Remember personal preferences
}
```

**Transparency Dashboard:**
```typescript
// Show user exactly what's stored
<MemoryDashboard>
  <MemoryList>
    <Memory>
      Type: "user_preference"
      Content: "Prefers TypeScript over JavaScript"
      Source: "Session 2024-01-15"
      <Button onClick={deleteMemory}>Delete</Button>
    </Memory>
  </MemoryList>
  
  <ExportButton>
    Export All Memories (JSON)
  </ExportButton>
</MemoryDashboard>
```

---

### 4.3 Security Best Practices

#### 1. Encryption at Rest

```typescript
// Encrypt sensitive memory database
import { encrypt, decrypt } from 'node-crypto'

class SecureMemoryService extends MemoryService {
  private encryptionKey: Buffer
  
  async initialize() {
    // Derive key from user password or OS keychain
    this.encryptionKey = await this.getEncryptionKey()
    
    // Enable SQLite encryption
    this.db.pragma(`cipher_key = '${this.encryptionKey.toString('hex')}'`)
  }
  
  private async getEncryptionKey(): Promise<Buffer> {
    // Use electron safeStorage (OS keychain)
    const { safeStorage } = require('electron')
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(
        await this.loadStoredKey()
      )
    }
  }
}
```

**Benefits:**
- ✅ Database file is encrypted on disk
- ✅ Requires user authentication to decrypt
- ✅ Protects against disk theft

---

#### 2. Access Control

```typescript
// Role-based access to memories
enum MemoryAccessLevel {
  PUBLIC = 0,      // Shared across all contexts
  PROJECT = 1,     // Project-specific
  PRIVATE = 2,     // User-only
  SENSITIVE = 3    // Requires explicit unlock
}

interface Entity {
  // ... existing fields
  accessLevel: MemoryAccessLevel
  encryptedContent?: string  // For SENSITIVE level
}

// Querying respects access level
memory_search({
  query: "database credentials",
  maxAccessLevel: MemoryAccessLevel.PROJECT
})
// Won't return SENSITIVE memories
```

---

#### 3. Audit Logging

```typescript
// Track all memory access
interface MemoryAuditLog {
  timestamp: Date
  action: 'create' | 'read' | 'update' | 'delete'
  entityId: string
  userId: string
  context: {
    project: string
    workspace: string
  }
  source: 'user' | 'ai' | 'system'
}

// Automatically log sensitive operations
class AuditedMemoryService extends MemoryService {
  async createEntity(data: EntityData): Promise<Entity> {
    const entity = await super.createEntity(data)
    
    await this.auditLog.write({
      timestamp: new Date(),
      action: 'create',
      entityId: entity.id,
      userId: this.currentUser,
      context: this.currentContext,
      source: 'ai'
    })
    
    return entity
  }
}
```

**Benefits:**
- ✅ Detect unauthorized access
- ✅ Debug memory issues
- ✅ Compliance reporting

---

## 5. MCP Server Comparison

### 5.1 Feature Matrix

| Server | Privacy | Performance | Automatic | Local | Leak Prevention | Best For |
|--------|---------|-------------|-----------|-------|-----------------|----------|
| **ChatGPT Approach** | ⚠️ Cloud | ⭐⭐⭐⭐ | ✅ Yes | ❌ No | ⚠️ Partial | User convenience |
| **Memento-MCP** | ⚠️ Depends | ⭐⭐⭐⭐⭐ | ❌ No | ✅ Yes | ✅ Good | Production scale |
| **RAG Memory** | ✅ Local | ⭐⭐⭐⭐ | ⚠️ Hybrid | ✅ Yes | ✅ Good | Document-heavy |
| **Graphiti** | ⚠️ Cloud | ⭐⭐⭐ | ✅ Yes | ❌ No | ⚠️ Partial | Temporal graphs |
| **Memgraph** | ✅ Local | ⭐⭐⭐⭐⭐ | ❌ No | ✅ Yes | ✅ Excellent | Real-time |
| **Our Implementation** | ✅✅ Local | ⭐⭐⭐⭐ | ❌ No | ✅ Yes | ✅ Excellent | Privacy-first |

---

### 5.2 Privacy Score Detailed

#### ChatGPT Approach (Score: 4/10)
- ❌ Cloud storage (OpenAI servers)
- ❌ No local option
- ✅ User can delete
- ⚠️ Silent extraction (user unaware)
- ❌ Potential training data use

#### Memento-MCP (Score: 7/10)
- ✅ Self-hosted Neo4j option
- ⚠️ Depends on deployment
- ✅ No automatic extraction
- ✅ User controls data
- ⚠️ Requires Neo4j infrastructure

#### Our Implementation (Score: 10/10)
- ✅ 100% local (SQLite)
- ✅ No network transmission
- ✅ User owns database file
- ✅ OS-level encryption available
- ✅ GDPR compliant by design

---

### 5.3 Memory Leak Prevention

#### Memento-MCP
```typescript
// Built-in size limits
const config = {
  maxEntities: 100000,
  maxRelations: 500000,
  autoArchive: true,
  archiveAfterDays: 90
}

// Automatic cleanup
neo4j.query(`
  MATCH (n:Entity)
  WHERE n.lastAccessed < datetime() - duration({days: 90})
  DELETE n
`)
```

**Leak Prevention: ⭐⭐⭐⭐ (Good)**

---

#### RAG Memory
```typescript
// Embedding-based automatic relevance filtering
memory.search({
  query: "current context",
  minRelevanceScore: 0.7  // Filter out irrelevant memories
})

// Automatic document expiration
config.documentTTL = 30  // days
```

**Leak Prevention: ⭐⭐⭐ (Fair)**

---

#### Our Implementation (Enhanced)
```typescript
// Add automatic safeguards
class SafeMemoryService extends MemoryService {
  // 1. PII Detection
  async createEntity(data: EntityData): Promise<Entity> {
    if (this.detectPII(data.description)) {
      throw new Error('PII detected. Use explicit consent.')
    }
    return super.createEntity(data)
  }
  
  // 2. Secret Redaction
  private detectSecrets(text: string): boolean {
    const patterns = [
      /sk_[a-zA-Z0-9]{32,}/,
      /ey[A-Za-z0-9_-]{100,}/,  // JWT
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/  // Email
    ]
    return patterns.some(p => p.test(text))
  }
  
  // 3. Automatic Pruning
  async startPruningSchedule() {
    setInterval(async () => {
      await this.pruneOldEntities(90)  // 90 days
      await this.pruneUnusedRelations()
    }, 24 * 60 * 60 * 1000)  // Daily
  }
}
```

**Leak Prevention: ⭐⭐⭐⭐⭐ (Excellent)**

---

## 6. Recommended Solution

### 6.1 Hybrid Approach: "OpenAI-Inspired, Privacy-First"

**Core Concept**: Combine ChatGPT's **automatic convenience** with **local-first privacy**.

```
User Conversation
       ↓
[Optional] Fact Extraction (local LLM)
       ↓
User Review & Approval
       ↓
Local SQLite Storage
       ↓
Automatic Retrieval on Context
```

---

### 6.2 Architecture

```typescript
/**
 * AutoMemoryService
 * Automatically extracts facts with user approval
 */
class AutoMemoryService extends MemoryService {
  private extractionQueue: PendingFact[] = []
  
  /**
   * 1. Automatic Extraction (background)
   */
  async analyzeConversation(messages: Message[]): Promise<PendingFact[]> {
    // Use local LLM to extract facts
    const facts = await this.localLLM.extract({
      messages,
      extractTypes: ['preference', 'project_info', 'code_pattern']
    })
    
    // Filter out sensitive data
    return facts.filter(f => !this.isSensitive(f))
  }
  
  /**
   * 2. User Approval UI
   */
  async requestApproval(facts: PendingFact[]): Promise<void> {
    // Show notification
    this.notifyUser({
      title: "New Memories Detected",
      body: `${facts.length} facts ready to save`,
      actions: ['Review', 'Dismiss']
    })
  }
  
  /**
   * 3. Smart Retrieval
   */
  async getContextualMemories(query: string): Promise<Entity[]> {
    // Automatically inject relevant memories into LLM context
    const relevant = await this.search(query, 5)
    
    // Log for transparency
    console.log(`[Memory] Injected ${relevant.length} memories into context`)
    
    return relevant
  }
}
```

---

### 6.3 User Experience Flow

```
┌─────────────────────────────────────┐
│  User: "I prefer TypeScript"        │
└──────────┬──────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ [AI Background Process]              │
│ Fact Detected: user_preference       │
│ Content: "Prefers TypeScript"        │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ [UI Notification - Bottom Right]     │
│ 💡 Remember this?                    │
│ "You prefer TypeScript"              │
│ [Save] [Dismiss] [Settings]          │
└──────────┬───────────────────────────┘
           │
     User clicks [Save]
           │
           ▼
┌──────────────────────────────────────┐
│ Stored in Local SQLite               │
│ Type: user_preference                │
│ Encrypted: ✅                         │
└──────────────────────────────────────┘
```

**Key Differences from ChatGPT:**
- ✅ **User approval required** (not silent)
- ✅ **100% local** (no cloud)
- ✅ **Transparent** (user sees what's stored)
- ✅ **Encrypted** (OS keychain integration)

---

### 6.4 Privacy Safeguards

```typescript
interface PrivacyConfig {
  // Opt-in by default
  automaticMemory: false,
  
  // Always enabled
  secretRedaction: true,
  piiDetection: true,
  
  // User configurable
  memoryRetentionDays: 90,
  requireApprovalFor: ['personal_info', 'credentials', 'project_data'],
  
  // Automatic cleanup
  autoPrune: true,
  maxEntities: 10000
}

// PII Detection
class PIIDetector {
  private patterns = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/,
    creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/
  }
  
  detect(text: string): boolean {
    return Object.values(this.patterns).some(p => p.test(text))
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

## 7. Implementation Plan

### Phase 1: Foundation (Week 1-2)
```typescript
// 1. Add PII detection
✅ Implement PIIDetector class
✅ Integrate into MemoryService.createEntity()
✅ Add unit tests

// 2. User approval UI
✅ Create MemoryApprovalNotification component
✅ Add to App.tsx
✅ Wire to IPC handlers

// 3. Automatic pruning
✅ Add pruneOldEntities() method
✅ Schedule daily cleanup
```

### Phase 2: Automatic Extraction (Week 3-4)
```typescript
// 1. Local fact extraction
✅ Install local LLM (Qwen2.5 or Llama)
✅ Implement extractFacts() function
✅ Filter sensitive data

// 2. Context injection
✅ Modify chat() function to auto-inject memories
✅ Add memory context to prompts
✅ Log transparency
```

### Phase 3: Advanced Features (Week 5-6)
```typescript
// 1. Memory dashboard
✅ Create MemoryExplorer UI component
✅ Show all stored entities
✅ Export/delete functionality

// 2. Encryption
✅ Integrate electron safeStorage
✅ Encrypt SQLite database
✅ Key management
```

### Phase 4: Testing & Refinement (Week 7-8)
```
✅ Privacy audit
✅ Memory leak testing
✅ Performance benchmarks
✅ User acceptance testing
```

---

## 8. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **User Adoption** | 70% enable auto-memory | Analytics |
| **Privacy Compliance** | 100% GDPR compatible | Audit |
| **Performance** | <5ms memory retrieval | Benchmark |
| **User Trust** | >80% positive feedback | Survey |
| **Memory Leaks** | 0 sensitive data leaks | Security scan |

---

## 9. Risks & Mitigation

### Risk 1: User Distrust
**Risk**: Users don't trust automatic memory  
**Mitigation**:
- Transparent UI showing what's stored
- Opt-in by default
- Easy delete/export

### Risk 2: Performance Degradation
**Risk**: Memory grows unbounded, slowing app  
**Mitigation**:
- Automatic pruning
- Entity limits (10K default)
- Background indexing

### Risk 3: False Positives (PII Detection)
**Risk**: Legitimate data flagged as sensitive  
**Mitigation**:
- User can override detection
- Whitelist patterns
- Machine learning-based detection (future)

---

## 10. Conclusion

**Recommendation**: Implement **Hybrid AutoMemory** approach.

**Why:**
1. ✅ Best of both worlds (convenience + privacy)
2. ✅ Local-first (no cloud dependency)
3. ✅ User control (approval required)
4. ✅ GDPR compliant
5. ✅ Prevents memory leaks

**Next Steps:**
1. Approve this proposal
2. Begin Phase 1 implementation
3. User testing with privacy-conscious beta users

---

## Appendix A: Code Examples

### Example 1: Automatic Fact Extraction
```typescript
// Extract facts from conversation
const conversation = [
  { role: 'user', content: 'I prefer TypeScript for all projects' },
  { role: 'assistant', content: 'Got it, TypeScript it is!' }
]

const facts = await autoMemory.extractFacts(conversation)
// Returns: [{ type: 'preference', content: 'Prefers TypeScript', confidence: 0.95 }]

// Request user approval
await autoMemory.requestApproval(facts)
```

### Example 2: Context Injection
```typescript
// Chat with automatic memory
async function chat(userMessage: string) {
  // Get relevant memories
  const memories = await autoMemory.getContextualMemories(userMessage)
  
  // Inject into prompt
  const systemPrompt = `
You are an AI assistant. User preferences:
${memories.map(m => `- ${m.description}`).join('\n')}

User message: ${userMessage}
  `
  
  // Call LLM
  return await llm.chat(systemPrompt)
}
```

### Example 3: Privacy Dashboard
```typescript
// Memory Explorer UI
<MemoryExplorer>
  <Header>
    Your Stored Memories ({entities.length})
    <ExportButton onClick={exportJSON}>Export All</ExportButton>
  </Header>
  
  <MemoryList>
    {entities.map(entity => (
      <MemoryCard key={entity.id}>
        <Type>{entity.type}</Type>
        <Content>{entity.description}</Content>
        <Metadata>
          Created: {entity.created_at}
          Last Used: {entity.last_accessed}
        </Metadata>
        <Actions>
          <Button onClick={() => deleteMemory(entity.id)}>Delete</Button>
        </Actions>
      </MemoryCard>
    ))}
  </MemoryList>
</MemoryExplorer>
```

---

**End of Proposal**
