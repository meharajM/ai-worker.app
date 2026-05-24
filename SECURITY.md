# Security Policy

AI-Worker connects local files, browser automation, MCP tools, LLM providers, and optional WhatsApp workflows. Please report security issues privately so maintainers can investigate before details are public.

## Supported Versions

AI-Worker is pre-1.0. Security fixes target the latest public release and the active default development branches.

## Report A Vulnerability

Please do not open a public issue for vulnerabilities.

Preferred reporting paths:

- Use GitHub private vulnerability reporting if it is enabled for this repository.
- Email `team@aiworker.app` with the subject `AI-Worker security report`.

Include:

- affected version or commit
- operating system
- clear reproduction steps
- impact assessment
- logs, screenshots, or proof-of-concept details where useful

## Scope

In scope:

- local file access controls
- secret storage and API key handling
- Electron main/preload/renderer boundaries
- MCP tool execution and process handling
- browser automation safety
- WhatsApp approval and messaging flows
- dependency or packaging vulnerabilities that affect AI-Worker users

Out of scope:

- social engineering
- attacks requiring already-compromised devices
- denial-of-service reports without a practical security impact
- vulnerabilities in third-party services unless AI-Worker makes them materially worse

## Disclosure

Maintainers will acknowledge valid reports when possible, investigate, and coordinate a fix before public disclosure. Please give maintainers reasonable time to respond before sharing details publicly.
