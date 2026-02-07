const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('Starting Parallel Race Test...');
    const electronApp = await electron.launch({
        args: [path.join(__dirname, '../out/main/index.js')],
        executablePath: process.env.ELECTRON_PATH,
    });

    const window = await electronApp.firstWindow();

    // Inject Mocks
    await window.evaluate(() => {
        window.SCENARIOS = [
            {
                triggers: ["Compare Amazon and BestBuy"],
                response: {
                    content: "I will research both in parallel.",
                    tool_calls: [
                        {
                            id: "call_sub_1",
                            type: "function",
                            function: {
                                name: "delegate_sub_task",
                                arguments: JSON.stringify({
                                    instruction: "Price of WH-1000XM5 on Amazon",
                                    context: "amazon.com"
                                })
                            }
                        },
                        {
                            id: "call_sub_2",
                            type: "function",
                            function: {
                                name: "delegate_sub_task",
                                arguments: JSON.stringify({
                                    instruction: "Price of WH-1000XM5 on BestBuy",
                                    context: "bestbuy.com"
                                })
                            }
                        }
                    ]
                }
            },
            {
                triggers: ["Amazon"],
                response: {
                    content: "Researching Amazon...",
                    tool_calls: [
                        {
                            id: "call_nav_amazon",
                            type: "function",
                            function: {
                                name: "navigate",
                                arguments: JSON.stringify({ url: "https://amazon.com/s?k=WH-1000XM5" })
                            }
                        }
                    ]
                }
            },
            {
                triggers: ["BestBuy"],
                response: {
                    content: "Researching BestBuy...",
                    tool_calls: [
                        {
                            id: "call_nav_bestbuy",
                            type: "function",
                            function: {
                                name: "navigate",
                                arguments: JSON.stringify({ url: "https://bestbuy.com/s?k=WH-1000XM5" })
                            }
                        }
                    ]
                }
            }
        ];

        const originalFetch = window.fetch;
        window.fetch = async (url, options) => {
            if (url.includes('api.openai.com') || url.includes('generativelanguage.googleapis.com')) {
                const bodyStr = options.body;
                const body = JSON.parse(bodyStr);
                const lastMsg = body.messages[body.messages.length - 1].content;

                const scenario = window.SCENARIOS.find(s => s.triggers.some(t => lastMsg.includes(t)));

                if (scenario) {
                    return new Response(JSON.stringify({
                        choices: [{ message: { role: "assistant", ...scenario.response } }],
                        usage: { total_tokens: 100 }
                    }), { status: 200 });
                }
            }
            return originalFetch(url, options);
        };
    });

    // Go to Chat
    await window.click('button:has-text("Chat")');

    // Type prompt
    const textarea = await window.locator('textarea');
    await textarea.fill("Compare Amazon and BestBuy");
    await textarea.press('Enter');

    console.log('Prompt sent. Waiting for parallel tools...');

    // Wait for "Parallel Execution" header
    await window.waitForSelector('text=Parallel Execution', { timeout: 15000 });

    // Take a screenshot to see if they are both "Navigating..."
    await window.screenshot({ path: 'tests/screenshots/parallel_race.png' });

    console.log('Screenshot saved to tests/screenshots/parallel_race.png');

    // Wait for some more time to let tools finish
    await window.waitForTimeout(5000);

    // Wait for the final aggregate response (if any)
    // In our mock, we didn't provide one for the main agent after sub-agents, 
    // but the sub-agents will finish.

    await electronApp.close();
    console.log('Test finished.');
})();
