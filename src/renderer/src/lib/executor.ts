/**
 * Plan Executor
 *
 * Executes approved plans by calling LLMs and MCP tools.
 * This module refactors the tool execution loop from App.tsx into a reusable module.
 */

import type { ExecutionContext, ExecutionResult, ExecutedStep } from '../types/orchestrator';
import { chat, type LLMMessage, type LLMSettings, type LLMTool, type ServerInfo } from './llm';
import { executeToolCall, getAllTools, getServers } from './mcp';

/**
 * Executes an approved plan
 *
 * @param context - Execution context containing plan, provider, and available tools
 * @param settings - LLM settings (provider, API keys, etc.)
 * @param onProgress - Optional callback for step progress updates
 * @returns Execution result with content and step details
 */
export async function executePlan(
    context: ExecutionContext,
    settings: LLMSettings,
    onProgress?: (step: number, description: string) => void
): Promise<ExecutionResult> {
    const startTime = Date.now();
    const executedSteps: ExecutedStep[] = [];

    try {
        // Build initial messages
        const messages: LLMMessage[] = [
            {
                role: 'system',
                content: buildExecutionSystemPrompt(context),
            },
            {
                role: 'user',
                content: context.userMessage,
            },
        ];

        // Get available tools
        const mcpTools = getAllTools();
        const llmTools: LLMTool[] = mcpTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
        }));

        // Get server info for context
        const servers = getServers();
        const serverInfo: ServerInfo[] = servers
            .filter((server) => server.connected)
            .map((server) => ({
                name: server.name,
                description: server.description.substring(0, 40),
                toolCount: server.tools.length,
                isReasoningServer:
                    server.name.includes('sequential-thinking') ||
                    server.name.includes('sequential') ||
                    server.description.toLowerCase().includes('reasoning'),
            }));

        // Determine effective settings based on provider preference
        // "local" -> browser (fastest local)
        // "cloud" -> use settings if it's a cloud provider, otherwise default to a cloud-only auto choice
        let effectiveProvider: any = context.provider;
        if (effectiveProvider === 'local') {
            effectiveProvider = 'browser';
        } else if (effectiveProvider === 'cloud') {
            const userPref = settings.preferredProvider;
            const isCloudPref = userPref === 'gemini' || userPref === 'openai' || userPref === 'openrouter';
            // If user preferred a cloud model, keep it. Otherwise, force cloud-only auto.
            effectiveProvider = isCloudPref ? userPref : 'gemini'; // Default to gemini for cloud power
        }

        const effectiveSettings: LLMSettings = {
            ...settings,
            preferredProvider: effectiveProvider,
        };

        // Simple tasks: single LLM call without tools
        // Only use the fast single-call path if NO tools are needed and plan is 1-step
        if (!context.plan.needsTools && context.plan.plan.length <= 1) {
            onProgress?.(1, 'Processing...');

            const stepStart = Date.now();
            const response = await chat(
                messages,
                llmTools.length > 0 ? llmTools : undefined,
                effectiveSettings,
                serverInfo.length > 0 ? serverInfo : undefined
            );

            executedSteps.push({
                stepNumber: 1,
                success: true,
                result: response.content,
                duration: Date.now() - stepStart,
            });

            return {
                success: true,
                content: response.content,
                executedSteps,
                provider: response.provider,
                model: response.model,
                totalDuration: Date.now() - startTime,
            };
        }

        // Complex tasks: multi-turn execution with tool calling
        let currentMessages = [...messages];
        let finalResponse = '';
        let iterationCount = 0;
        const maxIterations = 10;
        let lastProvider = 'unknown';
        let lastModel = 'unknown';

        while (iterationCount < maxIterations) {
            // Check for abort
            if (context.abortSignal?.aborted) {
                throw new Error('Cancelled by user');
            }

            // Update progress
            const currentStep = Math.min(iterationCount + 1, context.plan.plan.length);
            const stepDescription = context.plan.plan[currentStep - 1]?.description || 'Processing...';
            onProgress?.(currentStep, stepDescription);

            const stepStart = Date.now();

            // Call LLM
            let response;
            try {
                const chatPromise = chat(
                    currentMessages,
                    llmTools.length > 0 ? llmTools : undefined,
                    effectiveSettings,
                    serverInfo.length > 0 ? serverInfo : undefined
                );

                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('LLM call timeout after 60 seconds')), 60000);
                });

                response = await Promise.race([chatPromise, timeoutPromise]);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                executedSteps.push({
                    stepNumber: iterationCount + 1,
                    success: false,
                    error: errorMessage,
                    duration: Date.now() - stepStart,
                });

                return {
                    success: false,
                    content: `Error during execution: ${errorMessage}`,
                    executedSteps,
                    provider: lastProvider,
                    model: lastModel,
                    totalDuration: Date.now() - startTime,
                    error: errorMessage,
                };
            }

            lastProvider = response.provider;
            lastModel = response.model;
            finalResponse = response.content;

            // If no tool calls, we're done
            if (!response.toolCalls || response.toolCalls.length === 0) {
                executedSteps.push({
                    stepNumber: iterationCount + 1,
                    success: true,
                    result: response.content,
                    duration: Date.now() - stepStart,
                });
                break;
            }

            // Add assistant message with tool calls to conversation
            currentMessages.push({
                role: 'assistant',
                content: response.content || '',
                tool_calls: response.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: tc.name,
                        arguments: JSON.stringify(tc.arguments),
                    },
                })),
            } as LLMMessage);

            // Execute tool calls
            for (const toolCall of response.toolCalls) {
                const toolStart = Date.now();

                try {
                    const result = await executeToolCall(toolCall.name, toolCall.arguments);

                    if (result.error) {
                        currentMessages.push({
                            role: 'tool',
                            content: JSON.stringify({ error: result.error }),
                            tool_call_id: toolCall.id,
                            name: toolCall.name,
                        } as LLMMessage);
                    } else {
                        const resultStr =
                            typeof result.result === 'string'
                                ? result.result
                                : JSON.stringify(result.result);

                        // Truncate large results
                        const truncatedResult =
                            resultStr.length > 4000
                                ? resultStr.substring(0, 4000) + '\n... (result truncated)'
                                : resultStr;

                        currentMessages.push({
                            role: 'tool',
                            content: truncatedResult,
                            tool_call_id: toolCall.id,
                            name: toolCall.name,
                        } as LLMMessage);
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    currentMessages.push({
                        role: 'tool',
                        content: JSON.stringify({ error: errorMessage }),
                        tool_call_id: toolCall.id,
                        name: toolCall.name,
                    } as LLMMessage);
                }
            }

            executedSteps.push({
                stepNumber: iterationCount + 1,
                success: true,
                result: `Executed ${response.toolCalls.length} tool(s)`,
                duration: Date.now() - stepStart,
            });

            iterationCount++;
        }

        // Check if we hit max iterations
        if (iterationCount >= maxIterations) {
            console.warn(`[Executor] Reached max iterations (${maxIterations})`);
        }

        return {
            success: true,
            content: finalResponse,
            executedSteps,
            provider: lastProvider,
            model: lastModel,
            totalDuration: Date.now() - startTime,
        };
    } catch (error) {
        return {
            success: false,
            content: '',
            executedSteps,
            provider: context.provider,
            model: 'unknown',
            totalDuration: Date.now() - startTime,
            error: error instanceof Error ? error.message : 'Execution failed',
        };
    }
}

/**
 * Builds the system prompt for plan execution
 */
function buildExecutionSystemPrompt(context: ExecutionContext): string {
    const stepsText = context.plan.plan
        .map((s) => `${s.stepNumber}. ${s.description}${s.toolName ? ` (use ${s.toolName})` : ''}`)
        .join('\n');

    return `You are executing a plan to help the user. Follow these steps:

${stepsText}

Guidelines:
- Execute the plan faithfully
- Use tools when specified in the steps
- Provide clear, helpful responses
- If a tool fails, explain what happened and try alternatives if possible
- Keep responses concise but complete`;
}
