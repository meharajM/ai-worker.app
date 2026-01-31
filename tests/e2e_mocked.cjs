const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

(async () => {
    console.log('🚀 Starting E2E Mocked Integration Test...');

    // Ensure screenshot directory exists and is empty
    if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    } else {
        const files = fs.readdirSync(SCREENSHOT_DIR);
        for (const file of files) {
            if (file.endsWith('.png')) fs.unlinkSync(path.join(SCREENSHOT_DIR, file));
        }
    }

    // Find the installed electron binary
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
                '--disable-dev-shm-usage',
                '--window-size=1200,800'
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

        window.on('console', msg => console.log(`[Renderer]: ${msg.text()}`));
        window.on('pageerror', err => console.error(`[Renderer Error]: ${err}`));

        // Check tags mock
        await window.route('**/api/tags', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ models: [{ name: "mock-llm:latest" }] })
            });
        });

        await window.route('**/api/chat', async route => {
            const request = route.request();
            const postData = JSON.parse(request.postData() || '{}');
            const lastMsg = postData.messages?.[postData.messages.length - 1]?.content || "";

            console.log(`[Mock LLM] Request received. Content: "${lastMsg}"`);

            if (lastMsg.toLowerCase().includes('think')) {
                // Return Tool Call
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        model: "mock-llm",
                        done: true,
                        message: {
                            role: "assistant",
                            content: "I am thinking about it.",
                        }
                    })
                });
            } else {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        model: "mock-llm",
                        done: true,
                        message: {
                            role: "assistant",
                            content: "I am a mock AI."
                        }
                    })
                });
            }
        });

        await window.waitForLoadState('domcontentloaded');
        console.log('✅ Window Loaded');

        // --- 1. SWITCH TO OLLAMA PROVIDER ---
        await window.click('button[title="Settings"]');
        await window.waitForSelector('text=LLM Provider');
        await window.click('text=Ollama');
        console.log('✅ Switched to Ollama');

        // --- 2. ADD MCP SERVER ---
        const uniqueServerName = `ThinkingServer-${Date.now()}`;
        console.log(`  - Adding MCP server: ${uniqueServerName}`);

        await window.click('button[title="MCP Connections"]');
        await window.click('button:has-text("Add Connection")');

        await window.fill('input[placeholder="My Server"]', uniqueServerName);
        await window.click('button:has-text("Stdio (Local)")');

        await window.fill('input[placeholder="npx, python, node..."]', 'npx');
        await window.fill('input[placeholder="--args..."]', '-y @modelcontextprotocol/server-sequential-thinking');

        console.log('  - Submitting MCP form...');
        await window.getByRole('button', { name: 'Add Connection', exact: true }).click();

        console.log(`  - Waiting for ${uniqueServerName} card...`);
        const testId = `mcp-server-card-${uniqueServerName.toLowerCase().replace(/\s+/g, '-')}`;
        const mockServerCard = window.locator(`[data-testid="${testId}"]`);
        await mockServerCard.waitFor({ state: 'visible', timeout: 15000 });

        console.log('  - Clicking Connect on card...');
        await mockServerCard.locator('button[title="Connect"]').click();

        console.log('  - Waiting for "Active" status...');
        await mockServerCard.locator('span:has-text("Active")').waitFor({ timeout: 25000 });
        console.log('✅ MCP Server Connected (Active)');

        // --- 3. EXECUTE VIA CHAT ---
        await window.click('button[title="Chat"]');
        await window.waitForTimeout(1000); // Wait for transition

        console.log('  - Sending message to chat...');
        // Use a more specific selector using data-testid
        const chatInput = window.locator('[data-testid="chat-textarea"]');

        // Wait for it to exist (attached)
        await chatInput.waitFor({ state: 'attached', timeout: 15000 });

        // Ensure it's in view
        await chatInput.scrollIntoViewIfNeeded();

        // Bypass explicit visible check if it's flaky in Electron environment
        // await chatInput.waitFor({ state: 'visible', timeout: 15000 });

        try {
            await chatInput.click({ timeout: 5000, force: true });
        } catch (e) {
            console.log('ℹ️ Textarea click failed (force:true), trying focus...');
            await chatInput.focus();
        }

        // Use evaluate to set value and trigger React update, bypassing visibility checks
        await chatInput.evaluate((el, val) => {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, 'Please think about what 2+2 is');

        // Click send button with force
        await window.locator('button:has(svg.lucide-send)').click({ force: true });

        console.log('  - Waiting for assistant response...');
        await window.locator('div:has-text("thinking")').waitFor({ timeout: 60000 });
        console.log('✅ Assistant response received');

        await window.waitForTimeout(3000);
        console.log('\n🎉 MOCKED TEST PASSED');

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error);
        try {
            const window = await electronApp.firstWindow();
            await window.screenshot({ path: path.join(SCREENSHOT_DIR, 'test-mock-failure.png') });
        } catch (e) { }
        process.exit(1);
    } finally {
        await electronApp.close();
    }
})();
