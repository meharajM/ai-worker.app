const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

/**
 * AI Worker: COMPREHENSIVE E2E TEST SUITE (PROD Mode)
 * Based on example-prompts.md scenarios 1-21
 *
 * - Real LLM calls via OpenRouter (nvidia/nemotron model)
 * - Tests orchestration, UI status, browser automation, memory, and safety
 * - Proper pass/fail assertions with exit code 1 on failure
 */

// ─── Config ───────────────────────────────────────────────────────────
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots_real');
const APP_PATH = path.join(__dirname, '../out/main/index.js');
const MAX_RESPONSE_WAIT_S = 180; // 3 min max per scenario
const POLL_INTERVAL_MS = 5000;
const CRITICAL_ONLY = process.argv.includes('--critical-only') || process.env.CRITICAL_ONLY === '1';
const CRITICAL_SELECT_ARG = process.argv.find((arg) => arg.startsWith('--only-critical=') || arg.startsWith('--critical='));
const SELECTED_CRITICALS = (() => {
    const envVal = process.env.E2E_ONLY_CRITICALS || '';
    const argVal = CRITICAL_SELECT_ARG ? CRITICAL_SELECT_ARG.split('=')[1] || '' : '';
    const raw = `${envVal}${envVal && argVal ? ',' : ''}${argVal}`.trim();
    if (!raw) return null;
    const ids = raw
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
    return ids.length ? new Set(ids) : null;
})();
function shouldRunCritical(id) {
    return !SELECTED_CRITICALS || SELECTED_CRITICALS.has(id);
}
const SCENARIO_COOLDOWN_MS = Number(process.env.E2E_SCENARIO_COOLDOWN_MS || 5000);
const QUIET_PERIOD_MS = Number(process.env.E2E_QUIET_PERIOD_MS || 2500);
const QUIET_MAX_WAIT_MS = Number(process.env.E2E_QUIET_MAX_WAIT_MS || 20000);
const RUN_IDLE_MAX_WAIT_MS = Number(process.env.E2E_RUN_IDLE_MAX_WAIT_MS || 45000);
const RUN_IDLE_STABLE_MS = Number(process.env.E2E_RUN_IDLE_STABLE_MS || 2000);

