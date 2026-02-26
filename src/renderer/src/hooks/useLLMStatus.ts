/**
 * useLLMStatus — React hook that tracks LLM provider availability.
 *
 * Architecture: Used only by App.tsx to pass `llmStatus` to the Header component.
 *   This hook has NO knowledge of the agent or chat logic.
 *   It purely answers: "Which LLM is available right now?"
 *
 * Dependencies:
 *   - llm.ts: `getAvailableProviders` (polls all configured providers)
 *   - llm.ts: `subscribeToWebLLMStatus` (real-time WebLLM loading events)
 *   - settingsStore: reads current user LLM configuration
 *
 * Phase 3 note: This hook stays in the frontend unchanged. LLM status
 *   will still be checked locally (even in cloud mode, we need to know
 *   if the bundled backend is reachable).
 */

import React, { useState, useCallback, useEffect } from "react";
import {
    getAvailableProviders,
    subscribeToWebLLMStatus,
    type WebLLMStatus,
} from "../lib/llm";
import { useSettingsStore } from "../stores/settingsStore";

/** Shape of the LLM status returned by this hook. */
export interface LLMStatus {
    /** Human-readable provider name, e.g. "OpenAI (gpt-4o)" or null if none available. */
    provider: string | null;
    /** Whether the provider is ready to accept requests right now. */
    available: boolean;
}

/**
 * Reads all LLM provider settings, polls availability, and subscribes to
 * real-time WebLLM loading events. Returns the current best available provider.
 *
 * @param currentView - The active UI view. When "settings" is active, polling
 *   is suppressed to avoid duplicate checks (SettingsPanel does its own checking).
 *
 * @returns `{ llmStatus }` — the current provider name and availability flag.
 *
 * @example
 * const { llmStatus } = useLLMStatus(currentView);
 * // llmStatus = { provider: "On-Device (Llama-3)", available: true }
 */
export function useLLMStatus(currentView: string): { llmStatus: LLMStatus } {
    const settings = useSettingsStore();

    const [llmStatus, setLlmStatus] = useState<LLMStatus>({
        provider: null,
        available: false,
    });

    // Ref to prevent duplicate concurrent requests — if a check is already in
    // flight, new callers wait for it rather than firing another fetch.
    const checkLLMRef = React.useRef<Promise<void> | null>(null);

    /**
     * Checks all configured LLM providers and updates `llmStatus`.
     * Priority order: WebLLM (on-device) > Ollama > Gemini > OpenRouter > OpenAI.
     *
     * WHY useCallback: `checkLLM` is used as a dependency in multiple useEffects.
     * Memoizing it prevents infinite re-render loops when settings change.
     */
    const checkLLM = useCallback(async () => {
        // Skip when in settings view — SettingsPanel does its own LLM check,
        // and running both simultaneously causes flickering status indicators.
        if (currentView === "settings") return;

        // Prevent duplicate concurrent requests. If a check is already running,
        // return the same promise so callers share the result.
        if (checkLLMRef.current) return checkLLMRef.current;

        const promise = (async () => {
            try {
                // Build a plain settings object — we don't pass the full Zustand store
                // to avoid coupling llm.ts to the store shape.
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
                    browserModel: settings.browserModel,
                };

                const providers = await getAvailableProviders(settingsForLLM);

                // ── Priority resolution ──────────────────────────────────────────────
                // WebLLM (on-device) is checked first. If it's loading, we show a
                // "Loading..." state (available: false) so the user knows it's coming.
                if (providers.browser.available) {
                    if (providers.browser.isLoaded) {
                        setLlmStatus({ provider: `On-Device (${providers.browser.model})`, available: true });
                    } else if (providers.browser.isLoading) {
                        setLlmStatus({ provider: `On-Device (Loading...)`, available: false });
                    } else if (providers.ollama.available) {
                        setLlmStatus({ provider: `Ollama (${providers.ollama.model})`, available: true });
                    } else if (providers.gemini.available) {
                        setLlmStatus({ provider: `Gemini (${providers.gemini.model})`, available: true });
                    } else if (providers.openrouter.available) {
                        setLlmStatus({ provider: `OpenRouter (${providers.openrouter.model})`, available: true });
                    } else if (providers.openai.available) {
                        setLlmStatus({ provider: `OpenAI (${providers.openai.model})`, available: true });
                    } else {
                        setLlmStatus({ provider: null, available: false });
                    }
                } else if (providers.ollama.available) {
                    setLlmStatus({ provider: `Ollama (${providers.ollama.model})`, available: true });
                } else if (providers.gemini.available) {
                    setLlmStatus({ provider: `Gemini (${providers.gemini.model})`, available: true });
                } else if (providers.openrouter.available) {
                    setLlmStatus({ provider: `OpenRouter (${providers.openrouter.model})`, available: true });
                } else if (providers.openai.available) {
                    setLlmStatus({ provider: `OpenAI (${providers.openai.model})`, available: true });
                } else {
                    setLlmStatus({ provider: null, available: false });
                }
            } catch (error) {
                console.error("[useLLMStatus] Error checking LLM:", error);
                setLlmStatus({ provider: null, available: false });
            } finally {
                // Always clear the in-flight ref so the next call can proceed.
                checkLLMRef.current = null;
            }
        })();

        checkLLMRef.current = promise;
        return promise;
    }, [
        // Re-create checkLLM whenever any relevant setting changes so the
        // debounced effect below fires a fresh check.
        settings.preferredProvider,
        settings.ollamaModel,
        settings.ollamaBaseUrl,
        settings.openaiApiKey,
        settings.openaiBaseUrl,
        settings.openaiModel,
        settings.geminiApiKey,
        settings.geminiModel,
        settings.openrouterApiKey,
        settings.openrouterModel,
        settings.browserModel,
        currentView,
    ]);

    // ── Effect 1: Debounced check on settings change ─────────────────────────
    // WHY debounce (500ms): Settings panel can fire many rapid changes as the
    // user types an API key. Without debounce we'd hammer the provider APIs.
    useEffect(() => {
        const timer = setTimeout(() => { checkLLM(); }, 500);
        return () => clearTimeout(timer);
    }, [checkLLM]);

    // ── Effect 2: Periodic polling every 60 seconds ───────────────────────────
    // Catches cases where a provider becomes available after the app loads
    // (e.g., user starts Ollama in the background).
    useEffect(() => {
        if (currentView === "settings") return; // SettingsPanel handles its own polling
        const interval = setInterval(() => { checkLLM(); }, 60_000);
        return () => clearInterval(interval);
    }, [checkLLM, currentView]);

    // ── Effect 3: Real-time WebLLM subscription ───────────────────────────────
    // WebLLM fires events as the model downloads/loads. We update the status
    // immediately so the user sees "Loading 45%..." without waiting for the poll.
    useEffect(() => {
        const unsubscribe = subscribeToWebLLMStatus((status: WebLLMStatus) => {
            if (status.isLoaded && status.currentModel) {
                setLlmStatus({ provider: `On-Device (${status.currentModel})`, available: true });
            } else if (status.isLoading || status.backgroundDownload) {
                setLlmStatus({
                    provider: `On-Device (Loading ${status.loadingProgress.toFixed(0)}%)`,
                    available: false, // Not ready yet — show as inactive
                });
            } else {
                // WebLLM is neither loaded nor loading — fall back to regular provider check.
                checkLLM();
            }
        });
        return () => unsubscribe();
    }, [checkLLM]);

    return { llmStatus };
}
