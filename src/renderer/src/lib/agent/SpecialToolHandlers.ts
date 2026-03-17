/**
 * agent/SpecialToolHandlers.ts — Handlers for non-browser-interaction tools.
 *
 * Responsibilities:
 *   1. Sub-task Delegation: Spawns sub-agents to handle isolated research or coding tasks.
 *   2. Plan Execution: Coordinates the creation and updating of multi-step execution plans.
 *   3. Accessibility Auditing: Wraps accessibility scanning logic into a tool-compatible handler.
 *   4. Progress Reporting: Manages the generation of progress summaries for the main agent loop.
 *
 * Design decision: This class extracts "high-level" agent capabilities from the
 *   core loop in AgentRuntime. This separation of concerns allows the agent loop
 *   to remain generic while the specific intelligence for orchestration is
 *   encapsulated here.
 *
 * Consumed by: AgentRuntime (agent-runtime.ts)
 */

import { LLMMessage } from "../types";
import { executeToolCall } from "../mcp";
import type { AgentRuntimeOptions, AgentCheckpoint, ExecutionPlan } from "./types";
import { parseTabIdFromResult } from "../mcp";
import type { SubAgentFactory } from "./OrchestrationService";
import { analyzeToolOutput } from "../result-reporter";
import { laneManager } from "../execution-lanes";


/**
 * Handlers for "system" or "special" tools like create_execution_plan,
 * delegate_sub_task, and scan_page_accessibility.
 */
export class SpecialToolHandlers {
    constructor(
        private agentInstanceId: string,
        private options: AgentRuntimeOptions,
        private taskCategory: string | undefined,
        private addMessage: (msg: LLMMessage) => void,
        private makeSubAgentFactory: () => SubAgentFactory
    ) { }

    /**
     * Initializes a structured multi-step plan for achieving a complex goal.
     *
     * @param args - Object containing `goal` (string) and `steps` (array of step objects).
     * @returns The formatted response for the LLM and the structured plan object.
     */
    handleCreateExecutionPlan(args: Record<string, unknown>): { result: string; plan: ExecutionPlan } {
        const steps = (args.steps as Array<Record<string, unknown>>) || [];
        // Support both 'goal' (agent-generated) and 'original_request' (test mock / older LLM pattern)
        const goal = (args.goal as string) || (args.original_request as string) || 'Unknown goal';
        const plan: ExecutionPlan = {
            goal,
            steps: steps.map((s) => ({
                id: s.id as number,
                description: s.description as string,
                status: (s.status as ExecutionPlan['steps'][number]['status']) || 'pending',
                assigned_agent: s.assigned_agent as string | undefined,
            })),
        };
        console.log(`[SpecialToolHandlers] Plan created with ${steps.length} steps:`, goal);
        const result = `Execution plan created: ${goal}\n\nSteps:\n${steps
            .map((s) => `${s.id}. ${s.description} [${s.assigned_agent ?? 'agent'}]`)
            .join('\n')}\n\nI will now execute each step sequentially.`;
        return { result, plan };
    }

    /**
     * Injects a script into the page to extract a semantic accessibility tree.
     * This is more compact than a full DOM snapshot for rapid understanding.
     *
     * @returns A string representation of the accessibility tree or an error.
     */
    async handleScanPageAccessibility(): Promise<string> {
        console.log("[SpecialToolHandlers] Scanning page accessibility tree...");
        const script = `
      (function() {
        function getAccessibilityTree(element) {
          if (!element) return null;
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return null;
          const role = element.getAttribute('role') || element.tagName.toLowerCase();
          const label = element.getAttribute('aria-label') || element.innerText || '';
          const interestingRoles = ['button', 'link', 'input', 'textarea', 'select', 'heading', 'article', 'section', 'nav', 'main', 'form', 'img', 'a'];
          const isInteresting = interestingRoles.includes(role) || (element.onclick != null) ||
            (role === 'div' && (element.className.includes('btn') || element.className.includes('button')));
          if (!isInteresting && element.children.length === 0 && !label.trim()) return null;
          const node = {
            role: role,
            name: (label.substring(0, 50) + (label.length > 50 ? '...' : '')).replace(/\\n/g, ' ').trim(),
          };
          if (element.id) node.id = element.id;
          if (element.value) node.value = element.value;
          if (element.href) node.href = element.href;
          if (element.children.length > 0) {
            const children = Array.from(element.children).map(child => getAccessibilityTree(child)).filter(c => c !== null);
            if (children.length > 0) node.children = children;
          }
          if (!isInteresting && node.children) {
            return node.children.length === 1 ? node.children[0] : { role: 'group', children: node.children };
          }
          if (!isInteresting && !node.children) return null;
          return node;
        }
        return JSON.stringify(getAccessibilityTree(document.body));
      })()
    `;

        try {
            let result;
            try {
                result = await executeToolCall("browser_evaluate", { script, tabId: this.options.tabId });
            } catch (e) {
                console.warn("[SpecialToolHandlers] browser_evaluate failed, trying browser_run_code...");
            }
            if (!result || result.error) {
                result = await executeToolCall("browser_run_code", { code: script, tabId: this.options.tabId });
            }
            if (result.error) {
                return `Error scanning page: ${result.error}. Try using browser_snapshot instead if this persists.`;
            }
            const tree = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
            const output = `Page Accessibility Tree (Semantic Structure):\n${tree.substring(0, 15000)}`;
            console.log(`[SpecialToolHandlers] Accessibility scan complete (${output.length} chars)`);
            return output;
        } catch (err: any) {
            return `Error executing accessibility scan: ${err.message}`;
        }
    }

