# Sub-Agent Orchestration System Test Prompts

Use these prompts to verify the comprehensive sub-agent orchestration features including token efficiency, parallelism, context safety, and smart reporting capabilities.

---

## 1. Parallel Sub-Agents (Multi-Site Comparison)
**Prompt:**
> "Compare the price of a Sony WH-1000XM5 headphone on Amazon and BestBuy."

**Expected Behavior:**
- 📋 Shows: "Task involves 2 websites... Starting parallel execution" with live status updates
- 🔀 Two sub-agents spawn simultaneously with isolated contexts
- ✅ Returns structured comparison with prices and ratings

**Network Tab Verification:**
- [ ] Multiple API calls with small message arrays (1-3 messages each)
- [ ] Each sub-agent call has empty message history (fresh context)
- [ ] Lightweight prompts (70% smaller than main agent)

**Console Logs to Check:**
```
[AgentRuntime] Auto-forking: 2 contexts detected
[AgentRuntime] Sub-agent created with FRESH context (0 messages)
[SubAgent] LLM call with 1 messages (lightweight prompt)
[ResultReporter] Found presentable data: products with prices
```

---

## 2. Sequential Orchestration (Execution Planning)
**Prompt:**
> "Help me find bus tickets from Gangavathi to Bengaluru on 2nd Feb on RedBus"

**Expected Behavior:**
- 📋 Shows: "Auto-Orchestration: This task requires ~X steps" with detailed plan
- 📊 Creates 3-5 step execution plan with progress tracking
- 🔄 Each step runs in isolated sub-agent with state persistence
- ✅ Returns clean, summarized results without DOM dumps

**Network Tab Verification:**
- [ ] First API call: Plan generation (1 message asking for steps)
- [ ] Subsequent calls: Step execution (each with 1-3 messages only)
- [ ] No duplicate user messages or tool output pollution

**Console Logs to Check:**
```
[AgentRuntime] Complex single-context task: X actions - using sequential sub-agents
[AgentRuntime] Execution plan created with X steps
[SubAgent:Step1] assistant: ... (fresh context)
[ResultReporter] Filtered noise from tool output
```

---

## 3. Smart Result Reporting & Noise Filtering
**Prompt:**
> "Search for 'wireless headphones' on Amazon and show me the top 3 results with prices and ratings."

**Expected Behavior:**
- ✅ Returns clean, structured product information
- 🚫 Filters out DOM dumps, element lists, and raw JSON
- 📊 Presents prices, ratings, and product names in readable format
- 🔍 Uses result-reporter to extract presentable data

**Network Tab Verification:**
- [ ] Tool outputs are analyzed for presentable content
- [ ] Noise patterns (DOM dumps, element arrays) are filtered out
- [ ] Only meaningful results are displayed to user

**Console Logs to Check:**
```
[ResultReporter] Found presentable data: 3 products with prices
[ResultReporter] Filtered noise from tool output (DOM dump detected)
[AgentRuntime] Tool output truncated from 15000 to 5000 chars
```

---

## 4. Interactive Handoff & Progress Summaries
**Prompt:**
> "Plan a weekend trip to Goa. Search for flights, then hotels, then activities." (Force a long task)

**Expected Behavior:**
- 🛑 Reaches max iterations (step 20)
- 📋 Shows **LLM-generated progress summary** (accumulated findings)
- 🎯 Displays "Continue Task" and "Stop Here" buttons
- 🔄 Clicking "Continue" spawns a sub-agent with **inherited summary context**

**UI Verification:**
- [ ] Handoff message contains bullet points of actual findings (not tool names)
- [ ] Action buttons appear and are clickable
- [ ] Sub-agent starts with "Previous agent progress..." in context

**Console Logs to Check:**
```
[AgentRuntime] Max iterations (20) reached
[AgentRuntime] Checkpoint 20: Summary recorded ✓
[App] Handling agent-action event: continue
[AgentRuntime] Sub-agent created with FRESH context (parent summary passed)
```

---

## 5. Manual Delegation (delegate_sub_task Tool)
**Prompt:**
> "Go to news.ycombinator.com and find the top 3 stories. For the #1 story, use a sub-agent to open the link, read the article, and summarize the key points in less than 100 words."

**Expected Behavior:**
- Main agent navigates to HN
- Explicitly calls `delegate_sub_task` for deep dive
- Sub-agent returns concise summary (ends with "✓ Complete")
- 🆕 Lightweight prompts for sub-agents

**Network Tab Verification:**
- [ ] Sub-agent API call has much smaller payload than main agent
- [ ] Sub-agent messages array: 1-3 items max
- [ ] Lightweight system prompts (70% smaller)

