/**
 * useAgent — React hook that owns all agent execution logic.
 *
 * Architecture: This is the ONLY place in the UI that knows how to run an agent.
 *   It sits between App.tsx (pure UI) and AgentRuntime (pure business logic).
 *   App.tsx calls `useAgent()` and gets back `handleSubmit` + `pendingConfirmation`.
 *
 * Phase 3 readiness: When we migrate to a backend server, ONLY this file changes.
 *   Replace `new AgentRuntime(...)` with `new RemoteAgentClient(...)` — both
 *   implement the same `IAgentClient` interface. The rest of the app is unaffected.
 *
 * Dependencies:
 *   - agent-runtime.ts: AgentRuntime (the local implementation of IAgentClient)
 *   - chatStore: message history, session management, abort signal
 *   - settingsStore: LLM provider configuration
 *   - memory-reflector.ts: background memory extraction (fire-and-forget)
 *
 * Key design decisions:
 *   - Uses `useChatStore.getState()` (NOT reactive hooks) inside callbacks.
 *     WHY: Callbacks are closures. If we used `useChatStore()` reactive hook,
 *     the closure would capture a stale snapshot of messages. `getState()` always
 *     reads the latest store value at call time.
 *   - `AgentRuntime` is dynamically imported (lazy) to avoid loading the 1800-line
 *     module on app startup. It only loads when the user first submits a message.
 */

import { useState, useCallback, useEffect } from "react";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { type LLMMessage } from "../lib/llm";

/**
 * State returned by `useAgent`.
 * App.tsx destructures this and passes values to child components.
 */
export interface UseAgentReturn {
    /**
     * Call this when the user submits a message (text input or voice).
     * Handles: message history reconstruction, AgentRuntime instantiation,
     * background memory reflection, and error handling.
     *
     * @param content - The user's text message.
     * @param attachments - Optional file attachments (Electron exposes `.path`).
     */
    handleSubmit: (content: string, attachments?: File[], isHeadless?: boolean) => Promise<void>;
}

/**
 * Encapsulates all agent execution logic, extracted from App.tsx.
 *
 * @returns `{ handleSubmit }`
 *
 * @example
 * // In App.tsx:
 * const { handleSubmit } = useAgent();
 * // Pass handleSubmit to <VoiceInput onSubmit={handleSubmit} />
 */
