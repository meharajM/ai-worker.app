
// Prompt Library for Task-Specific Instructions
// These modules are dynamically injected based on the task classification

export const PROMPTS = {
    // Shopping / E-commerce specific rules
    SHOPPING: `
# SHOPPING PROTOCOLS
1. **Platform Selection**: Ask "Where do you want to shop?" if not specified.
2. **Filters**: Always check for 'Size', 'Color', and 'Price' filters. 
3. **Resilience**: If filters fail, try searching for the specific variant (e.g. "Nike Air Max Size 10") in the search bar.
4. **Safety**: NEVER proceed to checkout. Stop at the cart/review stage.
5. **Confirmation**: Show found products with price and availability before navigating away.
`.trim(),

    // Research / Information Gathering
    RESEARCH: `
# RESEARCH PROTOCOLS
1. **Sources**: Use multiple diverse sources if the query is broad.
2. **Citation**: Explicitly mention where the information came from (URL/Site Name).
3. **Detail Depth**: Provide a summary first, then ask if the user wants details.
4. **Fact Checking**: If two sources conflict, note the discrepancy.
5. **PDFs/Docs**: If a result is a PDF, mention it before opening.
`.trim(),

    // Form Filling / Admin (includes government/official sites)
    ADMIN: `
# FORM FILLING & STATE PROTOCOLS
1. **Robust Data Entry**: 
   - If a website uses complex frameworks (React/Angular), standard typing might not trigger updates.
   - **Protocol**: If an input doesn't update, use \`browser_evaluate\` to manually dispatch events:
     \`\`\`js
     element.value = 'value';
     element.dispatchEvent(new Event('input', { bubbles: true }));
     element.dispatchEvent(new Event('change', { bubbles: true }));
     \`\`\`

2. **Smart Selectors** (For Government/Official Sites):
   - **Prefer**: Text-based (\`text="Submit"\`) or role-based selectors
   - **Avoid**: CSS IDs (change frequently on official sites)
   - **Dropdowns**: If \`select_option\` fails, click container → wait 500ms → click option by text
   - **Fallback**: Use \`get_interactive_elements\` to list all clickable items

3. **Vision Protocol (CAPTCHAs & Errors)**:
   - **Locate**: Find the CAPTCHA image or error message container.
   - **Capture**: Take a screenshot of the page (or element if possible).
   - **Analyze**: Look specifically at the captured area to extract text/digits.
   - **Action**: Type the result. If it fails, retry once, then Ask User.

4. **Error Recovery**:
   - If you see "No records found" or generic errors, take a screenshot immediately.
   - Verify input accuracy against the user's request.
   - If a button click does nothing, try clicking the parent container or using JS click.

5. **Privacy**: Never save passwords or credentials.
`.trim(),

    // General Navigation / Simple
    GENERAL: `
# GENERAL NAVIGATION
1. **Efficiency**: Go directly to the target URL if known.
2. **Verification**: Confirm the page loaded correctly (check title/content).
`.trim()
};

export type TaskCategory = keyof typeof PROMPTS;

// Helper to get prompt, with sub-agent fallback
export function getPromptForCategory(category: string, isSubAgent = false): string {
    const key = category?.toUpperCase();
    // Check for specific SUB_AGENT_ prefixed key if needed, or just return base
    if (isSubAgent) {
        const subKey = `SUB_${key}`;
        if (PROMPTS[subKey as TaskCategory]) {
            return PROMPTS[subKey as TaskCategory];
        }
    }
    return PROMPTS[key as TaskCategory] || PROMPTS.GENERAL;
}