    /**
     * Saves a high-level summary of progress to persistent memory.
     * Used for agent self-reflection and context window management.
     *
     * @param args - Object containing the `summary` string.
     * @param iterationCount - The current loop index.
     * @returns Success message and the created checkpoint.
     */
    async handleUpdateProgressSummary(args: any, iterationCount: number): Promise<{ result: string; checkpoint: AgentCheckpoint }> {
        const summary = args.summary || "";
        const checkpoint: AgentCheckpoint = { step: iterationCount, summary, timestamp: Date.now() };

        await executeToolCall("memory_update_entity", {
            name: `AgentState_${this.agentInstanceId}`,
            Metadata: {
                lastCheckpoint: checkpoint,
                status: "active",
                iterationCount,
            },
        });
        console.log(`[SpecialToolHandlers] Progress checkpoint saved to memory (Step ${iterationCount})`);

        return {
            result: JSON.stringify({
                success: true,
                message: "Progress checkpoint saved to persistent memory.",
                checkpointStep: iterationCount,
            }),
            checkpoint
        };
    }

    /**
     * Handles the mark_task_complete signal from the agent.
     * This is the ONLY valid way for the agent to declare a task finished.
     *
     * @param args - Object containing `summary` (string) and `success` (boolean).
     * @returns Acknowledged result plus structured flags for the loop.
     */
    handleMarkTaskComplete(args: Record<string, unknown>): { result: string; isComplete: true; success: boolean } {
        const summary = (args.summary as string) || "Task complete.";
        const success = typeof args.success === "boolean" ? args.success : true;

        console.log(`[SpecialToolHandlers] mark_task_complete called. success=${success}. Summary: ${summary.substring(0, 80)}`);

        return {
            result: JSON.stringify({
                acknowledged: true,
                message: success
                    ? "Task marked as complete. Loop will exit cleanly."
                    : "Task marked as abandoned. Loop will exit and surface reason to user.",
                summary,
            }),
            isComplete: true,
            success,
        };
    }

