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
import { type AgentRuntimeOptions } from "./types";
import { preSeedSubAgentMemory } from "./AgentStateService";
import { laneManager } from "../execution-lanes";
import { RunWorkLedger } from "./RunWorkLedger";


// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Factory function for creating sub-agent instances.
 *
 * WHY a factory instead of direct import: Avoids the circular dependency
 * AgentRuntime → OrchestrationService → AgentRuntime. The factory is provided
 * by AgentRuntime at call time.
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
 * Each context (e.g., website, app, data source) gets its own isolated sub-agent
 * with a dedicated browser tab. Results are aggregated into a single summary.
 *
 * Live status updates: A single "status card" message is created upfront and
 * updated in-place as each sub-agent completes. This gives the user real-time
 * feedback without flooding the chat with intermediate messages.
 *
 * @param originalRequest - The user's original request (for context in sub-agent prompts).
 * @param decomposition - The task decomposition result (contexts, estimatedActions).
 * @param parentOptions - The parent agent's options (settings, signal, callbacks, etc.).
 * @param parentAgentId - The parent agent's instance ID (for memory linking).
 * @param addMessage - Callback to add a message to the parent's history + UI.
 * @param spawnSubAgent - Factory function to create sub-agent instances.
 * @returns The final aggregated result message.
 */
