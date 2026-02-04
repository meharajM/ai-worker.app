# AI Worker Memory & Workflow Improvements

This document outlines the optimization changes made to the AI Agent's memory system, specifically targeting the identification, capture, and retrieval of User Preferences, Workflows, and Project Goals.

## 1. System Prompt Optimization (`llm.ts`)

### Active Wisdom Retrieval
We enforced a "Context First" execution flow. Before planning any task, the agent now explicitly searches for:
- **Workflows**: Standard Operating Procedures (SOPs), templates, and formatting rules.
- **Projects**: Active sprint goals, deadlines, and project-specific context.
- **Preferences**: Coding styles, tool choices, and UI preferences.

**Impact**: preventing the agent from asking repeated questions or violating established user norms.

### Proactive & Structured Storage
Instead of vague "observations", the system now classifies long-term memory into strict entity types:
- **Type=`workflow`**: For repeated processes (e.g., "Always run lint before commit").
- **Type=`project`**: For goal-oriented contexts.
- **Type=`user_preference`**: For personal settings (e.g., "I use Dark Mode").

### Privacy & Narrative Control
- **Silent Operation**: All memory CRUD operations (`create`, `update`, `search`) are now strictly "invisible" to the user, preventing verbose "I am saving this to memory..." responses.

## 2. Tooling Enhancements (`client-tools.ts`)

### New Tool: `memory_update_entity`
- **Problem**: The agent previously could only *create* new entities, leading to duplicate entries (e.g., multiple "John Doe" entities).
- **Solution**: Added `memory_update_entity` to allow **appending** new observations to existing entities.
- **Protocol**: The system prompt now enforces a "Search → Check Existence → Update OR Create" loop.

## 3. Background Intelligence (`memory-reflector.ts`)

### Integrated Memory Reflector
The `MemoryReflector` has been integrated into the `AgentRuntime` loop.
- **Trigger**: Runs automatically in the background (fire-and-forget) after every successful assistant response.
- **Function**: It analyzes the immediate conversation context to extract **high-value, permanent** knowledge.
- **Scope Broadened**: Updated to specifically look for **Workflows** and **SOPs** in addition to simple preferences.
- **Deduplication**: Enabled strict rules to update existing entities rather than creating duplicates.

## 4. Architecture Standards

- **Unified Memory Backend**: The implementation supports the new `UnifiedMemoryBackend` architecture, compatible with both local SQLite and future vector databases.
- **Type Safety**: All tools and calls are typed against the MCP (Model Context Protocol) schema.

## Summary of Benefits
1.  **Reduced Hallucination**: Agent relies on stored facts rather than temporary context.
2.  **Workflow Automation**: Can "learn" how the user works and apply it to future tasks.
3.  **Clean Knowledge Graph**: Deduplication ensures the memory database remains queryable and efficient.
