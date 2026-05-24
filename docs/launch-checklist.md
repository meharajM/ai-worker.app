# Open Source Launch Checklist

Use this before making a public launch post or sharing the repository widely.

## Repository Settings

- Set repository description to: `Open-source voice-first desktop AI workspace for MCP tools, local files, browser automation, and provider-agnostic LLM workflows.`
- Set website URL to `https://ai-worker.tech`.
- Add topics:
  - `ai`
  - `ai-assistant`
  - `desktop-ai`
  - `electron`
  - `mcp`
  - `model-context-protocol`
  - `llm`
  - `agent`
  - `voice-interface`
  - `browser-automation`
  - `ollama`
  - `openai`
  - `gemini`
  - `playwright`
  - `local-first`
- Upload a social preview image under repository settings.
- Enable private vulnerability reporting if available.

## Launch Assets

- Use `docs/screenshots/chat-home.png` as the primary product screenshot.
- Use `docs/screenshots/mcp-connections.png` to show tool extensibility.
- Use `docs/screenshots/settings-llm.png` to show provider flexibility.
- Record a short demo video before public posting if possible.

## Launch Copy

Short description:

```text
AI-Worker is an open-source desktop AI workspace for chat, files, MCP tools, browser automation, voice input, and provider-agnostic LLM workflows.
```

Longer description:

```text
AI-Worker is a voice-first desktop AI workspace that connects chat to local files, browser automation, MCP tools, provider settings, speech recognition, and optional WhatsApp workflows. It is built with Electron, React, TypeScript, and MCP.
```

## Pre-Launch Checks

- README renders correctly on GitHub.
- `LICENSE` is detected by GitHub.
- Community profile shows README, license, contributing guide, code of conduct, security policy, and issue templates.
- All screenshot links render from the README.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:mock` have been run or documented as not run.
- Known startup or packaging issues are documented before public launch.

## Post-Launch Follow-Up

- Pin a GitHub issue for good first contributions.
- Add labels such as `good first issue`, `help wanted`, `bug`, `docs`, `security`, and `mcp`.
- Convert repeated questions into docs updates.
- Keep `CHANGELOG.md` updated for every public release.
