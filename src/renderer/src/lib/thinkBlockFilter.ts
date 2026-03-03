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
    const markdownPattern = /```think\s*([\s\S]*?)\s*```/g;
    let mdMatch;
    while ((mdMatch = markdownPattern.exec(content)) !== null) {
        thinkingParts.push(mdMatch[1].trim());
        cleanedContent = cleanedContent.replace(mdMatch[0], '');
        format = 'markdown';
    }

    // Clean up residual whitespace after stripping
    cleanedContent = cleanedContent.trim();

    // 2b. Aggressive General Tag Stripper
    // Some models (especially local/DeepSeek variants) leak internal tags like <debug_log> or <thought_process>.
    // This removes any <tag>...</tag> or <tag/> that isn't a standard HTML formatting tag.
    const ALLOWED_TAGS = ['b', 'i', 'code', 'pre', 'a', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'span', 'div'];
    
    // Process block-level tags: <tag>...</tag>
    const generalTagRegex = /<([a-zA-Z0-9_-]+)[^>]*>([\s\S]*?)<\/\1>/g;
    let tagMatch;
    while ((tagMatch = generalTagRegex.exec(cleanedContent)) !== null) {
        const tagName = tagMatch[1].toLowerCase();
        if (!ALLOWED_TAGS.includes(tagName)) {
            // It's a leaked internal tag, strip it
            cleanedContent = cleanedContent.replace(tagMatch[0], '');
        }
    }

    // Process self-closing tags: <tag/>
    const selfClosingRegex = /<([a-zA-Z0-9_-]+)[^>]*\/>/g;
    let selfClosingMatch;
    while ((selfClosingMatch = selfClosingRegex.exec(cleanedContent)) !== null) {
        const tagName = selfClosingMatch[1].toLowerCase();
        if (!ALLOWED_TAGS.includes(tagName)) {
            cleanedContent = cleanedContent.replace(selfClosingMatch[0], '');
        }
    }

    // Secondary cleanup after general tag stripping
    cleanedContent = cleanedContent.trim();

    // 3. Check for incomplete/streaming blocks (only if we haven't found complete ones, or at end)
    const incompleteXml = cleanedContent.trim().match(/^<(think|thinking|thought|tools)\b[^>]*>/i);
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
