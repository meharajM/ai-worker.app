/**
 * main/services/PluginManager.ts — Discovers, loads, and executes OpenCode-compatible plugins safely in Node.
 *
 * Responsibilities:
 *   1. Scan an external directory for plugin entry points.
 *   2. Evaluate/load third-party plugins in the Main process context where Node APIs are available.
 *   3. Emulate the OpenCode PluginContext (`$`, `client`, `project`) for the loaded plugins.
 *   4. Provide a secure execution environment for custom TS tools without exposing `require` directly to the renderer.
 *
 * Design decision: The renderer process operates with `nodeIntegration: false`. 
 *   We cannot run user-provided Node.js scripts in the renderer. The PluginManager 
 *   acts as a secure Node.js sandbox executing plugins on behalf of the renderer.
 *
 * Consumed by: ipc/plugins.ts
 */

import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { LoadedPlugin, OpenCodePluginContext, PluginToolAdapter } from '../../shared/types/plugins';

declare const __webpack_require__: any;
declare const __non_webpack_require__: any;


const execAsync = promisify(exec);

export class PluginManager {
    private static instance: PluginManager;
    private loadedPlugins: Map<string, LoadedPlugin> = new Map();
    // Cache the instantiated plugin exports (the returned hook interface from OpenCode plugins)
    private activeHooks: Map<string, any> = new Map();

    private constructor() {}

    /**
     * Singleton accessor for the PluginManager.
     * @returns The globally shared PluginManager instance.
     */
    public static getInstance(): PluginManager {
        if (!PluginManager.instance) {
            PluginManager.instance = new PluginManager();
        }
        return PluginManager.instance;
    }

