/**
 * memory-reflector.ts — Background agent for extracting long-term memories.
 *
 * Architecture: This module is intentionally decoupled from AgentRuntime.
 *   It uses a DYNAMIC import of AgentRuntime inside `analyze()` to:
 *   1. Break the potential circular dependency (agent-runtime → memory-reflector → agent-runtime)
 *   2. Keep the module lazy-loaded (only loaded when first analysis runs)
 *   3. Allow Phase 3 to swap AgentRuntime for RemoteAgentClient without touching this file
 *
 * Phase 3 note: In Phase 3, `analyze()` will import RemoteAgentClient instead of
 *   AgentRuntime. The `IAgentClient` interface ensures the swap is type-safe.
 *
 * Consumed by: useAgent.ts (fire-and-forget after each chat submission)
 */
import type { IAgentClient } from "./agent/IAgentClient";
import { LLMMessage } from "./types";


/**
 * MemoryReflector
 * 
 * A specialized, lightweight agent that consumes conversation history
 * in the background and extracts entities/facts to save to long-term memory.
 * 
 * It runs silently and does not block the main UI.
 */
export class MemoryReflector {
    private static instance: MemoryReflector;
    private isAnalyzing = false;
    private activeRunId = 0;
    private currentAbortController: AbortController | null = null;

    private constructor() { }

    static getInstance(): MemoryReflector {
        if (!MemoryReflector.instance) {
            MemoryReflector.instance = new MemoryReflector();
        }
        return MemoryReflector.instance;
    }

    cancel(reason = 'new prompt'): void {
        if (!this.isAnalyzing) return;
        console.log(`[MemoryReflector] Cancelling active analysis (${reason})`);
        this.currentAbortController?.abort();
        this.isAnalyzing = false;
        this.currentAbortController = null;
    }

    /**
     * Fire-and-forget analysis of recent conversation history.
     */
    async analyze(recentHistory: LLMMessage[], settings: Record<string, unknown> | null | undefined) {
        // Only analyze if there's substantial new content
        if (recentHistory.length < 2) return;

        if (this.isAnalyzing) {
            console.log('[MemoryReflector] Cancelling previous analysis in favor of latest context');
            this.currentAbortController?.abort();
        }

        const runId = ++this.activeRunId;
        const abortController = new AbortController();
        this.currentAbortController = abortController;
        this.isAnalyzing = true;
        console.log('[MemoryReflector] Starting background analysis...');

        try {
            // Take the last 4 messages to keep context small but relevant
            const contextWindow = recentHistory.slice(-4);

            // Phase 3 swap point: replace AgentRuntime with RemoteAgentClient here.
            // The IAgentClient interface ensures the swap is type-safe.
            const { AgentRuntime } = await import("./agent-runtime");
            const reflectorAgent: IAgentClient = new AgentRuntime({
                settings,
                isSubAgent: true,
                signal: abortController.signal,
                // We don't listen to messages, just results
                onMessage: (_msg: LLMMessage) => {
                    // console.log('[MemoryReflector] Internal thought:', _msg.content);
                }
            });


            // Specific prompt for the reflector
            const prompt = `
SYSTEM_TASK: BACKGROUND_MEMORY_EXTRACTION

You are the "Memory Reflector". Your ONLY job is to analyze the conversation below and save permanent user preferences, project facts, workflows, or **implicit** working patterns.

**DEDUPLICATION PROTOCOL (CRITICAL)**:
1. FIRST: Use \`memory_search\` to check if the concept/preference/entity ALREADY exists.
2. IF EXISTS: Use \`memory_update_entity\` with the existing entity's ID to APPEND a new observation.
3. IF NOT EXISTS: Use \`memory_create_entity\` to create a new entity.

CONVERSATION:
${contextWindow.map(m => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : '[Multimedia]'}`).join('\n')}

WHAT TO EXTRACT:
1. **Explicit Preferences**: Statements like "I like dark mode", "Use Python".
   - Description Format: "Prefers dark mode UI." (NOT "User said they like dark mode").
2. **Selections & Favorites**: Specific choices made by the user.
   - Description Format: "Casio F-91W selected for purchase." (NOT "User wants to buy...").
3. **Workflows & SOPs**: Repeated processes or rules.
   - Example: "Always run tests before commit."
4. **Project State**: Current goals, active constraints, or tech stack details.
   - Example: "Project Budget: ₹1500." 

DESCRIPTION WRITING RULES (STRICT):
- **FORBIDDEN PHRASES**: Do NOT start descriptions with "User said", "User asked", "User requested", "User searched for".
- **FACTTUAL TONE**: Write descriptions as **facts**. 
  - BAD: "User requested a background memory extraction." (This is a meta-command, ignore it).
  - BAD: "User searched for Casio watches."
  - GOOD: "Project Focus: Finding a Casio watch under ₹1500."
  - GOOD: "Preferred price range: Under ₹1000."
- **IGNORE META-COMMANDS**: If the user says "Extract memories from this", satisfying that request is your *job* (the action), but the request *itself* is NOT a memory to be stored.

ANTI-BLOAT RULES (CRITICAL):
- **DO NOT** save specific conversational turns or "User asked..." narratives.
- **DO NOT** save meta-instructions (e.g., "clean up code") as permanent entities.
- **DO NOT** save transient values (e.g. specific prices, timestamps, or temporary measurements) as independent facts. Only save them if they represent a **constraint** or **goal** (e.g. "Budget Limit: $500", not "Item price: $499.99").
- **DO NOT** create duplicate entities. ALWAYS search first and update if exists.
- **NULL HYPOTHESIS**: If the conversation contains only questions, confirmations ("are you sure?"), or transient interactions or one word messages with NO new facts/preferences, **DO NOT CALL ANY TOOLS**. first check if that can be applied to any of the existing conversations happening in that chat sessions if not applicatble then ask for confirmation from user".

GOAL: Extract Facts & State. No Narratives. No Meta-Commentary.
            `;

            console.log('[MemoryReflector] Sending prompt to reflector agent...');
            const response = await reflectorAgent.chat(prompt);
            console.log('[MemoryReflector] Analysis complete. Result:', response.content);

            // Log tool calls if any
            if (response.tool_calls && response.tool_calls.length > 0) {
                console.log(`[MemoryReflector] LLM generated ${response.tool_calls.length} tool calls.`);
            } else {
                console.log('[MemoryReflector] No tool calls generated by LLM.');
            }

        } catch (error) {
            if (abortController.signal.aborted) {
                console.log('[MemoryReflector] Analysis aborted (superseded by newer prompt)');
            } else {
                console.warn('[MemoryReflector] Background analysis failed (non-fatal):', error);
            }
        } finally {
            if (runId === this.activeRunId) {
                this.isAnalyzing = false;
                this.currentAbortController = null;
            }
        }
    }
}
