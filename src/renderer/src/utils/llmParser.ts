export interface ParsedStep {
    reasoning: string;
    toolCall?: { name: string; args: any };
    isFinal: boolean;
    finalAnswer?: string;
}

export function parseSequentialResponse(response: string): ParsedStep {
    // Extract thinking
    const thinkMatch = response.match(/<THINK>(.*?)<\/THINK>/s);
    const reasoning = thinkMatch?.[1]?.trim() || "Processing...";

    // Extract tool if present
    const toolMatch = response.match(/<TOOL>(.*?)<\/TOOL>/s);
    let toolCall = undefined;

    if (toolMatch) {
        try {
            const parsed = JSON.parse(toolMatch[1]);
            toolCall = {
                name: parsed.name || parsed.tool,
                args: parsed.args || parsed.arguments
            };
        } catch (e) {
            console.warn("Tool JSON parse failed:", e instanceof Error ? e.message : String(e));
        }
    }

    const isFinal = !toolMatch;
    let finalAnswer = "";

    if (isFinal) {
        const afterThink = response.split('</THINK>')[1];
        finalAnswer = afterThink ? afterThink.trim() : reasoning;
    }

    return { reasoning, toolCall, isFinal, finalAnswer };
}
