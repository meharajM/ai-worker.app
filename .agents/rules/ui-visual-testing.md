---
trigger: model_decision
description: Load when making changes to user interfaces, React components in src/renderer/, or CSS tokens, to ensure the AI agent proactively performs visual regression testing.
---

# Automated Visual Regression Rules

As an AI coding agent on this project, the UI quality and lack of manual effort from the user are critical. The user should NEVER have to manually test the application visually after you make UI changes.

Whenever your task involves modifying the UI (components, layouts, colors, CSS variables):

## 1. Proactive Subagent Testing
You MUST proactively use your `browser_subagent` tool to verify your UI changes. Never push or claim a UI task is complete until you have visually verified it.

## 2. The Verification Protocol
Before wrapping up a UI task, follow the protocol outlined in:
`visual-regression/no-code-visual-regression.md`

Specifically:
- Check for **Token Gaps** (hardcoded hex colors instead of CSS variables).
- Check **Dark and Light Modes** (always tell the subagent to switch themes to verify).
- Check **Hover States** or **Action Button visibility**.

## 3. Subagent Prompt Requirements
When invoking the `browser_subagent` to test your changes, always formulate tasks resembling the following:
> "Navigate to [Route]. Test the [Component] in Dark Mode. Then switch to Light Mode via Settings and test it again. Check that there are no hardcoded dark backgrounds or invisible text. Capture screenshots and return a list of visual inconsistencies."

## 4. Failing the Workflow
If your subagent identifies contrast issues or layout breaks, **fix them immediately** before handing the task back to the user.

By adhering to this rule, we fully automate visual QA, relieving the USER of manual testing.
