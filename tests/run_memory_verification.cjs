
const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
    console.log('🚀 Starting Memory Architecture Verification Driver...');

    // Find the installed electron binary
    const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');
    let execPath = macPath;
    if (!require('fs').existsSync(macPath)) execPath = linuxPath;

    let electronApp;
    try {
        electronApp = await electron.launch({
            executablePath: execPath,
            args: [path.join(__dirname, '../out/main/index.js'), '--no-sandbox'],
            env: { ...process.env, NODE_ENV: 'production' }
        });

        // Capture main process console logs
        electronApp.process().stdout.on('data', data => console.log(`[Main] ${data}`));
        electronApp.process().stderr.on('data', data => console.error(`[Main Error] ${data}`));

        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        console.log('✅ Window Loaded');

        // Trigger the test via IPC
        console.log('⚡ Triggering memory:run-tests IPC...');
        const result = await window.evaluate(async () => {
            // @ts-ignore
            return await window.electron.memory.runTests();
        });

        console.log('\n--- Test Results ---');
        if (result.success) {
            result.result.results.forEach(line => console.log(line));
            if (result.result.passed) {
                console.log('\n🎉 ALL MEMORY TESTS PASSED');
                process.exit(0);
            } else {
                console.log('\n❌ SOME TESTS FAILED');
                process.exit(1);
            }
        } else {
            console.error('❌ IPC Call Failed:', result.error);
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Driver Error:', error);
        process.exit(1);
    } finally {
        if (electronApp) await electronApp.close();
    }
})();
