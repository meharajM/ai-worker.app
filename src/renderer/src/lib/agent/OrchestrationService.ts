/**
 * agent/OrchestrationService.ts — Spawns and coordinates sub-agents.
 *
 * Responsibilities:
 *   1. Parallel orchestration: spawn N sub-agents simultaneously (one per context/website)
 *      and aggregate their results into a single summary message.
 *   2. Sequential orchestration: generate a multi-step plan via LLM, then execute
 *      each step with a fresh sub-agent (preserving context between steps).
 *   3. Continuation handoff: spawn a single sub-agent to continue a task that
 *      hit the max iteration limit.
 *   4. Browser tab provisioning: allocate and clean up dedicated tabs for each sub-agent.
 *
 * Architecture: This service takes a `spawnSubAgent` factory function as a parameter
 *   instead of importing AgentRuntime directly. This breaks the circular dependency
 *   (AgentRuntime → OrchestrationService → AgentRuntime) and makes the service
 *   testable with mock agents.
 *
 * Phase 3 note: In Phase 3, sub-agents run on the backend. The `spawnSubAgent`
 *   factory will create RemoteAgentClient instances pointing to backend workers.
 *   This service's logic remains unchanged.
 *
 * Consumed by: AgentRuntime (agent-runtime.ts)
 */

import { chat } from "../llm";
import { executeToolCall, parseTabIdFromResult } from "../mcp";
import { generateSubAgentInstruction, type TaskDecomposition } from "../task-decomposer";
import { type LLMMessage } from "../types";
import { type ExecutionPlan } from "../agent-protocol";
import { type AgentRuntimeOptions } from "./types";
import { preSeedSubAgentMemory } from "./AgentStateService";
import { laneManager } from "../execution-lanes";
import { RunWorkLedger } from "./RunWorkLedger";


// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Factory function for creating sub-agent instances.
 *
 * @param overrides - Options to override on the parent's options (e.g., isSubAgent, tabId).
 * @returns A new agent instance with a `chat()` method.
 */
export type SubAgentFactory = (overrides: Partial<AgentRuntimeOptions> & {
    agentInstanceId: string;
    parentAgentId: string;
}) => { chat: (prompt: string) => Promise<LLMMessage> };

// ── Parallel Orchestration ─────────────────────────────────────────────────────

/**
 * Executes sub-agents in parallel for multi-context tasks.
 *
 * @param originalRequest - The user's original request.
 * @param decomposition - The task decomposition result.
 * @param parentOptions - The parent agent's options.
 * @param parentAgentId - The parent agent's instance ID.
 * @param addMessage - Callback to add a message to the parent's history + UI.
 * @param spawnSubAgent - Factory function to create sub-agent instances.
 * @param ledger - Optional ledger for salvaging data.
 * @param onPlanUpdate - Callback for ExecutionPlan updates (checklist UI).
 * @returns The final aggregated result message.
 */
