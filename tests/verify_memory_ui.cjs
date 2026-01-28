
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('Main: Starting Memory UI Verification...');

    // Launch Electron app
    const electronApp = await electron.launch({
        args: [path.join(__dirname, '../out/main/index.js')],
        env: {
            ...process.env,
            NODE_ENV: 'development'
        }
    });

    try {
        // Wait for the first window to open
        const window = await electronApp.firstWindow();
        console.log('Main: Window opened');
        
        // Wait for app to load
        await window.waitForLoadState('domcontentloaded');
        await window.waitForTimeout(2000); // Give React time to hydrate

        // 1. Navigate to Settings
        console.log('Main: Navigating to Settings...');
        const settingsButton = window.locator('button[title="Settings"]');
        await settingsButton.waitFor({ state: 'visible', timeout: 5000 });
        await settingsButton.click();
        
        // 2. Click on Memory Tab in Settings Sidebar
        // The Memory tab has text "Memory"
        console.log('Main: Clicking Memory tab...');
        const memoryTab = window.locator('button', { hasText: 'Memory' }).first();
        await memoryTab.waitFor({ state: 'visible', timeout: 5000 });
        await memoryTab.click();

        // 3. Verify Memory Panel Content
        console.log('Main: Verifying Memory Panel content...');
        
        // Header
        const header = window.locator('h3', { hasText: 'Memory Architecture' });
        await header.waitFor({ state: 'visible', timeout: 5000 });
        console.log('✅ Found Memory Architecture header');
        
        // Backend Selector
        const backendLabel = window.locator('label', { hasText: 'Storage Backend' });
        await backendLabel.waitFor({ state: 'visible' });
        console.log('✅ Found Storage Backend selector');
        
        const serverMemoryBtn = window.locator('button', { hasText: 'Server Memory' });
        await serverMemoryBtn.waitFor({ state: 'visible' });
        console.log('✅ Found Server Memory option');

        const mementoBtn = window.locator('button', { hasText: 'Memento MCP (Neo4j)' });
        await mementoBtn.waitFor({ state: 'visible' });
        console.log('✅ Found Memento MCP option');

        // Stats Section
        const statsHeader = window.locator('h4', { hasText: 'Active Memory Stats' });
        await statsHeader.waitFor({ state: 'visible' });
        console.log('✅ Found Active Memory Stats section');

        // Check for specific stats labels
        await window.locator('div', { hasText: 'Total Entities' }).waitFor({ state: 'visible' });
        await window.locator('div', { hasText: 'Relations' }).waitFor({ state: 'visible' });
        await window.locator('div', { hasText: 'Storage Size' }).waitFor({ state: 'visible' });
        console.log('✅ Found All Stats labels');

        console.log('✅ MEMORY UI VERIFICATION PASSED');

    } catch (error) {
        console.error('❌ VERIFICATION FAILED:', error);
        
        // Take screenshot on failure
        try {
            const page = await electronApp.firstWindow();
            await page.screenshot({ path: 'memory_ui_failure.png' });
            console.log('Screenshot saved to memory_ui_failure.png');
        } catch (e) {
            console.error('Failed to take screenshot:', e);
        }
        
        process.exit(1);
    } finally {
        await electronApp.close();
    }
})();
