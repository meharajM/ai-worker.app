# Memory Implementation Checklist

**Project**: AI-Worker App  
**Goal**: Implement automatic, privacy-first memory system  
**Approach**: Hybrid (Evaluate existing MCP servers + Build custom layer)  
**Timeline**: 4 weeks  
**Last Updated**: January 26, 2026

---

## Status Legend
- `[ ]` Not Started
- `[/]` In Progress
- `[x]` Complete
- `[!]` Blocked/Issue
- `[~]` Skipped/Deferred

---

## Phase 0: Research & Setup (Week 1)

### 0.1 Verify MCP Memory Server Availability
- [x] Attempted `@modelcontextprotocol/memory` - **Not found in npm**
- [ ] Search for official MCP memory server GitHub repo
- [ ] Check Anthropic's modelcontextprotocol GitHub org for memory server
- [ ] Evaluate alternative packages:
  - [ ] `memento-mcp` (Neo4j-based)
  - [ ] Search npm for "mcp memory" packages
  - [ ] Check GitHub for community implementations

**Decision Point**: 
- If official package found → Use as base (Checklist Option A)
- If no suitable package → Keep our implementation (Checklist Option B)

---

## Option A: MCP Server + Custom Layer (If package found)

### A.1 Installation & Setup
- [ ] Install MCP memory server package
- [ ] Verify it works standalone
- [ ] Review API documentation
- [ ] Test basic operations (create entity, search)

### A.2 Create Adapter Layer
- [ ] Create `src/main/services/MCPMemoryAdapter.ts`
- [ ] Implement entity format conversion (ours ↔ MCP)
- [ ] Write unit tests for adapter
- [ ] Migrate existing SQLite data to MCP format

### A.3 Integration
- [ ] Update `src/main/ipc/mcp.ts` to use adapter
- [ ] Update IPC handlers
- [ ] Test in-process vs external MCP server
- [ ] Benchmark performance

---

## Option B: Enhanced Our Implementation (Current Path)

### B.1 Code Quality Improvements ✅
- [x] Refactor `MemoryService.ts` with better documentation
- [x] Extract tool schemas to constants
- [x] Add comprehensive JSDoc comments
- [x] Export Entity/Relation types

### B.2 Privacy & Security Layer (Week 1-2)

#### PII Detection
- [ ] Create `src/main/privacy/PIIDetector.ts`
- [ ] Implement pattern matching for:
  - [ ] Email addresses
  - [ ] Phone numbers
  - [ ] Credit cards
  - [ ] Social Security Numbers
  - [ ] API keys/secrets
- [ ] Add configuration for custom patterns
- [ ] Write unit tests

#### Secret Redaction
- [ ] Create `src/main/privacy/SecretRedactor.ts`
- [ ] Detect common secret patterns:
  - [ ] JWT tokens (eyJ...)
  - [ ] API keys (sk_..., pk_...)
  - [ ] Database credentials
  - [ ] OAuth tokens
- [ ] Implement redaction strategy (replace vs reject)
- [ ] Add whitelist functionality

#### Encryption Layer
- [ ] Create `src/main/security/EncryptionService.ts`
- [ ] Integrate electron `safeStorage` for key management
- [ ] Implement database encryption (SQLite cipher)
- [ ] Add encrypted content fields to schema
- [ ] Test encryption/decryption roundtrip

### B.3 Automatic Memory Extraction (Week 2-3)

#### Fact Extraction Engine
- [ ] Create `src/main/extractors/FactExtractor.ts`
- [ ] Design extraction prompt for local LLM
- [ ] Implement fact types:
  - [ ] `user_preference` (e.g., "prefers TypeScript")
  - [ ] `project_info` (e.g., "working on AI-Worker")
  - [ ] `code_pattern` (e.g., "uses async/await")
  - [ ] `relationship` (e.g., "collaborates with Alice")
