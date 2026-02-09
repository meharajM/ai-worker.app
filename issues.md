# Resolved Issues & Refinements

## 1. Orchestration: Misidentification of Parallel Tasks
- **Problem**: Sequential research tasks (e.g., "Research on Google") were being incorrectly flagged as parallel, leading to redundant sub-agents.
- **Solution**: 
    - Simplified `task-decomposer.ts` to "Complexity-First" analysis.
    - Unified the entry point in `AgentRuntime.ts` to always trigger an LLM-based planning phase for complex tasks.
    - Result: The Planner LLM now dynamically determines parallelization (using `parallel_clusters`), ensuring research flows stay sequential.
- **Status**: ✅ Resolved

## 2. Memory Service: JSON Parsing Errors
- **Problem**: `ServerMemoryAdapter.ts` encountered crashes due to trailing noise or logging output from the backend subprocess.
- **Solution**: 
    - Implemented a robust `extractJson` utility using a bracket-counting algorithm to isolate valid JSON.
- **Status**: ✅ Resolved

## 3. Architecture: Unified Orchestration & System Prompts
- **Problem**: Fragile parallel/sequential logic splits and hardcoded prompts.
- **Solution**:
    - Unified orchestration logic in `AgentRuntime.ts`.
    - Centralized `ORCHESTRATION_PLANNER` protocol in `prompt-library.ts`.
    - Refined `RESEARCH` and `GENERAL` protocols to support persistent findings and planning-first flows.
    - Updated `create_execution_plan` tool to support dynamic parallelism.
- **Status**: ✅ Resolved

## 4. Orchestration: High-Fidelity Instructions & Traceability
- **Problem**: Sub-agents received generic instructions, causing poor formatting (e.g., missing bolding/bullets in comparisons). Execution lineage was missing in memory.
- **Solution**: 
    - Restored specialized sub-agent instruction templates in `task-decomposer.ts`.
    - Enriched memory entities with `Parent Goal`, `Initialized at`, and `stepDescription` for better self-healing.
- **Status**: ✅ Resolved

## 5. Orchestration: Resource Overload (Tab Bloat)
- **Problem**: Opening all planned tabs upfront consumed excessive system memory.
- **Solution**: 
    - Implemented **Just-In-Time (JIT) Tab Allocation**.
    - Tabs are now provisioned only at the start of each execution cluster.
- **Status**: ✅ Resolved

## 6. Orchestration: Non-Deterministic Result Ordering
- **Problem**: Parallel sub-agents pushed results to the summary out-of-order.
- **Solution**: 
    - Implemented deterministic sorting by `stepId` before final synthesis.
- **Status**: ✅ Resolved

---
*Last Updated: 2026-02-09*
