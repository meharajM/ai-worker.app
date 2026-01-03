# End-to-End Integration Testing

This project includes an automated E2E integration test suite using **Playwright** with the **Electron** executable. This ensures that the application (Main Process + Renderer) functions correctly in a production-like environment.

## Running Tests

To run the integration tests:

```bash
npm run test:e2e
```

### Requirements for Local Tests
*   **Built Application**: You must run `npm run build` at least once before running integration tests.
*   **LLM Provider (for `test:e2e`)**: The production test (`test:e2e`) checks for a **READY** status. This requires either **Ollama** running locally, an **OpenAI** key configured, or a **WebGPU-compatible GPU** for on-device AI. 
*   **Independent Mocks (for `test:mock`)**: The mocked test (`test:mock`) is autonomous and does not require external LLMs or hardware acceleration.

## Test Coverage

The `tests/integration_test.cjs` script covers the following critical flows defined in `plan.md`:

1.  **Application Launch**:
    *   Verifies Electron launch and Main Window creation.
    *   Checks for IPC connectivity (App Version).

2.  **UI Initialization** (Phases 1 & 2):
    *   Verifies presence of Voice Input (Microphone button).
    *   Verifies Chat Input field.
    *   Verifies "READY" status (confirming WebLLM/Hardware initialization).

3.  **Navigation** (Phase 11):
    *   Switches between Chat, MCP Connections, and Settings views.
    *   Verifies correct rendering of each panel.

4.  **Error Handling**:
    *   Captures Renderer Console logs and Network Errors during execution.
    *   Saves a screenshot (`test-failure.png`) automatically if a test fails.

## Notes

*   **Production Mode**: The test sets `NODE_ENV=production` to ensure behavior matches the built application.

## Mocked Integration Tests

To run the advanced mocked tests (Simulating LLM and MCP Servers):

```bash
npm run test:mock
```

This test:
1.  Intercepts network requests to simulate an **Ollama** provider.
2.  Spawns a local **Mock MCP Server** (`tests/mocks/start-server.js`).
3.  Verifies that the app can connect, list tools, and execute a tool call loop end-to-end.