- [ ] Add confidence scoring
- [ ] Filter low-confidence facts

#### Local LLM Integration
- [ ] Evaluate local model options:
  - [ ] Qwen2.5-1.5B (current)
  - [ ] Phi-3-mini
  - [ ] Llama-3.2-1B
- [ ] Optimize extraction prompt
- [ ] Benchmark extraction speed
- [ ] Add fallback to rule-based extraction

### B.4 User Approval System (Week 3)

#### Notification UI
- [ ] Create `src/renderer/src/components/MemoryApprovalNotification.tsx`
- [ ] Design UI (bottom-right toast)
- [ ] Show extracted facts with context
- [ ] Add approve/reject/edit actions
- [ ] Implement batch approval

#### IPC Communication
- [ ] Create `src/main/ipc/memory.ts` handlers:
  - [ ] `memory:pending-facts` (get queue)
  - [ ] `memory:approve-fact` (user approved)
  - [ ] `memory:reject-fact` (user rejected)
  - [ ] `memory:edit-fact` (user modified)
- [ ] Update `src/preload/index.ts` with memory API
- [ ] Add types to `src/renderer/src/env.d.ts`

#### Settings Integration
- [ ] Add memory settings to `settingsStore.ts`:
  - [ ] `automaticMemoryExtraction: boolean`
  - [ ] `requireApprovalFor: string[]` (categories)
  - [ ] `memoryRetentionDays: number`
  - [ ] `maxMemories: number`
- [ ] Update `McpPreferencesPanel.tsx` with memory section
- [ ] Add toggle for automatic vs manual memory

### B.5 Smart Context Injection (Week 3)

#### Context-Aware Retrieval
- [ ] Update `MemoryService.search()` with context parameter
- [ ] Implement context filtering:
  - [ ] By project/workspace
  - [ ] By recency (prefer recent)
  - [ ] By relevance score
- [ ] Add "context boundary" to prevent leaks

#### Auto-Injection into Prompts
- [ ] Modify `src/renderer/src/lib/agent-runtime.ts`
- [ ] Automatically retrieve relevant memories before LLM call
- [ ] Inject into system prompt
- [ ] Add transparency logging (show what memories used)
- [ ] Limit injection to top 5 most relevant

### B.6 Memory Dashboard (Week 4)

#### Explorer UI
- [ ] Create `src/renderer/src/components/MemoryExplorer.tsx`
- [ ] Features:
  - [ ] List all entities (paginated)
  - [ ] Search/filter by type
  - [ ] View entity details
  - [ ] Delete entity
  - [ ] Export all memories (JSON)
  - [ ] Import memories
- [ ] Add to Settings panel as tab

#### Visualizations
- [ ] Create knowledge graph visualization (optional)
- [ ] Use D3.js or vis.js
- [ ] Show entities as nodes, relations as edges
- [ ] Interactive (click to view, drag to explore)

### B.7 Automatic Maintenance (Week 4)

#### Pruning System
- [ ] Create `src/main/services/MemoryMaintenance.ts`
- [ ] Implement automatic pruning:
  - [ ] Delete entities older than retention period
  - [ ] Prune unused relations
  - [ ] Archive instead of delete (optional)
- [ ] Schedule daily maintenance
- [ ] Add manual "Clean up memories" button

#### Performance Optimization
- [ ] Add indexes for common queries
- [ ] Implement query caching
- [ ] Optimize FTS5 searches
- [ ] Add lazy loading for large datasets
- [ ] Monitor database size

---

## Phase 1: Testing & Validation (Throughout)

### Unit Tests
- [ ] `MemoryService.test.ts` (CRUD operations)
- [ ] `PIIDetector.test.ts` (pattern matching)
- [ ] `SecretRedactor.test.ts` (redaction)
- [ ] `FactExtractor.test.ts` (extraction accuracy)
- [ ] `EncryptionService.test.ts` (encryption/decryption)

