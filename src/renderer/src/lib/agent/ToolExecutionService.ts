/**
 * agent/ToolExecutionService.ts — Executes MCP tool calls with self-healing retries.
 *
 * Responsibilities:
 *   1. Route tool calls through the correct execution lane (browser serial, tab serial, API parallel)
 *   2. Self-healing: retry failed tool calls with context-aware recovery strategies
 *   3. Loop detection: bail out if the same tool is called N times in a row
 *   4. Output truncation: prevent context bloat from large tool outputs
 *   5. Incremental reporting: surface presentable findings to the user immediately
 *
 * Architecture: All functions are pure (no class state). The caller (AgentRuntime)
 *   passes in the mutable state it owns (recentToolCalls, toolCallHistory, etc.)
 *   as parameters. This makes the service easy to test in isolation.
 *
 * Phase 3 note: In Phase 3, tool execution moves to the backend. This service
 *   will be replaced by a backend RPC call. The self-healing logic stays on the
 *   backend where it has direct access to the browser/filesystem.
 *
 * Consumed by: AgentRuntime (agent-runtime.ts)
 */

import { executeToolCall } from "../mcp";
import { analyzeToolOutput } from "../result-reporter";
import { type LLMMessage } from "../types";
import { laneManager } from "../execution-lanes";
import { STATEFUL_BROWSER_TOOLS } from "../client-tools";

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Maximum number of identical tool calls (same name + args) before we bail out.
 * WHY 3: One retry is reasonable; two retries means something is genuinely broken.
 */
export const MAX_IDENTICAL_CALLS = 3;

/**
 * Maximum characters to keep from a single tool output.
 * WHY 5000: Tools like `get_state` can return 100k+ chars, quickly exhausting
 * the LLM's context window. 5000 chars is enough for the LLM to act on.
 */
export const MAX_TOOL_OUTPUT_LENGTH = 5000;

/**
 * Total time budget for all retry attempts of a single tool call.
 * WHY cumulative (not per-attempt): Prevents 3 × 60s = 180s total from retries.
 */
const CUMULATIVE_TIMEOUT_MS = 120_000;

/**
 * Minimum time remaining before we attempt a retry.
 * WHY: Don't retry if there's less than 5s left — it would likely time out anyway.
 */
const MIN_REMAINING_FOR_RETRY_MS = 5_000;

// ── Loop Detection ─────────────────────────────────────────────────────────────

/**
 * Checks if the agent is stuck in a loop by examining recent tool call signatures.
 *
 * Detects:
 * 1. **Identical calls**: Same tool name + same arguments N times in a row.
 *    (We no longer block same tool + different args, because reading 3 different
 *    files or navigating to 3 different links in a row is perfectly valid exploration).
 *
 * @param recentToolCalls - Sliding window of the last N tool signatures.
 * @param toolCallHistory - Set of all unique tool signatures (for progress tracking).
 * @param callName - The name of the tool being called right now.
 * @param messages - Full message history (for extracting recent tool results).
 * @returns A loop bailout message if a loop is detected, or null if clear.
 */
export function checkForLoop(
    recentToolCalls: string[],
    toolCallHistory: Set<string>,
    callName: string,
    messages: LLMMessage[]
): LLMMessage | null {
    if (recentToolCalls.length < MAX_IDENTICAL_CALLS) return null;

    const lastN = recentToolCalls.slice(-MAX_IDENTICAL_CALLS);
    const allSame = lastN.every((sig) => sig === lastN[0]);

    if (!allSame) return null;

    console.error(
        `[ToolExecutionService] Infinite loop detected: ${callName} called ${MAX_IDENTICAL_CALLS}+ times with identical arguments`
    );

    // Gather recent tool outputs for context in the bailout message
    const recentResults = messages
        .filter((m) => m.role === "tool")
        .slice(-5)
        .map((m) => {
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            return content.length > 500 ? content.substring(0, 500) + "..." : content;
        });

    const completedSteps = messages.filter((m) => m.role === "tool").length;
    const uniqueToolsUsed = toolCallHistory.size;

    return {
        role: "assistant",
        content: `## ⚠️ I noticed I'm repeating the same action

I've called \`${callName}\` **${MAX_IDENTICAL_CALLS} times** with identical arguments, which usually means something isn't working as expected.

---

### 📊 Progress So Far
- **${completedSteps} tool calls** executed
- **${uniqueToolsUsed} unique actions** tried

### 📋 Recent Results
${recentResults.length > 0
                ? recentResults.map((r, i) => `**Result ${i + 1}:**\n\`\`\`\n${r}\n\`\`\``).join("\n\n")
                : "_No results captured yet_"
            }