export function useAgent(): UseAgentReturn {
    const settings = useSettingsStore();

    /**
     * Main entry point: processes user input, runs the agent, handles errors.
     *
     * Flow:
     * 1. Guard: ignore empty submissions
     * 2. Mark store as processing (shows spinner, disables input)
     * 3. Add user message to store
     * 4. Reconstruct LLM-format history from store messages (with tool results)
     * 5. Dynamically import AgentRuntime (lazy load)
     * 6. Run agent with callbacks that write back to the store
     * 7. Fire-and-forget: trigger MemoryReflector in background
     * 8. On error: add error message to store
     * 9. Always: mark store as done processing
     */
    const handleSubmit = useCallback(
        async (content: string, attachments?: File[], isHeadless?: boolean) => {
            if (!content.trim() && (!attachments || attachments.length === 0)) return;

            // Destructure store actions. We call setProcessing(true) first so the
            // UI immediately shows the loading state before any async work begins.
            const { addMessage, setProcessing } = useChatStore.getState();
            setProcessing(true);

            // Map File objects to plain metadata. Electron exposes `.path` on File
            // objects, which is not part of the standard Web File API.
            const attachmentData = attachments?.map((file) => ({
                name: file.name,
                path: (file as any).path || "",
                type: file.type,
            }));

            // Add the user's message to the store immediately so it appears in the
            // chat UI before the agent starts processing.
            addMessage({ role: "user", content, attachments: attachmentData });

            // Build a plain settings object to pass to AgentRuntime.
            // WHY not pass the full Zustand store: AgentRuntime lives in lib/ and
            // should not depend on the store shape. Plain objects are also easier
            // to serialize for Phase 3 (sending to a backend).
            const settingsForLLM = {
                preferredProvider: settings.preferredProvider,
                ollamaModel: settings.ollamaModel,
                ollamaBaseUrl: settings.ollamaBaseUrl,
                openaiApiKey: settings.openaiApiKey,
                openaiBaseUrl: settings.openaiBaseUrl,
                openaiModel: settings.openaiModel,
                geminiApiKey: settings.geminiApiKey,
                geminiModel: settings.geminiModel,
                openrouterApiKey: settings.openrouterApiKey,
                openrouterModel: settings.openrouterModel,
            };

            try {
                // ── Step 1: Reconstruct LLM message history ────────────────────────
                // WHY getState() here: We need the freshest messages AFTER addMessage()
                // has been committed to the store. Using the reactive `messages` from
                // the hook closure would give us the pre-addMessage snapshot.
                const freshMessages =
                    useChatStore.getState().getActiveSession()?.messages || [];
                const reconstructedHistory: LLMMessage[] = [];

                for (const m of freshMessages) {
                    // Build the base message object
                    const msg: LLMMessage = {
                        role: m.role as "user" | "assistant" | "system",
                        content: m.content,
                        // Preserve Gemini 2.0 thought signatures for tool-call correctness.
                        // Without this, Gemini 400s with "missing thought_signature".
                        ...(m.thought ? { thought: m.thought } : {}),
                        ...(m.thought_signature ? { thought_signature: m.thought_signature } : {}),
                    };

                    // Attach tool_calls if this message triggered any tool executions
                    if (m.toolCalls) {
                        msg.tool_calls = m.toolCalls.map((tc) => ({
                            id: tc.id,
                            type: "function",
                            function: {
                                name: tc.name,
                                arguments: tc.arguments,
                            },
                        }));
                    }

                    reconstructedHistory.push(msg);

                    // WHY synthetic tool messages: The LLM API requires that every
                    // tool_call in an assistant message is followed by a corresponding
                    // tool result message. The store keeps results on the toolCall object,
                    // so we synthesize the required `role: "tool"` messages here.
                    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
                        for (const tc of m.toolCalls) {
                            if (tc.result !== undefined && tc.result !== null) {
                                reconstructedHistory.push({
                                    role: "tool",
                                    tool_call_id: tc.id,
                                    content: tc.result,
                                });
                            }
                        }
                    }
                }

                // ── Step 2: Get session context ────────────────────────────────────
                const { activeSessionId, sessions } = useChatStore.getState();
                const activeSession = sessions.find((s) => s.id === activeSessionId);

                // ── Step 3: Dynamically import AgentRuntime ────────────────────────
                // WHY dynamic import: AgentRuntime is ~1800 lines and imports many
                // heavy dependencies (LLM clients, MCP, task-decomposer). Lazy loading
                // keeps the initial app bundle small and fast to parse.
                const { AgentRuntime } = await import("../lib/agent-runtime");

                // Track the ID of the "live" assistant message so we can update it
                // in-place as the agent streams partial responses.
                let activeAssistantMessageId: string | null = null;

                // ── Step 4: Instantiate and run the agent ──────────────────────────
                const runtime = new AgentRuntime(
                    {
                        activeSessionId: activeSessionId || "default",
                        workspacePath: activeSession?.workspacePath,
                        settings: settingsForLLM,
                        isHeadless,
                        // Get the abort signal from the store. The store creates a new
                        // AbortController when setProcessing(true) is called.
                        signal: useChatStore.getState().getAbortSignal() || undefined,

                        // Called by AgentRuntime for every new message (user, assistant, tool).
                        // We write each message to the session so it appears in the chat UI
                        // even if the user has navigated to another tab.
                        onMessage: (msg: LLMMessage) => {
                            // Do not add raw tool execution results as standalone chat bubbles.
                            // The tool result is instead mapped to the assistant message's toolCalls.
                            if (msg.role === "tool") {
                                return undefined;
                            }

                            const { addSessionMessage } = useChatStore.getState();

                            // Map LLMMessage → store message shape
                            const storeMsg: any = {
                                role: msg.role,
                                content:
                                    typeof msg.content === "string"
                                        ? msg.content
                                        : Array.isArray(msg.content)
                                            ? msg.content.map((c: any) => c.text || "").join("")
                                            : "",
                            };

                            if (msg.tool_calls) {
                                storeMsg.toolCalls = msg.tool_calls.map((tc) => ({
                                    id: tc.id,
                                    name: tc.function.name,
                                    arguments: tc.function.arguments,
                                }));
                            }

                            // Persist thought/thought_signature so they are included in the
                            // next API call to Gemini — required for tool-calling with reasoning.
                            if (msg.thought) storeMsg.thought = msg.thought;
                            if (msg.thought_signature) storeMsg.thought_signature = msg.thought_signature;

                            // addSessionMessage returns the new Message object
                            const newMsg = addSessionMessage(activeSessionId || "default", storeMsg);
                            if (msg.role === "assistant") {
                                activeAssistantMessageId = newMsg.id;
                            }
                            return newMsg.id;
                        },

                        // Called by AgentRuntime to update an existing message in-place
                        // (e.g., updating the parallel execution status card as sub-agents complete).
                        onMessageUpdate: (id: string, updates: Partial<LLMMessage>) => {
                            const { updateSessionMessage } = useChatStore.getState();
                            const storeUpdates: any = { ...updates };

                            // Flatten content arrays to strings for the store
                            if (Array.isArray(storeUpdates.content)) {
                                storeUpdates.content = storeUpdates.content
                                    .map((c: any) => c.text || "")
                                    .join("");
                            }

                            // The store doesn't have a "tool" role concept — skip role updates
                            if (storeUpdates.role === "tool") delete storeUpdates.role;

                            updateSessionMessage(activeSessionId || "default", id, storeUpdates);
                        },

                        onProgressUpdate: (progress?: number, eta?: number, plan?: any) => {
                            const { updateSessionProgress } = useChatStore.getState();
                            updateSessionProgress(activeSessionId || "default", progress, eta, plan);
                        }
                    },
                    reconstructedHistory // Pass reconstructed history as initial context
                );

                // ── Step 5: Fire-and-forget background memory reflection ───────────
                // WHY concurrent: We start the reflector BEFORE awaiting runtime.chat()
                // so it captures the user's intent even if the agent gets stuck in a
                // confirmation loop or fails early.
                // WHY dynamic import: Same reason as AgentRuntime — lazy load to keep
                // the initial bundle small.
                import("../lib/memory-reflector").then(({ MemoryReflector }) => {
                    const currentMessages =
                        useChatStore.getState().getActiveSession()?.messages || [];
                    const historyForReflector: LLMMessage[] = currentMessages.map((m) => ({
                        role: m.role as "user" | "assistant" | "system",
                        content: m.content,
                    }));
                    MemoryReflector.getInstance().analyze(historyForReflector, settingsForLLM);
                });

                // ── Step 6: Run the agent ──────────────────────────────────────────
                await runtime.chat(content, attachmentData);
            } catch (error) {
                console.error("[useAgent] Handler error:", error);
                const { activeSessionId, addSessionMessage } = useChatStore.getState();
                addSessionMessage(activeSessionId || "default", {
                    role: "assistant",
                    content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                });
            } finally {
                // Always clear the processing state, even on error, so the UI
                // re-enables the input and hides the spinner.
                const storeState = useChatStore.getState();
                storeState.setProcessing(false);
                // Gap 1 fix: clear session-level progress so the bar never lingers
                // across new messages or after an early abort/error.
                // WHY read activeSessionId from store here: the try-block's `activeSessionId`
                // may not be in scope if the error occurred before Step 2. Reading from the
                // store is always safe and correct.
                const sessionToClear = storeState.activeSessionId || "default";
                storeState.updateSessionProgress(sessionToClear, undefined, undefined, undefined);
            }
        },
        // WHY settings in deps: If the user changes LLM provider mid-session,
        // the next handleSubmit call should use the new settings.
        [settings]
    );

    // ── Listen for action button events from MessageBubble ───────────────────
    // MessageBubble renders action buttons (Continue, Regenerate) and fires
    // custom DOM events when clicked. We listen here and delegate to handleSubmit.
    //
    // WHY DOM events instead of props: MessageBubble is deep in the component
    // tree and doesn't have direct access to handleSubmit. Custom events let
    // it communicate upward without prop drilling.
    useEffect(() => {
        const handleAgentAction = (e: CustomEvent) => {
            const { type, content } = e.detail;
            const { isProcessing } = useChatStore.getState();

            if (type === "continue" && !isProcessing) {
                handleSubmit(content);
            }

            if (type === "regenerate" && !isProcessing) {
                // Regenerate: remove the last assistant + user message pair, then
                // re-submit the user's original content.
                const { sessions, activeSessionId, removeMessage } =
                    useChatStore.getState();
                const session = sessions.find((s) => s.id === activeSessionId);
                if (!session || session.messages.length === 0) return;

                const msgs = session.messages;
                const lastMsg = msgs[msgs.length - 1];

                if (lastMsg.role === "assistant") {
                    const userMsg = msgs[msgs.length - 2];
                    if (userMsg && userMsg.role === "user") {
                        const textToResubmit = userMsg.content;
                        removeMessage(lastMsg.id);
                        removeMessage(userMsg.id);
                        handleSubmit(textToResubmit);
                    }
                }
            }
        };

        window.addEventListener("agent-action", handleAgentAction as EventListener);
        return () =>
            window.removeEventListener("agent-action", handleAgentAction as EventListener);
    }, [handleSubmit]);

    return { handleSubmit };
}
