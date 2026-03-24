## Overview
This PR resolves critical stability and persistence issues within the WhatsApp integration pipeline. It fixes a major bug that forced users to re-scan the QR code every time the app restarted (due to accidental credential deletion), resolves concurrent duplicate agent triggers from incoming messages, and adds regex parsing resilience to the LLM utility.

## 🐛 Fixes & Improvements

**1. Fixed WhatsApp Session Persistence (Authentication Wipes)**
* **Problem:** The `connection.update` error handler inside `WhatsAppService.ts` was fundamentally flawed due to missing return boundaries. Any time the `baileys` library experienced a generic background network timeout or stream error, the auto-reconnect fallback accidentally allowed execution to plunge straight into `this._clearAuth()`, permanently deleting the user's `creds.json` from the hard drive and forcing them to re-link on every app launch.
* **Fix:** Completely restructured the connection closure logic into strict, compartmentalized `if/return` blocks. Stream errors and standard network timeouts now correctly soft-reconnect without triggering the `whatsapp-auth` total wipe function.

**2. Resolved Duplicate Message/Agent Execution**
* **Problem:** The `baileys` underlying WebSocket routinely fires `messages.upsert` twice for incoming texts (once for the raw encrypted stub, and once for the decrypted body). This caused the frontend to double-render chat bubbles and fire two concurrent AI agent chains for a single incoming message.
* **Fix:** Added a secure `processedMessageIds` Set deduplicator natively into the main-process listener. It now waits until the payload successfully parses before permanently recording the ID, completely blocking duplicate prompts while maintaining a safe 200-message memory cap.

**3. Fixed Unintentional UI Force-Disconnects (`WhatsAppConnectionDialog.tsx`)**
* **Problem:** Clicking the modal backdrop or hitting ESC right as a handshake succeeded would accidentally send a force-disconnect RPC command to the backend because the `handshakeCode` lingered in React state. 
* **Fix:** Hardened the `handleClose` trigger to unconditionally cancel the socket *only* if the UI state is actively sitting on `step === 'verify'`. Verified handshakes are now allowed to seamlessly transition and unmount.

**4. Shielded the Backend against Intentional Disconnects**
* **Fix:** Added an `explicitDisconnect` state flag. When a user manually taps "Pause connection", the service now intentionally skips the "unknown stream error" network heuristics, directly preventing local logic bombs.

**5. Enhanced LLM Tool Calling Resilience (`utils.ts`)**
* **Fix:** Improved JSON extraction within `parseToolCallsFromJson` to automatically correct contiguous malformed JSON objects (e.g., `} {` becomes `},{` array syntax), boosting the reliability of the tools engine when smaller LLM models hallucinate syntax bounds.

## 🧪 Testing Performed
- **E2E Automation Suite**: Verified no interference or rendering issues with standard UI elements.
- **`whatsapp_integration.test.ts`**: All 8/8 internal logic suites assert successfully.
- Manually confirmed credential persistence natively correctly preserves `phone.txt` & `creds.json` across standard OS process shutdowns (`Cmd+Q`).