export async function executeParallelSubAgents(
    originalRequest: string,
    decomposition: TaskDecomposition,
    parentOptions: AgentRuntimeOptions,
    parentAgentId: string,
    addMessage: (msg: LLMMessage) => string | void,
    spawnSubAgent: SubAgentFactory,
    ledger?: RunWorkLedger
): Promise<LLMMessage> {
    const { contexts } = decomposition;

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

    // Track live status for each sub-agent
    const agentStatuses = contexts.map((ctx) => ({
        context: ctx,
        status: "Starting...",
        isRunning: true,
        result: null as string | null,
    }));

    // Helper to render the live status card content
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

    // Create the initial status card message
    const statusMessage: LLMMessage = { role: "assistant", content: renderStatus() };
    const statusMessageId = addMessage(statusMessage) as string | undefined;

    // Spawn all sub-agents concurrently
    // Determine if sub-agents should run headless (inherit from parent)
    const useHeadless = parentOptions.isHeadless === true;

    const subAgentPromises = contexts.map(async (context, index) => {
        const instruction = generateSubAgentInstruction(originalRequest, context, contexts);
        const subAgentId = globalThis.crypto.randomUUID();

        // Pre-seed memory so the sub-agent can find its state entity on init
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

        // Skip visible-browser tab provisioning in headless mode — the headless
        // browser is used directly via the _headless flag on tool args.
        let subAgentTabId: number | undefined;
        if (!useHeadless) {
            try {
                const { browserLock } = await import("../resource-lock");
                const tabResult = await browserLock.runExclusive(async () =>
                    executeToolCall("new_tab", { url: "about:blank" })
                );

                // Extract tabId from the MCP content envelope (or raw fallback)
                const parsedTabId = parseTabIdFromResult(tabResult);
                if (parsedTabId !== undefined) {
                    subAgentTabId = parsedTabId;
                    console.log(`[OrchestrationService] Provisioned tab ${subAgentTabId} for sub-agent`);
                } else {
                    console.warn("[OrchestrationService] new_tab result did not contain a tabId:", tabResult.result);
                }
            } catch (e) {
                console.warn("[OrchestrationService] Failed to provision tab for sub-agent", e);
            }
        } else {
            console.log(`[OrchestrationService] Headless mode — skipping visible tab for sub-agent ${context}`);
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
                // Update the live status card as the sub-agent works
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

                const contentStr =
                    typeof msg.content === "string"
                        ? msg.content
                        : (msg.content as any[]).map((c: any) => (c.type === "text" ? c.text : "[Image]")).join(" ");
                console.log(`[SubAgent:${context}] ${msg.role}: ${contentStr?.substring(0, 50)}...`);
            },
        });

        try {
            const result = await subAgent.chat(instruction);
            const resultContent =
                typeof result?.content === "string"
                    ? result.content
                    : (result?.content as any[])?.map((c: any) => (c.type === "text" ? c.text : "")).join("") ?? "";

            // Detect sub-agent bailout (max consecutive errors)
            const isBailout = resultContent.includes("consecutive errors") ||
                resultContent.includes("stopping to prevent an infinite loop");

            const isSuccess = !isBailout;
            const finalStatus = isSuccess ? "Done" : "Failed";
            let finalResultStr = resultContent;

            if (isBailout) {
                const partials = await extractPartialFindings(subAgent);
                if (partials.length > 0) {
                    finalResultStr = `Sub-agent bailed out. Partial data collected:\n${partials.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
                } else {
                    finalResultStr = `Sub-agent bailed out with errors. No partial data salvaged.\n\nOriginal result: ${resultContent.substring(0, 100)}...`;
                }
                console.warn(`[OrchestrationService] Parallel sub-agent ${context} bailed out. Salvaged ${partials.length} partial findings.`);
            }

            agentStatuses[index].isRunning = false;
            agentStatuses[index].result = finalResultStr;
            agentStatuses[index].status = finalStatus;

            if (statusMessageId && parentOptions.onMessageUpdate) {
                parentOptions.onMessageUpdate(statusMessageId, { content: renderStatus() });
            }

            // Show the result immediately as a distinct message
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

            // Try to salvage partial data even on a hard crash
            let partialsMsg = "";
            try {
                const partials = await extractPartialFindings(subAgent);
                if (partials.length > 0) {
                    partialsMsg = `\n\nPartial data collected before crash:\n${partials.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
                    console.warn(`[OrchestrationService] Parallel sub-agent ${context} threw exception. Salvaged ${partials.length} partial findings.`);
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
        } finally {
            // ALWAYS close the sub-agent's tab to free resources, even on crash/timeout
            if (subAgentTabId !== undefined) {
                try {
                    const { browserLock } = await import("../resource-lock");
                    await browserLock.runExclusive(async () =>
                        executeToolCall("close_tab", { tabId: subAgentTabId })
                    );
                    console.log(`[OrchestrationService] Closed sub-agent tab ${subAgentTabId}`);
                    // Clean up the execution lane to prevent memory leaks
                    laneManager.cleanupTabLane(subAgentTabId);
                } catch (e) {
                    console.warn(`[OrchestrationService] Failed cleanup for tab ${subAgentTabId}`, e);
                }
            }
        }

    });

    const results = await Promise.all(subAgentPromises);

    // Aggregate results into a final summary
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

    // Update the status card one final time with the aggregated result
    if (statusMessageId && parentOptions.onMessageUpdate) {
        parentOptions.onMessageUpdate(statusMessageId, { content: summary });
    }

    return { role: "assistant", content: summary };
}

// ── Sequential Orchestration ───────────────────────────────────────────────────

/**
 * Executes sub-agents sequentially for complex single-context tasks.
 *
 * Flow:
 * 1. Generate a 3-5 step plan via LLM
 * 2. Display the plan to the user
 * 3. Execute each step with a fresh sub-agent (passing previous step results as context)
 * 4. Compile a final summary
 *
 * WHY sequential (not parallel): Single-context tasks often have dependencies
 * between steps (e.g., "navigate to page" must complete before "click button").
 *
 * @param originalRequest - The user's original request.
 * @param decomposition - The task decomposition result.
 * @param parentOptions - The parent agent's options.
 * @param parentAgentId - The parent agent's instance ID.
 * @param addMessage - Callback to add a message to the parent's history + UI.
 * @param spawnSubAgent - Factory function to create sub-agent instances.
 * @returns The final summary message.
 */
export async function executeSequentialSubAgents(
    originalRequest: string,
    decomposition: TaskDecomposition,
    parentOptions: AgentRuntimeOptions,
    parentAgentId: string,
    addMessage: (msg: LLMMessage) => string | void,
    spawnSubAgent: SubAgentFactory,
    ledger?: RunWorkLedger
): Promise<LLMMessage> {
    const { contexts, estimatedActions } = decomposition;
    const targetContext = contexts[0] || "task";

    // Notify user about auto-orchestration
    const planMessage: LLMMessage = {
        role: "assistant",
        content: `📋 **Auto-Orchestration**: This task requires ~${estimatedActions} steps. I'll break it down and execute each part efficiently to preserve context.\n\nAnalyzing...`,
    };
    addMessage(planMessage);
    parentOptions.onMessage?.(planMessage);

    // ── Step 1: Generate plan via LLM ──────────────────────────────────────────
    console.log("[OrchestrationService] Generating execution plan...");
    const planPrompt = `Break this task into 3-5 CONCRETE steps for an automation agent:

TASK: ${originalRequest}
TARGET: ${targetContext}

Rules:
- Each step = 1-3 tool calls (could be browser, file, API, database, messaging, etc.)
- Be specific: include URLs, filenames, endpoints, or identifiers when known
- NO vague steps like "gather information" or "clarify requirements"
- Each step should produce a clear, verifiable result

Format as JSON:
{
  "steps": [
    {"id": 1, "description": "Navigate to example.com OR Open file X OR Call API Y"},
    {"id": 2, "description": "Perform the main action"},
    {"id": 3, "description": "Extract/save results"}
  ]
}`;

    try {
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
        } catch {
            // JSON parse failed — use fallback plan
        }

        // Fallback if LLM didn't produce a valid plan
        if (!planData || !planData.steps || planData.steps.length === 0) {
            planData = {
                steps: [
                    {
                        id: 1,
                        description: `Navigate to ${targetContext === "current_page" ? "the target website" : targetContext
                            }`,
                    },
                    {
                        id: 2,
                        description: `Complete the main action: ${originalRequest.substring(0, 80)}`,
                    },
                    { id: 3, description: "Verify results and extract relevant information" },
                ],
            };
        }

        const steps = planData.steps;
        console.log(`[OrchestrationService] Plan created with ${steps.length} steps`);

        // Display plan to user
        const planDisplayMsg: LLMMessage = {
            role: "assistant",
            content: `## Execution Plan\n\n${steps
                .map((s) => `**Step ${s.id}**: ${s.description}`)
                .join("\n")}\n\n---\n`,
        };
        addMessage(planDisplayMsg);
        parentOptions.onMessage?.(planDisplayMsg);

        // ── Step 2: Execute each step via sub-agent ────────────────────────────────
        const results: Array<{ step: number; description: string; result: string }> = [];

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

        for (const step of steps) {
            if (parentOptions.signal?.aborted) {
                console.log("[OrchestrationService] Sequential orchestration aborted by user");
                ledger?.recordError('Sequential orchestration aborted by user');
                throw new Error("Aborted by user");
            }

            console.log(`[OrchestrationService] Executing step ${step.id}: ${step.description}`);

            // Build context from previous steps
            const previousStepsSummary =
                results.length > 0
                    ? `\n\nCOMPLETED STEPS:\n${results
                        .map(
                            (r) =>
                                `- Step ${r.step}: ${r.result.substring(0, 100)}${r.result.length > 100 ? "..." : ""
                                }`
                        )
                        .join("\n")}`
                    : "";

            const subAgentInstruction = `GOAL: ${originalRequest}

CURRENT STEP (${step.id}/${steps.length}): ${step.description}
${previousStepsSummary}

Execute this step using available tools. State persists from previous steps.
End with "✓ Done" and a brief result.`;

            const subAgentId = globalThis.crypto.randomUUID();

            await preSeedSubAgentMemory(
                subAgentId,
                parentAgentId,
                parentOptions.activeSessionId,
                [
                    `Sequential sub-agent for step ${step.id}/${steps.length}`,
                    `Task: ${step.description}`,
                    `Parent task: ${originalRequest}`,
                    `Initialized at ${new Date().toISOString()}`,
                ].join("\n"),
                { stepId: step.id, stepDescription: step.description }
            );

            const subAgent = spawnSubAgent({
                agentInstanceId: subAgentId,
                parentAgentId,
                isSubAgent: true,
                isHeadless: parentOptions.isHeadless,
                ownsTab: false,
                taskCategory: parentOptions.taskCategory,
                onMessage: (msg) => {
                    const contentStr =
                        typeof msg.content === "string"
                            ? msg.content
                            : (msg.content as any[]).map((c: any) => (c.type === "text" ? c.text : "[Image]")).join(" ");
                    console.log(`[SubAgent:Step${step.id}] ${msg.role}: ${contentStr?.substring(0, 50)}...`);
                },
            });

            try {
                const stepResult = await subAgent.chat(subAgentInstruction);
                const stepContent =
                    typeof stepResult.content === "string"
                        ? stepResult.content
                        : (stepResult.content as any[]).map((c: any) => (c.type === "text" ? c.text : "")).join("");

                // Detect bailout
                const isBailout = stepContent.includes("consecutive errors") ||
                    stepContent.includes("stopping to prevent an infinite loop");

                if (isBailout) {
                    const partials = await extractPartialFindings(subAgent);
                    let finalStepContent = stepContent;
                    if (partials.length > 0) {
                        finalStepContent = `Step bailed out. Partial data collected:\n${partials.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
                    }
                    console.warn(`[OrchestrationService] Sequential step ${step.id} bailed out. Salvaged ${partials.length} findings.`);
                    results.push({ step: step.id, description: step.description, result: finalStepContent.trim() });
                    ledger?.recordSubAgentReport(`step-${step.id}`, finalStepContent);
                } else {
                    results.push({ step: step.id, description: step.description, result: stepContent.trim() });
                    ledger?.recordSubAgentReport(`step-${step.id}`, stepContent);
                }

                const progressMessage: LLMMessage = {
                    role: "assistant",
                    content: `✓ **Step ${step.id} completed**\n${stepContent.substring(0, 150)}${stepContent.length > 150 ? "..." : ""
                        }`,
                };
                addMessage(progressMessage);
                parentOptions.onMessage?.(progressMessage);
            } catch (error: any) {
                console.error(`[OrchestrationService] Step ${step.id} failed:`, error);

                // Try to salvage partial data even on a hard crash
                let partialsMsg = "";
                try {
                    const partials = await extractPartialFindings(subAgent);
                    if (partials.length > 0) {
                        partialsMsg = `\n\nPartial data collected before crash:\n${partials.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
                        console.warn(`[OrchestrationService] Sequential step ${step.id} crashed. Salvaged ${partials.length} findings.`);
                    }
                } catch (e) { }

                results.push({
                    step: step.id,
                    description: step.description,
                    result: `Error: ${error.message}${partialsMsg}`,
                });
                ledger?.recordError(`[Sequential step ${step.id}] ${error.message}`);
            }
        }

        // ── Step 3: Compile final summary ──────────────────────────────────────────
        let finalSummary = `## Task Complete\n\n`;
        for (const result of results) {
            finalSummary += `**${result.description}**\n${result.result}\n\n`;
        }
        finalSummary += `---\n\n*Sequential orchestration complete: ${results.length} steps executed.*`;

        const finalMessage: LLMMessage = { role: "assistant", content: finalSummary };
        addMessage(finalMessage);
        parentOptions.onMessage?.(finalMessage);

        return finalMessage;
    } catch (error: any) {
        console.error("[OrchestrationService] Sequential orchestration failed:", error);
        ledger?.recordError(`Sequential orchestration failed: ${error.message}`);
        return {
            role: "assistant",
            content: `Failed to orchestrate task: ${error.message}. Falling back to direct execution.`,
        };
    }
}

// ── Continuation Handoff ───────────────────────────────────────────────────────

/**
 * Spawns a single sub-agent to continue a task that hit the max iteration limit.
 *
 * The continuation agent receives the original goal + a progress summary from
 * the last checkpoint, giving it enough context to pick up where the parent left off.
 *
 * @param originalRequest - The original user goal.
 * @param stepsTaken - How many steps the parent agent took (for context).
 * @param progressContext - A summary of progress so far (from the last checkpoint).
 * @param parentOptions - The parent agent's options.
 * @param parentAgentId - The parent agent's instance ID.
 * @param addMessage - Callback to add a message to the parent's history + UI.
 * @param spawnSubAgent - Factory function to create sub-agent instances.
 * @returns The continuation agent's final result.
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
    const instruction = `GOAL: ${originalRequest}

CONTEXT: I have already taken ${stepsTaken} steps but haven't finished.
Progress so far:
${progressContext}

INSTRUCTION: Continue the task from here. You have a fresh context window.
Focus on the next logical steps to complete the goal.
Use tools immediately. End with "✓ Done".`;

    const subAgent = spawnSubAgent({
        agentInstanceId: globalThis.crypto.randomUUID(),
        parentAgentId,
        isSubAgent: true,
        isHeadless: parentOptions.isHeadless,
        ownsTab: false,
        taskCategory: parentOptions.taskCategory,
        onMessage: (msg) => {
            if (msg.role === "assistant" && msg.content) {
                // Pass through partial updates if needed
            }
        },
    });

    addMessage({ role: "assistant", content: `Starting sub-agent to continue the task...` });

    try {
        const result = await subAgent.chat(instruction);
        ledger?.recordSubAgentReport('continuation', typeof result.content === "string" ? result.content : JSON.stringify(result.content));
        return result;
    } catch (error) {
        ledger?.recordError(`Continuation sub-agent failed: ${error instanceof Error ? error.message : String(error)}`);
        throw new Error(
            `Sub-agent failed to complete task: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
