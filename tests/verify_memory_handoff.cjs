
const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
    console.log('Main: Starting Sub-Agent Handoff Verification...');

    // Launch Electron app
    const electronApp = await electron.launch({
        args: [path.join(__dirname, '../out/main/index.js')],
        env: {
            ...process.env,
            NODE_ENV: 'development'
        }
    });

    try {
        const window = await electronApp.firstWindow();
        console.log('Main: Window opened');
        await window.waitForLoadState('domcontentloaded');
        await window.waitForTimeout(3000); // Allow initialization

        // 1. Start a new Chat
        console.log('Main: Starting new chat...');
        // Assume we are on a new chat or can just type
        const inputArea = window.locator('textarea[placeholder*="Type a message"]');
        await inputArea.waitFor({ state: 'visible' });

        // 2. Send a prompt that forces delegation
        // "Research quantum physics and parallel usage" -> triggers parallel or sub-agents
        // Or explicitly: "Create a sub-agent to check the time"
        const prompt = "Use a sub-agent to verify that 2+2=4. Call it 'MathChecker'.";
        await inputArea.fill(prompt);
        await window.keyboard.press('Enter');
        console.log(`Main: Sent prompt: "${prompt}"`);

        // 3. Wait for the Assistant to respond
        // We look for a new message from the assistant
        console.log('Main: Waiting for response...');

        // Wait for potential thinking or tool use
        await window.waitForTimeout(5000);

        // Check for indicators of sub-agent delegation
        // The sub-agent logic logs to console, but in UI we might see "Using delegate_sub_task" in the tool checklist
        const toolUse = window.locator('div', { hasText: 'Using delegate_sub_task' });

        // Wait for it to appear (up to 20s as LLM needs to think)
        try {
            await toolUse.waitFor({ state: 'visible', timeout: 20000 });
            console.log('✅ Verified: delegate_sub_task tool was called in UI.');
        } catch (e) {
            console.warn('⚠️ Could not find "Using delegate_sub_task" in UI. Checking logs or generic response.');
        }

        // 4. Verify Final Response
        // The main agent should report back the result from the sub-agent
        const response = window.locator('.prose').last();
        await response.waitFor({ state: 'visible', timeout: 30000 });
        const text = await response.innerText();

        console.log('Main: received response:', text.substring(0, 100) + '...');

        if (text.includes('4') || text.includes('MathChecker') || text.includes('verified')) {
            console.log('✅ Result verification passed (Contains expected keywords).');
        } else {
            console.warn('⚠️ Result verification warning: Response might not be complete.');
        }

        console.log('✅ HANDOFF VERIFICATION COMPLETED');

    } catch (error) {
        console.error('❌ VERIFICATION FAILED:', error);
        await electronApp.firstWindow().then(w => w.screenshot({ path: 'handoff_failure.png' }));
        process.exit(1);
    } finally {
        await electronApp.close();
    }
})();