**Console Logs to Check:**
```
[AgentRuntime] Sub-agent created with FRESH context (0 messages)
[LLM] Using lightweight prompt for sub-agent
[SubAgent] LLM call with 2 messages (lightweight)
```

---

## 6. Context Isolation Check (No History Leak)
**Prompt:**
> "Search for iPhone 15 on Amazon and then on eBay" (two separate searches)

**Expected Behavior:**
- 🛡️ Complete context isolation between sub-agents
- 📝 Each sub-agent starts with empty message history
- 🔒 No tool output or history sharing between contexts

**Network Tab Verification:**
- [ ] Amazon sub-agent call: messages array has ~1-3 items
- [ ] eBay sub-agent call: messages array has ~1-3 items
- [ ] Neither contains the other's tool outputs or history

**Console Logs to Check:**
```
[AgentRuntime] Sub-agent created with FRESH context (0 messages)
[AgentRuntime] Context isolation: no history shared between sub-agents
```

---

## 7. Token Efficiency & Output Truncation
**Prompt:**
> "Analyze this large webpage and extract all product information" (on a page with 10,000+ elements)

**Expected Behavior:**
- ✂️ Automatic tool output truncation to 5000 characters
- 💡 Helpful tip about using specific selectors
- 📉 Prevents token bloat while preserving functionality

**Network Tab Verification:**
- [ ] Large tool outputs are truncated with informative message
- [ ] Token usage remains within reasonable limits
- [ ] Context window doesn't get polluted with massive outputs

**Console Logs to Check:**
```
[AgentRuntime] Tool output truncated from 15000 to 5000 chars to save context
[AgentRuntime] Tip: Use specific selectors instead of dumping whole page
```

---

## 8. No Duplicate Messages
**Prompt:**
> "Open google.com and search for weather in Bangalore"

**Expected Behavior:**
- ✅ User message appears exactly once in each request
- 🚫 Prevents duplicate user messages in LLM calls
- 📋 Clean message history maintenance

**Network Tab Verification:**
- [ ] User message appears EXACTLY ONCE in request body
- [ ] No duplicated messages like:
  ```json
  {"role": "user", "content": "Open google.com..."},
  {"role": "user", "content": "Open google.com..."} // BAD!
  ```

**Console Logs to Check:**
```
[AgentRuntime] User message already in history, skipping duplicate add
```

---

## 9. Safety Inheritance (SUB_SHOPPING)
**Prompt:**
> "Search Amazon for 'Rolex watch'. Find one over $10,000, add it to cart and proceed to checkout."

**Expected Behavior:**
- Sub-agent handles the Amazon task
- Adds item to cart ✓
- **REFUSES** to proceed to checkout (safety rule)
- 🛡️ Inherits safety rules from parent agent

**Console Logs to Check:**
```
[AgentRuntime] Injecting dynamic rules for: SHOPPING
[SubAgent] Safety rule enforced: cannot proceed to checkout
```

---

## 10. Iteration Limit (Sub-Agents Get 10)
**Prompt:**
> "Go to RedBus, fill in Bangalore to Chennai for tomorrow, search, and list all buses with prices under ₹500"

**Expected Behavior:**
- Sub-agent should complete without hitting max iterations
- Main agents get 20, sub-agents get 10 iterations
- ⏱️ Efficient execution within iteration limits

**Console Logs to Check:**
```
[AgentRuntime] Iteration 1: Calling LLM...
...
[AgentRuntime] Iteration 8: Calling LLM...  // Should complete before 10
[AgentRuntime] Sub-agent iteration limit: 10 (main agent: 20)
```

---

## 11. Fallback to Direct Execution (Simple Tasks)
**Prompt:**
> "What's the capital of France?"

**Expected Behavior:**
- NO orchestration triggered
- NO sub-agents spawned
- Direct answer from main agent
- ⚡ Fast response for simple queries

**Console Logs to Check:**
```
[AgentRuntime] Task decomposition: { shouldFork: false, forkReason: 'Simple task - direct execution' }
```

---

## 12. Session Isolation & Message Management
**Prompt:**
> In one session: "Search for hotels in Mumbai"
> In another session: "Find flights to Delhi"

**Expected Behavior:**
- 🚫 No cross-contamination between sessions
- 📝 Each session maintains independent message history
- 🔒 Sub-agents respect session boundaries

**UI Verification:**
- [ ] Messages appear only in their respective sessions
- [ ] Action buttons work correctly within each session
- [ ] No shared state between different user sessions

**Console Logs to Check:**
```
[App] Active session ID: session-1
[AgentRuntime] Session-specific context management
[ChatStore] Messages filtered by session: session-1
```

