export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, any>;
}

export function getCompactToolList(tools: ToolDefinition[]): string {
    return tools.map(t =>
        `${t.name}:${t.description.substring(0, 40)}(${Object.keys(t.parameters).join(',')})`
    ).join(' | ');
}
