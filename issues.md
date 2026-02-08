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

---
*Last Updated: 2026-02-08*
