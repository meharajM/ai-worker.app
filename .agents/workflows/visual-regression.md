---
description: run full visual regression audit across application
---

# Visual Regression Automation Workflow

This workflow is intended to fully automate the visual testing process using the `browser_subagent`.

1. Read the instructions laid out in `visual-regression/no-code-visual-regression.md`.
2. Spawn a `browser_subagent` task to complete the "Standard Audit Flows" mentioned in the documentation.
3. The subagent should navigate to `http://localhost:5175`.
4. The subagent MUST explicitly test Both Light and Dark modes.
5. If visual regressions or contrast issues are detected, automatically plan and perform the fixes to the CSS tokens/components.
6. Commit any visual artifacts generated during the audit into `visual-regression/` folders and summarize the results in an artifact.
