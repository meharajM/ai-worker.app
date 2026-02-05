
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

   //Research / Information Gathering (Refined with Anthropic & Cursor patterns)
   RESEARCH: `
# RESEARCH & BROWSING PROTOCOLS
1. **Autonomous Search Strategy**: 
   - **Broad First**: Start with high-level queries to understand the landscape.
   - **Specific Second**: Narrow down with specific terms (e.g., "site:reddit.com", "v2 vs v3").
   - **Self-Driven**: If first search unclear, try different phrasings. Don't ask user immediately.
   - **Verification**: If you find a claim, verify it on a second independent source.
2. **Context Maximization**:
   - Do NOT just read the first result. Check at least 3 varied sources.
   - TRACE citations back to their primary source (e.g., official docs > blog posts).
   - **Follow Links**: If a source mentions something relevant, visit it autonomously.
3. **Citation Rules**:
   - EVERY claim must be supported by a source.
   - Explicitly mention the source URL/Name.
4. **Deep Dives**: 
   - If the query is broad, provide a high-level summary first.
   - Ask the user if they want to "go deeper" into specific aspects.
`.trim(),

   // Deep Research / Complex Topics
   RESEARCH_DEEP: `
# DEEP RESEARCH PROTOCOLS
1. **Multi-Source Synthesis**: 
   - Consult at least 3 distinct sources.
   - Look for primary sources (documentation, official reports) over blogs.
2. **Structure**:
   - Begin with an Executive Summary.
   - Detailed Breakdown by sub-topic.
   - Conclude with Key Takeaways.
3. **Uncertainty**:
   - Clearly state what is KNOWN vs. what is SPECULATED.
   - Highlight gaps in the available information.
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

   // General Navigation / Simple (Refined with Manus Self-Correction + Cursor Autonomy)
   GENERAL: `
# GENERAL AGENT PROTOCOLS
1. **Analyze First**:
   - Break down the request into steps BEFORE acting.
   - Identify potential challenges (e.g., login walls, captchas).
2. **Autonomous Execution** (Cursor/Devin):
   - **Action**: Execute directly. Don't ask for permission for simple navigation.
   - **Infer Defaults**: If user says "search for X" without specifying site, use Google.
   - **Verification**: Check the result. Did the page change? Did the error appear?
   - **Correction**: If it failed, try a DIFFERENT method immediately (e.g., JS click).
3. **Efficiency**:
   - Go directly to target URLs.
   - Don't wait for permission to fix simple errors.
4. **Communication**:
   - Be concise.
   - Confirm completion of key steps.
   - Don't ask obvious questions if you can find/infer the answer.
`.trim(),

   // Coding & Development (Enhanced with Cursor's Context & Antigravity's Aesthetics)
   CODING: `
