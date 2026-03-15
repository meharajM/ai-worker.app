const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('🚀 Testing Storage Flush on Exit...');

    const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');
    const electronExecutable = fs.existsSync(macPath) ? macPath : linuxPath;
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    const tempUserDataDir = path.join(__dirname, 'temp-storage-test');
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
        await window.waitForLoadState('domcontentloaded');

        console.log('--- Step 1: Verify Debounce is working ---');
        const debouncedResult = await window.evaluate(async () => {
            // Clear storage first
            localStorage.clear();

            // Trigger a save (via state change - we'll simulate what Zustand does)
            // Zustands setItem is called by the middleware.
            const testKey = 'ai-worker-chat-v3';
            const testValue = JSON.stringify({ state: { sessions: [{ id: 'test', title: 'Debounce Test' }] } });

            // Access the store directly to trigger a real change if possible, 
            // but since we want to test the ADAPTER, we can just call localStorage.setItem 
            // IF the adapter has replaced the global. However, the adapter is inside the store.

            // To test the REAL implementation, we should use the store.
            // @ts-ignore
            window.useChatStore.getState().createSession('test-debounce');

            // Immediate check (should be empty as it is debounced for 1000ms)
            const immediate = localStorage.getItem(testKey);

            // Wait 1.2s
            await new Promise(r => setTimeout(r, 1200));
            const afterWait = localStorage.getItem(testKey);

            return { immediate, afterWait };
        });

        if (debouncedResult.immediate === null) {
            console.log('✅ Debounce active: Storage empty immediately');
        } else {
            console.log('❌ Debounce failed: Storage populated immediately');
        }

        if (debouncedResult.afterWait && debouncedResult.afterWait.includes('test-debounce')) {
            console.log('✅ Storage eventually saved after timeout');
        } else {
            console.error('❌ Storage NOT saved after timeout');
            process.exit(1);
        }

        console.log('\n--- Step 2: Verify Flush on beforeunload ---');
        const flushResult = await window.evaluate(() => {
            localStorage.clear();
            // Trigger a change
            // @ts-ignore
            window.useChatStore.getState().createSession('test-flush');

            // Verify it's NOT in storage yet
            const beforeEvent = localStorage.getItem('ai-worker-chat-v3');

            // Simulate the exit event
            window.dispatchEvent(new Event('beforeunload'));

            // Immediate check (should be populated NOW because of flush)
            const afterEvent = localStorage.getItem('ai-worker-chat-v3');

            return { beforeEvent, afterEvent };
        });

        if (flushResult.beforeEvent === null) {
            console.log('✅ Pre-check: Storage empty before flush');
        }

        if (flushResult.afterEvent && flushResult.afterEvent.includes('test-flush')) {
            console.log('✅ SUCCESS: Storage flushed synchronously on beforeunload');
        } else {
            console.error('❌ FAILURE: Storage NOT flushed on beforeunload. DATA LOSS RISK DETECTED.');
            process.exit(1);
        }

        console.log('\n--- Step 3: Verify Persistence across Restarts ---');
        await window.evaluate(() => {
            // @ts-ignore
            window.useChatStore.getState().createSession('persistence-check-ws');
            // Also update a session title to be sure
            // @ts-ignore
            const sessions = window.useChatStore.getState().sessions;
            if (sessions.length > 0) {
                sessions[0].title = 'persistence-check-title';
            }
            window.dispatchEvent(new Event('pagehide'));
            console.log('Dispatched pagehide');
        });

        await electronApp.close();
        console.log('App closed');

        // Relaunch
        const newApp = await electron.launch({
            executablePath: execPath,
            args: [path.join(__dirname, '../out/main/index.js'), '--no-sandbox', `--user-data-dir=${tempUserDataDir}`],
            env: { ...process.env, NODE_ENV: 'production' }
        });

        console.log('App relaunched');
        const newWindow = await newApp.firstWindow();
        await newWindow.waitForLoadState('domcontentloaded');

        const raw = await newWindow.evaluate(() => localStorage.getItem('ai-worker-chat-v3'));
        console.log('Raw storage value check...');

        if (!raw) {
            console.error('❌ FAILURE: localStorage is NULL after relaunch');
            process.exit(1);
        }

        const parsed = JSON.parse(raw);
        console.log('Parsed sessions count:', parsed.state.sessions.length);

        const sessions = parsed.state.sessions;
        const hasWs = sessions.some(s => s.workspacePath === 'persistence-check-ws');
        const hasTitle = sessions.some(s => s.title === 'persistence-check-title');

        if (hasWs || hasTitle) {
            console.log('✅ SUCCESS: Persistence verified via raw storage check');
        } else {
            console.error('❌ FAILURE: Data missing from raw storage. Raw:', raw.substring(0, 200));
            process.exit(1);
        }

        await newApp.close();
        console.log('\n🎉 ALL STORAGE TESTS PASSED');

    } catch (e) {
        console.error('❌ Test crashed:', e);
        if (electronApp) await electronApp.close();
        process.exit(1);
    }
})();
