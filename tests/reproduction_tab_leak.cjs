const { _electron: electron } = require('playwright');
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('🚀 Starting Tab Leak Reproduction Suite...');

    const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');
    const electronExecutable = fs.existsSync(macPath) ? macPath : linuxPath;
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    const electronApp = await electron.launch({
        executablePath: execPath,
        args: [path.join(__dirname, '../out/main/index.js')],
        env: { ...process.env, NODE_ENV: 'production' }
    });

    try {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        console.log('✅ Electron Ready');

        const callTool = async (name, args = {}) => {
            return await window.evaluate(async ({ t, a }) => {
                // We use the same bridge as playwright_tools_test.cjs
                return await window.electron.mcp.callTool('playwright-test', t, a);
            }, { t: name, a: args });
        };

        const getTabs = async () => {
            const res = await callTool('get_tabs');
            try {
                // MCP format: server returns string result, which we parse
                const resultObj = typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
                // Our IPC fix in mcp.ts makes this a real object now
                const tabs = resultObj.tabs || [];
                return tabs;
            } catch (e) {
                console.log('Parse error in getTabs:', e.message);
                return [];
            }
        };

        // Initialize connection
        await window.evaluate(async () => {
            await window.electron.mcp.connect({ id: 'playwright-test', name: 'p-test', command: 'internal' });
        });

        console.log('\n--- Scenario 1: Natural New Tab Leak ---');
        const initialTabs = await getTabs();
        console.log(`Initial Tab Count: ${initialTabs.length}`);

        console.log('Opening a new tab...');
        await callTool('new_tab', { url: 'https://example.com' });
        const postNewTab = await getTabs();
        console.log(`Tab Count after new_tab: ${postNewTab.length}`);

        console.log('Waiting 5s to simulate task completion (no manual close)...');
        await new Promise(r => setTimeout(r, 5000));

        const finalTabs = await getTabs();
        console.log(`Final Tab Count (Expected leak if no fix): ${finalTabs.length}`);

        if (finalTabs.length > initialTabs.length) {
            console.log('🚨 REPRODUCTION SUCCESSFUL: Tab leaked after task completion!');
        } else {
            console.log('✅ No leak detected (or tool automatically cleaned up).');
        }

    } finally {
        await electronApp.close();
    }
})();
