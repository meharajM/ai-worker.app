/**
 * useAgent.ts — Encapsulates agent reasoning and UI/IPC communication.
 */

import { useCallback, useEffect } from "react";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWhatsAppStore } from "../stores/whatsappStore";
import { type LLMMessage } from "../lib/llm";
import { MemoryReflector } from "../lib/memory-reflector";
import electron from "../lib/electron";

/**
 * State returned by `useAgent`.
 */
export interface UseAgentReturn {
    handleSubmit: (content: string, attachments?: File[], isHeadless?: boolean, whatsappMetadata?: { from: string, id: string, timestamp: number }) => Promise<void>;
}

export function useAgent(): UseAgentReturn {
    const settings = useSettingsStore();

    const handleSubmit = useCallback(
        async (content: string, attachments?: File[], isHeadless?: boolean, whatsappMetadata?: { from: string, id: string, timestamp: number }) => {
            if (!content.trim() && (!attachments || attachments.length === 0)) return;

            const { addMessage, startProcessing } = useChatStore.getState();

            const attachmentData = attachments?.map((file) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const nativePath = (window as any).electron?.utils?.getPathForFile(file)
                    || (file as File & { path?: string }).path
                    || "";
                return {
                    name: file.name,
                    path: nativePath,
                    type: file.type,
                };
            });

            addMessage({ role: "user", content, attachments: attachmentData, whatsappMetadata });

            const originSessionId = useChatStore.getState().activeSessionId ?? "default";
            const abortSignal = startProcessing(originSessionId);

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

            // ── WhatsApp Context Recovery ──────────────────────────────────────
            const extractWaMetadata = () => {
                if (whatsappMetadata) return whatsappMetadata;
                const session = useChatStore.getState().sessions.find(s => s.id === originSessionId);
                if (session) {
                    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user' && m.whatsappMetadata);
                    if (lastUserMsg?.whatsappMetadata) return lastUserMsg.whatsappMetadata;
                }
                return null;
            };

            const activeWaMetadata = extractWaMetadata();
            const originJid = activeWaMetadata?.from || content.match(/^📱 \*\*WhatsApp\*\* \(([^)]+)\):/)?.[1];
            
            const waStore = useWhatsAppStore.getState();
            const isWaModeEnabled = waStore.whatsappEnabled && waStore.connectionState.status === 'connected';
            const targetJid = originJid || (isWaModeEnabled ? waStore.targetPhoneNumber : null);
            
            const isFromWhatsApp = !!activeWaMetadata || (!!originJid && content.startsWith('📱'));
            const shouldMirrorToWhatsApp = isFromWhatsApp || !!(isWaModeEnabled && targetJid);

            try {
                if (shouldMirrorToWhatsApp && targetJid) {
                    console.log('[useAgent] WhatsApp flow detected/enabled. JID:', targetJid);
                    electron.whatsapp.sendPresence(targetJid, "composing").catch(() => {});
                }

                const { AgentRuntime } = await import("../lib/agent-runtime");
                const runtime = new AgentRuntime({
                    settings: settingsForLLM,
                    activeSessionId: originSessionId,
                    signal: abortSignal,
                    isHeadless: isHeadless,
                    whatsappContext: {
                        isConnected: waStore.connectionState.status === 'connected',
                        isEnabled: waStore.whatsappEnabled
                    },
                    onProgressUpdate: (progress?: number, eta?: number, plan?: unknown) => {
                        useChatStore.getState().updateSessionProgress(originSessionId, progress, eta, plan as any);
                    },
                    onMessageUpdate: (id: string, updates: Partial<LLMMessage>) => {
                        useChatStore.getState().updateSessionMessage(originSessionId, id, updates as any);
                    },
                    onMessage: (updates: Omit<LLMMessage, "id" | "timestamp">) => {
                        const { addSessionMessage: addMsg } = useChatStore.getState();
                        const storeMsg: Omit<import('../stores/chatStore').Message, 'id' | 'timestamp'> = {
                            role: updates.role as any,
                            content: typeof updates.content === 'string' 
                                ? updates.content 
                                : Array.isArray(updates.content)
                                    ? updates.content.filter(p => p.type === 'text').map(p => (p as any).text).join('\n')
                                    : '',
                            thought: (updates as any).thought,
                            thought_signature: (updates as any).thought_signature,
                            toolCalls: updates.tool_calls?.map(tc => ({
                                id: tc.id,
                                name: tc.function.name,
                                arguments: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
                            })) as any
                        };
                        const newMsg = addMsg(originSessionId, storeMsg);
                        return typeof newMsg === 'string' ? newMsg : undefined;
                    },
                });

                // Run Agent
                const llmResponse = await runtime.chat(content, attachmentData);
                
                // Final Check Delivery
                if (shouldMirrorToWhatsApp && targetJid) {
                    const finalContent = typeof llmResponse.content === 'string' ? llmResponse.content : '';
                    if (finalContent.trim()) {
                        console.log('[useAgent] Final WhatsApp delivery check...');
                        electron.whatsapp.sendMessage(targetJid, finalContent).catch(() => {});
                    }
                }

                // Fire-and-forget memory reflection
                setTimeout(() => {
                    const session = useChatStore.getState().sessions.find(s => s.id === originSessionId);
                    const history = session?.messages.map(m => ({ role: m.role as any, content: m.content })) || [];
                    MemoryReflector.getInstance().analyze(history, settingsForLLM);
                });

            } catch (error) {
                console.error("[useAgent] Handler error:", error);
                const errorMessage = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
                useChatStore.getState().addSessionMessage(originSessionId, {
                    role: "assistant",
                    content: errorMessage,
                });
                
                // Mirror the error to WhatsApp so the user on the phone isn't left hanging
                if (shouldMirrorToWhatsApp && targetJid) {
                    electron.whatsapp.sendMessage(targetJid, errorMessage).catch(() => {});
                }
            } finally {
                if (shouldMirrorToWhatsApp && targetJid) {
                    electron.whatsapp.sendPresence(targetJid, "paused").catch(() => {});
                }
                const store = useChatStore.getState();
                store.stopProcessing(originSessionId);
                store.updateSessionProgress(originSessionId, undefined, undefined, undefined);
            }
        },
        [settings]
    );

    useEffect(() => {
        const handleAgentAction = (e: CustomEvent) => {
            const { type, content } = e.detail as { type: string; content: string };
            const { activeSessionId, isSessionProcessing } = useChatStore.getState();
            if (type === "continue" && activeSessionId && !isSessionProcessing(activeSessionId)) {
                handleSubmit(content);
            }
            if (type === "regenerate" && activeSessionId && !isSessionProcessing(activeSessionId)) {
                const { sessions, removeMessage } = useChatStore.getState();
                const session = sessions.find((s) => s.id === activeSessionId);
                if (!session || session.messages.length === 0) return;
                const lastMsg = session.messages[session.messages.length - 1];
                if (lastMsg.role === "assistant") {
                    const userMsg = session.messages[session.messages.length - 2];
                    if (userMsg && userMsg.role === "user") {
                        removeMessage(lastMsg.id);
                        removeMessage(userMsg.id);
                        handleSubmit(userMsg.content, undefined, undefined, userMsg.whatsappMetadata);
                    }
                }
            }
        };

        const handleAppSubmit = (e: Event) => {
            const customEvent = e as CustomEvent<{ content: string, whatsappMetadata?: any }>;
            const { activeSessionId, createSession } = useChatStore.getState();
            const content = customEvent.detail?.content;
            const whatsappMetadata = customEvent.detail?.whatsappMetadata;
            if (!content) return;
            let sessionId = activeSessionId;
            if (!sessionId) sessionId = createSession();
            handleSubmit(content, undefined, undefined, whatsappMetadata);
        };

        window.addEventListener("agent-action", handleAgentAction as EventListener);
        window.addEventListener("app:submit-message", handleAppSubmit);
        return () => {
            window.removeEventListener("agent-action", handleAgentAction as EventListener);
            window.removeEventListener("app:submit-message", handleAppSubmit);
        };
    }, [handleSubmit]);

    return { handleSubmit };
}