export async function executeParallelSubAgents(
    originalRequest: string,
    decomposition: TaskDecomposition,
    parentOptions: AgentRuntimeOptions,
    parentAgentId: string,
    addMessage: (msg: LLMMessage) => string | void,
    spawnSubAgent: SubAgentFactory,
    ledger?: RunWorkLedger,
    onPlanUpdate?: (plan: ExecutionPlan) => void
): Promise<LLMMessage> {
    const { contexts } = decomposition;

    // ── Convert parallel contexts to ExecutionPlan for the UI ──────────────
    const executionPlan: ExecutionPlan = {
        goal: originalRequest,
        steps: contexts.map((ctx, i) => ({
            id: i + 1,
            description: `Process ${ctx}`,
            status: "pending" as const,
        })),
    };
    onPlanUpdate?.(executionPlan);

    // Helper to salvage data from a sub-agent
    const extractPartialFindings = async (subAgentInstance: any): Promise<string[]> => {
        const history = subAgentInstance.getHistory?.() as LLMMessage[] | undefined;
        const partials: string[] = [];
        if (!history) return partials;

        for (const msg of history) {
            if (msg.role === "tool") {
                const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
                if (!content.includes('"error":') && content.length > 50) {
                    try {
                        const { analyzeToolOutput } = await import("../result-reporter");
                        const analysis = analyzeToolOutput("tool", content);
                        if (analysis.hasPresentableData && analysis.summary) {
                            partials.push(analysis.summary.substring(0, 300));
                        }
                    } catch (e) { }
                }
            }
        }
        return partials;
    };

    const agentStatuses = contexts.map((ctx) => ({
        context: ctx,
        status: "Starting...",
        isRunning: true,
        result: null as string | null,
    }));

    const renderStatus = () => {
        let content = `## ⚡ Parallel Execution\n\n`;
        for (const s of agentStatuses) {
            content += `- **${s.context}**: ${s.isRunning ? `*${s.status}*` : s.result ? "Completed" : s.status
                }\n`;
        }
        if (agentStatuses.some((s) => s.isRunning)) {
            content += `\n---\n*Working on ${contexts.length} sources...*`;
        }
        return content;
    };

    const statusMessage: LLMMessage = { role: "assistant", content: renderStatus() };
    const statusMessageId = addMessage(statusMessage) as string | undefined;

    const useHeadless = parentOptions.isHeadless === true;

    const subAgentPromises = contexts.map(async (context, index) => {
        const instruction = generateSubAgentInstruction(originalRequest, context, contexts);
        const subAgentId = globalThis.crypto.randomUUID();

        const planStep = executionPlan.steps[index];
        if (planStep) {
            planStep.status = "active";
            onPlanUpdate?.(executionPlan);
        }

        await preSeedSubAgentMemory(
            subAgentId,
            parentAgentId,
            parentOptions.activeSessionId,
            [
                `Parallel sub-agent for context: ${context}`,
                `Task: ${originalRequest}`,
                `Initialized at ${new Date().toISOString()}`,
            ].join("\n"),
            { context }
        );

        let subAgentTabId: number | undefined;
        if (!useHeadless) {
            try {
                const { browserLock } = await import("../resource-lock");
                const tabResult = await browserLock.runExclusive(async () =>
                    executeToolCall("new_tab", { url: "about:blank" })
                );

                const parsedTabId = parseTabIdFromResult(tabResult);
                if (parsedTabId !== undefined) {
                    subAgentTabId = parsedTabId;
                    console.log(`[OrchestrationService] Provisioned tab ${subAgentTabId} for sub-agent`);
                }
            } catch (e) {
                console.warn("[OrchestrationService] Failed to provision tab for sub-agent", e);
            }
        }

        const subAgent = spawnSubAgent({
            agentInstanceId: subAgentId,
            parentAgentId,
            isSubAgent: true,
            isHeadless: useHeadless,
            tabId: subAgentTabId,
            ownsTab: subAgentTabId !== undefined,
            taskCategory: parentOptions.taskCategory,
            onMessage: (msg: LLMMessage) => {
                let newStatus = "";
                if (msg.role === "assistant" && msg.content) {
                    const content = typeof msg.content === "string" ? msg.content : "";
                    newStatus = content.includes("<think>") ? "Thinking..." : "Processing response...";
                } else if (msg.tool_calls && msg.tool_calls.length > 0) {
                    const toolName = msg.tool_calls[0].function.name;
                    if (toolName.includes("navigate")) newStatus = "Navigating...";
                    else if (toolName.includes("click")) newStatus = "Interacting...";
                    else if (toolName.includes("search")) newStatus = "Searching...";
                    else newStatus = `Using ${toolName}...`;
                }

                if (newStatus) {
                    agentStatuses[index].status = newStatus;
                    if (statusMessageId && parentOptions.onMessageUpdate) {
                        parentOptions.onMessageUpdate(statusMessageId, { content: renderStatus() });
                    }
                }
            },
        });

        try {
            const result = await subAgent.chat(instruction);
            const resultContent =
                typeof result?.content === "string"
                    ? result.content
                    : (result?.content as any[])?.map((c: any) => (c.type === "text" ? c.text : "")).join("") ?? "";

            const isBailout = resultContent.includes("consecutive errors") ||
                resultContent.includes("stopping to prevent an infinite loop");

            const isSuccess = !isBailout;
            const finalStatus = isSuccess ? "Done" : "Failed";
            let finalResultStr = resultContent;

            if (isBailout) {
                const partials = await extractPartialFindings(subAgent);
                if (partials.length > 0) {
                    finalResultStr = `Sub-agent bailed out. Partial data collected:\n${partials.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
                }
                console.warn(`[OrchestrationService] Parallel sub-agent ${context} bailed out. Salvaged ${partials.length} partial findings.`);
            }

            agentStatuses[index].isRunning = false;
            agentStatuses[index].result = finalResultStr;
            agentStatuses[index].status = finalStatus;

            const finishedStep = executionPlan.steps[index];
            if (finishedStep) {
                finishedStep.status = isSuccess ? "completed" : "failed";
                finishedStep.result = finalResultStr.substring(0, 200);
            }
            onPlanUpdate?.(executionPlan);

            if (statusMessageId && parentOptions.onMessageUpdate) {
                parentOptions.onMessageUpdate(statusMessageId, { content: renderStatus() });
            }

            if (isSuccess) {
                addMessage({
                    role: "assistant",
                    content: `**✅ ${context} Analysis Complete**\n\n${finalResultStr.substring(0, 500)}${finalResultStr.length > 500 ? "..." : ""
                        }`,
                });
            } else {
                addMessage({
                    role: "assistant",
                    content: `**⚠️ ${context} Analysis Failed/Partial**\n\n${finalResultStr}`,
                });
            }
            ledger?.recordSubAgentReport(context, finalResultStr);

            return { context, success: isSuccess, result: finalResultStr };
        } catch (error: any) {
            agentStatuses[index].isRunning = false;
            agentStatuses[index].status = "Failed";

            let partialsMsg = "";
            try {
                const partials = await extractPartialFindings(subAgent);
                if (partials.length > 0) {
                    partialsMsg = `\n\nPartial data collected before crash:\n${partials.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
                }
            } catch (e) { }

            const errorText = `Error: ${error.message}${partialsMsg}`;
            agentStatuses[index].result = errorText;

            if (statusMessageId && parentOptions.onMessageUpdate) {
                parentOptions.onMessageUpdate(statusMessageId, { content: renderStatus() });
            }

            addMessage({
                role: "assistant",
                content: `**❌ ${context} Analysis Crashed**\n\n${errorText}`,
            });
            ledger?.recordError(`[Parallel:${context}] ${errorText}`);

            return { context, success: false, result: errorText };
        // NOTE: Tab cleanup for parallel sub-agents is handled exclusively by
        // AgentRuntime's _runLoop finally block via the `ownsTab` flag.
        // Having cleanup here AND in AgentRuntime caused double close_tab calls.
        }
    });

    const results = await Promise.all(subAgentPromises);
    const successfulResults = results.filter((r) => r.success);
    const failedResults = results.filter((r) => !r.success);

    let summary = `## Results from ${contexts.length} sources\n\n`;
    for (const result of successfulResults) {
        summary += `### ${result.context}\n${result.result.trim()}\n\n`;
    }
    if (failedResults.length > 0) {
        summary += `### ⚠️ Failed Sources\n`;
        for (const result of failedResults) {
            summary += `- **${result.context}**: ${result.result}\n`;
        }
        summary += `\n`;
    }
    summary += `---\n\n*Parallel execution complete: ${successfulResults.length}/${contexts.length} sources succeeded.*`;

    if (statusMessageId && parentOptions.onMessageUpdate) {
        parentOptions.onMessageUpdate(statusMessageId, { content: summary });
    }

    return { role: "assistant", content: summary };
}

// ── Sequential Orchestration ───────────────────────────────────────────────────

/**
 * Executes sub-agents sequentially.
 *
 * @param originalRequest - The user's original request.
 * @param decomposition - The task decomposition result.
 * @param parentOptions - The parent agent's options.
 * @param parentAgentId - The parent agent's instance ID.
 * @param addMessage - Callback to add a message to the parent's history + UI.
 * @param spawnSubAgent - Factory function to create sub-agent instances.
 * @param ledger - Optional ledger for salvaging data.
 * @param onPlanUpdate - Callback for ExecutionPlan updates.
 * @returns The final summary message.
 */
export async function executeSequentialSubAgents(
    originalRequest: string,
    decomposition: TaskDecomposition,
    parentOptions: AgentRuntimeOptions,
    parentAgentId: string,
    addMessage: (msg: LLMMessage) => string | void,
    spawnSubAgent: SubAgentFactory,
    ledger?: RunWorkLedger,
    onPlanUpdate?: (plan: ExecutionPlan) => void
): Promise<LLMMessage> {
    const { contexts, estimatedActions } = decomposition;
    const targetContext = contexts[0] || "task";

    addMessage({
        role: "assistant",
        content: `📋 **Auto-Orchestration**: This task requires ~${estimatedActions} steps. I'll break it down and execute each part efficiently to preserve context.\n\nAnalyzing...`,
    });

    try {
        const planPrompt = `Break this task into 3-5 CONCRETE steps for an automation agent:

TASK: ${originalRequest}
TARGET: ${targetContext}

Rules:
- Each step = 1-3 tool calls
- Be specific
- Each step should produce a clear result

Format as JSON:
{
  "steps": [
    {"id": 1, "description": "Description 1"},
    {"id": 2, "description": "Description 2"}
  ]
}`;

        const planResponse = await chat(
            [{ role: "user", content: planPrompt }],
            [],
            parentOptions.settings,
            [],
            parentOptions.signal
        );

        let planData: { steps: Array<{ id: number; description: string }> } | null = null;
        try {
            const jsonMatch = planResponse.content.match(/\{[\s\S]*"steps"[\s\S]*\}/);
            if (jsonMatch) planData = JSON.parse(jsonMatch[0]);
        } catch { }

        if (!planData || !planData.steps || planData.steps.length === 0) {
            planData = {
                steps: [
                    { id: 1, description: `Navigate to ${targetContext}` },
                    { id: 2, description: `Complete main action: ${originalRequest.substring(0, 80)}` },
                    { id: 3, description: "Verify results" },
                ],
            };
        }

        const steps = planData.steps;
        const executionPlan: ExecutionPlan = {
            goal: originalRequest,
            steps: steps.map(s => ({
                id: s.id,
                description: s.description,
                status: 'pending' as const,
            })),
        };
        onPlanUpdate?.(executionPlan);

        addMessage({
            role: "assistant",
            content: `## Execution Plan\n\n${steps
                .map((s) => `**Step ${s.id}**: ${s.description}`)
                .join("\n")}\n\n---\n`,
        });

        const results: Array<{ step: number; description: string; result: string }> = [];

        // ── Provision a SINGLE shared tab for all sequential steps ────────────
        const useHeadless = parentOptions.isHeadless === true;
        let sharedTabId: number | undefined;
        if (!useHeadless) {
            try {
                const { browserLock } = await import("../resource-lock");
                const tabResult = await browserLock.runExclusive(async () =>
                    executeToolCall("new_tab", { url: "about:blank" })
                );
                const parsedTabId = parseTabIdFromResult(tabResult);
                if (parsedTabId !== undefined) {
                    sharedTabId = parsedTabId;
                    console.log(`[OrchestrationService] Provisioned shared tab ${sharedTabId} for sequential sub-agents`);
                }
            } catch (e) {
                console.warn("[OrchestrationService] Failed to provision shared tab", e);
            }
        }

        // Helper to salvage data from a sub-agent
        const extractPartialFindings = async (subAgentInstance: any): Promise<string[]> => {
            const history = subAgentInstance.getHistory?.() as LLMMessage[] | undefined;
            const partials: string[] = [];
            if (!history) return partials;

            for (const msg of history) {
                if (msg.role === "tool") {
                    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
                    if (!content.includes('"error":') && content.length > 50) {
                        try {
                            const { analyzeToolOutput } = await import("../result-reporter");
                            const analysis = analyzeToolOutput("tool", content);
                            if (analysis.hasPresentableData && analysis.summary) {
                                partials.push(analysis.summary.substring(0, 300));
                            }
                        } catch (e) { }
                    }
                }
            }
            return partials;
        };

        try {
            for (const step of steps) {
                if (parentOptions.signal?.aborted) {
                    throw new Error("Aborted by user");
                }

                const planStep = executionPlan.steps.find(s => s.id === step.id);
                if (planStep) planStep.status = 'active';
                onPlanUpdate?.(executionPlan);

                const previousStepsSummary =
                    results.length > 0
                        ? `\n\nCOMPLETED STEPS:\n${results
                            .map((r) => `- Step ${r.step}: ${r.result.substring(0, 100)}...`)
                            .join("\n")}`
                        : "";

                const subAgentInstruction = `GOAL: ${originalRequest}\n\nCURRENT STEP (${step.id}/${steps.length}): ${step.description}${previousStepsSummary}\n\nEnd with "✓ Done" and a brief result.`;

                const subAgentId = globalThis.crypto.randomUUID();

                await preSeedSubAgentMemory(
                    subAgentId,
                    parentAgentId,
                    parentOptions.activeSessionId,
                    `Sequential sub-agent for step ${step.id}/${steps.length}`,
                    { stepId: step.id }
                );

                const subAgent = spawnSubAgent({
                    agentInstanceId: subAgentId,
                    parentAgentId,
                    isSubAgent: true,
                    isHeadless: useHeadless,
                    tabId: sharedTabId,
                    taskCategory: parentOptions.taskCategory,
                    onMessage: (msg: LLMMessage) => {
                        console.log(`[SubAgent:Step${step.id}] ${msg.role}: ${typeof msg.content === 'string' ? msg.content.substring(0, 50) : '...'}...`);
                    },
                });

                try {
                    const stepResult = await subAgent.chat(subAgentInstruction);
                    const stepContent =
                        typeof stepResult.content === "string"
                            ? stepResult.content
                            : (stepResult.content as any[]).map((c: any) => (c.type === "text" ? c.text : "")).join("");

                    const isBailout = stepContent.includes("consecutive errors") ||
                        stepContent.includes("stopping to prevent an infinite loop");

                    if (isBailout) {
                        const partials = await extractPartialFindings(subAgent);
                        let finalStepContent = stepContent;
                        if (partials.length > 0) {
                            finalStepContent = `Step bailed out. Partial data:\n${partials.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
                        }
                        results.push({ step: step.id, description: step.description, result: finalStepContent.trim() });
                        ledger?.recordSubAgentReport(`step-${step.id}`, finalStepContent);
                    } else {
                        results.push({ step: step.id, description: step.description, result: stepContent.trim() });
                        ledger?.recordSubAgentReport(`step-${step.id}`, stepContent);
                    }

                    const completedStep = executionPlan.steps.find(s => s.id === step.id);
                    if (completedStep) {
                        completedStep.status = 'completed';
                        completedStep.result = stepContent.substring(0, 200);
                    }
                    onPlanUpdate?.(executionPlan);

                    addMessage({
                        role: "assistant",
                        content: `✓ **Step ${step.id} completed**\n${stepContent.substring(0, 150)}...`,
                    });
                } catch (error: any) {
                    console.error(`[OrchestrationService] Step ${step.id} failed:`, error);
                    let partialsMsg = "";
                    try {
                        const partials = await extractPartialFindings(subAgent);
                        if (partials.length > 0) {
                            partialsMsg = `\n\nPartial findings:\n${partials.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
                        }
                    } catch (e) { }

                    const failedStep = executionPlan.steps.find(s => s.id === step.id);
                    if (failedStep) failedStep.status = 'failed';
                    onPlanUpdate?.(executionPlan);

                    results.push({
                        step: step.id,
                        description: step.description,
                        result: `Error: ${error.message}${partialsMsg}`,
                    });
                    ledger?.recordError(`[Sequential step ${step.id}] ${error.message}`);
                }
            }
        } finally {
            if (sharedTabId !== undefined) {
                try {
                    const { browserLock } = await import("../resource-lock");
                    await browserLock.runExclusive(async () =>
                        executeToolCall("close_tab", { tabId: sharedTabId })
                    );
                    laneManager.cleanupTabLane(sharedTabId);
                } catch (e) { }
            }
        }

        let finalSummary = `## Task Complete\n\n`;
        for (const result of results) {
            finalSummary += `**${result.description}**\n${result.result}\n\n`;
        }
        addMessage({ role: "assistant", content: finalSummary });

        return { role: "assistant", content: finalSummary };
    } catch (error: any) {
        console.error("[OrchestrationService] Sequential orchestration failed:", error);
        ledger?.recordError(`Sequential orchestration failed: ${error.message}`);
        return {
            role: "assistant",
            content: `Failed: ${error.message}.`,
        };
    }
}

// ── Continuation Handoff ───────────────────────────────────────────────────────

/**
 * Spawns a single sub-agent to continue a task.
 *
 * @param originalRequest - The original user goal.
 * @param stepsTaken - How many steps the parent agent took.
 * @param progressContext - A summary of progress so far.
 * @param parentOptions - The parent agent's options.
 * @param parentAgentId - The parent agent's instance ID.
 * @param addMessage - Callback to add a message to history.
 * @param spawnSubAgent - Factory function.
 * @param ledger - Optional ledger.
 * @returns The final result message.
 */
export async function continueWithSubAgent(
    originalRequest: string,
    stepsTaken: number,
    progressContext: string,
    parentOptions: AgentRuntimeOptions,
    parentAgentId: string,
    addMessage: (msg: LLMMessage) => string | void,
    spawnSubAgent: SubAgentFactory,
    ledger?: RunWorkLedger
): Promise<LLMMessage> {
    const subAgentId = globalThis.crypto.randomUUID();

    addMessage({
        role: "assistant",
        content: `🔄 **Task Continuation**: Segment limit reached (${stepsTaken} steps). Handing off to a fresh agent with progress summary to continue toward the final goal...`,
    });

    await preSeedSubAgentMemory(
        subAgentId,
        parentAgentId,
        parentOptions.activeSessionId,
        `Continuation sub-agent\nOriginal goal: ${originalRequest}\nProgress so far: ${progressContext}`,
        {}
    );

    const subAgent = spawnSubAgent({
        agentInstanceId: subAgentId,
        parentAgentId,
        isSubAgent: true,
        isHeadless: parentOptions.isHeadless,
        taskCategory: parentOptions.taskCategory,
    });

    const instruction = `ORIGINAL GOAL: ${originalRequest}\n\nPROGRESS SO FAR:\n${progressContext}\n\nPlease continue and complete the remaining work. Pick up exactly where the last agent left off.`;

    try {
        const result = await subAgent.chat(instruction);
        ledger?.recordSubAgentReport("continuation", typeof result.content === 'string' ? result.content : "Completed");
        return result;
    } catch (error: any) {
        ledger?.recordError(`Continuation failed: ${error.message}`);
        throw error;
    }
}
