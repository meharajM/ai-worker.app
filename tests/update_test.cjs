const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

(async () => {
    console.log('🚀 Starting Update Notification E2E Test...');

    const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');
    const electronExecutable = fs.existsSync(macPath) ? macPath : linuxPath;
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    const tempUserDataDir = path.join(__dirname, 'temp-user-data-update');
    if (fs.existsSync(tempUserDataDir)) {
        fs.rmSync(tempUserDataDir, { recursive: true, force: true });
    }

    const electronApp = await electron.launch({
        executablePath: execPath,
        args: [
            path.join(__dirname, '../out/main/index.js'),
            '--no-sandbox',
            `--user-data-dir=${tempUserDataDir}`
        ],
        env: { ...process.env, NODE_ENV: 'production' }
    });

    try {
        const window = await electronApp.firstWindow();
        await window.setViewportSize({ width: 1280, height: 800 });

        window.on('console', msg => {
            console.log(`[Renderer]: ${msg.text()}`);
        });

        // Mock the update check fetch
        await window.addInitScript(() => {
            console.log('🛠️ [InitScript] Injecting Mock Fetch and Electron API...');
            const originalFetch = window.fetch;
            window.fetch = async (input, init) => {
                const url = typeof input === 'string' ? input : input.url;
                if (url && url.includes('update.json')) {
                    console.log(`[MockFetch] Intercepting update.json request to: ${url}`);
                    return new Response(JSON.stringify({
                        latestVersion: '99.0.0',
                        rolloutPercentage: 100,
                        downloadUrl: 'https://github.com/mhrj/ai-worker/releases',
                        minRequiredVersion: '0.1.0',
                        releaseNotes: 'This is a mocked update for testing and screenshots!'
                    }), { 
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return originalFetch(input, init);
            };
            
            // Wait for electron to be available and mock getVersion and store IPC
            const poller = setInterval(() => {
                if (window.electron && window.electron.app && window.electron.ipcRenderer) {
                    console.log('✅ [InitScript] window.electron is available, mocking APIs');
                    
                    // Mock getVersion
                    window.electron.app.getVersion = () => Promise.resolve('0.1.0');
                    
                    // Mock electron-store IPC
                    const mockStore = { 'system.rolloutId': 50 };
                    const originalInvoke = window.electron.ipcRenderer.invoke;
                    window.electron.ipcRenderer.invoke = async (channel, ...args) => {
                        if (channel === 'electron-store-get') {
                            console.log(`[MockIPC] electron-store-get: ${args[0]}`);
                            return mockStore[args[0]];
                        }
                        if (channel === 'electron-store-set') {
                            console.log(`[MockIPC] electron-store-set: ${args[0]} = ${args[1]}`);
                            mockStore[args[0]] = args[1];
                            return;
                        }
                        return originalInvoke(channel, ...args);
                    };
                    
                    clearInterval(poller);
                }
            }, 100);
        });

        console.log('🔄 Loading application...');
        await window.goto('file://' + path.join(__dirname, '../out/renderer/index.html'));
        
        console.log('⏳ Waiting for Update Notification (3s delay in component)...');
        // Increase timeout to 30s
        const notification = window.locator('text=New Version Available!');
        await notification.waitFor({ state: 'visible', timeout: 30000 });
        
        console.log('✅ Update Notification is visible');
        
        // Capture screenshot
        const screenshotPath = path.join(SCREENSHOT_DIR, 'update_notification.png');
        await window.screenshot({ path: screenshotPath });
        console.log(`📸 Screenshot saved to: ${screenshotPath}`);

        // Verify "Download" button exists
        const downloadBtn = window.locator('button:has-text("Download")');
        if (await downloadBtn.isVisible()) {
            console.log('✅ Download button is visible');
        }

    } catch (e) {
        console.error('❌ Test failed:', e);
        process.exit(1);
    } finally {
        await electronApp.close();
    }
})();
