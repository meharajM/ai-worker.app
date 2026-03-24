# AI-Worker App

[![CI/CD](https://github.com/meharajM/ai-worker.app/actions/workflows/ci.yml/badge.svg)](https://github.com/meharajM/ai-worker.app/actions/workflows/ci.yml)

Voice-first desktop workspace with MCP integration.

## 🚀 Release & Publishing

The release process is optimized to run locally on macOS to avoid High-Cost GitHub Actions runners (10x rate) and stay within the GitHub Free Tier limits.

### 1. One-time Setup
To publish releases to Cloudflare R2, create a `.env.r2` file in the project root:

```bash
cp .env.r2.example .env.r2
# Fill in your R2 credentials from the Cloudflare Dashboard
```

### 2. Publishing to Cloudflare R2
Run any of the following commands from your local Mac. These will automatically **fix dependency issues**, run **quality checks** (lint/typecheck), **build** the binaries, and **upload** them to your R2 bucket.

```bash
# Build & Publish ALL platforms (Mac arm64 + Linux x64/arm64 + Windows x64)
# Note: Linux builds require Docker Desktop to be running.
npm run publish:all

# Build & Publish Mac ONLY (Fastest, no Docker needed)
npm run publish:mac

# Build & Publish Mac Universal (Includes support for Intel Macs)
npm run publish:mac:universal

# Build & Publish Linux + Windows only
npm run publish:linux-win
```

*All publish scripts will ask for a **'yes'** confirmation before proceeding to production.*

---

## 🛠️ CI/CD Pipeline (GitHub Actions)

The GitHub Actions pipeline is configured as a **Quality Gate only** to maintain Free Tier status:

- **Runs on**: Pull Requests and pushes to `main`.
- **Jobs**: Runs `Lint`, `Typecheck`, and `E2E Mock Tests`.
- **Infrastructure**: Only uses `ubuntu-latest` runners (1x cost). Artifact storage and macOS builds are disabled to save quota.

---

## 🏗️ Development & Building

### Prerequisites
- **Node.js**: (Version >=22.12.0)
- **Homebrew**: (For auto-setup of build tools)
- **Docker Desktop**: (Optional, only required for Linux builds on Mac)

### Basic Commands
```bash
# Start dev server
npm run dev

# Local quality checks
npm run lint
npm run typecheck

# Build JS/Renderer bundle
npm run build
```

### Dependency Shim (WhatsApp)
If you are building for production manually (without using the `publish` scripts), you **must** run the following first to fix the `libsignal` bundling issue:
```bash
npm run prebuild:electron
```
*(This is already handled automatically for you in all `npm run publish:*` scripts.)*

---

For local testing details, see [TESTING.md](./TESTING.md).
