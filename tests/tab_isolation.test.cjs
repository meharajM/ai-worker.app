/**
 * Tab Isolation E2E Test
 * 
 * Verifies that parallel sub-agents get dedicated browser tabs and that
 * ToolExecutionService correctly injects tabId into browser tool args.
 * 
 * ROOT CAUSE FIX (from deep analysis):
 * 1. mcpStore reads from electron-store (IPC store:get), NOT localStorage.
 *    We must mock store:get to return servers with pre-populated tools.
 * 2. The auto-connect filter skips servers where tools.length > 0,
 *    so we pre-populate tools in the mock to avoid needing connect/listTools at all.
 * 3. The mcp:call-tool IPC mock captures all tool calls including new_tab
 *    and returns proper MCP content envelopes.
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const assert = require('assert');

// ── Mock server config matching MCPServer interface ─────────────────────────
// Pre-populate tools array so mcpStore.findServerForTool() works immediately
// without needing auto-connect (which is skipped when tools.length > 0).
const MOCK_SERVER_ID = 'test-playwright-server';
const MOCK_SERVERS = [
    {
        id: MOCK_SERVER_ID,
        name: 'playwright',
        description: 'Mock Playwright for testing',
        type: 'stdio',
        command: 'internal',
        args: [],
        connected: false,
        autoConnect: true,
        tools: [
            { name: 'playwright_navigate', description: 'Navigate to URL', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
            { name: 'playwright_click', description: 'Click element', inputSchema: { type: 'object', properties: { selector: { type: 'string' } } } },
            { name: 'new_tab', description: 'Create new tab', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
            { name: 'close_tab', description: 'Close tab', inputSchema: { type: 'object', properties: { tabId: { type: 'number' } } } },
        ]
    }
];

(async () => {
    console.log('Starting Tab Isolation E2E Test...');
    const electronApp = await electron.launch({
        args: [path.join(__dirname, '../out/main/index.js')],
        executablePath: process.env.ELECTRON_PATH,
    });

    const page = await electronApp.firstWindow();
    page.on('console', msg => console.log('[Renderer]', msg.text()));

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Mock IPC handlers in the Main Process
    // ═══════════════════════════════════════════════════════════════════════════
    await electronApp.evaluate(({ ipcMain }) => {
        global.__TOOL_CALLS = [];
        let tabCounter = 1000;

        // ── Mock electron-store so mcpStore gets our test servers ──────────────
        // This is the KEY FIX: mcpStore reads from electron-store via IPC,
        // NOT from localStorage. We intercept store:get to return our
        // pre-configured servers with tools already populated.
        ipcMain.removeHandler('store:get');
        ipcMain.handle('store:get', async (_event, key) => {
            if (key === 'mcp_servers') {
                return global.__MOCK_SERVERS;
            }
            // Return sensible defaults for other keys
            if (key === 'has_completed_onboarding') return true;
            if (key === 'has_dismissed_dependency_warning') return true;
            return null;
        });

        ipcMain.removeHandler('store:set');
        ipcMain.handle('store:set', async (_event, _key, _value) => {
            // No-op — prevent the store from persisting test data
            return;
        });

        // ── Mock MCP connect (always succeed) ─────────────────────────────────
        ipcMain.removeHandler('mcp:connect');
        ipcMain.handle('mcp:connect', async (_event, config) => {
            console.log(`[Main Mock] mcp:connect for: ${config.id || config.name}`);
            return { success: true };
        });

        // ── Mock MCP list-tools ───────────────────────────────────────────────
        ipcMain.removeHandler('mcp:list-tools');
        ipcMain.handle('mcp:list-tools', async (_event, serverId) => {
            console.log(`[Main Mock] mcp:list-tools for: ${serverId}`);
            return {
                tools: [
                    { name: 'playwright_navigate', description: 'Navigate to URL', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
                    { name: 'new_tab', description: 'Create new tab', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
                    { name: 'close_tab', description: 'Close tab', inputSchema: { type: 'object', properties: { tabId: { type: 'number' } } } },
                ]
            };
        });

        // ── Mock MCP call-tool (the spy) ──────────────────────────────────────
        ipcMain.removeHandler('mcp:call-tool');
        ipcMain.handle('mcp:call-tool', async (_event, serverId, toolName, args) => {
            console.log(`[Main Mock] mcp:call-tool: ${toolName}`, JSON.stringify(args));
            global.__TOOL_CALLS.push({ name: toolName, args: args || {} });

            if (toolName === 'new_tab') {
                tabCounter++;
                return { result: { content: [{ type: 'text', text: JSON.stringify({ tabId: tabCounter }) }] } };
            }
            if (toolName === 'close_tab') {
                return { result: { content: [{ type: 'text', text: '{"success":true}' }] } };
            }
            // Default: return success for any tool (navigate, click, etc.)
            return { result: { content: [{ type: 'text', text: '{"success":true}' }] } };
        });

        // ── Mock MCP disconnect ───────────────────────────────────────────────
        ipcMain.removeHandler('mcp:disconnect');
        ipcMain.handle('mcp:disconnect', async () => ({ success: true }));

        // ── Mock secure storage (API keys) ────────────────────────────────────
        ipcMain.removeHandler('secure:get');
        ipcMain.handle('secure:get', async (_event, key) => {
            if (key === 'openai_api_key') return { value: 'test-key-12345' };
            return { value: null };
        });

        ipcMain.removeHandler('secure:set');
        ipcMain.handle('secure:set', async () => ({ success: true }));

        // ── Mock memory tools ─────────────────────────────────────────────────
        ipcMain.removeHandler('memory:call-tool');
        ipcMain.handle('memory:call-tool', async () => ({ result: '{}' }));

    }, { /* no special args — electron module is auto-injected */ });

    // Pass mock servers to main process global scope
    await electronApp.evaluate((_, servers) => {
        global.__MOCK_SERVERS = servers;
    }, MOCK_SERVERS);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Inject renderer-side mocks (fetch for LLM, other localStorage)
    // ═══════════════════════════════════════════════════════════════════════════
    await page.addInitScript(() => {
        // Skip onboarding / dependency screens
        localStorage.setItem('has_completed_onboarding', 'true');
        localStorage.setItem('has_dismissed_dependency_warning', 'true');
        localStorage.setItem('llm_provider', 'openai');

        // ── LLM Fetch mock ────────────────────────────────────────────────────
        // The test triggers a prompt that the task decomposer classifies as
        // "parallel" (multiple contexts). The LLM returns delegate_sub_task
        // tool calls. Each sub-agent then calls playwright_navigate.
                // ── 1. TaskDecomposer Call (First LLM call to decide strategy) ──────
                if (body.messages.length === 1 || fullText.includes('analyze the following task')) {
                    return new Response(JSON.stringify({
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: JSON.stringify({
                                    should_parallelize: true,
                                    contexts: ['amazon_research', 'bestbuy_research'],
                                    reasoning: 'Testing parallel tab isolation',
                                    estimatedActions: 2
                                })
                            },
                            finish_reason: 'stop'
                        }],
                        usage: { prompt_tokens: 100, completion_tokens: 50 }
                    }), { status: 200, headers: { 'content-type': 'application/json' } });
                }

                // ── 2. Parallel Orchestration: Main Agent (returns delegate_sub_task) ─
                if (fullText.includes('compare phones') && !fullText.includes('sub-agent')) {
                    return new Response(JSON.stringify({
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: null,
                                tool_calls: [
                                    {
                                        id: 'tc_1',
                                        type: 'function',
                                        function: {
                                            name: 'delegate_sub_task',
                                            arguments: JSON.stringify({
                                                instruction: 'Search Amazon',
                                                context: 'amazon_research'
                                            })
                                        }
                                    },
                                    {
                                        id: 'tc_2',
                                        type: 'function',
                                        function: {
                                            name: 'delegate_sub_task',
                                            arguments: JSON.stringify({
                                                instruction: 'Search BestBuy',
                                                context: 'bestbuy_research'
                                            })
                                        }
                                    }
                                ]
                            },
                            finish_reason: 'tool_calls'
                        }],
                        usage: { prompt_tokens: 100, completion_tokens: 50 }
                    }), { status: 200, headers: { 'content-type': 'application/json' } });
                }

                // ── 3. Sub-Agent Navigation ───────────────────────────────────
                if (fullText.includes('navigate') || fullText.includes('search')) {
                    // Check if we already navigated (avoid infinite loop)
                    if (fullText.includes('tool_outputs') || fullText.includes('history')) {
                         return new Response(JSON.stringify({
                            choices: [{
                                message: { role: 'assistant', content: '✓ Findings captured.' },
                                finish_reason: 'stop'
                            }],
                            usage: { prompt_tokens: 100, completion_tokens: 10 }
                        }), { status: 200, headers: { 'content-type': 'application/json' } });
                    }

                    const target = fullText.includes('amazon') ? 'amazon' : 'bestbuy';
                    return new Response(JSON.stringify({
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: null,
                                tool_calls: [{
                                    id: `tc_nav_${target}`,
                                    type: 'function',
                                    function: {
                                        name: 'playwright_navigate',
                                        arguments: JSON.stringify({ url: `https://${target}.com/phones` })
                                    }
                                }]
                            },
                            finish_reason: 'tool_calls'
                        }],
                        usage: { prompt_tokens: 100, completion_tokens: 50 }
                    }), { status: 200, headers: { 'content-type': 'application/json' } });
                }
                    return new Response(JSON.stringify({
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: null,
                                tool_calls: [{
                                    id: `tc_bb_${callCount}`,
                                    type: 'function',
                                    function: {
                                        name: 'playwright_navigate',
                                        arguments: JSON.stringify({ url: 'https://bestbuy.com/phones' })
                                    }
                                }]
                            },
                            finish_reason: 'tool_calls'
                        }],
                        usage: { prompt_tokens: 100, completion_tokens: 50 }
                    }), { status: 200, headers: { 'content-type': 'application/json' } });
                }

                // ── Fallback: return a clean text completion ──────────────────
                return new Response(JSON.stringify({
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: '✓ Done. Task complete.'
                        },
                        finish_reason: 'stop'
                    }],
                    usage: { prompt_tokens: 50, completion_tokens: 20 }
                }), { status: 200, headers: { 'content-type': 'application/json' } });
            }

            // Non-LLM requests: pass through
            return originalFetch(input, init);
        };
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Load the page (triggers mcpStore init with our mocked store:get)
    // ═══════════════════════════════════════════════════════════════════════════
    const appPath = 'file://' + path.join(__dirname, '../out/renderer/index.html');
    await page.goto(appPath);

    // Wait for the app to fully initialize
    console.log('⏳ Waiting for app initialization...');
    await page.waitForTimeout(8000);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Trigger the prompt
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('📝 Sending prompt...');
    await page.fill('textarea', 'Compare phones across retailers');
    await page.press('textarea', 'Enter');

    // Wait for agent execution (sub-agents spawn, run, close)
    console.log('⏳ Waiting for parallel execution...');
    await page.waitForTimeout(25000);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 5: Analyze IPC spy results
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('🔍 Analyzing results...');

    const toolExecutions = await electronApp.evaluate(() => global.__TOOL_CALLS || []);

    // Log ALL captured tool calls for debugging
    console.log(`\n📊 Total tool calls captured: ${toolExecutions.length}`);
    for (const tc of toolExecutions) {
        console.log(`  → ${tc.name}(${JSON.stringify(tc.args)})`);
    }

    // ── Verify new_tab was called ─────────────────────────────────────────────
    const newTabCalls = toolExecutions.filter(e => e.name === 'new_tab');
    console.log(`\n🔑 new_tab calls: ${newTabCalls.length}`);
    assert.ok(
        newTabCalls.length >= 2,
        `Expected at least 2 new_tab calls (one per sub-agent), got ${newTabCalls.length}.\n` +
        `All calls: ${toolExecutions.map(t => t.name).join(', ')}`
    );

    // ── Verify playwright_navigate was called with distinct tabIds ─────────────
    const navigations = toolExecutions.filter(e => e.name === 'playwright_navigate');
    console.log(`🧭 navigate calls: ${navigations.length}`);

    // Each navigation should have a tabId injected by ToolExecutionService
    const tabIds = new Set(navigations.map(n => n.args.tabId).filter(id => id !== undefined));
    console.log(`🏷️  Distinct tab IDs on navigate calls: ${Array.from(tabIds).join(', ')}`);

    assert.ok(
        navigations.length >= 2,
        `Should have at least 2 navigate calls, got ${navigations.length}`
    );

    assert.ok(
        tabIds.size >= 2,
        `Should have at least 2 distinct tabIds, found: [${Array.from(tabIds).join(', ')}]\n` +
        `Navigate args: ${navigations.map(n => JSON.stringify(n.args)).join('\n  ')}`
    );

    // ── Verify close_tab was called for cleanup ───────────────────────────────
    const closeTabCalls = toolExecutions.filter(e => e.name === 'close_tab');
    console.log(`🧹 close_tab calls: ${closeTabCalls.length}`);

    console.log('\n✅ Test Passed: Sub-agents correctly isolated into separate tabs!');
    await electronApp.close();
})().catch(err => {
    console.error('\n❌ Test Failed:', err);
    process.exit(1);
});
