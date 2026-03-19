import { useWhatsAppStore } from '../stores/whatsappStore';
import { useChatStore } from '../stores/chatStore';
import { type LLMMessage } from './llm';
import electron from './electron';

/**
 * Extracts and resolves the target WhatsApp JID.
 * It first checks if the prompt is an incoming remote message prefixed with the WhatsApp identifier.
 * If not, it falls back to the active user's JID if 'WhatsApp Mode' is toggled on.
 */
export const resolveWhatsAppTarget = (text: string): string | null => {
    let jid: string | null = null;
    
    if (text && typeof text === 'string') {
        const patterns = [
            /📱 \*\*WhatsApp\*\* \(([^)]+)\):/,
            /📱 WhatsApp \(([^)]+)\):/,
            /WhatsApp.*?\((\+?[^)]+)\):/, // Handle LID or numbers
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                jid = match[1];
                console.log(`[WhatsAppIntegration] Extracted JID from message: ${jid}`);
                break;
            }
        }
    }
    
    const waState = useWhatsAppStore.getState();
    const isWaConnected = waState.whatsappEnabled && waState.connectionState.status === "connected";
    
    // Fallback to active WhatsApp Mode if enabled
    if (!jid && isWaConnected && waState.connectionState.phoneNumber) {
        jid = waState.connectionState.phoneNumber;
        console.log(`[WhatsAppIntegration] Falling back to global target phone: ${jid}`);
    }
    
    if (jid && !isWaConnected) {
        console.warn(`[WhatsAppIntegration] Found JID ${jid} but WhatsApp mode is disabled or disconnected. (Enabled: ${waState.whatsappEnabled}, Status: ${waState.connectionState.status})`);
    }

    // Ensure we only return a JID if the socket is actually connected and mode is valid
    const result = isWaConnected ? jid : null;
    if (result) {
        console.log(`[WhatsAppIntegration] Resolved final target JID: ${result}`);
    }
    return result;
};

/**
 * Returns the mobile-formatting system prompt to be invisibly injected 
 * into the agent's context whenever it is handling a WhatsApp message.
 */
export const getWhatsAppSystemPrompt = (): LLMMessage => ({
    role: "system",
    content: "WHATSAPP MODE ACTIVE: Keep responses concise, well-formatted for mobile screens, and use emojis."
});

/**
 * Convenience methods for presence updates.
 */
export const setWhatsAppTyping = (jid: string) => {
    electron.whatsapp.sendPresence(jid, "composing")
        .catch(err => console.error("[WhatsApp] Failed to send typing presence:", err));
};

export const setWhatsAppPaused = (jid: string) => {
    electron.whatsapp.sendPresence(jid, "paused")
        .catch(err => console.error("[WhatsApp] Failed to send paused presence:", err));
};

/**
 * Safely parses the LLM output (accounting for tool strings or text arrays)
 * and sends the final string to the designated JID over IPC.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sendWhatsAppResponse = (targetJid: string, llmResponse: any, originSessionId: string) => {
    let responseText = '';

    if (typeof llmResponse.content === 'string') {
        responseText = llmResponse.content;
    } else if (Array.isArray(llmResponse.content)) {
        responseText = llmResponse.content
            .filter((part: { type: string; text?: string }) => part.type === 'text')
            .map((part: { type: string; text?: string }) => part.text)
            .join('\n');
    }
    
    if (responseText) {
        console.log('[useAgent] Final WhatsApp delivery check...');
        electron.whatsapp.sendMessage(targetJid, responseText)
            .catch(err => console.error("[WhatsApp] Failed to send response:", err));
    } else {
        // Fallback: try to retrieve the last plain assistant text from the store
        const finalMessages = useChatStore.getState().sessions.find(s => s.id === originSessionId)?.messages ?? [];
        const lastAssistantMessage = finalMessages.slice().reverse().find(m => m.role === "assistant" && (!m.toolCalls || m.toolCalls.length === 0));
        
        if (lastAssistantMessage && lastAssistantMessage.content) {
            console.log('[useAgent] Final WhatsApp delivery check...');
            electron.whatsapp.sendMessage(targetJid, lastAssistantMessage.content)
                .catch(err => console.error("[WhatsApp] Fallback failed to send response:", err));
        }
    }
};
