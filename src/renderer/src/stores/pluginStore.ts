/**
 * renderer/src/stores/pluginStore.ts — Zustand store for managing OpenCode compatibility plugins.
 *
 * Responsibilities:
 *   1. Track the globally loaded plugins bridged from the Main process via IPC.
 *   2. Provide actions to refresh the plugin list and notify the Agent of available tools.
 *
 * Design decision: strictly adheres to zustand-stores.md. Uses explicit immutable updates
 *   and exports a custom hook using `create`.
 *
 * Consumed by: agent-runtime.ts, UI components.
 */

import { create } from 'zustand';
import type { LoadedPlugin } from '../../../shared/types/plugins';

interface PluginState {
    plugins: LoadedPlugin[];
    isLoading: boolean;
    error: string | null;
    
    // Actions
    fetchPlugins: () => Promise<void>;
    getTools: () => any[];
}

export const usePluginStore = create<PluginState>((set, get) => ({
    plugins: [],
    isLoading: false,
    error: null,

    /**
     * Fetches the populated list of loaded plugins from the Main process Node sandbox.
     */
    fetchPlugins: async () => {
        set({ isLoading: true, error: null });
        try {
            // @ts-ignore - typing dynamically injected into window.electron via preload
            const loaded = await window.electron.plugins.loadAll();
            set({ plugins: loaded, isLoading: false });
        } catch (error: any) {
            set({ error: error?.message || 'Failed to fetch plugins from Main process', isLoading: false });
        }
    },

    /**
     * Aggregates all registered custom tools across every loaded plugin.
     * @returns A unified array of PluginToolAdapter definitions.
     */
    getTools: () => {
        const { plugins } = get();
        return plugins.flatMap(p => p.tools);
    }
}));
