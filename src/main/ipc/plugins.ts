/**
 * main/ipc/plugins.ts — IPC handlers for bridging the Renderer agent loop to PluginManager.
 *
 * Responsibilities:
 *   1. Register an IPC handler for every constant defined in IPC.plugins.
 *   2. Delegate completely to the PluginManager service without holding domain logic.
 *
 * Design decision: strictly adheres to process-architecture.md. Handlers are one-liners
 *   that sanitize inputs and invoke standard service methods.
 *
 * Consumed by: ipc/index.ts
 */

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { PluginManager } from '../services/PluginManager';

export function registerPluginHandlers(): void {
    const manager = PluginManager.getInstance();

    ipcMain.handle(IPC.plugins.loadAll, async () => {
        return await manager.loadPlugins();
    });

    ipcMain.handle(IPC.plugins.getLoaded, () => {
        return manager.getLoadedPlugins();
    });

    ipcMain.handle(IPC.plugins.executeTool, async (_event, pluginId: unknown, toolName: unknown, args: unknown) => {
        if (typeof pluginId !== 'string' || typeof toolName !== 'string') {
            throw new Error('Invalid pluginId or toolName argument; must be strings.');
        }
        return await manager.executeTool(pluginId, toolName, args as Record<string, unknown>);
    });

    ipcMain.handle(IPC.plugins.emitEvent, async (_event, eventName: unknown, payload: unknown) => {
        if (typeof eventName !== 'string') {
            throw new Error('Invalid eventName; must be a string.');
        }
        await manager.emitEvent(eventName, payload);
        return { success: true };
    });
}
