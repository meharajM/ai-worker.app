# Visual Regression Baseline - MCP Connections Flow

---
**Branch:** `main`
**Date:** 2026-03-14
**Status:** Baseline Established
---

## 🏗️ Interface Overview
The MCP Connections page manages external tool integrations.

### 1. MCP Dashboard
![MCP Dashboard](file:///Users/meharaj/.gemini/antigravity/brain/49040519-3c11-49c0-81d3-26531d798b4c/mcp_dashboard_verification_1773448799210.png)
- **Header:** "MCP Connections" title with summary (8 connected / 8 configured).
- **Button:** Teal "Add Connection" button at the top right.
- **List:** Cards for each server (File System, Brave Search, etc.) with:
  - Icon and Name.
  - "Active" status badge.
  - Inline command summary.
  - Action icons (Edit, Toggle Power, Delete).

### 2. Add Connection Form
![Add Form](file:///Users/meharaj/.gemini/antigravity/brain/49040519-3c11-49c0-81d3-26531d798b4c/mcp_add_form_verification_1773448812189.png)
- **Layout:** Card-based form overlaying the list.
- **Fields:** Name, Connection Type (Stdio vs SSE), Command, and Arguments.
- **Alert:** Yellow warning box about local secret storage.
- **Actions:** Teal "Add Connection" and secondary "Cancel" button.

---

## 📝 Observations
- The form uses a distinct dark background (`#1a1d23` likely) which is targeted for replacement in PR #113.
- Typography is consistent between headers and body text.
- Form inputs have subtle borders and clear focus states.