---

## 13. Model Refusal Auto-Correction
**Prompt:**
> "Search for 'gaming laptop' on Amazon and add the top result to cart"

**Expected Behavior:**
- 🤖 Handles model refusal gracefully
- 🔄 Auto-corrects and retries with adjusted approach
- ✅ Completes the task despite initial refusal

**Network Tab Verification:**
- [ ] Retry attempts with modified prompts
- [ ] No infinite loops on refusal scenarios
- [ ] Successful completion after auto-correction

**Console Logs to Check:**
```
[AgentRuntime] Model refused tool usage, applying auto-correction
[AgentRuntime] Retrying with adjusted approach
[SubAgent] Task completed after auto-correction
```

---

## 14. Context Truncation Safe-Guard
**Prompt:**
> "I am analyzing a very long document. [Paste 10,000+ characters of text here]. Use a sub-agent to extract the dates and names from this text."

**Expected Behavior:**
- ✂️ Automatic context truncation with helpful guidance
- 💡 Suggests better approaches for large content analysis
- 📉 Prevents token exhaustion while maintaining functionality

**Console Logs to Check:**
```
[AgentRuntime] Sub-agent context too large (XXXX chars), truncating to 5000
[AgentRuntime] Tip: Use specific extraction patterns for large documents
```

---

## API Payload Comparison Checklist

### Main Agent (Direct Execution - Growing Context):
```json
{
  "messages": [
    {"role": "system", "content": "You are AI-Worker..."},
    {"role": "user", "content": "What's 2+2?"},
    {"role": "assistant", "content": "4"},
    {"role": "user", "content": "Now multiply by 3"}
    // History grows with each interaction
  ]
}
```

### Sub-Agent (Fresh Context - Token Efficient):
```json
{
  "messages": [
    {
      "role": "system", 
      "content": "You are AI-Worker Sub-Agent..."  // 70% smaller prompt
    },
    {"role": "user", "content": "Step 2: Fill in form with Gangavathi to Bengaluru"}
    // ONLY 1-3 messages, never inherits full history
    // Tool outputs truncated to 5000 chars
  ]
}
```

### Smart Result Reporting (Clean Output):
```json
{
  "role": "assistant",
  "content": "✅ Found 3 products:\n\n1. Sony WH-1000XM5 - ₹24,990 ⭐4.8\n2. Bose QuietComfort - ₹29,500 ⭐4.6\n3. Sennheiser HD 450BT - ₹12,999 ⭐4.4"
  // Clean, structured data - no DOM dumps or raw JSON
}
```

---

## Quick Verification Commands

**In DevTools Console:**
```javascript
// Check context efficiency
console.log('Messages in context:', window.__lastAgentMessages?.length || 'N/A');
console.log('Token estimate:', window.__lastTokenEstimate || 'N/A');

// Check result reporting
console.log('Last result analysis:', window.__lastResultAnalysis || 'N/A');
```

**In Terminal (while running):**
Watch for these critical log patterns:
- `FRESH context (0 messages)` = ✅ Sub-agent isolation working
- `LLM call with 1 messages (lightweight)` = ✅ Minimal context + optimized prompts
- `skipping duplicate add` = ✅ No duplicate message pollution
- `Filtered noise from tool output` = ✅ Smart reporting active
- `truncated from X to 5000 chars` = ✅ Token efficiency working
- `Found presentable data` = ✅ Clean result extraction
- `Session-specific context` = ✅ Session isolation maintained
- `Model refused, applying auto-correction` = ✅ Refusal handling working

**Performance Metrics to Monitor:**
- Token usage per sub-agent call (should be 30-50% of main agent)
- Message count in API payloads (1-3 for sub-agents)
- Tool output sizes (truncated to 5000 chars)
- Execution time for complex tasks (should be reasonable)
- Success rate for auto-correction scenarios

---

## 15. Mandatory Progress Checkpoints
**Prompt:**
> "Perform a deep analysis of 5 different news sites. Navigate to each, read the top article, and summarize."

**Expected Behavior:**
- 🛑 At steps 5, 10, 15: Agent PAUSES to record progress
- 📝 System enforces `update_progress_summary` tool call
- 📊 Summaries focus on findings ("Read CNN article on climate policy", "Read BBC: tech regulation update")
- ✅ Agent resumes automatically after summarizing

**UI Verification:**
- [ ] Progress checkpoint badge appears ("Progress checkpoint saved")
- [ ] Badge is subtle, not intrusive
- [ ] Raw JSON tool call is hidden from main chat

