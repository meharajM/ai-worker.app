# Visual Regression Baseline - Settings Flow

---
**Branch:** `main`
**Date:** 2026-03-14
**Status:** Baseline Established
---

## 🏗️ Interface Overview
The Settings page allows users to configure LLM providers and application appearance.

### 1. LLM Provider Settings
![LLM Provider](file:///Users/meharaj/.gemini/antigravity/brain/49040519-3c11-49c0-81d3-26531d798b4c/settings_llm_provider_verification_1773448972580.png)
- **Navigation:** Vertical primary sidebar (Account, LLM Provider, Speech Recognition, etc.).
- **Provider Toggles:** Horizontal pill-style buttons for Ollama, Gemini, etc.
- **Form:** Large card containing API key input and model selector.

### 2. Appearance Settings
![Appearance Settings](file:///Users/meharaj/.gemini/antigravity/brain/49040519-3c11-49c0-81d3-26531d798b4c/settings_appearance_verification_1773448975340.png)
- **Theme Selection:** Pill-style selection for Dark, Light, and System.
- **Current Limitation:** Note explicitly states "Light theme coming soon. Currently dark mode only." 
- **Bug Check:** In the screenshot, "Light" is highlighted even though the app is in Dark mode. This is a clear target for verification in the PR branch.

---

## 📝 Observations
- The "Light" theme button being highlighted while in Dark Mode is a known UI bug in `main`.
- The spacing between sidebar items and the main content area is consistent.
- Settings cards use a slightly lighter grey than the main background.