    /**
     * Spawns a sub-agent to perform a specific instruction with context.
     * Closes the sub-agent's temporary tab and updates the execution plan on completion.
     *
     * @param args - Object containing `instruction` and `context`.
     * @param executionPlan - The current active plan to update.
     * @returns Result from sub-agent and updated plan if applicable.
     */
    async handleDelegateSubTask(args: any, executionPlan: ExecutionPlan | null): Promise<{ result: string, planUpdate?: ExecutionPlan }> {
        const instruction = args.instruction || "";
        let context = args.context || "";

        if (context.length > 5000) {
            console.warn(`[SpecialToolHandlers] Sub-agent context too large (${context.length} chars), truncating to 5000`);
            context = context.substring(0, 5000) + "\n...[truncated for efficiency]...";
        }

        console.log(`[SpecialToolHandlers] Delegating to sub-agent: ${instruction}`);

        const subAgentId = globalThis.crypto.randomUUID();

        const { preSeedSubAgentMemory } = await import("./AgentStateService");
        await preSeedSubAgentMemory(
            subAgentId,
            this.agentInstanceId,
            this.options.activeSessionId,
            [
                `Sequential sub-agent for task: ${instruction.substring(0, 100)}`,
                `Initialized at ${new Date().toISOString()}`,
            ].join("\n"),
            { instruction: instruction.substring(0, 200) }
        );

        const useHeadless = this.options.isHeadless === true;
        let subAgentTabId: number | undefined;
        if (!useHeadless) {
            try {
                const { browserLock } = await import("../resource-lock");
                const tabResult = await browserLock.runExclusive(async () =>
                    executeToolCall("new_tab", { url: "about:blank" })
                );
                const subAgentTabIdResult = parseTabIdFromResult(tabResult);
                if (subAgentTabIdResult !== undefined) {
                    subAgentTabId = subAgentTabIdResult;
                }
            } catch (e) {
                console.warn("[SpecialToolHandlers] Failed to provision tab for sub-agent", e);
            }
        } else {
            console.log(`[SpecialToolHandlers] Headless mode — skipping visible tab for delegate_sub_task`);
        }

        const subAgent = this.makeSubAgentFactory()({
            agentInstanceId: subAgentId,
            parentAgentId: this.agentInstanceId,
            isSubAgent: true,
            isHeadless: useHeadless,
            tabId: subAgentTabId,
            taskCategory: this.taskCategory,
            onMessage: (msg: LLMMessage) => {
                const contentStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
                console.log(`[SubAgent Tab:${subAgentTabId ?? "default"}] ${msg.role}: ${contentStr?.substring(0, 50)}`);
            },
        });

        try {
            const prompt = `${instruction}${context ? `\n\nContext: ${context}` : ""}\n\nReturn key findings only. End with "✓ Done".`;
            const finalRes = await subAgent.chat(prompt);
            const finalContent = typeof finalRes.content === "string" ? finalRes.content : JSON.stringify(finalRes.content);

            // ── Detect sub-agent bailout vs clean completion ──────────────────────
            const isBailout = finalContent.includes("consecutive errors") ||
                finalContent.includes("stopping to prevent an infinite loop");

            let salvagedResult = finalContent;
            let updatedPlan: ExecutionPlan | undefined;

            if (isBailout) {
                console.warn(`[SpecialToolHandlers] Sub-agent bailout detected. Salvaging partial data for: ${instruction.substring(0, 50)}...`);

                // Access history to salvage tool outputs
                const subAgentHistory = (subAgent as any).getHistory?.() as LLMMessage[] | undefined;
                if (subAgentHistory) {
                    const partialFindings: string[] = [];
                    for (const m of subAgentHistory) {
                        if (m.role === 'tool' && m.content) {
                            const analysis = analyzeToolOutput(m.name || 'unknown', m.content);
                            if (analysis.hasPresentableData && analysis.summary) {
                                partialFindings.push(analysis.summary);
                            }
                        }
                    }

                    if (partialFindings.length > 0) {
                        salvagedResult = `Sub-agent encountered errors and stopped. Partial data collected before failure:\n\n${partialFindings.join('\n')}`;
                        console.log(`[SpecialToolHandlers] Salvaged ${partialFindings.length} findings from failed sub-agent.`);
                    }
                }
            }

            if (subAgentTabId !== undefined) {
                try {
                    const { browserLock } = await import("../resource-lock");
                    await browserLock.runExclusive(async () =>
                        executeToolCall("close_tab", { tabId: subAgentTabId })
                    );
                    // Clean up the execution lane to prevent memory leaks
                    laneManager.cleanupTabLane(subAgentTabId);
                } catch (e) {
                    console.warn(`[SpecialToolHandlers] Failed to close sub-agent tab ${subAgentTabId}`, e);
                }
            }

            if (executionPlan) {
                updatedPlan = { ...executionPlan };
                const matchingStep = updatedPlan.steps.find(
                    (s) =>
                        s.status === "pending" &&
                        (instruction.toLowerCase().includes(s.description.toLowerCase().substring(0, 20)) ||
                            s.description.toLowerCase().includes(instruction.toLowerCase().substring(0, 20)))
                );
                if (matchingStep) {
                    matchingStep.status = isBailout ? "failed" : "completed";
                    matchingStep.result = salvagedResult.substring(0, 500);
                }
            }

            return { result: salvagedResult.trim(), planUpdate: updatedPlan };
        } catch (err: any) {
            // Best-effort tab cleanup on hard failure to prevent leaks
            if (subAgentTabId !== undefined) {
                try {
                    const { browserLock } = await import("../resource-lock");
                    await browserLock.runExclusive(async () =>
                        executeToolCall("close_tab", { tabId: subAgentTabId })
                    );
                    laneManager.cleanupTabLane(subAgentTabId);
                } catch (e) {
                    console.warn(`[SpecialToolHandlers] Failed to close sub-agent tab ${subAgentTabId} after error`, e);
                }
            }
            return { result: `Sub-agent failed: ${err.message}` };
        }
    }
}