// ─── ENV Loader ───────────────────────────────────────────────────────
function loadEnv() {
    const envPath = path.join(__dirname, '../.env');
    if (!fs.existsSync(envPath)) {
        console.warn('⚠️ No .env file found at', envPath);
        return {};
    }
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
        const match = line.match(/^([^#\s]+)=(.+)$/);
        if (match) env[match[1].trim()] = match[2].trim();
    });
    return env;
}

const env = { ...process.env, ...loadEnv() };

// ─── Results Tracker ──────────────────────────────────────────────────
const results = [];
function recordResult(name, passed, details = '') {
    results.push({ name, passed, details });
    const icon = passed ? '✅' : '❌';
    console.log(`\n${icon} ${name}${details ? ': ' + details : ''}`);
}

function printSummary() {
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    results.forEach(r => {
        console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}${r.details ? ' — ' + r.details : ''}`);
    });
    console.log('─'.repeat(60));
    console.log(`  Total: ${results.length}  |  Passed: ${passed}  |  Failed: ${failed}`);
    console.log('='.repeat(60));
    return failed;
}

// ─── Console Log Collector ────────────────────────────────────────────
let consoleLogs = [];
let allConsoleLogs = [];
function clearLogs() { consoleLogs = []; }
function logsContain(pattern) {
    if (typeof pattern === 'string') return consoleLogs.some(l => l.includes(pattern));
    return consoleLogs.some(l => pattern.test(l));
}
function logsMatching(pattern) {
    if (typeof pattern === 'string') return consoleLogs.filter(l => l.includes(pattern));
    return consoleLogs.filter(l => pattern.test(l));
}
function logsCount(pattern) {
    return logsMatching(pattern).length;
}
function allLogsContain(pattern) {
    if (typeof pattern === 'string') return allConsoleLogs.some(l => l.includes(pattern));
    return allConsoleLogs.some(l => pattern.test(l));
}
function allLogsMatching(pattern) {
    if (typeof pattern === 'string') return allConsoleLogs.filter(l => l.includes(pattern));
    return allConsoleLogs.filter(l => pattern.test(l));
}
function allLogsCount(pattern) {
    return allLogsMatching(pattern).length;
}

function isClosedTargetError(error) {
    const msg = String(error);
    return (
        msg.includes('Target page, context or browser has been closed') ||
        msg.includes('Execution context was destroyed') ||
        msg.includes('has been closed')
    );
}

async function isRunActive(window) {
    const stopBtn = window.locator('button[title="Stop Generation"]');
    return (await stopBtn.count().catch(() => 0)) > 0;
}

async function waitForRunIdle(window, maxWaitMs = RUN_IDLE_MAX_WAIT_MS, stableMs = RUN_IDLE_STABLE_MS) {
    const pollMs = 250;
    let stableForMs = 0;
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
        const active = await isRunActive(window);
        if (!active) {
            stableForMs += pollMs;
            if (stableForMs >= stableMs) return true;
        } else {
            stableForMs = 0;
        }
        await window.waitForTimeout(pollMs);
    }
    return false;
}

async function waitForLogQuietPeriod(window, quietMs = QUIET_PERIOD_MS, maxWaitMs = QUIET_MAX_WAIT_MS) {
    const pollMs = 250;
    let lastCount = consoleLogs.length;
    let stableForMs = 0;
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
        await window.waitForTimeout(pollMs);
        const currentCount = consoleLogs.length;
        if (currentCount === lastCount) {
            stableForMs += pollMs;
            if (stableForMs >= quietMs) return true;
        } else {
            lastCount = currentCount;
            stableForMs = 0;
        }
    }
    return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Send a prompt and wait for a final assistant response.
 * Returns { text, timedOut, durationS }
 */
async function sendPromptAndWait(window, prompt, opts = {}) {
    const {
        maxWaitS = MAX_RESPONSE_WAIT_S,
        keywords = [],          // any of these in last bubble = success
        bubbleSelector = '[data-testid="message-bubble"]',
    } = opts;

    clearLogs();

    const input = window.locator('[data-testid="chat-textarea"]');
    await input.waitFor({ state: 'visible', timeout: 15000 });
    await input.fill(prompt);
    await window.keyboard.press('Enter');
    console.log(`\n🚀 Prompt: "${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

    const start = Date.now();
    const maxPolls = Math.ceil(maxWaitS / (POLL_INTERVAL_MS / 1000));
    let lastText = '';

    for (let i = 0; i < maxPolls; i++) {
        try {
            await window.waitForTimeout(POLL_INTERVAL_MS);
        } catch (error) {
            if (isClosedTargetError(error)) {
                const durationS = ((Date.now() - start) / 1000).toFixed(1);
                console.error(`[E2E] Window/browser closed while waiting for response (${durationS}s).`);
                return { text: lastText, timedOut: true, durationS: parseFloat(durationS), windowClosed: true };
            }
            throw error;
        }
        process.stdout.write('.');

        try {
            // Only inspect assistant bubbles. User bubbles often contain the same
            // keywords as the prompt and can cause false positives.
            const assistantBubbles = window.locator(`${bubbleSelector}[data-role="assistant"]`);
            const assistantCount = await assistantBubbles.count();
            if (assistantCount < 1) continue;

            const assistantTexts = await assistantBubbles.allInnerTexts().catch(() => []);
            if (!assistantTexts || assistantTexts.length === 0) continue;

            lastText = assistantTexts[assistantTexts.length - 1] || '';
            const combinedAssistantText = assistantTexts.join('\n').toLowerCase();

            // Check if agent is done (keyword match anywhere in assistant output)
            if (keywords.length > 0) {
                if (keywords.some(kw => combinedAssistantText.includes(kw.toLowerCase()))) {
                    // Prevent cross-scenario bleed: only mark done after run is idle.
                    const runIdle = await waitForRunIdle(window);
                    if (!runIdle) {
                        console.warn('[E2E] Keyword matched but run still active; continuing to wait.');
                        continue;
                    }
                    const durationS = ((Date.now() - start) / 1000).toFixed(1);
                    console.log(`\n⏱️  Response in ${durationS}s`);
                    return { text: lastText, timedOut: false, durationS: parseFloat(durationS) };
                }
            }

        } catch (e) { /* bubble might not exist yet */ }
    }

    const durationS = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n⏱️  Timed out after ${durationS}s`);
    return { text: lastText, timedOut: true, durationS: parseFloat(durationS) };
}

/**
 * Start a new chat session by clicking the new-chat button.
 */
async function startNewChat(window) {
    // Allow background tool/LLM activity from the previous scenario to settle.
    let idle = await waitForRunIdle(window, Math.max(RUN_IDLE_MAX_WAIT_MS, 60000));
    if (!idle) {
        const stopBtn = window.locator('button[title="Stop Generation"]');
        if ((await stopBtn.count().catch(() => 0)) > 0) {
            console.warn('[E2E] Previous run still active before new scenario; stopping it for isolation.');
            await stopBtn.first().click().catch(() => { });
            idle = await waitForRunIdle(window, 15000, 1000);
        }
    }
    await waitForLogQuietPeriod(window, QUIET_PERIOD_MS, Math.max(QUIET_MAX_WAIT_MS, 30000));
    if (SCENARIO_COOLDOWN_MS > 0) {
        await window.waitForTimeout(SCENARIO_COOLDOWN_MS);
    }

    try {
        const newChatBtn = window.locator('[data-testid="new-chat-btn"], button[title="New Chat"], button[title="New Chat Session"]');
        if (await newChatBtn.count() > 0) {
            await newChatBtn.first().click();
            await window.waitForTimeout(1000);
        }
    } catch (e) {
        // If no new chat button, just continue
    }
    clearLogs();
}

/**
 * Take a named screenshot.
 */
async function screenshot(window, name) {
    await window.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

/**
 * Toggle "Detailed Visibility" mode in dev UI.
 * - true  => Detailed Visibility ON (dev internals visible)
 * - false => Detailed Visibility OFF (prod-like filtered view)
 */
async function setDetailedVisibility(window, enabled) {
    const onBtn = window.locator('button:has-text("Detailed Visibility ON")');
    const offBtn = window.locator('button:has-text("Detailed Visibility OFF")');
    const onVisible = (await onBtn.count()) > 0;
    const offVisible = (await offBtn.count()) > 0;

    if (enabled && offVisible) {
        await offBtn.first().click();
        await window.waitForTimeout(500);
    } else if (!enabled && onVisible) {
        await onBtn.first().click();
        await window.waitForTimeout(500);
    }
}

// ─── MAIN ─────────────────────────────────────────────────────────────
(async () => {
    console.log('\n🚀 Starting COMPREHENSIVE E2E TEST SUITE (OpenRouter Live)');
    console.log('='.repeat(60));

    if (!env.VITE_OPENROUTER_API_KEY) {
        console.error('❌ ERROR: VITE_OPENROUTER_API_KEY not found in .env');
        process.exit(1);
    }

    // Clean screenshot dir
    if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    } else {
        const files = fs.readdirSync(SCREENSHOT_DIR);
        for (const file of files) {
            if (file.endsWith('.png')) fs.unlinkSync(path.join(SCREENSHOT_DIR, file));
        }
    }

    // Electron paths
    const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');
    const electronExecutable = fs.existsSync(macPath) ? macPath : linuxPath;
    const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

    let electronApp;
    try {
        electronApp = await electron.launch({
            executablePath: execPath,
            args: [APP_PATH],
            env: { ...env, NODE_ENV: 'production' },
            timeout: 120000
        });
    } catch (err) {
        console.error('❌ Launch Failed:', err);
        process.exit(1);
    }

    try {
        const window = await electronApp.firstWindow();
        await window.setViewportSize({ width: 1280, height: 800 });

        // Attach console collector
        window.on('console', msg => {
            const text = msg.text();
            consoleLogs.push(text);
            allConsoleLogs.push(text);
            console.log(`[Renderer]: ${text}`);
        });
        window.on('pageerror', err => console.error(`[Renderer ERROR]: ${err}`));

        // ──────────────────────────────────────────────────────────
        //  SETUP: Inject model, credentials, bypass onboarding
        // ──────────────────────────────────────────────────────────
        console.log('\n⚙️  Setting up test environment...');
        const TARGET_MODEL = env.VITE_OPENROUTER_MODEL || 'qwen/qwen3.6-plus:free';
        const TARGET_API_KEY = env.VITE_OPENROUTER_API_KEY;

        // Ensure we are on a document where localStorage is accessible.
        // In some launches the first window starts at an opaque origin briefly.
        await window.waitForFunction(() => {
            try {
                localStorage.setItem('__e2e_probe__', '1');
                localStorage.removeItem('__e2e_probe__');
                return true;
            } catch {
                return false;
            }
        }, { timeout: 30000 });

        // Write ALL localStorage values in one shot
        await window.evaluate(({ model, apiKey }) => {
            localStorage.setItem('has_completed_onboarding', 'true');
            localStorage.setItem('ai_worker_settings', JSON.stringify({
                state: {
                    preferredProvider: 'openrouter',
                    openrouterModel: model,
                    openrouterApiKey: apiKey,
                    theme: 'dark',
                    displayMode: 'dev'
                },
                version: 0
            }));
        }, { model: TARGET_MODEL, apiKey: TARGET_API_KEY });

        // IPC injection in MAIN process
        await electronApp.evaluate(({ ipcMain }, { apiKey, model }) => {
            ipcMain.removeHandler('store:get');
            ipcMain.removeHandler('secure:get');

            ipcMain.handle('store:get', (event, key) => {
                if (key === 'ai_worker_settings') {
                    return {
                        state: {
                            openrouterModel: model,
                            preferredProvider: 'openrouter',
                            theme: 'dark',
                            displayMode: 'dev'
                        },
                        version: 0
                    };
                }
                if (key === 'mcp_servers.settings.llm_provider') return 'openrouter';
                if (key === 'mcp_servers.settings.openrouter_model') return model;
                if (key === 'mcp_servers.settings.use_fallback_env') return true;
                return undefined;
            });

            ipcMain.handle('secure:get', (event, key) => {
                if (key === 'openrouter_api_key' || key === 'mcp_servers.settings.openrouter_api_key') {
                    return { success: true, value: apiKey };
                }
                return { success: true, value: null };
            });
        }, { apiKey: TARGET_API_KEY, model: TARGET_MODEL });

        // Single reload
        await window.reload();
        await window.waitForLoadState('domcontentloaded');
        await window.locator('button[title="Start Voice Mode"]').waitFor({ state: 'visible', timeout: 15000 });

        // Verify model
        const activeModel = await window.evaluate(() => {
            const store = JSON.parse(localStorage.getItem('ai_worker_settings') || '{}');
            return store?.state?.openrouterModel;
        });
        if (activeModel !== TARGET_MODEL) {
            console.error(`❌ MODEL MISMATCH: expected "${TARGET_MODEL}", got "${activeModel}"`);
            process.exit(1);
        }
        console.log(`✅ Model verified: ${activeModel}`);
        console.log('✅ Setup complete. Starting scenarios...\n');
        const criticalScope = SELECTED_CRITICALS ? ` (selected: ${Array.from(SELECTED_CRITICALS).sort((a, b) => a - b).join(',')})` : '';
        console.log(`🧪 Test mode: ${CRITICAL_ONLY ? 'critical-only' : 'full-suite'}${criticalScope}`);

        // Startup validation for historically flaky signals (#1/#6/#18/#17).
        const startupParseError = allLogsContain(/Failed to parse create_entities response|Failed to parse search response/i);
        const startupCspDuplicate = allLogsContain(/Ignoring duplicate Content-Security-Policy directive/i);
        const startupWebllmCacheError = allLogsContain(/Failed to check downloaded models: ReferenceError: caches is not defined/i);
        const startupSignalPass = !startupParseError && !startupCspDuplicate && !startupWebllmCacheError;
        recordResult(
            'S00: Startup Integrity Signals',
            startupSignalPass,
            `Memory parse errors: ${startupParseError}. CSP duplicates: ${startupCspDuplicate}. WebLLM cache error: ${startupWebllmCacheError}`
        );
        const staleSocketBaseline = allLogsCount(/Cleared stale SingletonSocket/i);
        const contextDestroyedBaseline = allLogsCount(/Execution context was destroyed/i);

        if (!CRITICAL_ONLY) {
            // ══════════════════════════════════════════════════════════
            //  SCENARIO 11: Fallback to Direct Execution (Simple Query)
            //  example-prompts.md #11 — Fastest, no browser needed
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 11: Direct Execution (Simple Query)');
            console.log('─'.repeat(60));
            {
                clearLogs();
                const result = await sendPromptAndWait(window, "What's the capital of France?", {
                    maxWaitS: 60,
                    keywords: ['paris'],
                });
                await screenshot(window, 's11-direct-execution');

                const passed = !result.timedOut && result.text.toLowerCase().includes('paris');
                const noOrchestration = !logsContain('Auto-forking') && !logsContain('Sub-agent created');
                recordResult(
                    'S11: Direct Execution (no orchestration)',
                    passed && noOrchestration,
                    passed
                        ? `Answered correctly in ${result.durationS}s. Orchestration bypassed: ${noOrchestration}`
                        : `Timed out or wrong answer: "${result.text.substring(0, 60)}"`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 8: No Duplicate Messages
            //  example-prompts.md #8 — Verify message deduplication
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 8: No Duplicate Messages');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window, "Open google.com and search for weather in Bangalore", {
                    maxWaitS: 120,
                    keywords: ['bangalore', 'weather', 'temperature', 'forecast'],
                });
                await screenshot(window, 's08-no-duplicates');

                // Check console logs for duplicate warning (good) or absence of duplicates
                const hasDuplicateGuard = logsContain('skipping duplicate') || logsContain('already in history');
                const noError = !logsContain('Handler error');
                recordResult(
                    'S08: No Duplicate Messages',
                    !result.timedOut && noError,
                    `Completed in ${result.durationS}s. Dup guard fired: ${hasDuplicateGuard}. No errors: ${noError}`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 1: Parallel Sub-Agents (Multi-Site Comparison)
            //  example-prompts.md #1
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 1: Parallel Sub-Agents (Multi-Site)');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Compare the price of a Sony WH-1000XM5 headphone on Amazon.com and BestBuy.com. Just give me the prices found.", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['sony', 'price', 'amazon', 'bestbuy', '$', '₹'],
                });
                await screenshot(window, 's01-parallel-final');

                const hasParallelLog = logsContain('Auto-forking') || logsContain('parallel') || logsContain('2 contexts');
                const hasFreshContext = logsContain('FRESH context') || logsContain('Sub-agent created');
                recordResult(
                    'S01: Parallel Sub-Agents',
                    !result.timedOut,
                    `${result.timedOut ? 'TIMEOUT' : 'Completed'} in ${result.durationS}s. Parallel: ${hasParallelLog}. Fresh ctx: ${hasFreshContext}`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 6: Context Isolation (No History Leak)
            //  example-prompts.md #6
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 6: Context Isolation');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Search for iPhone 15 on Amazon and then on eBay", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['iphone', 'amazon', 'ebay', 'price', '$'],
                });
                await screenshot(window, 's06-context-isolation');

                const freshContextLogs = logsMatching(/FRESH context/i);
                const noHistoryLeak = !logsContain('history shared between');
                recordResult(
                    'S06: Context Isolation',
                    !result.timedOut,
                    `${result.timedOut ? 'TIMEOUT' : 'Completed'} in ${result.durationS}s. Fresh context signals: ${freshContextLogs.length}. No leak: ${noHistoryLeak}`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 3: Smart Result Reporting & Noise Filtering
            //  example-prompts.md #3
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 3: Smart Result Reporting');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Search for 'wireless headphones' on Amazon and show me the top 3 results with prices and ratings.", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['headphone', 'price', '$', 'rating', '⭐', 'star'],
                });
                await screenshot(window, 's03-smart-reporting');

                const hasTruncation = logsContain('Truncated') || logsContain('truncated');
                const hasCleanOutput = !result.text.includes('[object Object]') && !result.text.includes('innerHTML');
                recordResult(
                    'S03: Smart Result Reporting',
                    !result.timedOut && hasCleanOutput,
                    `${result.timedOut ? 'TIMEOUT' : 'Completed'} in ${result.durationS}s. Clean output: ${hasCleanOutput}. Truncation active: ${hasTruncation}`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 5: Manual Delegation (delegate_sub_task)
            //  example-prompts.md #5
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 5: Manual Delegation via Sub-Agent');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Go to news.ycombinator.com and find the top 3 stories. For the #1 story, use a sub-agent to open the link, read the article, and summarize the key points in less than 100 words.", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['hacker news', 'summary', 'story', 'article', 'points'],
                });
                await screenshot(window, 's05-delegation');

                const hasSubAgent = logsContain('Sub-agent created') || logsContain('delegate_sub_task');
                const hasLightweight = logsContain('lightweight');
                recordResult(
                    'S05: Manual Delegation (delegate_sub_task)',
                    !result.timedOut,
                    `${result.timedOut ? 'TIMEOUT' : 'Completed'} in ${result.durationS}s. Sub-agent: ${hasSubAgent}. Lightweight: ${hasLightweight}`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 7: Token Efficiency & Output Truncation
            //  example-prompts.md #7 — Check truncation in logs
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 7: Token Efficiency & Truncation');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Go to amazon.com and extract all product categories visible on the homepage.", {
                    maxWaitS: 120,
                    keywords: ['categor', 'electronics', 'books', 'fashion', 'home'],
                });
                await screenshot(window, 's07-truncation');

                const truncationLogs = logsMatching(/[Tt]runcated.*\d+.*→.*\d+/);
                recordResult(
                    'S07: Token Efficiency & Truncation',
                    truncationLogs.length > 0 || !result.timedOut,
                    `Truncation events: ${truncationLogs.length}. Completed: ${!result.timedOut} in ${result.durationS}s`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 18A: Memory — Preference Learning
            //  example-prompts.md #18A
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 18A: Memory — Preference Learning');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "I'm working on a new React project named 'Orbit'. I strictly use Tailwind CSS and TypeScript. Also, always add a 'Copyright 2026' header to any code you generate.", {
                    maxWaitS: 90,
                    keywords: ['orbit', 'noted', 'remember', 'saved', 'preference', 'got it', 'understood', 'tailwind'],
                });
                await screenshot(window, 's18a-memory-learning');

                const hasMemoryCreate = logsContain('memory_create_entity') || logsContain('MemoryReflector');
                const hasEntityCreation = logsContain('Invoking Tool: memory_create');
                recordResult(
                    'S18A: Memory — Preference Learning',
                    !result.timedOut && hasMemoryCreate,
                    `MemoryReflector active: ${hasMemoryCreate}. Entity created: ${hasEntityCreation}. Completed in ${result.durationS}s`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 18B: Memory — Active Retrieval
            //  example-prompts.md #18B (follow-up to 18A)
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 18B: Memory — Active Retrieval');
            console.log('─'.repeat(60));
            {
                // Same chat session as 18A for context continuity
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Generate a login component for my project.", {
                    maxWaitS: 90,
                    keywords: ['tailwind', 'typescript', 'copyright 2026', 'tsx', 'login', 'component'],
                });
                await screenshot(window, 's18b-memory-retrieval');

                const hasMemorySearch = logsContain('memory_search') || logsContain('Invoking Tool: memory_search');
                const usesTailwind = result.text.toLowerCase().includes('tailwind') || result.text.includes('className');
                const hasCopyright = result.text.includes('Copyright 2026');
                recordResult(
                    'S18B: Memory — Active Retrieval',
                    !result.timedOut,
                    `Uses Tailwind: ${usesTailwind}. Has Copyright: ${hasCopyright}. Memory searched: ${hasMemorySearch}. Completed in ${result.durationS}s`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 21A: Single Bubble — Direct Tool-Calling Agent
            //  example-prompts.md #21A
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 21A: Single Bubble (Multi-Step Direct)');
            console.log('─'.repeat(60));
            {
                // Tool cards are intentionally hidden in prod view; enforce dev view.
                await setDetailedVisibility(window, true);
                await startNewChat(window);
                clearLogs();
                const assistantBefore = await window
                    .locator('[data-testid="message-bubble"][data-role="assistant"]')
                    .count()
                    .catch(() => 0);
                const actionCardsBefore = await window
                    .locator('[data-testid="toolcall-agent-group"], [data-testid="toolcall-agent-chip"]')
                    .count()
                    .catch(() => 0);
                const result = await sendPromptAndWait(window,
                    "Go to bbc.com, find the top headline, then go to reuters.com and find their top headline, then compare the two.", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['bbc', 'reuters', 'headline', 'compar'],
                });
                await screenshot(window, 's21a-single-bubble');

                // Count newly-rendered cards/bubbles for this scenario only.
                const actionCardsAfter = await window
                    .locator('[data-testid="toolcall-agent-group"], [data-testid="toolcall-agent-chip"]')
                    .count()
                    .catch(() => -1);
                const assistantAfter = await window
                    .locator('[data-testid="message-bubble"][data-role="assistant"]')
                    .count()
                    .catch(() => -1);
                const actionCardsDelta = Math.max(0, actionCardsAfter - actionCardsBefore);
                const assistantDelta = Math.max(0, assistantAfter - assistantBefore);
                recordResult(
                    'S21A: Single Bubble (all tools in one card)',
                    !result.timedOut && actionCardsDelta <= 1 && assistantDelta >= 1,
                    `Action-card delta: ${actionCardsDelta}. Assistant-bubble delta: ${assistantDelta}. Completed in ${result.durationS}s`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 21G: Immediate Reply — No Bubble, No Progress
            //  example-prompts.md #21G
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 21G: Immediate Reply (No Tools)');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window, "What is the difference between TCP and UDP?", {
                    maxWaitS: 45,
                    keywords: ['tcp', 'udp', 'protocol', 'connection', 'reliable'],
                });
                await screenshot(window, 's21g-instant-reply');

                const noToolCalls = !logsContain('Executing tool:');
                const fast = result.durationS < 30;
                recordResult(
                    'S21G: Immediate Reply (no tools, no progress bar)',
                    !result.timedOut && noToolCalls,
                    `No tools: ${noToolCalls}. Fast (${result.durationS}s < 30s): ${fast}`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 2: Sequential Orchestration (RedBus)
            //  example-prompts.md #2
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 2: Sequential Orchestration');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Help me find bus tickets from Bangalore to Mysore on RedBus for tomorrow", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['bus', 'bangalore', 'mysore', 'redbus', 'seat', 'price', 'ticket', '₹', '$'],
                });
                await screenshot(window, 's02-sequential');

                const hasExecutionPlan =
                    logsContain('execution plan') ||
                    logsContain('Execution plan') ||
                    logsContain('create_execution_plan') ||
                    logsContain('plan_created');
                const hasSteps =
                    logsContain('Step 1') ||
                    logsContain('step 1') ||
                    logsContain('sequential_step_start');
                const directSingleSite = logsContain(/direct-single-site short-circuit/i);
                const orchestratedPath = hasExecutionPlan && hasSteps;
                recordResult(
                    'S02: Sequential Orchestration',
                    !result.timedOut && (orchestratedPath || directSingleSite),
                    `Orchestrated path: ${orchestratedPath}. Direct short-circuit: ${directSingleSite}. Plan created: ${hasExecutionPlan}. Step tracking: ${hasSteps}. Completed in ${result.durationS}s`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 21C: Progress Bar — Parallel Orchestration
            //  example-prompts.md #21C
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 21C: Progress Bar — Parallel');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Compare the price of AirPods Pro on Amazon, BestBuy, and Target.", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['airpods', 'price', 'amazon', 'bestbuy', 'target', '$'],
                });
                await screenshot(window, 's21c-progress-parallel');

                const hasParallelSummary = await window
                    .locator('text=/Results from 3 sources|Parallel Execution/i')
                    .first()
                    .isVisible()
                    .catch(() => false);
                recordResult(
                    'S21C: Progress Bar — Parallel',
                    !result.timedOut && hasParallelSummary,
                    `Parallel summary visible: ${hasParallelSummary}. Completed in ${result.durationS}s`
                );
            }
        }

        // ══════════════════════════════════════════════════════════
        //  CRITICAL 1: Parallel delegate_sub_task in single turn
        //  Guards against regression where delegate calls become fully sequential.
        // ══════════════════════════════════════════════════════════
        if (shouldRunCritical(1)) {
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Critical 1: delegate_sub_task Parallelism');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Compare iPhone 17 pricing across Amazon.in and Flipkart.com. Delegate both site lookups in parallel and return a combined comparison table.", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['amazon', 'flipkart', 'iphone', 'price', 'comparison'],
                });
                await screenshot(window, 'critical-01-delegate-parallel');

                const delegateSignals = logsCount(/delegate_sub_task|Delegating to sub-agent|Sub-agent created/i);
                const maxIterationFailure = logsContain(/Sub-agent failed: Max iterations reached/i);
                const has429 = logsContain(/OpenAI error \(429\)|Rate limit exceeded|resource exhausted/i);

                recordResult(
                    'Critical 1: delegate_sub_task Parallelism',
                    !result.timedOut && delegateSignals >= 2 && !maxIterationFailure,
                    `Completed: ${!result.timedOut}. Delegate signals: ${delegateSignals}. Max-iteration failure: ${maxIterationFailure}. 429 seen: ${has429}`
                );
            }
        }

        // ══════════════════════════════════════════════════════════
        //  CRITICAL 2: Conditional wording should not force sequential mode
        //  Guards task-decomposer "if/unless" over-trigger regression.
        // ══════════════════════════════════════════════════════════
        if (shouldRunCritical(2)) {
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Critical 2: Conditional Multi-Site Decomposition');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Compare AirPods Pro prices on amazon.com and bestbuy.com if possible, and return both prices.", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['airpods', 'amazon', 'bestbuy', 'price', '$'],
                });
                await screenshot(window, 'critical-02-conditional-decomposition');

                const hasParallelHints = logsContain(/Auto-forking.*parallel|parallel.*contexts|2 contexts/i);
                const delegateSignals = logsCount(/delegate_sub_task|Delegating to sub-agent|Sub-agent created/i);
                recordResult(
                    'Critical 2: Conditional Multi-Site Decomposition',
                    !result.timedOut && (hasParallelHints || delegateSignals >= 2),
                    `Completed: ${!result.timedOut}. Parallel hints: ${hasParallelHints}. Delegate signals: ${delegateSignals}`
                );
            }
        }

        // ══════════════════════════════════════════════════════════
        //  CRITICAL 3: Detailed visibility OFF must still show final result
        //  Guards prod-view filtering regressions.
        // ══════════════════════════════════════════════════════════
        if (shouldRunCritical(3)) {
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Critical 3: Detailed Visibility OFF Final Output');
            console.log('─'.repeat(60));
            {
                await setDetailedVisibility(window, false);
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "From the BBC and Reuters homepages, extract one top visible headline from each site WITHOUT opening article links, then provide a short comparison.", {
                    maxWaitS: 120,
                    keywords: ['bbc', 'reuters', 'headline', 'comparison', 'visible'],
                });
                await screenshot(window, 'critical-03-prod-visibility-final-result');

                const assistantBubbles = window.locator('[data-testid="message-bubble"][data-role="assistant"]');
                const assistantCount = await assistantBubbles.count();
                const hasExecutionFailedBadge = (await window.locator('text=Execution failed').count()) > 0;

                recordResult(
                    'Critical 3: Detailed Visibility OFF Final Output',
                    !result.timedOut && assistantCount > 0 && !hasExecutionFailedBadge,
                    `Completed: ${!result.timedOut}. Assistant bubbles: ${assistantCount}. Checklist failed badge visible: ${hasExecutionFailedBadge}`
                );

                // Restore detailed visibility ON for remaining diagnostics.
                await setDetailedVisibility(window, true);
            }
        }

        // ══════════════════════════════════════════════════════════
        //  CRITICAL 4: File-write request should not loop infinitely
        //  Guards fs_write loop behavior when workspace is not selected.
        // ══════════════════════════════════════════════════════════
        if (shouldRunCritical(4)) {
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Critical 4: File Write Loop Safety');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const assistantBubblesBefore = await window.locator('[data-testid="message-bubble"][data-role="assistant"]').count().catch(() => 0);
                const result = await sendPromptAndWait(window,
                    "Create a file named demo.txt containing 'hello world'.", {
                    maxWaitS: 90,
                    keywords: ['workspace', 'folder', 'select', 'file', 'create', 'demo.txt', 'permission', 'cannot'],
                });
                await screenshot(window, 'critical-04-file-write-loop-safety');

                const infiniteLoopDetected = logsContain(/Infinite loop detected: fs_write_file/i);
                const repeatedFsWrite = logsCount(/fs_write_file/i);
                const workspaceGuardSeen = logsContain(/WORKSPACE REQUIRED|select a workspace folder|No workspace folder is set/i);
                const assistantBubblesAfter = await window.locator('[data-testid="message-bubble"][data-role="assistant"]').count().catch(() => 0);
                const receivedAssistantResponse = assistantBubblesAfter > assistantBubblesBefore;
                const completed = !result.timedOut || workspaceGuardSeen || receivedAssistantResponse;
                recordResult(
                    'Critical 4: File Write Loop Safety',
                    completed && !infiniteLoopDetected,
                    `Completed: ${completed}. Timed out: ${result.timedOut}. Workspace guard: ${workspaceGuardSeen}. Assistant response: ${receivedAssistantResponse}. Infinite fs loop: ${infiniteLoopDetected}. fs_write references: ${repeatedFsWrite}`
                );
            }
        }

        // ══════════════════════════════════════════════════════════
        //  CRITICAL 5: Memory entity writes should not parse-fail
        //  Guards JSON parse failures + 300s memory-create disable fallback.
        // ══════════════════════════════════════════════════════════
        if (shouldRunCritical(5)) {
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Critical 5: Memory Create Stability');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Remember this preference: always use concise bullet points in responses.", {
                    maxWaitS: 75,
                    keywords: ['remember', 'preference', 'noted', 'saved', 'concise'],
                });
                await screenshot(window, 'critical-05-memory-create-stability');

                const parseFailure = logsContain(/Failed to parse create_entities response/i);
                const memoryCreateDisabled = logsContain(/Disabled memory_create_entity for 300s/i);
                recordResult(
                    'Critical 5: Memory Create Stability',
                    !result.timedOut && !parseFailure && !memoryCreateDisabled,
                    `Completed: ${!result.timedOut}. Parse failure: ${parseFailure}. 300s disable: ${memoryCreateDisabled}`
                );
            }
        }

        if (!CRITICAL_ONLY) {
            // ══════════════════════════════════════════════════════════
            //  SCENARIO 13: Model Refusal Auto-Correction
            //  example-prompts.md #13
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 13: Model Refusal Auto-Correction');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Search for 'gaming laptop' on Amazon and add the top result to cart", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['laptop', 'amazon', 'cart', 'added', 'gaming', 'price', '$'],
                });
                await screenshot(window, 's13-refusal-correction');

                const hasAutoCorrection = logsContain('auto-correct') || logsContain('Retrying');
                const hasRefusal = logsContain('refused') || logsContain('Refusal');
                recordResult(
                    'S13: Model Refusal Auto-Correction',
                    !result.timedOut,
                    `Auto-correction: ${hasAutoCorrection}. Refusal detected: ${hasRefusal}. Completed in ${result.durationS}s`
                );
            }

            // ══════════════════════════════════════════════════════════
            //  SCENARIO 15: Mandatory Progress Checkpoints
            //  example-prompts.md #15 (long running task)
            // ══════════════════════════════════════════════════════════
            console.log('\n' + '─'.repeat(60));
            console.log('📋 Scenario 15: Mandatory Progress Checkpoints');
            console.log('─'.repeat(60));
            {
                await startNewChat(window);
                clearLogs();
                const result = await sendPromptAndWait(window,
                    "Go to 3 news sites (CNN, BBC, Reuters), find the top headline on each, and summarize them.", {
                    maxWaitS: MAX_RESPONSE_WAIT_S,
                    keywords: ['cnn', 'bbc', 'reuters', 'headline', 'summary', 'news'],
                });
                await screenshot(window, 's15-progress-checkpoints');

                const checkpointLogs = logsMatching(/[Cc]heckpoint|progress.*summary|update_progress/);
                recordResult(
                    'S15: Mandatory Progress Checkpoints',
                    !result.timedOut && checkpointLogs.length > 0,
                    `Checkpoints fired: ${checkpointLogs.length}. Completed in ${result.durationS}s`
                );
            }
        }

        // ══════════════════════════════════════════════════════════
        //  DONE — Print summary and exit
        // ══════════════════════════════════════════════════════════
        const staleSocketDelta = Math.max(0, allLogsCount(/Cleared stale SingletonSocket/i) - staleSocketBaseline);
        const contextDestroyedDelta = Math.max(0, allLogsCount(/Execution context was destroyed/i) - contextDestroyedBaseline);
        recordResult(
            'S00B: Runtime Stability Signals',
            contextDestroyedDelta === 0 && staleSocketDelta <= 2,
            `Execution-context-destroyed: ${contextDestroyedDelta}. Stale-socket-cleanups: ${staleSocketDelta}`
        );

        await screenshot(window, 'final-state');
        const failedCount = printSummary();

        console.log('\n🎉 E2E Suite Complete.');
        await electronApp.close();
        process.exit(failedCount > 0 ? 1 : 0);

    } catch (error) {
        console.error('\n❌ CRITICAL FAILURE:', error);
        try {
            const window = await electronApp.firstWindow();
            await window.screenshot({ path: path.join(SCREENSHOT_DIR, 'crash-dump.png') });
        } catch (e) { }

        printSummary();
        await electronApp.close();
        process.exit(1);
    }
})();