---

### 🔄 What would you like me to do?
1. **"Try a different approach"** - I'll use alternative methods
2. **"Continue anyway"** - I'll keep trying the current approach
3. **"Stop here"** - I'll stop and you can take over manually
4. Or give me specific instructions on what to try next`,
    };
}

// ── Self-Healing Execution ─────────────────────────────────────────────────────

/**
 * Executes a single MCP tool call with self-healing retry logic.
 *
 * Recovery strategies (in order of specificity):
 * 1. Context destroyed → wait 1s, retry (navigation race condition)
 * 2. Stale element → retry immediately (DOM update)
 * 3. Lane timeout → wait 2s, retry
 * 4. Tool-level timeout → retry with doubled timeout
 * 5. Network error → wait 2s, retry (transient)
 * 6. Browser context lost → wait 1s, retry
 * 7. Element not found → retry with 1.5× timeout (page still loading)
 * 8. Navigation timeout → retry with 1.5× timeout
 *
 * Syntax/logic errors are NOT retried — they need LLM intervention.
 *
 * @param name - The tool name to execute.
 * @param args - The tool arguments.
 * @param tabId - If set, inject as `args.tabId` for browser tools (tab isolation).
 * @param workspacePath - If set, inject as `args.workspacePath` for fs tools.
 * @param signal - AbortSignal to cancel execution.
 * @returns `{ result, error }` — never throws (errors are returned as strings).
 */
export async function executeWithSelfHealing(
    name: string,
    args: Record<string, unknown>,
    tabId: number | undefined,
    workspacePath: string | undefined,
    signal: AbortSignal | undefined,
    isHeadless?: boolean
): Promise<{ result: unknown; error?: string }> {
    return _executeWithRetry(name, args, tabId, workspacePath, signal, isHeadless, 1, Date.now());
}

async function _executeWithRetry(
    name: string,
    args: Record<string, unknown>,
    tabId: number | undefined,
    workspacePath: string | undefined,
    signal: AbortSignal | undefined,
    isHeadless: boolean | undefined,
    attempt: number,
    startTime: number
): Promise<{ result: unknown; error?: string }> {
    // ── Cumulative timeout guard ──────────────────────────────────────────────
    const elapsed = Date.now() - startTime;
    if (elapsed >= CUMULATIVE_TIMEOUT_MS) {
        console.warn(
            `[ToolExecutionService] Cumulative timeout exceeded for ${name} after ${Math.round(elapsed / 1000)}s`
        );
        return {
            result: null,
            error: `Cumulative timeout: ${name} exceeded ${CUMULATIVE_TIMEOUT_MS / 1000}s across all retry attempts`,
        };
    }

    try {
        // ── Tab isolation: inject tabId for browser tools ─────────────────────────
        // WHY: Parallel sub-agents each get a dedicated tab. Injecting tabId here
        // ensures all browser tool calls from this agent stay in their own tab.
        if (tabId !== undefined && STATEFUL_BROWSER_TOOLS.includes(name)) {
            args = { ...args, tabId };
        }

        // ── Headless toggle: inject _headless into args ───────────────────────────
        if (isHeadless) {
            args = { ...args, _headless: true };
        }

        // ── Workspace security: inject workspacePath for filesystem tools ─────────
        if (name.startsWith("fs_") && workspacePath) {
            args = { ...args, workspacePath };
        }

        // ── Execute via Lane Manager ──────────────────────────────────────────────
        // Lane Manager routes to the correct execution lane:
        //   - Browser Serial: stateful browser tools (navigate, click, etc.)
        //   - Tab Serial: per-tab tools (scoped to a specific tab)
        //   - API Parallel: stateless API tools (memory, filesystem, etc.)
        const lane = laneManager.getLane(name, { tabId });
        const timeoutMs = laneManager.getTimeoutForTool(name);
        const result = await lane.run(
            async () => executeToolCall(name, args),
            timeoutMs,
            signal
        );

        return result as { result: unknown; error?: string };
    } catch (error: any) {
        const errorStr = String(error);

        // Abort errors: exit immediately, no retry
        if (
            errorStr.includes("Aborted") ||
            errorStr.includes("LaneAbortError") ||
            signal?.aborted
        ) {
            return { result: null, error: "Aborted by user" };
        }

        // ── Recovery strategies (max 2 attempts total) ────────────────────────────
        if (attempt <= 2) {
            if (signal?.aborted) return { result: null, error: "Aborted by user" };

            // Check cumulative timeout before retrying
            const retryElapsed = Date.now() - startTime;
            if (retryElapsed + MIN_REMAINING_FOR_RETRY_MS >= CUMULATIVE_TIMEOUT_MS) {
                console.warn(
                    `[ToolExecutionService] Insufficient time remaining for retry of ${name}`
                );
                return {
                    result: null,
                    error: `${errorStr} (no retry: cumulative timeout would be exceeded)`,
                };
            }

            if (errorStr.includes("Execution context was destroyed")) {
                console.log(`[ToolExecutionService] Context destroyed in ${name}. Retrying in 1s...`);
                await delay(1000);
                if (signal?.aborted) return { result: null, error: "Aborted by user" };
                return _executeWithRetry(name, args, tabId, workspacePath, signal, isHeadless, attempt + 1, startTime);
            }

            if (errorStr.includes("Element is not attached") || errorStr.includes("Node is detached")) {
                console.log(`[ToolExecutionService] Stale element in ${name}. Retrying immediately...`);
                return _executeWithRetry(name, args, tabId, workspacePath, signal, isHeadless, attempt + 1, startTime);
            }

            if (errorStr.includes("Lane timeout")) {
                console.log(`[ToolExecutionService] Lane timeout for ${name} (attempt ${attempt}). Retrying in 2s...`);
                await delay(2000);
                if (signal?.aborted) return { result: null, error: "Aborted by user" };
                return _executeWithRetry(name, args, tabId, workspacePath, signal, isHeadless, attempt + 1, startTime);
            }

            if (errorStr.includes("Timeout") && args.timeout && typeof args.timeout === "number") {
                console.log(`[ToolExecutionService] Timeout in ${name}. Retrying with double timeout...`);
                return _executeWithRetry(
                    name,
                    { ...args, timeout: args.timeout * 2 },
                    tabId,
                    workspacePath,
                    signal,
                    isHeadless,
                    attempt + 1,
                    startTime
                );
            }

            if (
                errorStr.includes("net::ERR_") ||
                errorStr.includes("ECONNREFUSED") ||
                errorStr.includes("fetch failed")
            ) {
                console.log(`[ToolExecutionService] Network error in ${name}. Retrying in 2s...`);
                await delay(2000);
                if (signal?.aborted) return { result: null, error: "Aborted by user" };
                return _executeWithRetry(name, args, tabId, workspacePath, signal, isHeadless, attempt + 1, startTime);
            }

            if (
                errorStr.includes("Target closed") ||
                errorStr.includes("Session closed") ||
                errorStr.includes("Browser has been closed")
            ) {
                console.log(`[ToolExecutionService] Browser context lost in ${name}. Retrying in 1s...`);
                await delay(1000);
                if (signal?.aborted) return { result: null, error: "Aborted by user" };
                return _executeWithRetry(name, args, tabId, workspacePath, signal, isHeadless, attempt + 1, startTime);
            }

            if (
                errorStr.includes("Element not found") ||
                errorStr.includes("waiting for selector") ||
                errorStr.includes("No element matches")
            ) {
                console.log(`[ToolExecutionService] Element not found in ${name}. Retrying with longer wait...`);
                return _executeWithRetry(
                    name,
                    { ...args, timeout: ((args.timeout as number) || 5000) * 1.5 },
                    tabId,
                    workspacePath,
                    signal,
                    isHeadless,
                    attempt + 1,
                    startTime
                );
            }

            if (errorStr.includes("Navigation timeout") || errorStr.includes("page.goto")) {
                console.log(`[ToolExecutionService] Navigation timeout in ${name}. Retrying with extended timeout...`);
                return _executeWithRetry(
                    name,
                    { ...args, timeout: ((args.timeout as number) || 30000) * 1.5 },
                    tabId,
                    workspacePath,
                    signal,
                    isHeadless,
                    attempt + 1,
                    startTime
                );
            }
        }

        // Syntax/logic errors: don't retry — delegate to LLM for correction
        if (
            errorStr.includes("Syntax error") ||
            errorStr.includes("ReferenceError") ||
            errorStr.includes("TypeError") ||
            errorStr.includes("Unexpected identifier")
        ) {
            console.log(
                `[ToolExecutionService] Syntax/logic error in ${name} - delegating to LLM for correction`
            );
        }

        return { result: null, error: errorStr };
    }
}

// ── Output Processing ──────────────────────────────────────────────────────────

/**
 * Formats a tool execution result into a string for the LLM context.
 *
 * Handles:
 * - Error enrichment: adds recovery hints based on error type
 * - Output truncation: caps output at MAX_TOOL_OUTPUT_LENGTH chars
 *
 * @param toolName - The tool that was called (for recovery hint selection).
 * @param typedResult - The raw result from `executeWithSelfHealing`.
 * @returns `{ resultStr, isError }` — the formatted string and whether it's an error.
 */
export function formatToolResult(
    toolName: string,
    typedResult: { result: unknown; error?: string }
): { resultStr: string; isError: boolean } {
    if (typedResult.error) {
        const errorMsg = typedResult.error;
        let recoveryHint = "";

        if (errorMsg.includes("not found") || errorMsg.includes("Timeout")) {
            recoveryHint =
                "\n\n💡 **Recovery Tip**: Try:\n1. `convert_to_markdown(uri=\"current_page_url\")` for fast content reading (no browser needed)\n2. `get_interactive_elements()` to find clickable elements\n3. `screenshot()` to see the current page state\n4. Use a text-based selector like `text=\"Submit\"` instead";
        } else if (errorMsg.includes("not visible") || errorMsg.includes("hidden")) {
            recoveryHint =
                "\n\n💡 **Recovery Tip**: The element exists but is hidden. Try:\n1. Scroll the page first (`scroll`).\n2. Wait for animations to complete (`wait`).\n3. Check if a modal or popup is blocking.";
        } else if (
            errorMsg.includes("Syntax error") ||
            errorMsg.includes("JavaScript evaluation")
        ) {
            recoveryHint =
                "\n\n💡 **Recovery Tip**: Selector syntax error detected. Common fixes:\n1. **Use text-based selectors** instead: `click_text(\"wireless headphones\")` or `click_text(\"Add to cart\")`\n2. **Check attribute quotes**: `div[data-attr=\"value\"]` not `div[data-attr=value]`\n3. **Use simpler selectors**: Try `get_interactive_elements()` to see available elements\n4. **Escape special characters**: Use `\\` before special chars in selectors";
        } else if (errorMsg.includes("Missing required parameter")) {
            recoveryHint =
                "\n\n💡 **Recovery Tip**: A required parameter was missing. Check the tool definition and ensure all required fields are provided.";
        } else if (errorMsg.includes("ExtractionError")) {
            recoveryHint =
                "\n\n💡 **Recovery Tip**: Extraction failed (empty results). The selector is likely wrong.\n1. **Use `get_interactive_elements`** immediately to find the correct selector.\n2. Do NOT retry the same selector.";
        }

        return {
            resultStr: JSON.stringify({ error: errorMsg + recoveryHint }),
            isError: true,
        };
    }

    const rawResult =
        typeof typedResult.result === "string"
            ? typedResult.result
            : JSON.stringify(typedResult.result);

    return { resultStr: rawResult, isError: false };
}

