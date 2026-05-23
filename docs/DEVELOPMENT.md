# Developer Guide 🛠️

Welcome! This document outlines developer workflows, environment setup, coding guidelines, and testing frameworks for contributing to AI-Worker.

## Project Architecture Overview

AI-Worker is built using **Electron**, **React**, **TypeScript**, and **Vite**.
- **`src/main/`**: Node.js backend. Manages the Electron browser window lifecycles, configuration stores, native processes (such as MCP client runtimes), speech model servers, and local SQLite data.
- **`src/preload/`**: The security gateway. Exposes APIs to the renderer using Electron's `contextBridge`.
- **`src/renderer/`**: The frontend UI. Built using React, TailwindCSS, Lucide icons, and Radix UI elements.
- **`src/renderer/src/lib/agent/`**: Core agent orchestration, tool execution, and conversational loop state services.

---

## 🚀 Running the Development Environment

Start the development server with Hot Module Replacement (HMR):
```bash
npm run dev
```
To clean cache/build directories, reset local databases, and launch the dev environment fresh:
```bash
npm run dev:clean
```

---

## 🧹 Code Quality and Guidelines

We enforce strict coding and security rules to maintain stability:

### 1. TypeScript Standards
- Enable strict mode in TypeScript config.
- Avoid using `any` type. Use explicit types or generic parameters where possible.
- Declare components and handlers with precise typing.

### 2. Electron Security Boundaries
Every contribution must respect Electron security conventions:
- **Never expose raw Node objects** via preload.
- Expose only the minimum surface necessary for IPC invokes.
- Sanitize paths, restrict protocols, and validate all inputs in Main-process IPC handlers.

### 3. Linting and Formatting
Check and autofix code quality issues before opening a pull request:
```bash
# Verify formatting/linter errors
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Check TypeScript compiler
npm run typecheck
```

---

## 🧪 Testing Suites

AI-Worker has a comprehensive test suite covering end-to-end user flows, speech recognition, and browser automation tools.

### Mock E2E & UI Tests
Validate core user interfaces and dialog layers without spinning up external APIs or models:
```bash
npm run test:mock
```

### Speech Integration Tests
Ensure local speech-to-text models (Vosk) compile and analyze voice streams correctly:
```bash
npm run test:speech
```

### Full E2E & Tool Checking
Run playwright and system-wide verification tests:
```bash
# Mocked E2E pipeline
npm run test:e2e

# Playwright browser integration check
npm run test:playwright

# Real E2E verification (requires API configuration)
npm run test:e2e:real
```

### PR Check List
Before committing your work, verify everything builds correctly:
```bash
npm run test:build
```
This runs prebuild checks, compiles the application, and validates bundle integrity.
