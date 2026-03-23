/**
 * shared/ipc-channels.ts — Strictly typed IPC channel names.
 *
 * Responsibilities:
 *   1. Define every IPC channel as a string constant.
 * 
 * Design decision: Avoids silent runtime failures from typos in hardcoded strings. 
 *   Both preload scripts and main process handlers must import these constants.
 * 
 * Consumed by: ipc/plugins.ts (main), preload/index.ts (renderer)
 */

export const IPC = {
    plugins: {
        /** Instructs the Main process to scan and load available plugins. */
        loadAll: 'plugins:load-all',
        /** Returns the list of currently loaded plugins. */
        getLoaded: 'plugins:get-loaded',
        /** Routes a custom tool execution back to the Main process sandbox. */
        executeTool: 'plugins:execute-tool',
        /** Emits an event from the Renderer agent loop to all plugins. */
        emitEvent: 'plugins:emit-event',
    }
} as const;
