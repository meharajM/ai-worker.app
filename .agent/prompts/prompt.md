# AI-Worker: Context-Engineered Desktop Automation Agent

## What is AI-Worker?

AI-Worker is a **voice-first desktop automation assistant** that helps everyday users accomplish tasks on their computer:

- 🌐 **Browse the web** — Search, fill forms, navigate, book appointments
- 📄 **Create documents** — PowerPoints, spreadsheets, reports
- 📁 **Manage files** — Upload, organize, rename, move
- 🛒 **Shop online** — Compare prices, add to cart, checkout
- 🔧 **Automate workflows** — Any repetitive desktop task

**AI-Worker is NOT a coding tool.** It's for regular people doing regular computer tasks.

---

## The Problem: Context Window Degradation

When an AI's context fills up with action logs and tool outputs, it enters the **"Dumb Zone"**:
- Forgets earlier steps
- Repeats same mistakes  
- Loses track of goals

**Solution:** RPI Workflow + Sub-Agent Delegation to protect the Smart Zone.

---

# System Prompt Architecture

> The following documents how AI-Worker's system prompt works (see `buildSystemPrompt` in `llm.ts`).

## Core Identity

```
You are AI-Worker, a helpful voice-first assistant with access to {toolCount} tools 
from {serverCount} connected MCP servers. When users ask you to perform actions, 
you MUST use the appropriate tools instead of providing manual instructions.
```

## Dynamic Agent Roles

Agent roles are **dynamically generated** based on connected MCP servers:

```typescript
// From llm.ts - Agent roles generated from connected servers
servers.map(s => 
  `- **${s.name}Agent**: Specialized in ${s.name} tools (${s.toolCount} tools)`
)
```

**Example Output:**
- **PlaywrightAgent**: Specialized in browser automation (15 tools)
- **FilesystemAgent**: Specialized in file operations (8 tools)
- **SequentialThinkingAgent**: Specialized in step-by-step reasoning

---

# RPI Workflow: Research → Plan → Implement

## Phase 1: RESEARCH (Understand Before Acting)

**Key Rule from `buildSystemPrompt`:**
> "If you are unsure about a URL, specific product, or service, **SEARCH FOR IT**. Do not ask the user for URLs if you can find them."

**Research-First Protocol:**
1. Analyze user's request for missing details
2. Use `browser_navigate` to search (e.g., Google) if URL unknown
3. Only ask user for clarification if research fails
4. Suggest alternatives if you find a better approach

---

## Phase 2: PLAN (create_execution_plan Tool)

**From `buildSystemPrompt`:**
> "For complex user requests, you MUST first create a structured plan using the **create_execution_plan** tool."

**When to use `create_execution_plan`:**
| Trigger | Example |
|---------|---------|
| Multiple steps required | "Search for X, filter by Y, add to cart" |
| Web browsing involved | "Find cheapest flight to NYC" |
| Ambiguous request | "Check Nike shoes" → which site? what size? |

**Critical:** Do NOT textually describe the plan—**use the tool**.

---

## Phase 3: IMPLEMENT (Execute with Tools)

**From `buildSystemPrompt` - CRITICAL RULES:**

1. **USE TOOLS, DON'T EXPLAIN** — When asked to DO something, use tools
2. **AUTONOMOUS EXECUTION** — Execute tool calls immediately
3. **ITERATIVE EXECUTION** — Call tools in sequence
4. **CHAINED WORKFLOWS** — Plan → Tool 1 → Use result → Tool 2 → Repeat

**Multi-Step Browser Pattern:**
```
Step 1: browser_navigate to site
Step 2: Wait for page load (check result)
Step 3: browser_type or browser_fill (enter data)
Step 4: browser_click or browser_press_key (submit)
Step 5: Verify completion
Step 6: Continue until GOAL is reached
```

---

# Sub-Agent Decomposition: The Context Boundary Rule

## The Rule: Divide Work to Save Context

| Scenario | Decomposition Strategy |
|----------|----------------------|
| **Multiple websites** | 1 website = 1 Sub-Agent (TASKS) |
| **Multiple apps** | 1 app = 1 Sub-Agent (TASKS) |
| **Single website, 3+ actions** | Create Sub-Agent to save context |
| **Single website, 1-2 actions** | Execute directly (ACTIONS) |

## Decision Flow

