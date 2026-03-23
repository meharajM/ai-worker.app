/**
 * shared/types/plugins.ts — Core definitions for the Plugin Architecture.
 *
 * Responsibilities:
 *   1. Define the internal schema for AiWorkerPlugin.
 *   2. Define the OpenCode Compatibility Adapter interfaces so that existing
 *      OpenCode plugins (e.g. opencode-office) can be loaded natively.
 * 
 * Design decision: The main process and renderer process share these types so that 
 *   both ends of the IPC bridge understand the structure of a loaded plugin and its tools.
 *   We define OpenCode-like types here to avoid a hard dependency on @opencode-ai/plugin.
 * 
 * Consumed by: PluginManager (main), active plugins (main), pluginStore (renderer).
 */

/**
 * Represents a basic MCP Tool schema.
 */
export interface PluginSchemaProperty {
    type: string;
    description?: string;
    properties?: Record<string, any>;
    required?: string[];
}

export interface PluginToolSchema {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
}

/**
 * Represents a tool adapted from an OpenCode plugin into our internal MCPTool schema.
 */
export interface PluginToolAdapter extends PluginToolSchema {
    /** 
     * The ID of the plugin that owns this tool, used to route execution
     * back to the correct Main process sandbox over IPC. 
     */
    pluginId: string;
}

/**
 * Represents the normalized plugin structure loaded into memory.
 */
export interface LoadedPlugin {
    /** Unique identifier for the plugin (e.g., 'opencode-office'). */
    id: string;
    /** Display name. */
    name: string;
    /** Version string. */
    version: string;
    /** List of MCP servers that should be injected into mcpStore. */
    mcpServers: any[];
    /** List of custom TypeScript tools provided by the plugin. */
    tools: PluginToolAdapter[];
    /** Whether the plugin successfully loaded without errors. */
    isActive: boolean;
}

/**
 * Emulated context provided to OpenCode plugins during initialization and tool execution.
 * 
 * Design decision: Matches the OpenCode SDK's context structure so unmodified 
 *   third-party plugins can access the shell, client capabilities, and paths.
 */
export interface OpenCodePluginContext {
    /** Information about the current AI-Worker project environment. */
    project: { name: string; root: string };
    /** The directory currently active in the chat context. */
    directory: string;
    /** A mock or actual git worktree path if required by the plugin. */
    worktree?: string;
    /** The shell bridge, traditionally the 'bun' $ API in OpenCode. */
    $: any;
    /** A limited agent client interface provided to the plugin. */
    client: Record<string, any>;
}

/**
 * Represents the payload passed when executing a plugin tool over IPC.
 */
export interface PluginToolExecutionPayload {
    pluginId: string;
    toolName: string;
    args: Record<string, unknown>;
}
