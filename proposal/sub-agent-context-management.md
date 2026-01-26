# Sub-Agent Context Management: Protecting the "Smart Zone"

This document explains how AI-Worker uses the **Sub-Agent (Fork and Distill)** pattern to handle complex tasks like product comparisons without overwhelming the main context window.

---

## 1. The Problem: Context Bloat (Traditional Approach)

Imagine a single agent trying to compare Nike shoes across Amazon, BestBuy, and Newegg.

**The "Dumb Zone" Trap:**
As the agent navigates each site, the context window fills with:
- HTML snapshots / Accessibility trees
- Error messages & retries
- Intermediate search results
- Page scrolling logs

By the time it gets to the 3rd website, the agent is "cluttered." It might forget the specific size (Size 7) or the price from the first site.

```mermaid
graph TD
    A[Start: Compare Nike Size 7] --> B[Amazon: Search & Extract]
    B --> C[BestBuy: Search & Extract]
    C --> D[Newegg: Search & Extract]
    D --> E[Final Summary]
    
    subgraph "Context Window Status"
    B -.-> B1["+ 5,000 Tokens (Amazon logs)"]
    C -.-> C1["+ 8,000 Tokens (BestBuy logs)"]
    D -.-> D1["+ 6,000 Tokens (Newegg logs)"]
    E -.-> E1["Total: 19,000+ Tokens (Cluttered!)"]
    end
```

---

## 2. The Solution: AI-Worker's "Fork and Distill"

Instead of one agent doing everything, AI-Worker **forks** each search into a separate, isolated sub-agent.

### Step 1: Forking (Isolation)
The Main Agent spawns 3 sub-agents. Each sub-agent starts with a **clean, 0-token context**. All their messy "detecting buttons" and "scrolling" happens in their own isolated box.

### Step 2: Distillation (Compression)
Once a sub-agent finds the price, it returns **ONLY the final answer** (the "distillate") to the Main Agent.

```mermaid
sequenceDiagram
    participant Main as Main Agent (Orchestrator)
    participant Sub1 as Sub-Agent (Amazon)
    participant Sub2 as Sub-Agent (BestBuy)
    
    Main->>Sub1: "Find Nike Size 7 price on Amazon"
    Note over Sub1: Clean Context (0 tokens)
    Sub1->>Sub1: [Messy Work: Navigate, Scroll, Click, OCR]
    Note right of Sub1: Generates 5,000 tokens of "garbage"
    Sub1-->>Main: "Distilled Result: $89.99"
    
    Main->>Sub2: "Find Nike Size 7 price on BestBuy"
    Note over Sub2: Clean Context (0 tokens)
    Sub2->>Sub2: [Messy Work: Popups, Form Filling]
    Note right of Sub2: Generates 7,000 tokens of "garbage"
    Sub2-->>Main: "Distilled Result: $94.50"
    
    Note over Main: Main Context: ONLY ~$184.49 worth of data seen!
```

---

## 3. Real Example: Nike Shoe Comparison

**User Request:** *"Search Nike shoes of size 7 and compare Amazon/BestBuy and get me the price?"*

### How Context is Saved:

| Activity | Sub-Agent (Messy Zone) | Main Agent (Smart Zone) |
|----------|------------------------|--------------------------|
| **Navigation** | 2,000 tokens of URL/redirect logs | **0 tokens** (Hidden) |
| **Search UI** | 3,000 tokens of accessibility nodes | **0 tokens** (Hidden) |
| **Selecting Size 7** | 1,500 tokens of click/retry logs | **0 tokens** (Hidden) |
| **Final Price** | **Result: $89.99** | **Seen: "Amazon: $89.99"** |

### The "Distillate" Format
The sub-agent is instructed to return *only* a structured summary.
**Sub-Agent Response:**
> "Found 'Nike Air Zoom' in Size 7 on Amazon. Price: $89.99. In stock: Yes. Shipping: $5.00."

**Total Context Cost for Main Agent:** ~50 tokens per website.
**Cost without Sub-Agents:** ~10,000+ tokens per website.

---

## 4. Why this keeps the AI "Smart"

1.  **Zero Trajectory Errors:** If a sub-agent gets a popup on Amazon and takes 5 steps to close it, those 5 "error correction" steps never enter the Main Agent's history. The Main Agent never "learns" those errors.
2.  **Parallel Search:** Because sub-agents are isolated, they can run at the same time. The Main Agent just waits for the "pings" of distilled data.
3.  **High Signal, No Noise:** The Main Agent's context window contains *only* the user request and the final answers. This allows it to perform **perfect reasoning** (e.g., "Amazon is $5 cheaper but BestBuy has free shipping").

---

## Summary Diagram

```mermaid
graph LR
    User([User Request]) --> Main[Main Agent 🧠]
    
    Main -->|Fork| S1[Sub: Amazon 🛒]
    Main -->|Fork| S2[Sub: BestBuy 🏷️]
    Main -->|Fork| S3[Sub: Newegg 💻]
    
    S1 --"Distill: $90"--> Main
    S2 --"Distill: $95"--> Main
    S3 --"Distill: $92"--> Main
    
    Main -->|Final Reasoning| Out[[Final Comparison Table]]
    
    style Main fill:#d4f1f4,stroke:#05445e
    style S1 fill:#f9d5e5,stroke:#c83349
    style S2 fill:#f9d5e5,stroke:#c83349
    style S3 fill:#f9d5e5,stroke:#c83349
```
