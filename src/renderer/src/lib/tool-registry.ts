import script from 'minisearch';
// @ts-ignore - MiniSearch import capability
const MiniSearch = script;

import { getAllTools } from './mcp';
import { type LLMTool } from './llm';
import { APP_MODES, type AppModeId } from '../types/modes';

export interface IndexedTool extends LLMTool {
    id: string; // usually same as name
    modeScore?: number;
}

class ToolRegistryService {
    private miniSearch: any;
    private isIndexed: boolean = false;
    private allTools: LLMTool[] = [];

    constructor() {
        this.miniSearch = new MiniSearch({
            fields: ['name', 'description'], // fields to index for full-text search
            storeFields: ['name', 'description', 'parameters'], // fields to return with search results
            searchOptions: {
                boost: { name: 2 }, // match on name is more important than description
                prefix: true, // partial matching
                fuzzy: 0.2 // typo tolerance
            }
        });
    }

    /**
     * Index all available tools. Should be called on app start or when tools change.
     * Non-blocking async operation.
     */
    public async indexTools(): Promise<void> {
        try {
            // Get all tools from MCP registry
            const mcpTools = getAllTools();

            // Convert MCP tools to LLM tools (mapping inputSchema -> parameters)
            this.allTools = mcpTools.map(tool => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
            }));

            console.log(`[ToolRegistry] Indexing ${this.allTools.length} tools...`);

            // Prepare documents for MiniSearch
            const documents = this.allTools.map(tool => ({
                id: tool.name,
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }));

            this.miniSearch.removeAll();
            this.miniSearch.addAll(documents);
            this.isIndexed = true;

            console.log('[ToolRegistry] Indexing complete.');
        } catch (error) {
            console.error('[ToolRegistry] Failed to index tools:', error);
        }
    }

    /**
     * Get relevant tools for a user query within a specific mode.
     * Uses "App Modes" filtering first, then "Semantic Search" (Hydration) if needed.
     */
    public searchTools(query: string, modeId: AppModeId, limit: number = 15): LLMTool[] {
        if (!this.isIndexed) {
            console.warn('[ToolRegistry] Tools not indexed yet, returning all (fallback)');
            return this.allTools.slice(0, limit);
        }

        const modeConfig = APP_MODES[modeId];
        if (!modeConfig) {
            console.warn(`[ToolRegistry] Unknown mode ${modeId}, defaulting to General`);
            return this.searchTools(query, 'general', limit);
        }

        // 1. Filter tools by Mode (Hard Filter)
        const modeTools = this.allTools.filter(tool => {
            return modeConfig.includedTools.some(pattern => {
                // Support regex-like wildcards (e.g. "browser_.*")
                if (pattern.endsWith('.*')) {
                    const prefix = pattern.replace('.*', '');
                    return tool.name.startsWith(prefix);
                }
                return tool.name === pattern;
            });
        });

        console.log(`[ToolRegistry] Mode '${modeId}' has ${modeTools.length} candidate tools.`);

        // 2. If tool count is small, just return relevant ones directly (Fast Path)
        // For 'Developer' mode with 100 tools, we proceed to search.
        // For 'General' mode with 5 tools, we just return them.
        if (modeTools.length <= limit) {
            return modeTools;
        }

        // 3. Dynamic Hydration (Search within the Mode's tools)
        // We create a temporary search index just for this mode's candidates? 
        // Or simpler: We search ALL tools, then intersect with Mode.
        // Searching ALL is faster than re-indexing on the fly.

        const searchResults = this.miniSearch.search(query);

        // Map search results back to full tool objects
        const relevantTools: LLMTool[] = [];

        for (const result of searchResults) {
            if (relevantTools.length >= limit) break;

            // Check if this tool is allowed in current mode
            const tool = modeTools.find(t => t.name === result.id);
            if (tool) {
                relevantTools.push(tool);
            }
        }

        // If we didn't find enough matches via search, fill up with the "Mode Defaults"
        // (Optimization: just return what we found, noise is bad)

        console.log(`[ToolRegistry] Hydrated ${relevantTools.length} tools for query "${query}" in mode ${modeId}`);
        return relevantTools;
    }

    public getModeTools(modeId: AppModeId): LLMTool[] {
        return this.searchTools("", modeId, 100); // Return all tools for the mode (up to 100)
    }
}

export const ToolRegistry = new ToolRegistryService();
