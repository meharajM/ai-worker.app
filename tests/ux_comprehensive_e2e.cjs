const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

(async () => {
    console.log('🚀 Starting UX/UI Discovery E2E Test...');

    if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const electronExecutable = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    const electronApp = await electron.launch({
        executable_path: execPath,
        args: [path.join(__dirname, '../out/main/index.js'), '--no-sandbox'],
        env: { ...process.env, NODE_ENV: 'production' }
    });

    try {
        const window = await electronApp.firstWindow();
        window.on('console', msg => console.log(`[Renderer]: ${msg.text()}`));

        await window.addInitScript(() => {
            console.log("🛠️ Injecting UX Discovery Mocks...");

            const SCENARIOS = [
                // 1. Parallel Sub-Agents (Happy Path)
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
                // 2. Sequential Orchestration (Failure Path: Planning Error)
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
                // 3. Smart Result Reporting (Noise Leakage UX issue)
                {
                    triggers: ["top 3 results with prices", "Noise Leak"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "Here are the top 3 results:\n1. Sony - $300\n2. Bose - $280\n3. Sennheiser - $250\n\n<debug_log>{\"raw_elements\": [{\"id\": 1, \"text\": \"raw node leak\"}]}</debug_log>"
                            }
                        }]
                    }
                },
                // 4. Interactive Handoff (Happy Path)
                {
                    triggers: ["Plan a weekend trip to Goa", "Handoff"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "I've planned the first part of your Goa trip (Flights and Hotels). I've reached the token limit. Continue?",
                                actions: [
                                    { type: "continue", label: "Continue to Activities" },
                                    { type: "stop", label: "Stop here" }
                                ]
                            }
                        }]
                    }
                },
                // 5. Manual Delegation (Success)
                {
                    triggers: ["news.ycombinator.com", "Deep Dive"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "Navigating to HN...",
                                tool_calls: [{
                                    id: "delegate_1",
                                    type: "function",
                                    function: {
                                        name: "delegate_sub_task",
                                        arguments: JSON.stringify({
                                            agent_name: "Summarizer",
                                            task: "Read the top story and summarize"
                                        })
                                    }
                                }]
                            }
                        }]
                    }
                },
                // 9. Safety Inheritance (Refusal UX)
                {
                    triggers: ["Rolex", "checkout"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "I found the Rolex, but my internal safety policy prevents me from completing the checkout process for high-value items."
                            }
                        }]
                    }
                },
                // 11. Fallback to Direct (Simple)
                {
                    triggers: ["capital of France"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "The capital of France is Paris."
                            }
                        }]
                    }
                },
                // 13. Model Refusal Auto-Correction (Retry UX)
                {
                    triggers: ["gaming laptop", "Refusal Retry"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "I apologize, I can't access Amazon directly right now.",
                                tool_calls: []
                            }
                        }]
                    }
                },
                // 15. Mandatory Progress Checkpoints
                {
                    triggers: ["analysis of 5 different news sites", "Checkpoint"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "Analyzed CNN and BBC so far.",
                                tool_calls: [{
                                    id: "cp_1",
                                    type: "function",
                                    function: {
                                        name: "update_progress_summary",
                                        arguments: JSON.stringify({
                                            summary: "Read CNN: Tech Stocks Up. Read BBC: Weather Alert."
                                        })
                                    }
                                }]
                            }
                        }]
                    }
                },
                // 18. Memory (Implicit Preference)
                {
                    triggers: ["brand new project named 'Orbit'"],
                    response: {
                        choices: [{
                            message: {
                                role: "assistant",
                                content: "Got it! I've noted that the 'Orbit' project uses Tailwind and TypeScript. I'll use those for all future code for this project.",
                                tool_calls: [{
                                    id: "mem_1",
                                    type: "function",
                                    function: {
                                        name: "memory_create_entity",
                                        arguments: JSON.stringify({
                                            name: "Orbit",
                                            entityType: "project",
                                            observations: { tech: ["Tailwind", "TypeScript"], owner: "user" }
                                        })
                                    }
                                }]
                            }
                        }]
                    }
                }
            ];

            const originalFetch = window.fetch;
            window.fetch = async (input, init) => {
                let urlStr = (typeof input === 'object' && input !== null && 'url' in input) ? input.url : input.toString();

                if (urlStr.includes('/api/tags')) {
                    return new Response(JSON.stringify({ models: [{ name: "mock-model" }] }), { status: 200 });
                }

                if (urlStr.includes('/api/chat') || urlStr.includes('/chat/completions')) {
                    let bodyStr = init?.body || await (input instanceof Request ? input.text() : "");

                    if (bodyStr.includes("BACKGROUND_MEMORY_EXTRACTION")) {
                        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "No updates." } }] }), { status: 200 });
                    }

                    try {
                        const body = JSON.parse(bodyStr);
                        // Search all messages for triggers to handle decomposition/sub-agent calls
                        const scenario = SCENARIOS.find(s =>
                            s.triggers.some(t =>
                                body.messages.some(m => typeof m.content === 'string' && m.content.includes(t))
                            )
                        );

                        let responseData = {
                            model: "mock-model",
                            choices: [{ message: { role: "assistant", content: "Default mock response. (Trigger not matched)" } }],
                            usage: { total_tokens: 100 }
                        };

                        if (scenario) {
                            console.log(`[MockFetch] Matched Scenario for "${scenario.triggers[0]}"`);
                            responseData = { ...responseData, ...scenario.response };
                        } else {
                            console.warn(`[MockFetch] No scenario matched for prompt ending in: "${body.messages[body.messages.length - 1].content.substring(0, 30)}..."`);
                        }

                        return new Response(JSON.stringify(responseData), { status: 200 });
                    } catch (e) { }
                }
                return originalFetch(input, init);
            };
        });

        await window.reload();
        await window.waitForLoadState('domcontentloaded');

        // Configure OpenAI
        await window.click('button[title="Settings"]');
        await window.click('text=OpenAI');
        await window.locator('input[type="password"]').fill('sk-mock-key');
        await window.click('button[title="Chat"]');
        await window.waitForTimeout(1000);

        const chatInput = window.locator('[data-testid="chat-textarea"]');
        const sendButton = window.locator('[data-testid="send-button"]');

        const testRun = async (title, prompt, checkFn) => {
            console.log(`\n🔹 ${title}`);
            await chatInput.fill(prompt);
            await sendButton.click();
            await window.waitForTimeout(3000);
            await checkFn(window);
            await window.screenshot({ path: path.join(SCREENSHOT_DIR, `${title.replace(/\s+/g, '_').toLowerCase()}.png`) });
        };

        // 1. Parallel Happy Path
        await testRun("Parallel Support", "Compare the price of a Sony WH-1000XM5 headphone", async (w) => {
            if (await w.locator('text=Starting comparison').first().isVisible()) console.log("✅ Parallel trigger works");
        });

        // 2. Planning JSON Error (UX Recovery Check)
        await testRun("Planning Error Recovery", "bus tickets from Gangavathi Sequential Error", async (w) => {
            if (await w.locator('text=INVALID_JSON_HERE').first().isVisible()) {
                console.log("⚠️ UX ISSUE: Raw JSON error leaked to UI!");
            }
        });

        // 3. Noise Leakage Check
        await testRun("Noise Leakage", "top 3 results with prices Noise Leak", async (w) => {
            if (await w.locator('text=raw node leak').first().isVisible()) {
                console.log("⚠️ UX ISSUE: Debug log leaked to user!");
            }
        });

        // 4. Handoff UI Check
        await testRun("Handoff Buttons", "Plan a weekend trip to Goa Handoff", async (w) => {
            if (await w.locator('button:has-text("Continue")').first().isVisible()) console.log("✅ Handoff buttons rendered");
        });

        // 5. Memory Reflector Check
        await testRun("Memory Learning", "brand new project named 'Orbit'", async (w) => {
            if (await w.locator('text=Orbit').first().isVisible()) console.log("✅ Memory entity mentioned");
        });

        // 6. Safety Refusal
        await testRun("Safety Refusal", "Rolex checkout", async (w) => {
            if (await w.locator('text=safety policy').first().isVisible()) console.log("✅ Safety refusal handled");
        });

        console.log('\n✅ Comprehensive UX discovery run complete.');

    } catch (e) {
        console.error('❌ Run failed:', e);
    } finally {
        await electronApp.close();
    }
})();