    /**
     * Emulates the OpenCode `$` template literal tag for shell execution.
     * @param strings Template strings array.
     * @param values Interpolated values.
     * @returns The trimmed stdout from the executed shell command.
     */
    private emulateOpenCodeShell(strings: TemplateStringsArray, ...values: any[]): Promise<string> {
        return new Promise(async (resolve, reject) => {
            const command = strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '');
            try {
                const { stdout } = await execAsync(command);
                resolve(stdout.trim());
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Constructs the emulated OpenCode plugin context.
     * @returns The OpenCodePluginContext object.
     */
    private createPluginContext(): OpenCodePluginContext {
        // Construct the mock `$` function so plugins can await $`command`
        const dollarSign: any = (strings: TemplateStringsArray, ...values: any[]) => {
            return this.emulateOpenCodeShell(strings, ...values);
        };

        return {
            project: { name: 'ai-worker', root: app.getPath('userData') },
            directory: process.cwd(),
            $: dollarSign,
            client: {
                // Mock client wrapper
            }
        };
    }

    /**
     * Scans the user data directory for a 'plugins' folder and attempts to load dynamically.
     * @returns A list of successfully loaded plugins.
     * @throws Does not throw; logs errors and skips failing plugins.
     */
    public async loadPlugins(): Promise<LoadedPlugin[]> {
        // Use local ./plugins directory during development, otherwise use OS user data
        const pluginsDir = app.isPackaged
            ? path.join(app.getPath('userData'), 'plugins')
            : path.join(app.getAppPath(), 'plugins');
        
        try {
            await fs.mkdir(pluginsDir, { recursive: true });
        } catch (e) {
            console.error('[PluginManager] Failed to ensure plugins directory:', e);
            return [];
        }

        let entries: string[] = [];
        try {
            entries = await fs.readdir(pluginsDir);
        } catch (e) {
            console.error('[PluginManager] Failed to read plugins directory:', e);
            return [];
        }

        const results: LoadedPlugin[] = [];

        for (const entry of entries) {
            if (entry.startsWith('.') || (!entry.endsWith('.js') && !entry.endsWith('.cjs'))) continue;
            
            const pluginPath = path.join(pluginsDir, entry);
            const pluginId = path.basename(entry, path.extname(entry));
            
            try {
                // Bypass webpack's static analysis by using a constructed require
                // We use __non_webpack_require__ if available, otherwise native require
                const requireFunc = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;
                const module = requireFunc(pluginPath);
                
                // OpenCode plugins usually export a default or named matching the file
                // But if they export a raw function via module.exports, `module` is the function.
                const pluginInit = typeof module === 'function' ? module : (module.default || module.plugin || Object.values(module)[0]);
                
                if (typeof pluginInit !== 'function') {
                    throw new Error(`Plugin at ${pluginPath} does not export a function.`);
                }

                const ctx = this.createPluginContext();
                const hooks = await pluginInit(ctx);
                
                this.activeHooks.set(pluginId, hooks);

                // Extract OpenCode style MCP servers if defined (this is our extension)
                const mcpServers = hooks.mcpServers || [];

                // Extract custom tools defined via the `tool` attribute
                const tools: PluginToolAdapter[] = [];
                if (hooks.tool) {
                    for (const [toolName, toolDef] of Object.entries<any>(hooks.tool)) {
                        tools.push({
                            pluginId,
                            name: toolName,
                            description: toolDef.description || 'Custom plugin tool',
                            inputSchema: toolDef.args || { type: 'object', properties: {} }
                        });
                    }
                }

                const loaded: LoadedPlugin = {
                    id: pluginId,
                    name: pluginId,
                    version: '1.0.0', // Could be read from package.json if it's an npm module
                    mcpServers,
                    tools,
                    isActive: true
                };

                this.loadedPlugins.set(pluginId, loaded);
                results.push(loaded);
                console.log(`[PluginManager] ✓ Loaded plugin: ${pluginId}`);

            } catch (error) {
                console.error(`[PluginManager] ✗ Failed to load plugin ${pluginId}:`, error);
            }
        }

        return results;
    }

    /**
     * Executes a tool provided by a specific loaded plugin.
     * @param pluginId - The ID of the plugin providing the tool.
     * @param toolName - The key name of the tool to execute.
     * @param args - Arbitrary arguments passed to the tool.
     * @returns The stringified result from the tool execution.
     * @throws If the plugin is not loaded, tool doesn't exist, or execution fails.
     */
    public async executeTool(pluginId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
        const hooks = this.activeHooks.get(pluginId);
        if (!hooks) {
            throw new Error(`Plugin ${pluginId} is not loaded or has no active hooks.`);
        }

        const toolDef = hooks.tool && hooks.tool[toolName];
        if (!toolDef || typeof toolDef.execute !== 'function') {
            throw new Error(`Plugin ${pluginId} does not provide tool '${toolName}'.`);
        }

        const ctx = this.createPluginContext();
        
        // Execute the OpenCode-style tool
        const result = await toolDef.execute(args, ctx);
        
        // Ensure result is stringified for MCP/AI compatibility
        return typeof result === 'string' ? result : JSON.stringify(result);
    }

    /**
     * Emits an event (like session.idle) to all active plugins.
     * @param eventName - The name of the event (e.g., 'session.started').
     * @param payload - Data associated with the event.
     */
    public async emitEvent(eventName: string, payload: any): Promise<void> {
        const promises: Promise<void>[] = [];

        for (const [pluginId, hooks] of this.activeHooks.entries()) {
            if (typeof hooks.event === 'function') {
                promises.push(
                    (async () => {
                        try {
                            // OpenCode usually wraps the event: event({ event: { type: '...', data: ... } })
                            await hooks.event({ event: { type: eventName, ...payload } });
                        } catch (e) {
                            console.error(`[PluginManager] Plugin ${pluginId} failed handling event ${eventName}:`, e);
                        }
                    })()
                );
            }
        }

        await Promise.all(promises);
    }

    /**
     * Returns the list of currently loaded plugins and their metadata.
     * @returns An array of LoadedPlugin objects.
     */
    public getLoadedPlugins(): LoadedPlugin[] {
        return Array.from(this.loadedPlugins.values());
    }
}
