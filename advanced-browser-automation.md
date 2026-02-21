# Advanced Browser Automation Strategies

This document details three advanced strategies for optimizing browser automation in the AI-Worker app. These are follow-up optimizations to the already implemented "Compound Actions" (Option 1) and "Action Recipes" (Option 2).

---

## Option 3: Electron `BrowserView` + Embedded CDP

**Concept:** Instead of launching a separate Playwright browser instance (which is hidden and resource-heavy), use Electron's native `BrowserView` capability. This places the automated browser *inside* the application window, allowing the user to watch the agent work in real-time, while controlling it via the Chrome DevTools Protocol (CDP) directly from the main process.

### Architecture
*   **Current:** `Agent → PlaywrightService → Playwright Binary → Chromium Instance`
*   **Proposed:** `Agent → BrowserViewService → Electron Main Process → webContents.debugger (CDP)`

### Key Benefits
*   **Zero External Dependencies:** No Playwright binary download required.
*   **Visual Feedback:** The browser is part of the UI, not a headless ghost process.
*   **Shared Session:** The user can intervene (click/type) in the same view the agent is controlling.
*   **Performance:** Zero-copy screenshots (the surface is already in the compositor).

### Implementation Strategy

1.  **Create `BrowserViewService.ts` (Main Process)**
    ```typescript
    import { BrowserView, BrowserWindow, ipcMain } from 'electron';

    class BrowserViewService {
      private view: BrowserView;
      
      constructor(mainWindow: BrowserWindow) {
        this.view = new BrowserView();
        mainWindow.setBrowserView(this.view);
        this.view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
        
        // Attach CDP
        try {
          this.view.webContents.debugger.attach('1.3');
        } catch (err) {
          console.log('Debugger attach failed: ', err);
        }
      }

      async sendCommand(method: string, params?: any) {
        return this.view.webContents.debugger.sendCommand(method, params);
      }
    }
    ```

2.  **Map Tools to CDP Commands**
    *   `navigate` → `Page.navigate`
    *   `click` → `Input.dispatchMouseEvent` (requires x,y coordinates from DOM)
    *   `type` → `Input.dispatchKeyEvent`
    *   `get_state` → `DOM.getDocument` + `DOM.describeNode`

3.  **UI Integration**
    *   Add a toggle in the renderer to "Show Agent View".
    *   When active, resize the `BrowserView` to fill a designated panel in the layout.

### Trade-offs
*   **Loss of Abstraction:** Playwright handles complex waiting, auto-dismissing dialogs, and shadowing DOMs. CDP is raw and brittle; you'd need to re-implement "wait for element" logic.
*   **Browser Lock-in:** Works only with Electron's bundled Chromium (no Firefox/WebKit).

---

## Option 4: Vision Fallback Mode

**Concept:** When CSS selectors fail (dynamic IDs, Shadow DOM, obscure frameworks), fall back to a "human-like" vision approach. The agent takes a screenshot, asks a Vision-Language Model (VLM) for the XY coordinates of an element, and clicks those coordinates.

### Architecture
Flow: `Tool Fail (Selector Not Found)` → `Capture Screenshot` → `VLM Call ("Where is the 'Submit' button?")` → `Return [x, y]` → `Mouse Click at [x, y]`

### Implementation Strategy

1.  **Enhance `PlaywrightService.ts`**
    Add a private method `resolveCoordinatesViaVision(task: string): Promise<{x, y}>`.

2.  **Integrate with a VLM (e.g., GPT-4o, Claude 3.5 Sonnet)**
    *   **System Prompt:** "You are a UI locator assistant. Return the center coordinates [x, y] of the element described by the user based on the image."
    *   **New Tool:** `mouse_click(x, y)`

3.  **Automatic Fallback Logic**
    Update `callTool('click', ...)`:
    ```typescript
    try {
      await page.click(selector);
    } catch (e) {
      if (isSelectorError(e)) {
        console.log("Selector failed, attempting vision fallback...");
        const screenshot = await page.screenshot();
        const { x, y } = await this.askVlmForCoordinates(screenshot, selectorDesc);
        await page.mouse.click(x, y);
      }
    }
    ```

### Key Benefits
*   **Resilience:** Immune to code changes, dynamic classes, and obfuscated DOMs.
*   **Universal Support:** Works on canvas-based apps (Figma, Google Maps) where there is no DOM.

### Trade-offs
*   **Latency:** Vision calls are slow (~1-3s).
*   **Cost:** Processing high-res screenshots consumes significant tokens.

---

## Option 5: Stagehand Integration

**Concept:** Integrate [Stagehand](https://github.com/browserbase/stagehand), an AI-native browser automation library designed specifically for agents. Unlike Playwright (which expects selectors), Stagehand expects *intent*.

### Architecture
Replace manual selector logic with Stagehand's AI-driven methods.
`await page.act("click the login button")` instead of `await page.click("#login-btn")`

### Implementation Strategy

1.  **Install Stagehand**
    `npm install @browserbase/stagehand`

2.  **Create `StagehandService.ts`**
    Wrap the library to expose an MCP interface.

3.  **Define New Tools**
    *   `stagehand_act(instruction)`: Performs an action based on natural language.
    *   `stagehand_extract(instruction, schema)`: Scrapes data into a specific JSON shape.
    *   `stagehand_observe(instruction)`: Returns relevant elements for a specific goal.

    ```typescript
    // Example Tool Implementation
    case 'stagehand_act':
      await stagehand.act({ action: args.instruction });
      return { result: 'Action completed' };
    ```

### Key Benefits
*   **Self-Healing:** The library "figures out" the DOM for you. You stop writing selectors entirely.
*   **Simplified Agent Logic:** The agent just says "click X", and the library handles the *how*.

### Trade-offs
*   **Black Box:** You lose control over exactly *what* is being clicked.
*   **Latency/Cost:** Stagehand makes its own LLM calls under the hood to analyze the DOM, adding latency and cost to every action.
*   **Stability:** It is a newer, less mature library compared to Playwright.
