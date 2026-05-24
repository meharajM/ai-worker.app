# AI-Worker Open Source Visibility Plan

## Objective

Make AI-Worker credible, discoverable, and easy to adopt as an open source project. The repository should quickly answer what the product does, how to run it, how to contribute, how to report issues safely, and why the project is worth trying.

## Current Status

Completed in the open-source readiness pass:

- Rewrote `README.md` into a product-first entrypoint with screenshots, quick start, docs links, contribution links, release notes, CI notes, and license.
- Added `LICENSE` matching the MIT declaration in `package.json`.
- Added `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `CHANGELOG.md`.
- Added GitHub issue templates for bug reports and feature requests.
- Updated `.github/pull_request_template.md` to focus on summary, validation, screenshots, release notes, and version tagging.
- Expanded `package.json` metadata with repository, issue tracker, and search keywords.
- Added `docs/setup.md` and `docs/usage.md`.
- Added `docs/README.md` as a documentation index.
- Added `docs/launch-checklist.md` for GitHub settings, launch copy, topics, and post-launch follow-up.
- Added real screenshots under `docs/screenshots/`.
- Added `.env.r2.example` so documented release setup commands resolve.

Still open before a wider public launch:

- Review dependency audit findings and decide the upgrade path.
- Confirm `team@aiworker.app` is the correct public security and conduct contact.
- Fix or formally document the Electron development startup issue.
- Set GitHub repository description, website, topics, labels, private vulnerability reporting, and social preview image in GitHub settings.
- Align branch and release docs around `main` versus `prod`.
- Clean up or relocate crowded root-level internal markdown files.

## Success Criteria

- A new visitor can understand AI-Worker within 30 seconds from the README.
- A user can install or run the project from documented steps.
- A contributor can find contribution rules, issue paths, PR expectations, and security reporting instructions.
- GitHub and npm metadata expose the project clearly for search and indexing.
- Root docs and linked docs have no broken local references.
- The repository looks maintained, safe to evaluate, and ready to share publicly.

## Workstreams

### 1. Legal And Project Identity

Status: mostly complete.

Completed:

- Added root `LICENSE`.
- Kept `package.json` license as `MIT`.
- Standardized the public project name as `AI-Worker`.

Remaining:

- Confirm copyright holder wording.
- Confirm `https://ai-worker.tech` is the canonical homepage.

### 2. README And Product Proof

Status: mostly complete.

Completed:

- Moved the README from release-first to product-first.
- Embedded screenshots near the top and throughout the README.
- Added quick start, usage, docs, contribution, project status, release, CI, and license sections.
- Removed the stale `TESTING.md` reference.

Remaining:

- Review README rendering on GitHub after push.
- Add a short demo GIF or video if one is created.
- Add public download links once release artifacts are confirmed.

### 3. Setup, Usage, And Docs

Status: mostly complete.

Completed:

- Added `docs/setup.md`.
- Added `docs/usage.md`.
- Added `docs/README.md`.
- Added screenshot assets under `docs/screenshots/`.
- Added `docs/launch-checklist.md`.

Remaining:

- Validate all setup commands after the Electron startup issue is resolved.
- Decide whether older internal docs should move under a clearer `docs/internal/` or `docs/archive/` structure.

### 4. Community And Governance

Status: mostly complete.

Completed:

- Added `CONTRIBUTING.md`.
- Added `CODE_OF_CONDUCT.md`.
- Added `SECURITY.md`.
- Added `CHANGELOG.md`.
- Added issue templates.
- Refined PR template.

Remaining:

- Confirm the public contact email.
- Add repository labels in GitHub settings.
- Pin good first issues after the first public issue pass.

### 5. Metadata And Indexing

Status: mostly complete for repo files.

Completed:

- Updated `package.json` description.
- Added `repository`.
- Added `bugs`.
- Added discoverability keywords.

Remaining:

- Add `funding` if there is a funding URL.
- Add `CITATION.cff` only if the project targets academic or research citation.
- Set GitHub topics manually.

Recommended GitHub topics:

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

### 6. Security And Dependency Readiness

Status: needs follow-up.

Known issues:

- `npm install --package-lock-only --ignore-scripts` reported `37 vulnerabilities`: `1 low`, `10 moderate`, `25 high`, and `1 critical`.
- `npm audit --omit=dev --audit-level=critical` reported `21 production dependency vulnerabilities`: `8 moderate`, `12 high`, and `1 critical`.
- The critical production finding is in `protobufjs`, reached through the WhatsApp/libsignal dependency chain.
- High production findings include Electron, `@modelcontextprotocol/sdk`, Axios, Hono, lodash, minimatch, and related transitive packages.

Tasks:

- Run `npm audit` and classify findings by production impact.
- Avoid blind `npm audit fix --force` unless the breaking changes are reviewed.
- Prioritize production dependencies and Electron-related exposure.
- Document any accepted risk before public launch.

### 7. GitHub Surface Polish

Status: requires repository settings access.

Manual tasks:

- Set repository description.
- Set website URL.
- Add topics.
- Upload social preview image.
- Enable private vulnerability reporting if available.
- Create labels such as `good first issue`, `help wanted`, `bug`, `docs`, `security`, `mcp`, and `needs-triage`.

### 8. Branch And Release Alignment

Status: needs decision.

Current mismatch:

- CI runs on `main` and `prod`.
- Auto-tagging runs on PR merges into `prod`.
- Older docs and templates referenced `main` for tagging.

Tasks:

- Decide whether `main` or `prod` is the public release branch.
- Update README, PR template, and workflows to use the same language.
- Keep local R2 publishing docs if releases remain local-first.

## Next Execution Order

1. Audit and triage dependency vulnerabilities.
2. Fix or document the Electron startup issue.
3. Confirm public maintainer/security contact.
4. Push the open-source readiness files and inspect GitHub rendering.
5. Set GitHub description, topics, labels, vulnerability reporting, and social preview.
6. Resolve `main` versus `prod` release language.
7. Clean up root-level internal markdown docs.

## Definition Of Done

- GitHub community profile shows README, license, contributing guide, code of conduct, security policy, and issue templates.
- README renders with screenshots and clear setup/contribution paths.
- Package metadata is complete enough for npm/GitHub discovery.
- Security reporting is private and documented.
- Dependency audit findings are triaged.
- GitHub settings are updated for discovery and sharing.
- Remaining known issues are documented honestly before public launch.
