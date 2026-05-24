# Contributing To AI-Worker

Thanks for taking the time to improve AI-Worker. This project is an open-source desktop AI workspace, so good contributions usually make the app easier to install, understand, trust, or extend.

## Before You Start

- Read the [README](./README.md) for the product overview.
- Read [docs/setup.md](./docs/setup.md) and get the app running locally.
- Search existing issues before opening a new one.
- For larger changes, open an issue first so the design and scope can be discussed.

## Local Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm run build
npm run test:mock
```

For Python-backed MCP tools such as MarkItDown, install Python 3 and `uv`, or run the dependency setup script documented in [scripts/README.md](./scripts/README.md).

## Pull Request Expectations

- Keep changes focused and explain the user-facing impact.
- Include screenshots for visible UI changes.
- Include validation notes: commands run, manual checks performed, and known gaps.
- Update docs when behavior, setup, commands, or screenshots change.
- Avoid unrelated refactors in feature or bug-fix PRs.

## Code Style

- Follow the existing TypeScript, React, Electron, and Tailwind patterns.
- Prefer small, readable modules over broad abstractions.
- Keep Electron main-process, preload, and renderer responsibilities separate.
- Treat file, browser, WhatsApp, and MCP operations as user-trust-sensitive surfaces.

## Reporting Bugs

Use the bug report template and include:

- operating system
- Node.js version
- app version or commit
- steps to reproduce
- expected behavior
- actual behavior
- logs or screenshots when useful

## Requesting Features

Use the feature request template and describe:

- the workflow you want to improve
- who benefits from it
- what current workaround exists
- whether it touches chat, MCP, browser automation, speech, providers, or packaging

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](./SECURITY.md).

## Conduct

All participation is covered by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