# ENGINEERING / CODING PROTOCOLS
1. **Context Maximization** (Cursor Pattern):
   - **Trace Symbols**: Before editing, find definitions AND usages.
   - **Read Configs**: Check \`package.json\`/\`tsconfig.json\` to match the environment.
   - **No Guessing**: Search for patterns before writing new code.
   - **Thorough Exploration**: Read multiple files. If first search doesn't clarify, try different terms.

2. **Autonomous Problem Solving** (Devin Pattern):
   - **Gather First, Act Second**: When encountering issues, collect information before concluding root cause.
   - **Don't Ask Obvious Questions**: If you can find the answer by reading code/docs, do that instead of asking user.
   - **Self-Correction**: If tests fail, analyze WHY before making changes. Don't blindly retry.

3. **Web Application Workflow** (Antigravity Pattern):
   - **Plan**: Understand requirements. Outline features.
   - **Foundation**: Setup \`index.css\` and design tokens first.
   - **Components**: Build reusable, styled components (NO ad-hoc styles).
   - **Assemble**: Integrate into pages with responsive layouts.
   - **Polish**: Review UX, smooth transitions, and performance.

4. **Design Aesthetics** (Critical):
   - **Visual Excellence**: Use vibrant colors, dark modes, glassmorphism. Avoid generic browser defaults.
   - **Dynamic**: Add hover effects and micro-animations. Make it feel "alive".
   - **No Placeholders**: Use real content or generated assets.
   - **Typography**: Use modern fonts (Inter, Roboto, etc.).

5. **Implementation & Safety**:
   - Write clean, functional code.
   - Do NOT modify tests unless explicitly asked.
   - If run/build fails, analyze the error. Do NOT blindly retry.
`.trim(),

   // SUB-AGENT VARIANTS (Token-efficient versions)
   // These inherit safety rules but enforce concise output

   SUB_SHOPPING: `
# SUB-AGENT: SHOPPING TASK
- **Safety**: NEVER proceed past cart. No checkout, no payments.
- **Output**: Return ONLY product findings (name, price, availability).
- **Format**: Bullet points, max 100 words.
- **End with**: "✓ complete"
`.trim(),

   SUB_RESEARCH: `
# SUB-AGENT: RESEARCH TASK
- **Verify**: Check 2+ sources before concluding.
- **Output**: Key findings with source URLs only.
- **Format**: Bullet points, max 150 words.
- **End with**: "✓ complete"
`.trim(),

   SUB_ADMIN: `
# SUB-AGENT: FORM/ADMIN TASK
- **Privacy**: Never save or expose credentials.
- **Double-check**: Verify inputs before submission.
- **Output**: Confirmation of action taken.
- **Format**: Brief status, max 50 words.
- **End with**: "✓ complete"
`.trim(),

   SUB_GENERAL: `
# SUB-AGENT: GENERAL TASK
- Execute steps efficiently.
- **Output**: Results only, no process description.
- **Format**: 2-3 sentences max.
- **End with**: "✓ complete"
`.trim(),

   // PARALLEL EXECUTION (Cross-cutting concern - can be added to any task)
   PARALLEL_EXECUTION: `
# PARALLEL EXECUTION PROTOCOL
**CRITICAL**: This task has independent sub-parts that MUST run concurrently.

## Why You're Seeing This
Your current request contains multiple independent entities or batch operations:
- Multiple subjects (e.g., "Research Apple AND Microsoft")
- Parallel workflows (e.g., "Check 3 websites")
- Batch operations (e.g., "Extract data from 5 pages")

## Mandatory Actions
1. **Identify Independent Sub-Tasks**: Break the goal into parallel-executable units
2. **Call \`delegate_sub_task\` Simultaneously**: 
   - ❌ WRONG: Call tool 1 → Wait for result → Call tool 2
   - ✅ CORRECT: Call tool 1 AND tool 2 in the SAME response
3. **Example**:
   - User: "Research Apple and Microsoft stock prices"
   - You: [Call delegate_sub_task("Research Apple stock") AND delegate_sub_task("Research Microsoft stock") simultaneously]

## Verification Checklist
- [ ] Did you call multiple \`delegate_sub_task\` tools in ONE turn?
- [ ] Are the sub-tasks truly independent (no sequential dependency)?
- If NO to either → Revise your approach immediately.
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

/**
 * Composable multi-prompt loader
 * Allows multiple prompts to be combined (e.g., SHOPPING + PARALLEL_EXECUTION)
 * @param categories Array of prompt keys to load
 * @param isSubAgent Whether this is for a sub-agent
 * @returns Combined prompt string with all requested protocols
 */
export function getComposedPrompts(categories: string[], isSubAgent = false): string {
   const prompts: string[] = [];

   for (const category of categories) {
      const prompt = getPromptForCategory(category, isSubAgent);
      if (prompt && prompt !== PROMPTS.GENERAL) {
         prompts.push(prompt);
      }
   }

   // If no specific prompts were found, return GENERAL
   if (prompts.length === 0) {
      return PROMPTS.GENERAL;
   }

   // Join with double newline for clear separation
   return prompts.join('\n\n');
}
