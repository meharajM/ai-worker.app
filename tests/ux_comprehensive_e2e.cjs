const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

(async () => {
    console.log('🚀 Starting PR #136 Validation + UX Discovery E2E Test...');

    if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');
    const electronExecutable = fs.existsSync(macPath) ? macPath : linuxPath;
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    const electronApp = await electron.launch({
        executable_path: execPath,
        args: [path.join(__dirname, '../out/main/index.js'), '--no-sandbox'],
        env: { ...process.env, NODE_ENV: 'production' }
    });

    try {
        const window = await electronApp.firstWindow();
        const logs = [];
        window.on('console', msg => {
            const text = msg.text();
            logs.push(text);
            console.log(`[Renderer]: ${text}`);
        });

        await window.addInitScript(() => {
            localStorage.setItem('skipDepsCheck', 'true');
            console.log("🛠️ Injecting PR #136 + UX Discovery Mocks...");

            const SCENARIOS = [
                // PR #136: Sequential Orchestration Test (Tab Sharing & Resource Safety)
                {
                    triggers: ["Sequential-Validation"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "Breaking down the task...",
                                tool_calls: [{
                                    id: "plan_1",
                                    type: "function",
                                    function: {
                                        name: "create_execution_plan",
                                        arguments: JSON.stringify({
                                            goal: "Sequential-Validation",
                                            steps: [
                                                { id: 1, description: "Verify Step A" },
                                                { id: 2, description: "Verify Step B" }
                                            ]
                                        })
                                    }
                                }]
                            }
                        }]
                    }
                },
                {
                    triggers: ["Verify Step A"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "✓ Done Verify Step A"
                            }
                        }]
                    }
                },
                {
                    triggers: ["Verify Step B"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "✓ Done Verify Step B"
                            }
                        }]
                    }
                },
                // Existing Scenario 1: Parallel Sub-Agents
                {
                    triggers: ["Compare the price of a Sony WH-1000XM5"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "Starting comparison...",
                                tool_calls: [
                                    { id: "p1", type: "function", function: { name: "create_sub_agent", arguments: JSON.stringify({ name: "Amazon", goal: "Find WH-1000XM5 price" }) } },
                                    { id: "p2", type: "function", function: { name: "create_sub_agent", arguments: JSON.stringify({ name: "BestBuy", goal: "Find WH-1000XM5 price" }) } }
                                ]
                            }
                        }]
                    }
                },
                // Existing Scenario 2: Planning Error
                {
                    triggers: ["bus tickets from Gangavathi", "Sequential Error"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "I'll plan this... wait, error in planning logic.",
                                tool_calls: [{
                                    id: "plan_fail",
                                    type: "function",
                                    function: {
                                        name: "create_execution_plan",
                                        arguments: "INVALID_JSON_HERE{{"
                                    }
                                }]
                            }
                        }]
                    }
                },
                // Existing Scenario: Memory
                {
                    triggers: ["brand new project named 'Orbit'"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "Got it! Project 'Orbit' noted.",
                                tool_calls: [{
                                    id: "mem_1",
                                    type: "function",
                                    function: {
                                        name: "memory_create_entity",
                                        arguments: JSON.stringify({
                                            name: "Orbit",
                                            entityType: "project"
                                        })
                                    }
                                }]
                            }
                        }]
                    }
                }
            ];

            // Removed mock for real LLM calls
        });

        await window.reload();
        await window.waitForLoadState('domcontentloaded');
        console.log('✅ Window Loaded');

        // Dismiss Modal
        try {
            const skipBtn = window.locator('text=Skip for now').first();
            if (await skipBtn.isVisible({ timeout: 5000 })) await skipBtn.click();
        } catch (e) { }

        // Configure Settings
        await window.click('button[title="Settings"]');
        await window.click('text=OpenRouter');
        await window.locator('input[type="password"]').fill(process.env.VITE_OPENROUTER_API_KEY || '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');
        await window.selectOption('select', 'qwen/qwen3.6-plus:free');
        await window.click('button[title="Chat"]');

        const chatInput = window.locator('[data-testid="chat-textarea"]');
        const sendButton = window.locator('[data-testid="send-button"]');

        const testRun = async (title, prompt, checkFn) => {
            console.log(`\n🔹 ${title}`);
            await chatInput.fill(prompt);
            await sendButton.click();
            await window.waitForTimeout(10000); // Execution takes time
            await checkFn(window);
            await window.screenshot({ path: path.join(SCREENSHOT_DIR, `${title.replace(/\s+/g, '_').toLowerCase()}.png`) });
        };

        // 1. Validation for PR #136: Tab sharing and resource safety
        await testRun("PR 136 Validation", "Sequential-Validation", async (w) => {
            const tabLogs = logs.filter(l => l.includes('Provisioned shared tab'));
            if (tabLogs.length === 1) console.log('✅ PASS: Exactly one shared tab provisioned.');
            else console.error(`❌ FAIL: Shared tab log count: ${tabLogs.length}`);

            const checklistVisible = await w.locator('text=All tasks completed').isVisible().catch(() => false);
            if (checklistVisible) console.log('✅ PASS: SubTaskChecklist rendered and completed.');
            else console.error('❌ FAIL: SubTaskChecklist NOT visible.');

            const browserClosedLog = logs.some(l => l.includes('Playwright browser closed on agent completion'));
            if (browserClosedLog) console.log('✅ PASS: Browser resources freed.');
            else console.error('❌ FAIL: Browser resources NOT freed.');
        });

        // 2. Regression for Parallel
        await testRun("Parallel Regression", "Compare the price of a Sony WH-1000XM5 headphone", async (w) => {
            if (await w.locator('text=Starting comparison').first().isVisible()) console.log("✅ Parallel trigger works");
        });

        console.log('\n✅ PR #136 Validation + Regression complete.');

    } catch (e) {
        console.error('❌ Run failed:', e);
    } finally {
        await electronApp.close();
    }
})();
