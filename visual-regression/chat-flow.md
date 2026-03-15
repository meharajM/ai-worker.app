# Visual Regression Baseline - Chat Flow

---
**Branch:** `main`
**Date:** 2026-03-14
**Status:** Baseline Established
---

## 🏗️ Interface Overview
The current interface is dark-themed with a modern, high-contrast aesthetic.

### 1. Initial Landing State
![Landing Page](file:///Users/meharaj/.gemini/antigravity/brain/49040519-3c11-49c0-81d3-26531d798b4c/landing_page_1773448574100.png)
- **Background:** Deep dark grey/black.
- **Components:** Feature cards for "Discovery & Extract" and "Ultimate Trip Planner".
- **Header:** "Sign In" button (left) and "NO LLM" status indicator (right).
- **Input:** Centered message input with attachment, vision, and send icons.

### 2. Message Exchange
![Chat Message](file:///Users/meharaj/.gemini/antigravity/brain/49040519-3c11-49c0-81d3-26531d798b4c/chat_message_error_1773448600808.png)
- **User Bubble:** Blue background, white text, timestamp.
- **Bot Bubble:** Dark grey background, white text, bot icon on the left.
- **Header Changes:** "Clear Chat" button appears above the chat history.

### 3. Sidebar
![Sidebar Visible](file:///Users/meharaj/.gemini/antigravity/brain/49040519-3c11-49c0-81d3-26531d798b4c/sidebar_shown_1773448648022.png)
- **Width:** Responsive (appears on wide screens, collapses on narrow).
- **Items:** Hub Chat, MCP Connections, Hub Settings.

---

## 📝 Observations
- The design system uses hardcoded colors (observed in PR #113 diff as something to be fixed).
- Components have soft shadows but rely heavily on background contrast.
- Tooltip/Hover behavior is consistent across action buttons.