/**
 * Truncates a tool output string to MAX_TOOL_OUTPUT_LENGTH characters.
 *
 * WHY: Tools like `get_state` can return 100k+ characters. Feeding this directly
 * to the LLM would exhaust the context window. We truncate and add a hint telling
 * the LLM to use more specific selectors instead of dumping the whole page.
 *
 * Error messages are never truncated — the LLM needs the full error to recover.
 *
 * @param toolName - The tool that produced the output (for logging).
 * @param resultStr - The raw output string.
 * @returns The (possibly truncated) output string.
 */
export function truncateToolOutput(toolName: string, resultStr: string): string {
    if (resultStr.length <= MAX_TOOL_OUTPUT_LENGTH) return resultStr;

    // Never truncate error messages
    const isError = resultStr.includes('"error":') || resultStr.startsWith("Error:");
    if (isError) return resultStr;

    const truncated =
        resultStr.substring(0, MAX_TOOL_OUTPUT_LENGTH) +
        `\n\n[Tool output truncated from ${resultStr.length} to ${MAX_TOOL_OUTPUT_LENGTH} chars to save context. 💡 TIP: If you don't see what you need, use a more specific selector or filter instead of dumping the whole page.]`;

    console.log(
        `[ToolExecutionService] Truncated ${toolName} output: ${resultStr.length} → ${MAX_TOOL_OUTPUT_LENGTH} chars`
    );
    return truncated;
}

