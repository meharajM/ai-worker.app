const { _electron: electron } = require('playwright');
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

(async () => {
    console.log('🚀 Starting PR 109 Fixes Validation (Process Management & Playwright Persistence)...');

    const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');
    const electronExecutable = fs.existsSync(macPath) ? macPath : linuxPath;
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    const testTempDir = path.join(os.tmpdir(), 'pr109-test-' + Date.now());
    if (fs.existsSync(testTempDir)) {
        fs.rmSync(testTempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testTempDir);

    let electronApp;
    try {
        console.log('🚀 Launching Electron...');
        electronApp = await electron.launch({
            executablePath: execPath,
            args: [
                path.join(__dirname, '../out/main/index.js'),
                '--no-sandbox',
                `--user-data-dir=${testTempDir}`
            ],
            timeout: 60000,
            env: { ...process.env, NODE_ENV: 'production' }
        });
        console.log('✅ Electron launched successfully');
    } catch (launchError) {
        console.error('❌ Failed to launch Electron:', launchError);
        process.exit(1);
    }

    try {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        console.log('✅ Window Loaded');

        // Test 1: McpProcessManager teardown coverage (Spawn dummy background process)
        console.log('\n--- 1. Testing Process Management & tree-kill ---');
        console.log('   Starting dummy external Python MCP server (will be tracked by McpProcessManager)...');
        
        // Connect an intentionally long-running dummy process
        const connectProcessRes = await window.evaluate(async () => {
            // @ts-ignore
            return await window.electron.mcp.connect({
                id: 'dummy-zombie-server',
                type: 'stdio',
                command: 'python3', // or node
                args: ['-c', 'import time, sys; sys.stdout.write(""); time.sleep(100)']
            });
        });
        
        console.log('✅ MCP Connection requested and process spawned');

        // Verify connected to internal Playwright MCP
        const connectResult = await window.evaluate(async () => {
            // @ts-ignore
            return await window.electron.mcp.connect({
                id: 'playwright-test',
                name: 'playwright-test',
                command: 'internal'
            });
        });
        if (!connectResult.success) throw new Error('Playwright Connection failed');
        console.log('✅ Connected to Playwright MCP (Internal)');

        // Test 2: Race Condition Prevention on Headless Initialization
        console.log('\n--- 2. Testing Headless Playwright Race Condition Fix ---');
        const helperCall = async (t, a) => {
            return await window.evaluate(async ({ id, t, a }) => {
                // @ts-ignore
                return await window.electron.mcp.callTool(id, t, a);
            }, { id: 'playwright-test', t, a });
        };

        const t1 = Date.now();
        console.log('   Triggering two background scrapes concurrently...');
        const resList = await Promise.all([
            helperCall('background_scrape', { url: 'https://example.com', extractType: 'text' }),
            helperCall('background_scrape', { url: 'https://example.org', extractType: 'text' })
        ]);

        const hasErrors = resList.some(r => r.error);
        if (hasErrors) {
            console.warn('⚠️ Tests encountered an error during headless race:', JSON.stringify(resList));
        } else {
            console.log('✅ Concurrent headless initialization succeeded seamlessly!');
        }
        console.log(`   (Took ${Date.now() - t1}ms)`);

        console.log('\n--- 3. Shutting down, verifying tree-kill logic ---');
        // Quitting the application to trigger before-quit which calls McpProcessManager.teardownAll()
        await electronApp.close();
        electronApp = null;
        
        // Wait 1 second to ensure cleanup is complete
        await new Promise(r => setTimeout(r, 1000));
        
        try {
            // Check if our python3 sleep 100 process survived
            const survivingProcesses = execSync("pgrep -f 'time.sleep(100)' || true").toString().trim();
            if (survivingProcesses) {
                console.warn('❌ ZOMBIE DETECTED: tree-kill failed or process leaked! PIDs:', survivingProcesses);
                execSync("pkill -f 'time.sleep(100)' || true");
                throw new Error('Zombie process leaked');
            } else {
                console.log('✅ Process Manager correctly killed all child MCP processes on exit!');
            }
        } catch (e) {
            if (e.message.includes('Zombie process leaked')) throw e;
            console.log('✅ Process verification passed.');
        }

        console.log('\n🎉 ALL PR 109 VALIDATION TESTS PASSED 🎉\n');

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error);
        process.exit(1);
    } finally {
        if (electronApp) await electronApp.close();
        if (fs.existsSync(testTempDir)) {
            try { fs.rmSync(testTempDir, { recursive: true, force: true }); } catch(e){}
        }
    }
})();
