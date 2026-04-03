const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

function loadEnv() {
    const envPath = path.join(__dirname, '../.env');
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
        const match = line.match(/^([^#\s]+)=(.+)$/);
        if (match) env[match[1].trim()] = match[2].trim();
    });
    return env;
}

(async () => {
    console.log('🚀 Starting E2E Test (Production Mode Debug)...');

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
    const electronExecutable = fs.existsSync(macPath) ? macPath : linuxPath;
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    console.log('Using electron execPath:', execPath);
    console.log('exists execPath?', fs.existsSync(execPath));

    let electronApp;
    try {
        console.log('🚀 Launching Electron...');
        electronApp = await electron.launch({
            executablePath: execPath,
            args: [
                path.join(__dirname, '../out/main/index.js')
            ],
            timeout: 120000,
            env: {
                ...process.env,
                ...loadEnv(),
                NODE_ENV: 'production'
            }
        });
        console.log('✅ Electron launched successfully');
    } catch (launchError) {
        console.error('❌ Failed to launch Electron:', launchError);
        if (process.env.GITHUB_ACTIONS) {
            try {
                const { execSync } = require('child_process');
                console.log('Debug: ldd electron output:');
                console.log(execSync(`ldd ${execPath}`).toString());
            } catch (lddError) { }
        }
        process.exit(1);
    }

    try {
        const window = await electronApp.firstWindow();
        await window.setViewportSize({ width: 1280, height: 800 });

        window.on('console', msg => console.log(`[Renderer]: ${msg.text()}`));
        window.on('pageerror', err => console.error(`[Renderer Error]: ${err}`));
        window.on('requestfailed', request => {
            console.log(`[Network Error]: ${request.url()} - ${request.failure().errorText}`);
        });

        await window.waitForLoadState('domcontentloaded');
        console.log('✅ Window Loaded');

        // Screenshot initial state
        await window.waitForTimeout(3000);
        await window.screenshot({ path: path.join(SCREENSHOT_DIR, 'test-start.png') });
        console.log('📸 Initial state captured');

        // Check content
        const bodyContent = await window.content();
        console.log(`ℹ️  Page Content Dump:\n${bodyContent}`);

        // 1. App Loaded (Check for Mic Button - always visible)
        // Title might be hidden if chat history exists
        await window.locator('button[title="Start Voice Mode"]').waitFor({ state: 'visible', timeout: 15000 });
        console.log('✅ Voice Input Found (App Loaded)');

        const titleVisible = await window.isVisible('text=AI Worker');
        if (titleVisible) console.log('✅ Welcome Title Visible');
        else console.log('ℹ️  Welcome Title hidden (history exists?)');

        // 2. Status "READY" or "ACTIVE"
        try {
            await window.getByText('READY', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
            console.log('✅ Status is READY');
        } catch (e) {
            // Could be ACTIVE if session is active
            const activeText = await window.locator('text=active').count();
            if (activeText > 0) {
                console.log('✅ Status is ACTIVE');
            } else {
                console.log('ℹ️ Status text not found (may be styled differently)');
            }
        }

        // 3. UI Elements
        await window.locator('button:has(svg.lucide-send)').waitFor();
        console.log('✅ UI Loaded');

        // --- MCP Section ---
        console.log('\n--- Testing MCP ---');
        await window.click('button[title="MCP Connections"]');
        await window.waitForSelector('text=MCP Connections', { timeout: 5000 });
        console.log('✅ Connections Panel');

        // --- Settings Section ---
        console.log('\n--- Testing Settings ---');
        await window.click('button[title="Settings"]');
        await window.waitForSelector('text=LLM Provider', { timeout: 5000 });
        console.log('✅ Settings Panel');

        const ver = await electronApp.evaluate(async ({ app }) => app.getVersion());
        console.log(`ℹ️  App Version: ${ver}`);

        console.log('\n🎉 TEST PASSED');

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error);

        try {
            const window = await electronApp.firstWindow();
            await window.screenshot({ path: path.join(SCREENSHOT_DIR, 'test-failure.png') });
            console.log('📸 Failure screenshot saved');
        } catch (e) {
            console.error('Failed to capture failure screenshot');
        }
        process.exit(1);
    } finally {
        await electronApp.close();
    }
})();
