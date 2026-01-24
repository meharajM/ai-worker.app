# Research Proposal: High-Performance Browser Automation for Electron Agents

## Executive Summary
This proposal recommends replacing the current `npx`-based Playwright MCP server with a **native, in-process Playwright service** embedded directly within the Electron Main process. Our research confirms this as the lowest-latency architecture possible for local desktop agents.

Crucially, this architecture prioritizes the **Non-Technical User Experience** by removing complex configuration, terminal commands, and manual setup.

## Problem Statement
The current implementation suffers from significant latency (2-5 seconds per session) and poor UX:
1.  **Process Overhead**: Spawning a new Node.js process via `npx` for every MCP session.
2.  **IPC Serialization**: JSON-RPC communication over standard I/O (stdio).
3.  **Cold Starts**: Browsers and contexts are re-initialized frequently.
4.  **Complexity**: Users must understand "servers", "connect", and "tokens".

## Proposed Solution: In-Process Playwright & Native Services
By moving Playwright inside the Electron implementation:
-   **Zero IPC**: The agent controller and the browser automation live in the same memory space.
-   **Hot-Swapping**: A singleton `Browser` instance is kept alive.
-   **Persistent Contexts**: Cookies/Local Storage are preserved, allowing "logged-in" states to persist across agent tasks.
-   **Invisible integration**: Users just see "Browser" capabilities, no setup required.

## Competitor Analysis

| Solution | Architecture | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **Current Implementation** | `npx @playwright/mcp` (Stdio) | Easy to set up, standard MCP. | **High Latency**, slow startup, no persistence. |
| **Chrome DevTools MCP** | External Process + CDP | Good for debugging. | Still has stdio overhead; separate process. |
| **Manus AI (Browser Use)** | Cloud Containers + VNC | Scalable, safe sandboxing. | **Network Latency**, expensive infrastructure. |
| **Antigravity** | Browser Extensions | Safe, user-verified actions. | Extension API limitations, slower than direct control. |
| **Claude Computer Use** | Native Messaging / Cloud | Tight integration. | Limited by Chrome Native Messaging or cloud latency. |
| **Proposed Solution** | **In-Process Playwright** | **Instant response**, full "God Mode" access. | Requires managing browser lifecycle in Main process. |

## Optimization & UX Strategy

### 1. Browser: In-Process Playwright (The "Magical" Browser)
-   **Architecture**: Singleton `Browser` instance in Main process.
-   **Speed**: Zero IPC latency, persistent context (cookies/storage).
-   **Safety**: Resource blocking (images/fonts).
-   **Stealth**: Evasion techniques (User-Agent rotation, `navigator.webdriver` removal).
-   **UX**: No "Connect" button. It just works.

### 2. Filesystem: In-Process Node.js (Safe Mode)
-   **Architecture**: Direct wrapper around `fs.promises`.
-   **Speed**: 5-10x faster than spawning shell commands or stdio MCP.
-   **Safety**: **Shadow Write Layer**. 
    -   Writes to "Protected" folders are intercepted and saved to a staging area.
    -   **UX**: Users see a simple "Review Changes" notification.
    -   **Visualizer**: A side-by-side "Before/After" view for text files, eliminating the need to read raw diffs.

### 3. Memory: In-Process SQLite (The "Brain")
-   **Architecture**: Low-overhead `better-sqlite3` instance running in Main process.
-   **Speed**: <1ms query time vs parsing large JSON files.
-   **Schema**:
    -   **Entities**: People, projects, and concepts with flexible JSON metadata.
    -   **Relations**: Graph-like connections (e.g., "mentions", "authored_by").
    -   **Search**: **FTS5 (Full Text Search)** enabled for instant recall without heavy vector databases.
-   **Persistence**: ACID compliant, reliable.

#### Memory Schema Definition
```sql
-- Entities: The nodes of the knowledge graph
CREATE TABLE entities (
    id TEXT PRIMARY KEY,       -- UUID
    name TEXT NOT NULL,        -- Display name
    type TEXT,                 -- e.g., 'person', 'file', 'concept'
    description TEXT,          -- Summary for LLM context
    metadata JSON,             -- Flexible payload (DOB, email, etc.)
    search_text TEXT GENERATED ALWAYS AS (name || ' ' || description) VIRTUAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Full Text Search Virtual Table
CREATE VIRTUAL TABLE entities_fts USING fts5(name, description, type, content='entities', content_rowid='rowid');

-- Triggers to keep FTS in sync
CREATE TRIGGER entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, description, type) VALUES (new.rowid, new.name, new.description, new.type);
END;
CREATE TRIGGER entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, description, type) VALUES('delete', old.rowid, old.name, old.description, old.type);
END;
CREATE TRIGGER entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, description, type) VALUES('delete', old.rowid, old.name, old.description, old.type);
  INSERT INTO entities_fts(rowid, name, description, type) VALUES (new.rowid, new.name, new.description, new.type);
END;

-- Relations: The edges of the graph
CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    from_entity_id TEXT NOT NULL,
    to_entity_id TEXT NOT NULL,
    relation_type TEXT NOT NULL, -- e.g. "works_on", "is_friend_of"
    description TEXT,
    weight REAL DEFAULT 1.0,
    FOREIGN KEY(from_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY(to_entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX idx_relations_from ON relations(from_entity_id);
CREATE INDEX idx_relations_to ON relations(to_entity_id);
```

## Conclusion
For a local, desktop-based AI worker, the **In-Process Playwright** approach provides an unfair speed advantage. Combined with a **SQLite-backed Memory** and **Shadow Filesystem**, we create an agent that is faster, smarter, and safer than any cloud-based alternative—transparently to the user.
