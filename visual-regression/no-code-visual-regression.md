# No-Code Visual Regression Guide for AI Agents

This document provides a standardized protocol for performing **manual-visual regressions** and **UI audits** using browser subagents. Since this project moves fast and leverages a premium design system, every PR should be audited for visual consistency without necessarily writing brittle E2E code tests for every small UI tweak.

---

## 🎯 The Objective
To verify that UI changes (new features, refactors, or theme updates) maintain the "Premium" look and feel and do not introduce regressions in layout, contrast, or interaction states.

## 🛠 Prerequisites
1.  **Local Dev Server**: The app must be running (usually `npm run dev` on `http://localhost:5175`).
2.  **Browser Subagent**: Use the `browser_subagent` tool for all interactions.
3.  **Baseline Branch**: Usually `main` or the target branch of a PR.

---

## 🔄 The Visual Regression Workflow

### Phase 1: Establish Baselines (On `main`)
*Before starting work or reviewing a PR, capture the "Source of Truth".*

1.  **Checkout Main**: `git checkout main`.
2.  **Execute Baseline Task**: Run a `browser_subagent` task to capture screenshots of core flows.
3.  **Store Artifacts**: 
    - Save screenshots to `visual-regression/baselines/{flow}_main.png`.
    - Create/Update `visual-regression/{flow}-flow.md` documenting current behavior and appearance.

### Phase 2: Implementation & Branch Audit
*Perform the same steps on the feature/PR branch.*

1.  **Checkout Branch**: `git checkout feature-branch`.
2.  **Execute Audit Task**: Run the exact same `browser_subagent` flow as used in Phase 1.
3.  **Capture Deviations**: Look for:
    - **Token Gaps**: Hardcoded colors that don't change with themes.
    - **Layout Shift**: Buttons or inputs moving unexpectedly.
    - **Contrast Issues**: Text becoming unreadable (especially in Light Mode).
    - **Hover States**: Broken or non-premium transitions.

### Phase 3: Reporting & Fix Loop
1.  **Generate Summary**: Create `visual-regression/regression-audit-summary.md`.
2.  **Document Issues**: If issues are found, capture specific screenshots of the "Visual Bug".
3.  **Fix and Re-Verify**: Apply code fixes, then trigger a "targeted verification" with the subagent to prove the fix.

---

## 📋 Standard Audit Flows

### 1. Chat & Orchestration Flow
- **Navigate**: `http://localhost:5175`.
- **Action**: Send a message that triggers multiple tools (e.g., "List files and search for 'config'").
- **Check**:
    - Do `ToolCallList` chips look consistent?
    - Is the "Analyzing..." pulse animation working?
    - Are message action buttons (Copy/Regenerate) visible on hover?

### 2. MCP Connections Flow
- **Navigate**: `/mcp`.
- **Action**: Open the "Add Connection" form.
- **Check**:
    - Are all labels (Name, Command, Arguments) visible?
    - Does the "Local Only" warning have accessible contrast?
    - Transition from "Offline" to "Active" state should be smooth.

### 3. Settings & Theming Flow
- **Navigate**: `/settings`.
- **Action**: Toggle between **Dark** and **Light** modes.
- **Check**:
    - Does the Sidebar background adapt?
    - Are there any "Ghost Borders" or hardcoded dark backgrounds in Light Mode?
    - Verify typography contrast on the Hub Landing page.

---

## 🤖 Instructions for AI Agents (Prompt Snippet)

When asked to "Perform a visual regression audit", use this logic:

1.  **Baseline**: "I will first checkout the `main` branch and capture screenshots of the [Flow Name] to establish a visual baseline."
2.  **Navigation**: Use `open_browser_url` followed by specific `click_browser_pixel` or `type_browser_text` steps. 
3.  **Verification**: "I will now checkout the PR branch, repeat the flow, and compare the aesthetics. I will specifically look for hardcoded hex codes (#...) or CSS classes that don't respect the design tokens."
4.  **Reporting**: "I will provide a side-by-side comparison in a markdown artifact and flag any 'Visual Inconsistencies'."

---

## ⚡ Automated Workflow (Slash Command)

Use the `/visual-regression` workflow to trigger a full, automated audit across core flows. This workflow:
1. Orchestrates the `browser_subagent` to test both Light and Dark modes.
2. Performs the standard audit flows automatically.
3. Generates the `regression-audit-summary.md` report.
4. Identifies and proposes fixes for any detected contrast issues or token gaps.

---

## 📌 Best Practices
- **Wait for Load**: Always use `wait_for_selector` or a small timeout after navigation to ensure animations settle.
- **Full Page Screenshots**: Use `capture_browser_screenshot` for the entire viewport to catch footer/sidebar regressions.
- **Theme Testing**: **ALWAYS** test in Light Mode if you are touching shared components. Light Mode is where most "token gaps" reside.