### Integration Tests
- [ ] End-to-end memory flow (extract → approve → store → retrieve)
- [ ] Privacy: Ensure PII is detected and blocked
- [ ] Security: Ensure secrets are redacted
- [ ] Performance: <10ms for search queries
- [ ] Concurrency: Multiple sessions don't interfere

### User Testing
- [ ] Privacy-conscious testers review
- [ ] Test with real conversations
- [ ] Verify no memory leaks (data)
- [ ] Verify no memory leaks (performance)
- [ ] Collect feedback on approval UX

---

## Phase 2: Documentation

### Developer Docs
- [ ] Architecture diagram (how everything connects)
- [ ] API documentation (MemoryService methods)
- [ ] Privacy safeguards explanation
- [ ] Configuration guide

### User Docs
- [ ] How to enable/disable automatic memory
- [ ] How to review and manage memories
- [ ] Privacy implications explained
- [ ] FAQ section

---

## Phase 3: Launch Preparation

### Performance Benchmarks
- [ ] Measure query latency (target: <5ms)
- [ ] Measure extraction latency (target: <500ms)
- [ ] Database size after 1000 entities (target: <10MB)
- [ ] Memory usage (target: <50MB)

### Privacy Audit
- [ ] Review all stored data
- [ ] Verify no PII leaks
- [ ] Confirm encryption works
- [ ] Test access controls
- [ ] GDPR compliance check

### Release Checklist
- [ ] Update CHANGELOG.md
- [ ] Bump version number
- [ ] Tag release in git
- [ ] Deploy to testers
- [ ] Monitor for errors

---

## Milestones

### Week 1: Foundation
- [x] Code refactoring ✅
- [ ] PII detection implemented
- [ ] Secret redaction implemented
- [ ] Encryption layer functional

### Week 2: Automation
- [ ] Fact extraction working
- [ ] Local LLM integration complete
- [ ] Context injection functional
- [ ] Basic tests passing

### Week 3: User Experience
- [ ] Approval UI complete
- [ ] Settings integrated
- [ ] Memory dashboard basic version
- [ ] Integration tests passing

### Week 4: Polish & Launch
- [ ] Full test coverage
- [ ] Documentation complete
- [ ] Performance optimized
- [ ] User testing done
- [ ] 🚀 **READY TO SHIP**

---

## Known Issues / Blockers

### Current Blockers
- [!] `@modelcontextprotocol/memory` package doesn't exist in npm
  - **Resolution**: Researching alternative packages or continue with our implementation

### Technical Debt
- [ ] Need to decide: JSON vs SQLite for MCP Memory storage
- [ ] SQLCipher licensing for encryption (or use alternative)
- [ ] Performance impact of encryption on large databases

### Open Questions
- [ ] Should memory be per-user or per-workspace?
- [ ] How to handle memory in multi-user scenarios?
- [ ] Cloud sync for memories (future feature)?

---

## Success Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Memory extraction accuracy | >80% | [ ] |
| PII detection rate | 100% | [ ] |
| User adoption (enable auto-memory) | >70% | [ ] |
| Query performance | <5ms | [ ] |
| User satisfaction | >80% positive | [ ] |
| Privacy incidents | 0 | [ ] |

---

## Next Actions (Priority Order)

1. ⚠️ **RESEARCH**: Find actual MCP memory server package or alternatives
2. 🔨 **BUILD**: Implement PII detector (highest privacy priority)
3. 🔨 **BUILD**: Implement secret redactor
4. 🧪 **TEST**: Write comprehensive privacy tests
5. 🎨 **UI**: Create memory approval notification

---

## Notes

- **Privacy First**: All features must pass privacy review before implementation
- **User Control**: User must be able to see, edit, and delete all memories
- **Performance**: Memory operations should be imperceptible (<10ms)
- **Transparency**: Always log what memories are being used/created

---

**End of Checklist**

Last updated: January 26, 2026 23:39 IST