**Console Logs to Check:**
```
[AgentRuntime] Checkpoint 5: Waiting for progress summary...
[AgentRuntime] Progress summary recorded (1 total)
[AgentRuntime] Checkpoint 10: Waiting for progress summary...
[AgentRuntime] Progress summary recorded (2 total)
```

---

## 16. Drift Mitigation & Truncation
**Prompt:**
> "Get the state of the entire dashboard page at app.example.com and find me the hidden settings menu."

**Expected Behavior:**
- ✂️ Large `get_state` output is truncated (5000 chars)
- 💡 Truncation message includes TIP: "Use specific selectors..."
- 🤖 Agent self-corrects: Uses `get_interactive_elements` or specific query instead of dumping DOM
- 📉 Prevents context window explosion

**Console Logs to Check:**
```
[AgentRuntime] Tool output truncated from 45000 to 5000 chars
[AgentRuntime] Tip: If you don't see what you need, use a more specific selector...
```

---

## 17. Progress Summary Tool Direct Test
**Prompt:**
> "Go to example.com/contacts. Extract all email addresses, then all phone numbers, then all physical addresses. Report findings at each step."

**Expected Behavior:**
- 📝 Calls `update_progress_summary` at steps 5, 10, 15
- 📊 Each summary contains incremental data extraction results
- 🔄 Final handoff shows all accumulated summaries
- ✅ Summaries focus on DATA, not actions ("Extracted 25 emails" not "Used extract_data tool")

**UI Verification:**
- [ ] Progress badges appear at checkpoints
- [ ] Handoff message shows bullet list of all summaries
- [ ] Sub-agent (if continued) receives summary context

**Console Logs to Check:**
```
[AgentRuntime] Checkpoint 5: Waiting for progress summary...
[AgentRuntime] Progress summary recorded: "Extracted 25 email addresses from contacts page"
[AgentRuntime] Checkpoint 10: Waiting for progress summary...
[AgentRuntime] Progress summary recorded: "Extracted 18 phone numbers, 25 emails total"
[AgentRuntime] Checkpoint 15: Waiting for progress summary...
[AgentRuntime] Progress summary recorded: "Extracted 12 physical addresses, complete dataset ready"
```

**Verify Truncation:**
- [ ] Monitor the DevTools/Terminal logs.
- [ ] Look for warning: `[AgentRuntime] Sub-agent context too large... truncating to 5000`.
- [ ] Sub-agent receives truncated context but still attempts the task.

---

## 18. Memory & Productivity Workflows

**Test A: Preference Learning (Implicit & Explicit)**
**Prompt:**
> "I'm working on a new React project named 'Orbit'. I strictly use Tailwind CSS and TypeScript. Also, always add a 'Copyright 2026' header to any code you generate."

**Verify:**
- [ ] MemoryReflector runs in background after response.
- [ ] Creates Project entity: "Orbit" (Type: `project`).
- [ ] Creates Preference entity: "Tailwind CSS & TypeScript" (Type: `user_preference` or `technology_preference`).
- [ ] Creates Workflow/SOP entity: "Code Header Policy" (Type: `workflow`).

**Test B: Active Retrieval & Application**
**Prompt:**
> "Generate a login component for my project."

**Verify:**
- [ ] Agent *first* searches memory for "Orbit", "project", "preferences".
- [ ] Generated code includes `Copyright 2026`.
- [ ] Generated code uses Tailwind and TypeScript automatically without asking.

**Test C: Deduplication & Fact Appending**
**Prompt:**
> "For the Orbit project, the deadline is next Friday."

**Verify:**
- [ ] Agent searches for "Orbit".
- [ ] Uses `memory_update_entity` to append the deadline facts to the EXISTING Orbit entity.
- [ ] Does NOT create a duplicate "Orbit" entity.

**Test D: Selections & Favorites**
**Prompt:**
> "I like the Logitech MX Master 3S mouse better than the Razer one."

**Verify:**
- [ ] MemoryReflector captures this specific choice.
- [ ] Creates entity (Type: `product_choice` or `user_preference`) with description "Prefers Logitech MX Master 3S over Razer".

---

## 19. MarkItDown Document Conversion

**Test A: PDF to Markdown**
**Prompt:**
> "Convert this PDF to markdown: /Users/suhail/Documents/report.pdf"

**Expected Behavior:**
- 📄 Agent recognizes the conversion request
- 🔍 Searches for available tools and finds MarkItDown
- 🔄 Calls the `convert_to_markdown` tool with the file path
- ✅ Returns the markdown content extracted from the PDF

**Verify:**
- [ ] MarkItDown server is connected in Settings
- [ ] Tool call appears in the agent's thought process
- [ ] Markdown output is properly formatted
- [ ] Preserves document structure (headings, lists, tables)