/**
 * Analyzes a tool output and surfaces a "Finding" message to the user if the
 * output contains presentable data (e.g., search results, extracted content).
 *
 * WHY incremental reporting: Without this, the user sees nothing until the agent
 * finishes all tool calls. With it, interesting findings appear immediately.
 *
 * @param toolName - The tool that produced the output.
 * @param resultStr - The raw output string.
 * @param addMessage - Callback to add a message to the agent's history + UI.
 */
/**
 * Analyzes tool output and returns a findings summary if presentable data exists.
 * Does NOT add a message directly to history to avoid UI clutter (Standalone bubbles).
 */
export function reportFinding(
    toolName: string,
    resultStr: string
): { hasPresentableData: boolean; summary: string } | null {
    try {
        const analysisResult = analyzeToolOutput(toolName, resultStr);
        if (analysisResult.hasPresentableData && analysisResult.summary) {
            console.log(
                `[ToolExecutionService] Detected finding: ${analysisResult.summary.substring(0, 50)}...`
            );
            return {
                hasPresentableData: true,
                summary: analysisResult.summary
            };
        }
    } catch (e) {
        console.warn("[ToolExecutionService] Failed to analyze tool output:", e);
    }
    return null;
}

/**
 * Checks if a tool call represents a progress/state update rather than a functional action.
 */
export function isProgressUpdate(toolName: string): boolean {
    const internalTools = [
        'update_progress_summary',
        'create_execution_plan',
        'memory_update_entity'
    ];
    return internalTools.includes(toolName);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
