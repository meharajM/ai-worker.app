# Resolved Issues & Refinements

## 1. Orchestration: Misidentification of Parallel Tasks ✅ RESOLVED
- **Problem**: Sequential research tasks (e.g., "Research on Google about X and Y") were incorrectly flagged as parallel, leading to redundant sub-agents.
- **Root Cause**: 
    - Regex-based website extraction treated any multiple website mentions as parallel
    - Broad keyword detection (`/\band\b/i`, `/,/`) flagged sequential tasks
    - No dependency analysis between detected contexts
- **Solution Implemented** (2026-02-11):
    - Removed all regex-based website extraction (`extractWebsites()`, `WEBSITE_PATTERNS`)
    - Implemented **LLM-based context detection and dependency analysis** in `task-decomposer.ts`
    - LLM now intelligently:
      - Detects contexts across multiple types (websites, files, APIs, locations, entities)
      - Analyzes task dependencies (identifies sequential workflows vs independent tasks)
      - Distinguishes verbs from contexts (e.g., "google" as action vs "google.com" as website)
    - Added robustness mitigations:
      - 5-minute cache with 100-entry LRU (reduces redundant LLM calls)
      - 5-second timeout protection (prevents hanging)
      - Response validation and normalization (handles malformed responses)
      - Graceful fallback to sequential on errors (safe default)
    - Removed conflicting parallel detection in `agent-runtime.ts` (lines 487-505)
- **Result**: Tasks now default to sequential unless LLM verifies true independence. Fixes false parallels like "google flipkart.com and give details" and "Research Apple and Microsoft trends".


## 2. Memory Service: JSON Parsing Errors
- **Problem**: `ServerMemoryAdapter.ts` encountered crashes due to trailing noise or logging output from the backend subprocess.
- **Solution**: 
    - Implemented a robust `extractJson` utility using a bracket-counting algorithm to isolate valid JSON.


## 3. Architecture: Unified Orchestration & System Prompts
- **Problem**: Fragile parallel/sequential logic splits and hardcoded prompts.
- **Solution**:
    - Unified orchestration logic in `AgentRuntime.ts`.
    - Centralized `ORCHESTRATION_PLANNER` protocol in `prompt-library.ts`.
    - Refined `RESEARCH` and `GENERAL` protocols to support persistent findings and planning-first flows.
    - Updated `create_execution_plan` tool to support dynamic parallelism.


---

# Open Issues (Future Work)

## 4. Orchestration: Telemetry & Monitoring
- **Problem**: No visibility into LLM-based orchestration performance
- **Missing**:
  - Cache hit/miss rates
  - LLM failure rates
  - Average latency metrics
  - Parallel vs sequential decision distribution
- **Impact**: Can't optimize or debug orchestration issues effectively
- **Priority**: Medium

## 5. Orchestration: Retry Logic
- **Problem**: Single LLM attempt with immediate fallback to sequential
- **Current Behavior**: If LLM call fails (network, timeout, parsing), immediately defaults to sequential
- **Improvement Needed**: 
  - Add retry logic (e.g., 2-3 attempts with backoff)
  - Consider using faster/cheaper model as fallback before defaulting to sequential
- **Priority**: Low-Medium

## 6. Orchestration: Cache Management
- **Problem**: No manual cache invalidation or inspection
- **Current Implementation**: 
  - 5-minute TTL, automatic expiry
  - 100-entry LRU eviction
  - No way to clear or inspect cache
- **Improvement Needed**:
  - Add cache clearing mechanism (useful for debugging)
  - Expose cache stats in UI/logs
  - Consider persistent cache across sessions
- **Priority**: Low

## 7. Orchestration: A/B Testing & Validation
- **Problem**: No way to compare LLM-based vs regex-based performance
- **Missing**:
  - Benchmark suite for orchestration decisions
  - Comparison metrics (accuracy, latency, cost)
  - Test cases for edge scenarios
- **Impact**: Hard to validate improvements or catch regressions
- **Priority**: Medium

## 8. Memory: Unnecessary Analysis on Every Message ✅ RESOLVED
- **Problem**: `MemoryReflector.analyze()` was being called after every single user message, causing unwanted delays
- **Root Cause**: 
  - Line 593 in `agent-runtime.ts` triggered memory analysis on every turn completion
  - Even when LLM determined no facts to save, an LLM call was still made
  - Added latency to every interaction (500ms-2s per message)
- **Intended Use Cases**:
  1. Detecting and storing user preferences (when explicitly mentioned)
  2. Sub-agent context preservation and task summary reporting
- **Solution Implemented** (2026-02-11):
  - **Disabled** automatic memory analysis on every message (line 593)
  - **Kept** memory analysis for sub-agent completion (line 294) - needed for context preservation
  - Memory analysis now only happens when:
    - Sub-agents complete their tasks (for summary reporting)
    - User explicitly calls memory tools
- **Result**: Eliminates unnecessary LLM calls and delays on every message

## 9. Orchestration: LLM Decomposition Called for Simple Greetings ✅ RESOLVED
- **Problem**: `analyzeTaskForDecomposition()` was being called for ALL user prompts, including simple greetings like "hi", "hello", "thanks"
- **Root Cause**:
  - LLM-based task decomposition (lines 285-288) called unconditionally for every prompt
  - No pre-filtering to skip simple conversational inputs
  - Added 500ms-2s latency even for trivial interactions
  - Existing `analyzeTask()` in `confirmation-message.ts` already detected simple prompts but wasn't being used to skip decomposition
- **Impact**: 
  - Poor user experience: "hi" triggered unnecessary LLM analysis
  - Wasted LLM calls and API costs
  - Added perceivable latency for basic interactions
- **Solution Implemented** (2026-02-11):
  - **Leveraged existing `analyzeTask()` complexity analysis**:
    - When `requireConfirmation` is enabled (main agent), capture `complexity.level` from existing analysis
    - Simple prompts (greetings, thanks, yes/no) are detected by the LLM in `analyzeTask()`
    - No additional LLM calls required
  - **Conditional task decomposition**:
    - Skip `analyzeTaskForDecomposition()` when `taskComplexity === 'simple'`
    - Only run LLM-based decomposition for moderate/complex tasks
  - **Architecture Note**:
    - When `requireConfirmation` is disabled (sub-agents, background processes), agents receive task-specific instructions, never simple greetings
    - Sub-agents are spawned with instructions like "Search Amazon for laptops under $500", not "hi"
    - Therefore, no need for greeting detection when confirmation is disabled
- **Result**: 
  - Simple prompts now get instant responses (no LLM decomposition)
  - Complex tasks still benefit from intelligent decomposition
  - Reduced API costs and improved UX for conversational interactions
  - Cleaner code without unnecessary regex patterns

---
*Last Updated: 2026-02-11*
