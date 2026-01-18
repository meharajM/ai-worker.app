const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

(async () => {
    console.log('🚀 Starting Phase 13 E2E Tests...');

    // Ensure screenshot directory exists and is empty
    if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    } else {
        const files = fs.readdirSync(SCREENSHOT_DIR);
        for (const file of files) {
            if (file.endsWith('.png')) fs.unlinkSync(path.join(SCREENSHOT_DIR, file));
        }
    }

    const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');

    let execPath = 'electron';
    if (fs.existsSync(macPath)) {
        execPath = macPath;
    } else if (fs.existsSync(linuxPath)) {
        execPath = linuxPath;
    }

    console.log('Using electron execPath:', execPath);

    let electronApp;
    try {
        console.log('🚀 Launching Electron...');
        electronApp = await electron.launch({
            executablePath: execPath,
            args: [
                path.join(__dirname, '../out/main/index.js'),
                '--no-sandbox',
                '--disable-gpu',
            ],
            timeout: 60000,
            env: {
                ...process.env,
                NODE_ENV: 'production'
            }
        });
        console.log('✅ Electron launched successfully');
    } catch (launchError) {
        console.error('❌ Failed to launch Electron:', launchError);
        process.exit(1);
    }

    try {
        const window = await electronApp.firstWindow();

        // --- 1. NETWORK MOCKING ---

        // Gemini Mocking
        await window.route('**/generativelanguage.googleapis.com/v1beta/models**', async route => {
            console.log('intercepted Gemini models list');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ models: [{ name: "models/gemini-1.5-flash", displayName: "Gemini 1.5 Flash" }] })
            });
        });

        await window.route('**/generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent**', async route => {
            console.log('intercepted Gemini content generation');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    candidates: [{
                        content: {
                            role: "model",
                            parts: [{ text: "Hello from Mock Gemini!" }]
                        },
                        finishReason: "STOP"
                    }]
                })
            });
        });

        // OpenRouter Mocking
        await window.route('**/openrouter.ai/api/v1/models**', async route => {
            console.log('intercepted OpenRouter models list');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: [{ id: "google/gemini-flash-1.5", name: "Gemini 1.5 Flash" }] })
            });
        });

        await window.route('**/openrouter.ai/api/v1/chat/completions**', async route => {
            console.log('intercepted OpenRouter chat');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    choices: [{
                        message: {
                            role: "assistant",
                            content: "Hello from Mock OpenRouter!"
                        }
                    }]
                })
            });
        });

        await window.waitForLoadState('domcontentloaded');
        console.log('✅ Window Loaded & Network Routes Set');

        // --- 2. CONFIGURE GEMINI ---
        console.log('\n--- Testing Gemini Configuration ---');
        await window.click('button[title="Settings"]');
        await window.waitForSelector('text=LLM Provider');

        // Click Gemini provider button to show config
        const preferredProviderSection = window.locator('div:has-text("Preferred Provider")');
        await preferredProviderSection.locator('button:has-text("Gemini")').click();

        await window.fill('input[placeholder="Enter Gemini API Key..."]', 'mock-gemini-key');

        const geminiSection = window.locator('div:has-text("Google Gemini")');
        await geminiSection.locator('button:has-text("Test Connection")').click();

        await window.waitForSelector('text=Connection successful!', { timeout: 15000 });
        console.log('✅ Gemini Connection Verified');

        // --- 3. CONFIGURE OPENROUTER ---
        console.log('\n--- Testing OpenRouter Configuration ---');
        // Click OpenRouter provider button to show config
        await preferredProviderSection.locator('button:has-text("OpenRouter")').click();

        await window.fill('input[placeholder="Enter OpenRouter API Key..."]', 'mock-openrouter-key');

        const orSection = window.locator('div:has-text("OpenRouter")');
        await orSection.locator('button:has-text("Test Connection")').click();

        await window.waitForSelector('text=Connection successful!', { timeout: 15000 });
        console.log('✅ OpenRouter Connection Verified');

        // --- 4. SWITCH PROVIDER & CHAT ---
        console.log('\n--- Testing Chat with Gemini ---');
        // Select Gemini as preferred provider
        await preferredProviderSection.locator('button:has-text("Gemini")').click();
        await window.waitForTimeout(500); // Small wait for state to settle

        await window.click('button[title="Chat"]');

        await window.fill('textarea', 'Hello Gemini');
        await window.click('button:has(svg.lucide-send)');

        // Wait for response text from mock
        await window.waitForSelector('text=Hello from Mock Gemini!', { timeout: 20000 });
        console.log('✅ Gemini Chat Verified');

        // Note: Activity Timeline feature was removed from the sidebar.
        // Tests for that feature have been skipped.
        console.log('ℹ️ Activity Timeline tests skipped (feature not in current UI)');

        console.log('\n🎉 PHASE 13 TESTS PASSED');

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error);
        try {
            const window = await electronApp.firstWindow();
            await window.screenshot({ path: path.join(SCREENSHOT_DIR, 'test-phase13-failure.png') });
        } catch (e) { }
        process.exit(1);
    } finally {
        await electronApp.close();
    }
})();