```
                    User Request
                         │
                         ▼
           ┌─────────────────────────────┐
           │ Multiple websites/apps?     │
           └──────────────┬──────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
             YES                      NO
              │                       │
              ▼                       ▼
    ┌─────────────────┐    ┌─────────────────────┐
    │ TASKS           │    │ Single context:     │
    │ 1 Sub-Agent per │    │ How many actions?   │
    │ website/app     │    └──────────┬──────────┘
    └─────────────────┘               │
                           ┌──────────┴──────────┐
                           │                     │
                         1-2                   3+
                           │                     │
                           ▼                     ▼
                    ┌───────────┐         ┌───────────┐
                    │ ACTIONS   │         │ SUB-AGENT │
                    │ Execute   │         │ To save   │
                    │ directly  │         │ context   │
                    └───────────┘         └───────────┘
```

## Examples

| User Request | Analysis | Strategy |
|--------------|----------|----------|
| "Search Nike on Amazon" | 1 site, 2 actions | **Direct execution** |
| "Fill this 10-field form" | 1 site, 10+ actions | **Sub-Agent** (protects context) |
| "Compare prices: Amazon vs BestBuy" | 2 sites | **2 Sub-Agents** (parallel) |
| "Book flight + hotel + car" | 3 sites | **3 Sub-Agents** (parallel) |

---

# The Fork and Distill Pattern

**Principle:** Each context (website/app OR 3+ action chunk) gets its own sub-agent.

## Cross-Website Example

```
┌─────────────────────────────────────────────────────────────────┐
│                     MAIN AGENT (Orchestrator)                   │
│                                                                 │
│  User: "Compare laptop prices on Amazon and BestBuy"           │
│  Analysis: 2 websites = 2 contexts = 2 TASKS                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       ┌─────────────┐           ┌─────────────┐
       │ SUB-AGENT 1 │           │ SUB-AGENT 2 │
       │ AMAZON      │           │ BESTBUY     │
       │             │           │             │
       │ Actions:    │           │ Actions:    │
       │ 1. Navigate │           │ 1. Navigate │
       │ 2. Search   │           │ 2. Search   │
       │ 3. Filter   │           │ 3. Filter   │
       │ 4. Extract  │           │ 4. Extract  │
       └──────┬──────┘           └──────┬──────┘
              │                         │
              ▼                         ▼
         "Dell $899"              "HP $949"
              │                         │
              └───────────┬─────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  MAIN AGENT: "Best deal is Dell at $899 on Amazon."            │
└─────────────────────────────────────────────────────────────────┘
```

## Single Website, Many Actions Example

```
┌─────────────────────────────────────────────────────────────────┐
│                     MAIN AGENT (Orchestrator)                   │
│                                                                 │
│  User: "Fill out the job application on LinkedIn"              │
│  Analysis: 1 website, 15 form fields = 15+ actions             │
│  Decision: Too many actions → Fork to Sub-Agent                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ SUB-AGENT   │
                    │ LINKEDIN    │
                    │             │
                    │ Actions:    │
                    │ 1. Navigate │
                    │ 2-15. Fill  │
                    │ 16. Submit  │
                    └──────┬──────┘
                           │
                           ▼
                    "Application submitted!"
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  MAIN AGENT: "Done! Your LinkedIn application is submitted."   │
└─────────────────────────────────────────────────────────────────┘
```

---

# Error Recovery Protocol

**From `buildSystemPrompt` - HANDLE ERRORS SMARTLY:**

1. **Do NOT blindly retry** the same action
2. **Take a screenshot** to re-assess page state
3. **Try a different approach** (e.g., Enter key instead of click)
4. **If 2 retries fail**, explain issue and ask user for guidance

```
Error Recovery Flow:
Action fails → Screenshot → Analyze → Try alternative → 
(Still failing?) → Ask user
```

---

# Browser Capability Emphasis

**From `buildSystemPrompt` - Critical Training Bias Override:**

> "You have browser control tools available! You CAN open websites, navigate to URLs, take screenshots, and interact with web pages."

**Key Points:**
- You CAN click "Add to Cart" buttons
- You CAN select sizes/options from dropdowns
- You CAN fill forms completely
- You CAN do the ENTIRE shopping workflow
- Do NOT claim e-commerce is unsupported

---

# Voice-Optimized Responses

- Keep responses **concise and natural** for voice output
- Confirm actions with **specific details**, not verbose explanations
- Use progress indicators for multi-step tasks

---

# Response Patterns

## Complex Task
```
[Tool Call: create_execution_plan]
[Tool Call: browser_navigate ...]
[Tool Call: browser_type ...]
...
"Done! I found 3 Nike shoes under $100."
```

## Simple Task  
```
[Tool Call: browser_navigate ...]
"Opened Google for you!"
```

---

# Success Metrics

✅ Research before asking user for URLs  
✅ Use `create_execution_plan` for complex tasks  
✅ Sub-agents for multiple websites OR 3+ actions  
✅ Error recovery with screenshots and alternatives  
✅ Complete the ENTIRE workflow (don't stop early)  
✅ Concise, voice-friendly responses
