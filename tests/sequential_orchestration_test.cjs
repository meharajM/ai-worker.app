const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('🚀 Starting Sequential Orchestration Tab Reuse Test (V3)...');

    const electronExecutable = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    const electronApp = await electron.launch({
        executablePath: execPath,
        args: [path.join(__dirname, '../out/main/index.js'), '--no-sandbox'],
        env: { ...process.env, NODE_ENV: 'production' }
    });

    try {
        const window = await electronApp.firstWindow();
        const logs = [];
        window.on('console', msg => {
            logs.push(msg.text());
            console.log(`[Renderer]: ${msg.text()}`);
        });

        await window.addInitScript(() => {
            const mockResponse = (data) => new Response(JSON.stringify(data), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

            const handleFetch = async (url, options) => {
                const urlStr = url.toString();
                if (urlStr.includes('chat/completions') || urlStr.includes('openrouter.ai') || urlStr.includes('googlegenerativelai')) {
                    const body = JSON.parse(options.body);
                    const lastMessage = body.messages[body.messages.length - 1].content;
                    console.log(`[MOCK FETCH] Intercepted: ${lastMessage.substring(0, 60)}`);

                    if (lastMessage.includes('ORCHESTRATION PLANNING PROTOCOL')) {
                        return mockResponse({
                            choices: [{
                                message: {
                                    role: "assistant", content: JSON.stringify({
                                        steps: [
                                            { id: 1, description: "Step 1", parallel_cluster: null },
                                            { id: 2, description: "Step 2", parallel_cluster: null }
                                        ]
                                    })
                                }
                            }]
                        });
                    }
                    return mockResponse({
                        choices: [{ message: { role: "assistant", content: "Step completed. ✓ Done" } }]
                    });
                }
                return fetch(url, options); // This is the original fetch since we haven't overridden it yet in this scope
            };

            // Aggressive override
            const originalFetch = window.fetch;
            window.fetch = handleFetch;
            // @ts-ignore
            globalThis.fetch = handleFetch;

            // Mock MCP
            if (window.electron && window.electron.mcp) {
                window.electron.mcp.connect = async () => ({ success: true, serverId: 'mock-server' });
                window.electron.mcp.callTool = async (id, tool, args) => {
                    if (tool === 'new_tab') return { result: { tabId: 'tab-999' } };
                    return { result: { success: true } };
                };
            }

            window.localStorage.setItem('openai_api_key', 'sk-mock-key');
            window.localStorage.setItem('preferred_provider', 'openai');
        });

        await window.waitForLoadState('domcontentloaded');
        await window.waitForSelector('[data-testid="chat-textarea"]', { timeout: 30000 });

        const input = await window.$('[data-testid="chat-textarea"]');
        await input.fill("Search and Navigate and Click and then Find"); // Complex prompt
        await input.press('Enter');
        console.log('🚀 Task Started');

        let foundProvision = false;
        let foundReuse = false;
        let foundCleanup = false;

        const startTime = Date.now();
        while (Date.now() - startTime < 45000) {
            if (!foundProvision && logs.some(l => l.includes('Provisioned new tab tab-999'))) foundProvision = true;
            if (!foundReuse && logs.some(l => l.includes('Reusing tab tab-999'))) foundReuse = true;
            if (!foundCleanup && logs.some(l => l.includes('Closed persistent orchestration tab tab-999'))) foundCleanup = true;

            if (foundProvision && foundReuse && foundCleanup) break;
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log(`Results: Provisioned=${foundProvision}, Reused=${foundReuse}, Cleanup=${foundCleanup}`);

        if (foundProvision && foundReuse && foundCleanup) {
            console.log('🎉 SUCCESS: Sequential orchestration verified!');
        } else {
            console.error('FAILED verification.');
            process.exit(1);
        }

    } catch (e) {
        console.error('❌ Test error:', e);
        process.exit(1);
    } finally {
        await electronApp.close();
    }
})();
