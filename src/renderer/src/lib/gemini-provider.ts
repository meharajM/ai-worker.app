/**
 * gemini-provider.ts — All Gemini API and Antigravity gateway logic.
 *
 * Extracted from llm.ts so that Gemini/Antigravity changes are isolated
 * to this file and do not cause merge conflicts with other provider changes.
 *
 * Public surface consumed by llm.ts:
 *   - getGeminiSettings()
 *   - checkGemini()
 *   - testGeminiConnection()
 *   - callGemini()
 */

import { LLM_CONFIG } from './constants';
import type { LLMMessage, LLMTool, LLMResponse, LLMSettings, LLMContentPart } from './types';

// ── Internal type ─────────────────────────────────────────────────────────────

export interface GeminiProviderStatus {
    available: boolean;
    model?: string;
    error?: string;
    models?: string[];
    modelsEndpointAvailable?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract plain text from multimodal content (for system instructions etc.). */
function extractText(content: string | LLMContentPart[]): string {
    if (typeof content === 'string') return content;
    return content.map(p => p.type === 'text' ? p.text : '').join('\n');
}

function safeParseJSON(str: string): unknown {
    try { return JSON.parse(str); } catch { return {}; }
}

function ensureRecord(v: unknown): Record<string, unknown> {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return {};
}

// ── Settings ──────────────────────────────────────────────────────────────────

/**
 * Resolves Gemini credentials from settings / secure store / Antigravity OAuth.
 * Priority: settings object → electron secure store → Antigravity (no-key path).
 */
export async function getGeminiSettings(settings?: LLMSettings): Promise<{
    apiKey: string;
    baseUrl: string;
    model: string;
    antigravity: import('./antigravity-gateway').AntigravityCredentials | null;
}> {
    const electron = (await import('./electron')).default;
    const { getAntigravityCredentials } = await import('./antigravity-gateway');

    const apiKey =
        settings?.geminiApiKey ||
        (await electron.secure.get('gemini_api_key')).value ||
        '';
    const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;
    const model = settings?.geminiModel || LLM_CONFIG.GEMINI.DEFAULT_MODEL;
    const antigravity = await getAntigravityCredentials();

    return { apiKey, baseUrl, model, antigravity };
}

// ── Provider check ────────────────────────────────────────────────────────────

/**
 * Checks whether Gemini is configured and reachable.
 * Returns available=true if either an API key or Antigravity OAuth is present.
 */
export async function checkGemini(settings?: LLMSettings): Promise<GeminiProviderStatus> {
    const { apiKey, model, antigravity } = await getGeminiSettings(settings);

    if (!apiKey && !antigravity) {
        return { available: false, error: 'Sign in with Google or set Gemini API Key' };
    }

    // Antigravity path: gateway doesn't expose /models — use the known model list.
    if (antigravity && !apiKey) {
        const { SUPPORTED_GATEWAY_MODELS } = await import('./antigravity-gateway');
        const models = Array.from(SUPPORTED_GATEWAY_MODELS);
        return {
            available: true,
            model: models.includes(model as any) ? model : models[0],
            models,
            modelsEndpointAvailable: false,
        };
    }

    // API-key path: fetch the available models list.
    try {
        const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;
        const response = await fetch(`${baseUrl}/models?key=${apiKey}`);

        if (response.ok) {
            const data = await response.json();
            const models = (data.models || [])
                .filter((m: { name: string }) => m.name.includes('gemini'))
                .map((m: { name: string }) => m.name.split('/').pop())
                .filter(Boolean) as string[];

            return {
                available: true,
                model: models.find(m => m === model) || models[0] || model,
                models,
                modelsEndpointAvailable: true,
            };
        }

        return { available: true, model, models: [model], modelsEndpointAvailable: false, error: 'Could not fetch Gemini models list' };
    } catch {
        return { available: true, model, models: [model], modelsEndpointAvailable: false };
    }
}

// ── Connection test ───────────────────────────────────────────────────────────

/**
 * Tests the Gemini connection.
 * Falls back to Antigravity gateway when no API key is provided.
 */
export async function testGeminiConnection(
    apiKey: string,
    model: string,
    settings?: LLMSettings
): Promise<{
    success: boolean;
    error?: string;
    models?: string[];
    modelsEndpointAvailable?: boolean;
}> {
    try {
        if (apiKey) {
            const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;
            const response = await fetch(`${baseUrl}/models?key=${apiKey}`);

            if (response.ok) {
                const data = await response.json();
                const models = (data.models || [])
                    .filter((m: { name: string }) => m.name.includes('gemini'))
                    .map((m: { name: string }) => m.name.split('/').pop())
                    .filter(Boolean) as string[];
                return { success: true, models, modelsEndpointAvailable: true };
            }

            const error = await response.json().catch(() => ({}));
            return { success: false, error: (error as any).error?.message || `API error: ${response.statusText}` };
        }

        // No API key — try Antigravity
        const { getAntigravityCredentials, buildGatewayRequest, SUPPORTED_GATEWAY_MODELS } = await import('./antigravity-gateway');
        const antigravity = await getAntigravityCredentials();

        if (antigravity) {
            const payload = {
                contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                generationConfig: { maxOutputTokens: 1 }
            };
            const request = buildGatewayRequest(antigravity, model, payload);
            const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body });

            if (response.ok) {
                return { success: true, models: Array.from(SUPPORTED_GATEWAY_MODELS), modelsEndpointAvailable: false };
            }
            const error = await response.json().catch(() => ({}));
            return { success: false, error: (error as any).error?.message || `Gateway error: ${response.statusText}` };
        }

