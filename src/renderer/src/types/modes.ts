export type AppModeId = 'general' | 'finance' | 'developer' | 'researcher';

export interface AppModeConfig {
    id: AppModeId;
    name: string;
    description: string;
    icon: string;
    // Tools explicitly allowed in this mode (regex patterns or exact names)
    includedTools: string[];
    // MCP Servers explicitly allowed (if empty, defaults to filtering tools)
    includedServers?: string[];
    // If true, we bypass semantic search and just load includedTools
    disableSemanticSearch?: boolean;
}

export const APP_MODES: Record<AppModeId, AppModeConfig> = {
    general: {
        id: 'general',
        name: 'General',
        description: 'Everyday tasks, quick answers, and system control.',
        icon: 'Brain',
        includedTools: [
            'get_current_time',
            'convert_time',
            'weather',
            'calculator',
            'browser_navigate' // Read-only browsing
        ],
        includedServers: ['filesystem', 'memory', 'playwright', 'fetch']
    },
    finance: {
        id: 'finance',
        name: 'Finance',
        description: 'Market analysis, stock data, and financial reporting.',
        icon: 'TrendingUp',
        includedTools: [
            'get_current_time',
            'convert_time',
            'get_stock_price',
            'get_crypto_price',
            'analyze_market',
            'filesystem_read', // To read CSVs
        ],
        includedServers: ['filesystem', 'memory', 'finance', 'sequential-thinking']
    },
    developer: {
        id: 'developer',
        name: 'Developer',
        description: 'Coding, shell access, git, and system engineering.',
        icon: 'Terminal',
        includedTools: [
            'get_current_time',
            'convert_time',
            'filesystem_.*',
            'shell_.*', // Placeholder for potential shell tools
            'git_.*',
            'browser_.*',
            'sequential_thinking'
        ],
        includedServers: ['filesystem', 'memory', 'git', 'playwright', 'sequential-thinking', 'fetch']
    },
    researcher: {
        id: 'researcher',
        name: 'Researcher',
        description: 'Deep web research, paper analysis, and synthesis.',
        icon: 'BookOpen',
        includedTools: [
            'get_current_time',
            'convert_time',
            'browser_.*',
            'mcp_server_paper_.*',
            'filesystem_write', // To save notes
            'sequential_thinking'
        ],
        includedServers: ['filesystem', 'memory', 'playwright', 'sequential-thinking', 'fetch']
    }
};
