/**
 * Result Reporter Module
 * 
 * Analyzes tool outputs to detect "presentable" results and extract
 * structured data (products, prices, search results, etc.) for user display.
 */

export interface ExtractedProduct {
    name: string;
    price?: string;
    rating?: string;
    url?: string;
}

export interface ExtractedSearchResult {
    title: string;
    url?: string;
    snippet?: string;
}

export interface ExtractedNavigation {
    url: string;
    title?: string;
}

export interface ExtractedData {
    type: 'products' | 'search_results' | 'navigation' | 'confirmation' | 'error' | 'text';
    products?: ExtractedProduct[];
    searchResults?: ExtractedSearchResult[];
    navigation?: ExtractedNavigation;
    message?: string;
}

export interface PresentableResult {
    hasPresentableData: boolean;
    summary: string;
    extractedData?: ExtractedData;
}

/**
 * Patterns that indicate non-presentable data (noise)
 */
const NOISE_PATTERNS = [
    /^\s*\{\s*"elements"\s*:/i,           // Raw DOM elements dump
    /^\s*\{\s*"count"\s*:\s*\d+/i,         // Element count objects
    /selector.*nav-a.*type.*a/i,          // Interactive element dumps
    /\{"index":\d+,"text":.*"selector":/i, // Playwright element arrays
    /\[Redundant Tool Output Pruned/i,    // Pruned content marker
];

/**
 * Patterns that indicate presentable data
 */
const PRESENTABLE_PATTERNS = {
    products: [
        /(?:₹|Rs\.?|INR|USD|\$)\s*[\d,]+(?:\.\d{2})?/i, // Price patterns
        /(?:rating|stars?|reviews?)\s*[:\-]?\s*[\d.]+/i, // Rating patterns
        /(?:add to cart|buy now|in stock|out of stock)/i, // Shopping actions
    ],
    navigation: [
        /(?:navigated? to|opened?|loaded?|page:)\s*https?:\/\//i,
        /url[:\s]+https?:\/\//i,
        /title[:\s]+.{10,}/i,
    ],
    confirmation: [
        /(?:success(?:fully)?|completed?|done|added|submitted)/i,
        /✓|✔|☑/,
    ],
    error: [
        /(?:error|failed?|timeout|not found|exception)/i,
    ],
};

/**
 * Check if output is noise (DOM dumps, element lists, etc.)
 */
function isNoise(output: string): boolean {
    if (output.length > 5000) return true; // Very large outputs are noise

    for (const pattern of NOISE_PATTERNS) {
        if (pattern.test(output)) return true;
    }

    return false;
}

/**
 * Try to extract product information from output
 */
function extractProducts(output: string | any): ExtractedProduct[] | null {
    const products: ExtractedProduct[] = [];

    // Skip if this looks like Playwright interactive elements
    if (typeof output === 'string') {
        if (output.includes('"type":"a"') || output.includes('"type":"select"') || output.includes('"index":')) {
            return null; // This is Playwright element data, not products
        }
    }

    // Try to parse as JSON array of products
    if (typeof output === 'object' && Array.isArray(output)) {
        // Check if it's a Playwright element array
        if (output.length > 0 && output[0].index !== undefined && output[0].type) {
            return null; // This is interactive elements, not products
        }

        for (const item of output.slice(0, 5)) { // Max 5 products
            if (item.name || item.title || item.product) {
                products.push({
                    name: item.name || item.title || item.product,
                    price: item.price || item.cost,
                    rating: item.rating || item.stars,
                    url: item.url || item.link,
                });
            }
        }
    }

    // Try to extract from text using patterns
    if (typeof output === 'string' && products.length === 0) {
        // Look for price patterns with context
        const priceMatches = output.match(/([^.!?\n]{10,50}(?:₹|Rs\.?|INR|\$)\s*[\d,]+(?:\\.\\d{2})?[^.!?\n]{0,30})/gi);
        if (priceMatches && priceMatches.length > 0) {
            for (const match of priceMatches.slice(0, 3)) {
                // Extract the price value
                const priceMatch = match.match(/(₹|Rs\.?|INR|\$)\s*([\d,]+(?:\\.\\d{2})?)/i);
                if (priceMatch) {
                    products.push({
                        name: match.replace(priceMatch[0], '').trim().substring(0, 50),
                        price: priceMatch[0],
                    });
                }
            }
        }
    }

    return products.length > 0 ? products : null;
}

/**
 * Try to extract navigation/page load information
 */
function extractNavigation(output: string | any): ExtractedNavigation | null {
    if (typeof output === 'object') {
        if (output.url || output.href) {
            return {
                url: output.url || output.href,
                title: output.title || output.pageTitle,
            };
        }
    }

    if (typeof output === 'string') {
        const urlMatch = output.match(/https?:\/\/[^\s"'<>]+/);
        const titleMatch = output.match(/title[:\s]+["']?([^"'\n]+)["']?/i);

        if (urlMatch) {
            return {
                url: urlMatch[0],
                title: titleMatch ? titleMatch[1] : undefined,
            };
        }
    }

    return null;
}


/**
 * Try to extract text from MCP-style content objects
 */
function extractMcpContent(output: any): string | null {
    // Handle {"content": [{"type": "text", "text": "..."}]} pattern
    if (output && typeof output === 'object' && Array.isArray(output.content)) {
        const textParts = output.content
            .filter((c: any) => c.type === 'text' && c.text)
            .map((c: any) => c.text)
            .join('\n');

        // If the extracted text itself is JSON, try to parse it
        if (textParts.trim().startsWith('[') || textParts.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(textParts);
                // If it's a list of products/objects, let extractProducts handle it
                if (Array.isArray(parsed)) return null;
                // Otherwise return as is (to be flattened later) or just text
            } catch (e) { /* ignore */ }
        }

        return textParts.length > 0 ? textParts : null;
    }
    return null;
}

/**
 * flatten simple JSON objects to bullet definitions
 */
function flattenJsonToBullets(obj: any): string | null {
    if (typeof obj !== 'object' || obj === null) return null;

    // If array, map each item
    if (Array.isArray(obj)) {
        const items = obj.map(i => flattenJsonToBullets(i)).filter(Boolean);
        return items.length > 0 ? items.join('\n') : null;
    }

    // Capture meaningful keys
    const keys = ['name', 'title', 'product', 'price', 'cost', 'rating', 'status', 'message'];
    const foundKeys = keys.filter(k => obj[k]);

    if (foundKeys.length > 0) {
        const parts = foundKeys.map(k => {
            const val = obj[k];
            if (typeof val === 'object') return null;
            return k === 'name' || k === 'title' ? `**${val}**` : `${k}: ${val}`;
        }).filter(Boolean);
        return `• ${parts.join(' - ')}`;
    }

    return null;
}

/**
 * Main function: Analyze tool output and determine if it's presentable
 */
export function analyzeToolOutput(
    toolName: string,
    output: any
): PresentableResult {
    // 0. If output is a stringified JSON object, parse it back to an object
    let parsedOutput = output;
    if (typeof output === 'string' && (output.trim().startsWith('{') || output.trim().startsWith('['))) {
        try {
            parsedOutput = JSON.parse(output);
        } catch (e) {
            // Keep as string if parsing fails
        }
    }

    // 1. Try to extract content from MCP structure first
    const mcpContent = extractMcpContent(parsedOutput);
    const effectiveOutput = mcpContent || parsedOutput;

    // Convert to string for pattern matching
    const outputStr = typeof effectiveOutput === 'string'
        ? effectiveOutput
        : JSON.stringify(effectiveOutput);

    // Quick noise check
    if (isNoise(outputStr)) {
        return {
            hasPresentableData: false,
            summary: '',
        };
    }

    // Check for errors first
    if (effectiveOutput?.error || PRESENTABLE_PATTERNS.error.some(p => p.test(outputStr))) {
        const errorMsg = effectiveOutput?.error || outputStr.match(/error[:\s]+([^\n]+)/i)?.[1] || 'An error occurred';
        return {
            hasPresentableData: true,
            summary: `⚠️ ${errorMsg.substring(0, 100)}`,
            extractedData: { type: 'error', message: errorMsg },
        };
    }

    // Check for products/prices
    const products = extractProducts(effectiveOutput);
    if (products && products.length > 0) {
        const summary = products.map(p =>
            `• ${p.name}${p.price ? ` - ${p.price}` : ''}${p.rating ? ` (${p.rating})` : ''}`
        ).join('\n');

        return {
            hasPresentableData: true,
            summary: `**Found ${products.length} item(s):**\n${summary}`,
            extractedData: { type: 'products', products },
        };
    }

    // Check for navigation
    if (toolName.includes('navigate') || toolName.includes('goto')) {
        const nav = extractNavigation(effectiveOutput);
        if (nav) {
            return {
                hasPresentableData: true,
                summary: `📍 Navigated to: ${nav.title || nav.url}`,
                extractedData: { type: 'navigation', navigation: nav },
            };
        }
    }

    // Check for confirmation/success
    if (PRESENTABLE_PATTERNS.confirmation.some(p => p.test(outputStr))) {
        // Extract a short success message
        const successMsg = outputStr.substring(0, 100).replace(/\s+/g, ' ').trim();
        return {
            hasPresentableData: true,
            summary: `✅ ${successMsg}`,
            extractedData: { type: 'confirmation', message: successMsg },
        };
    }

    // Check for meaningful text content (not too short, not too long)
    if (outputStr.length > 20 && outputStr.length < 500) {
        // BLOCK RAW JSON: If it looks like JSON and wasn't handled above, try to flatten or ignore
        if (outputStr.trim().startsWith('{') || outputStr.trim().startsWith('[')) {
            try {
                const parsed = JSON.parse(outputStr);
                const flattened = flattenJsonToBullets(parsed);
                if (flattened) {
                    return {
                        hasPresentableData: true,
                        summary: flattened,
                        extractedData: { type: 'text', message: flattened }
                    };
                }
                // If complex JSON and not flattening, ignore it to avoid dumping raw data
                return { hasPresentableData: false, summary: '' };
            } catch (e) {
                // Not JSON, proceed to text check
            }
        }

        // Check if it contains actual words, not just JSON/code
        const wordCount = outputStr.split(/\s+/).filter(w => /^[a-zA-Z]+$/.test(w)).length;
        if (wordCount > 5) {
            return {
                hasPresentableData: true,
                summary: outputStr.substring(0, 200) + (outputStr.length > 200 ? '...' : ''),
                extractedData: { type: 'text', message: outputStr },
            };
        }
    }

    return {
        hasPresentableData: false,
        summary: '',
    };
}

/**
 * Format extracted data for user display
 */
export function formatForDisplay(data: ExtractedData): string {
    switch (data.type) {
        case 'products':
            if (!data.products) return '';
            return data.products.map(p =>
                `• **${p.name}**${p.price ? ` — ${p.price}` : ''}${p.rating ? ` ⭐ ${p.rating}` : ''}`
            ).join('\n');

        case 'navigation':
            if (!data.navigation) return '';
            return `📍 **${data.navigation.title || 'Page loaded'}**\n${data.navigation.url}`;

        case 'confirmation':
            return `✅ ${data.message}`;

        case 'error':
            return `⚠️ ${data.message}`;

        case 'text':
            return data.message || '';

        default:
            return '';
    }
}