        return { success: false, error: 'No API key provided and not signed in with Google.' };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Connection failed' };
    }
}

// ── Chat caller ───────────────────────────────────────────────────────────────

/**
 * Sends a chat request to Gemini via either:
 *   1. Antigravity gateway (OAuth, higher rate limits) — preferred when signed in
 *   2. Standard Gemini REST API (API key)
 *
 * Handles full message history conversion (including multimodal content,
 * tool calls/results, and Gemini 2.0 thought_signature echo-back).
 */
export async function callGemini(
    messages: LLMMessage[],
    tools?: LLMTool[],
    settings?: LLMSettings,
    abortSignal?: AbortSignal
): Promise<LLMResponse> {
    const { apiKey, model, antigravity } = await getGeminiSettings(settings);
    const { buildGatewayRequest, unwrapGatewayResponse, sanitizeToolSchema } = await import('./antigravity-gateway');
    const baseUrl = LLM_CONFIG.GEMINI.BASE_URL;

    // Build a lookup: tool_call_id → function name (needed to populate functionResponse.name)
    const toolIdToName = new Map<string, string>();
    messages.forEach(m => {
        if (m.role === 'assistant' && m.tool_calls) {
            m.tool_calls.forEach((tc: any) => {
                if (tc.id && tc.function?.name) toolIdToName.set(tc.id, tc.function.name);
            });
        }
    });

    // Convert OpenAI-style message history to Gemini `contents` array
    const contents: any[] = [];
    const validMessages = messages.filter(m => m.role !== 'system');

    for (const m of validMessages) {
        let role: 'user' | 'model' | null = null;
        if (m.role === 'assistant') role = 'model';
        if (m.role === 'user' || m.role === 'tool') role = 'user';
        if (!role) continue;

        const parts: any[] = [];

        // Text / image content
        if (m.role !== 'tool' && m.content) {
            if (typeof m.content === 'string') {
                parts.push({ text: m.content });
            } else {
                m.content.forEach(part => {
                    if (part.type === 'text') {
                        parts.push({ text: part.text });
                    } else if (part.type === 'image_url') {
                        const matches = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
                        if (matches) {
                            parts.push({ inline_data: { mime_type: matches[1], data: matches[2] } });
                        }
                    }
                });
            }
        }

        // Gemini 2.0 Thinking: echo thought_signature back to the API.
        // Without this, Gemini returns HTTP 400 "missing thought_signature in functionCall parts".
        if (m.role === 'assistant' && (m as any).thought) {
            parts.push({
                thought: (m as any).thought,
                thought_signature: (m as any).thought_signature
            });
        }

        // Tool calls (assistant → model)
        if (m.role === 'assistant' && (m as any).tool_calls) {
            (m as any).tool_calls.forEach((tc: any) => {
                parts.push({
                    functionCall: {
                        name: tc.function.name,
                        args: typeof tc.function.arguments === 'string'
                            ? (() => {
                                try { return safeParseJSON(tc.function.arguments); }
                                catch { console.warn(`[callGemini] Failed to parse args for ${tc.function.name}`); return { _parse_error: 'Invalid JSON' }; }
                            })()
                            : tc.function.arguments
                    }
                });
            });
        }

        // Tool results (tool role → user turn with functionResponse)
        if (m.role === 'tool') {
            const resultText = typeof m.content === 'string'
                ? m.content
                : Array.isArray(m.content)
                    ? extractText(m.content)
                    : JSON.stringify(m.content ?? '');

            const fnName = (m as any).name || (m.tool_call_id ? toolIdToName.get(m.tool_call_id) : 'unknown_tool');
            parts.push({ functionResponse: { name: fnName, response: { result: resultText } } });
        }

        if (parts.length === 0) continue;

        // Merge consecutive messages with the same role (Gemini API requirement)
        if (contents.length > 0 && contents[contents.length - 1].role === role) {
            contents[contents.length - 1].parts.push(...parts);
        } else {
            contents.push({ role, parts });
        }
    }

    // System instruction
    const systemMessage = messages.find(m => m.role === 'system');
    const systemInstructionText = systemMessage ? extractText(systemMessage.content) : undefined;

    // Tool declarations (strip JSON Schema meta-props the gateway rejects)
    const toolConfig = tools && tools.length > 0 ? {
        function_declarations: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeToolSchema(t.parameters)
        }))
    } : undefined;

    const geminiPayload: Record<string, unknown> = {
        contents,
        systemInstruction: systemInstructionText ? { parts: [{ text: systemInstructionText }] } : undefined,
        tools: toolConfig ? [{ function_declarations: toolConfig.function_declarations }] : undefined,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    };

    // ── Route: Antigravity gateway → standard API → error ───────────────────────
    let data: any;
    if (antigravity) {
        const gw = buildGatewayRequest(antigravity, model, geminiPayload);
        console.log('[callGemini] Using Antigravity gateway proxy');
        const result = await (await import('./electron')).default.antigravity.callGateway(gw.url, gw.headers, gw.body);
        data = unwrapGatewayResponse(result);
    } else if (apiKey) {
        const response = await fetch(`${baseUrl}/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortSignal,
            body: JSON.stringify(geminiPayload)
        });

        if (!response.ok) {
            const errorDetails = await response.json().catch(() => ({}));
            throw new Error(`Gemini API error: ${response.statusText}. ${JSON.stringify(errorDetails)}`);
        }
        data = await response.json();
    } else {
        throw new Error('No Gemini authentication available. Sign in with Google or set a Gemini API key.');
    }

    // ── Parse response ───────────────────────────────────────────────────────────
    const candidate = data.candidates?.[0];
    const responseParts: any[] = candidate?.content?.parts || [];

    // Text (exclude thought parts, which carry a `thought` key not `text`)
    const content = responseParts.find((p: any) => p.text && !p.thought)?.text || '';

    // Gemini 2.0 reasoning — must be stored and echoed back in the next turn
    const thoughtPart = responseParts.find((p: any) => p.thought);
    const thought = thoughtPart?.thought as string | undefined;
    const thoughtSignature = thoughtPart?.thought_signature as string | undefined;

    const toolCalls = responseParts
        .filter((p: any) => p.functionCall)
        .map((p: any) => ({
            id: `gemini-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            name: p.functionCall.name,
            arguments: ensureRecord(p.functionCall.args)
        }));

    return {
        content,
        thought,
        thought_signature: thoughtSignature,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        provider: 'gemini',
        model
    };
}