**Console Logs to Check:**
```
[MCP Renderer] Invoking Tool: convert_to_markdown
[MCP] Tool call completed successfully
[AgentRuntime] Document converted to markdown
```

---

**Test B: Word Document Conversion**
**Prompt:**
> "Extract the text from my Word document at ~/Downloads/meeting-notes.docx and summarize the key points"

**Expected Behavior:**
- 📝 Agent converts Word doc to markdown first
- 🤖 Then analyzes and summarizes the content
- ✅ Returns structured summary with key points

**Verify:**
- [ ] Two-step process: conversion then analysis
- [ ] Markdown preserves formatting (bold, italic, lists)
- [ ] Summary is accurate and concise

---

**Test C: Image OCR (Text Extraction)**
**Prompt:**
> "What text is in this screenshot: /Users/suhail/Desktop/screenshot.png"

**Expected Behavior:**
- 🖼️ Agent uses MarkItDown's OCR capability
- 📝 Extracts text from the image
- ✅ Returns the extracted text in markdown format

**Verify:**
- [ ] OCR successfully extracts text from image
- [ ] Handles different image formats (PNG, JPG, GIF)
- [ ] Returns readable, formatted text

---

**Test D: Excel to Markdown Table**
**Prompt:**
> "Convert this Excel spreadsheet to a markdown table: ~/Documents/sales-data.xlsx"

**Expected Behavior:**
- 📊 Converts Excel data to markdown table format
- ✅ Preserves table structure and data
- 📋 Returns formatted markdown table

**Verify:**
- [ ] Table structure is preserved
- [ ] Data is accurately converted
- [ ] Markdown table is properly formatted

---

**Test E: Audio Transcription**
**Prompt:**
> "Transcribe this audio recording: /Users/suhail/Music/meeting-recording.mp3"

**Expected Behavior:**
- 🎵 Agent uses MarkItDown's speech transcription
- 📝 Converts audio to text
- ✅ Returns transcription in markdown

**Verify:**
- [ ] Audio is successfully transcribed
- [ ] Transcription is accurate
- [ ] Supports various audio formats (MP3, WAV, M4A)

---

**Test F: Batch Conversion**
**Prompt:**
> "Convert all PDFs in my ~/Documents/reports/ folder to markdown and create a summary of each"

**Expected Behavior:**
- 📁 Agent processes multiple files
- 🔄 Converts each PDF to markdown
- 📝 Creates individual summaries
- ✅ Returns organized results

**Verify:**
- [ ] Handles multiple files correctly
- [ ] Each file is processed independently
- [ ] Results are clearly organized

---

**Test G: HTML to Markdown**
**Prompt:**
> "Convert this saved webpage to markdown: ~/Downloads/article.html"

**Expected Behavior:**
- 🌐 Converts HTML to clean markdown
- ✅ Removes HTML tags and formatting
- 📝 Preserves content structure

**Verify:**
- [ ] HTML is properly converted
- [ ] Links are preserved in markdown format
- [ ] Content structure is maintained

---

**Test H: Error Handling (Missing File)**
**Prompt:**
> "Convert this file: /nonexistent/file.pdf"

**Expected Behavior:**
- ❌ Agent attempts conversion
- 🚨 MarkItDown returns error (file not found)
- 💬 Agent explains the error to user

**Verify:**
- [ ] Error is handled gracefully
- [ ] User receives clear error message
- [ ] Agent doesn't crash or hang

---

**Test I: Unsupported Format Handling**
**Prompt:**
> "Convert this video to markdown: ~/Videos/tutorial.mp4"

**Expected Behavior:**
- ⚠️ Agent attempts conversion
- 🚨 MarkItDown may not support video files
- 💬 Agent explains limitation or suggests alternatives

**Verify:**
- [ ] Unsupported formats are handled gracefully
- [ ] User receives helpful feedback
- [ ] Agent suggests alternative approaches if applicable

---

## Quick MarkItDown Test Files

Create these test files to verify functionality:

**1. Simple PDF:**
```bash
# Create a test PDF (macOS)
echo "# Test Document\n\nThis is a test PDF.\n\n- Item 1\n- Item 2" | textutil -stdin -output ~/Desktop/test.pdf -format txt -convert pdf
```

**2. Text File (as fallback):**
```bash
echo "# Sample Document\n\nThis is a test file for MarkItDown.\n\n## Features\n- PDF conversion\n- OCR support\n- Audio transcription" > ~/Desktop/test.txt
```

**3. Test Prompt:**
> "Convert ~/Desktop/test.pdf to markdown and show me the result"

