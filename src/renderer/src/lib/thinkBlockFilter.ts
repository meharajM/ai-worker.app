/**
 * Universal think block filtering for all LLM providers
 * Supports: OpenAI, Claude, Gemini, Ollama, WebLLM
 */

export interface ThinkBlockResult {
    /** Extracted thinking content (if any) */
    thinking: string | null;
    /** Content with thinking removed */
    cleanedContent: string;
    /** Whether thinking block is complete (not streaming) */
    isComplete: boolean;
    /** Format detected: 'xml' | 'markdown' | 'none' */
    format: 'xml' | 'markdown' | 'none';
}

/**
 * Extract and remove think blocks from LLM response
 * Handles multiple formats generically
 */
export function filterThinkBlocks(content: string): ThinkBlockResult {
    if (!content) {
        return {
            thinking: null,
            cleanedContent: '',
            isComplete: true,
            format: 'none'
        };
    }

    let thinkingParts: string[] = [];
    let cleanedContent = content;
    let format: 'xml' | 'markdown' | 'none' = 'none';
    let isComplete = true;

    // 1. XML Patterns (Multiple occurrences supported)
    const xmlPatterns = [
        { regex: /<think>([\s\S]*?)<\/think>/g, tag: 'think' },
        { regex: /<thinking>([\s\S]*?)<\/thinking>/g, tag: 'thinking' },
        { regex: /<thought>([\s\S]*?)<\/thought>/g, tag: 'thought' },
        { regex: /<tools>([\s\S]*?)<\/tools>/g, tag: 'tools' } // Hide leaked tool definitions
    ];

    for (const { regex, tag } of xmlPatterns) {
        let match;
        // Use loop to find all occurrences
        while ((match = regex.exec(content)) !== null) {
            thinkingParts.push(match[1].trim());
            cleanedContent = cleanedContent.replace(match[0], '');
            format = 'xml';
        }
    }

    // 2. Markdown Patterns
    const markdownPattern = /```think\n([\s\S]*?)\n```/g;
    let mdMatch;
    while ((mdMatch = markdownPattern.exec(content)) !== null) {
        thinkingParts.push(mdMatch[1].trim());
        cleanedContent = cleanedContent.replace(mdMatch[0], '');
        format = 'markdown';
    }

    // Clean up residual whitespace after stripping
    cleanedContent = cleanedContent.trim();

    // 3. Check for incomplete/streaming blocks (only if we haven't found complete ones, or at end)
    const incompleteXml = cleanedContent.trim().match(/^<(think|thinking|thought|tools)(?![^>]*>)/i);
    const incompleteMarkdown = cleanedContent.trim().startsWith('```think');

    if (incompleteXml && thinkingParts.length === 0) {
        // Only strip if it's the start of the message
        const tag = incompleteXml[1];
        const thinking = cleanedContent.replace(new RegExp(`^<${tag}>\\s*`, 'i'), '').trim();
        return {
            thinking,
            cleanedContent: '',
            isComplete: false,
            format: 'xml'
        };
    }

    if (incompleteMarkdown && thinkingParts.length === 0) {
        const thinking = cleanedContent.replace(/^```think\n?/, '').trim();
        return {
            thinking,
            cleanedContent: '',
            isComplete: false,
            format: 'markdown'
        };
    }

    return {
        thinking: thinkingParts.length > 0 ? thinkingParts.join('\n\n---\n\n') : null,
        cleanedContent,
        isComplete,
        format
    };
}

/**
 * Detect leaked reasoning patterns (outside think blocks)
 */
export function hasLeakedReasoning(content: string): boolean {
    const patterns = [
        /^,?\s*(?:the user|let me|since this|looking at|wait,?\s+the|I (?:need|should|will|don't|can|verified))/i,
        /^(?:Therefore|Thus|So),?\s+(?:the\s+)?(?:response|answer|tool call)\s+should/i,
        /^(?:Yep|No need|Okay so|Right, so)/i,
        /^(?:Hmm|Well|Alright|Ah),?\s+(?:the user|let me|I should)/i,
        /^(?:But|However),?\s+(?:according to|based on|looking at)/i,
        /^<tools>/i  // Catch malformed/unclosed tool tags at start
    ];
    return patterns.some(p => p.test(content.trim()));
}
