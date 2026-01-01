# AI-Worker App

Voice-first desktop workspace with MCP integration.

## Testing & CI/CD

This project uses GitHub Actions for continuous integration.

- **Tests**: Every push runs typechecking and automated E2E mock tests.
- **Builds**: Multi-platform binaries (Linux, Windows, macOS) are built automatically.
- **Releases**: Creating a tag (e.g., `v1.0.0`) automatically creates a draft GitHub release with the compiled binaries.

For local testing details, see [TESTING.md](./TESTING.md).

## Building

### Prerequisites

- Node.js
- NPM/Yarn/PNPM

### Build for Host OS

```bash
npm run build
```

### Build for Windows on Linux

To build the Windows `.exe` executable/installer on Linux, **Wine** is required.

1. Install Wine using the provided helper script:
   ```bash
   chmod +x install_build_deps.sh
   ./install_build_deps.sh
   ```
   Or install it manually using your distribution's package manager (ensure you have both 64-bit and 32-bit support if needed).

2. Run the Windows build command:
   ```bash
   npm run build:win
   ```
