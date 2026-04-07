const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const APP_PATH = path.join(__dirname, '../out/main/index.js');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots_real_focus');
const MAX_WAIT_S = Number(process.env.E2E_FOCUS_MAX_WAIT_S || 180);
const POLL_MS = 5000;

function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach((line) => {
    const m = line.match(/^([^#\s]+)=(.+)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
  return env;
}

const env = { ...process.env, ...loadEnv() };
const TARGET_MODEL = env.E2E_OPENROUTER_MODEL || env.VITE_OPENROUTER_MODEL || 'qwen/qwen3.6-plus:free';
const TARGET_API_KEY = env.E2E_OPENROUTER_API_KEY || env.VITE_OPENROUTER_API_KEY;

let consoleLogs = [];
function clearLogs() { consoleLogs = []; }
function logsContain(pattern) {
  if (typeof pattern === 'string') return consoleLogs.some((l) => l.includes(pattern));
  return consoleLogs.some((l) => pattern.test(l));
}

async function sendPromptAndWait(window, prompt, keywords, maxWaitS = MAX_WAIT_S) {
  clearLogs();
  const input = window.locator('[data-testid="chat-textarea"]');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(prompt);
  await window.keyboard.press('Enter');

  const start = Date.now();
  const maxPolls = Math.ceil(maxWaitS / (POLL_MS / 1000));
  let lastText = '';

  for (let i = 0; i < maxPolls; i++) {
    await window.waitForTimeout(POLL_MS);
    const assistantBubbles = window.locator('[data-testid="message-bubble"][data-role="assistant"]');
    const count = await assistantBubbles.count().catch(() => 0);
    if (count < 1) continue;

    const texts = await assistantBubbles.allInnerTexts().catch(() => []);
    if (!texts.length) continue;

    lastText = texts[texts.length - 1] || '';
    const combined = texts.join('\n').toLowerCase();

    if (keywords.some((kw) => combined.includes(kw.toLowerCase()))) {
      const durationS = Number(((Date.now() - start) / 1000).toFixed(1));
      return { timedOut: false, durationS, text: lastText };
    }
  }

  return {
    timedOut: true,
    durationS: Number(((Date.now() - start) / 1000).toFixed(1)),
    text: lastText,
  };
}

async function startNewChat(window) {
  try {
    const newChatBtn = window.locator('[data-testid="new-chat-btn"], button[title="New Chat"], button[title="New Chat Session"]');
    if (await newChatBtn.count() > 0) {
      await newChatBtn.first().click();
      await window.waitForTimeout(1000);
    }
  } catch {
    // ignore
  }
  clearLogs();
}

async function resetChatState(window) {
  await window.evaluate(() => {
    localStorage.removeItem('ai-worker-chat-v3');
  });
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await window.locator('button[title="Start Voice Mode"]').waitFor({ state: 'visible', timeout: 15000 });
  clearLogs();
}

async function screenshot(window, name) {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await window.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

(async () => {
  if (!TARGET_API_KEY) {
    console.error('❌ Missing VITE_OPENROUTER_API_KEY/E2E_OPENROUTER_API_KEY');
    process.exit(1);
  }

  const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');
  const electronExecutable = fs.existsSync(macPath) ? macPath : linuxPath;
  const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

  const electronApp = await electron.launch({
    executablePath: execPath,
    args: [APP_PATH, '--no-sandbox'],
    env: { ...env, NODE_ENV: 'production' },
    timeout: 120000,
  });

  const window = await electronApp.firstWindow();
  window.on('console', (msg) => {
    const txt = msg.text();
    consoleLogs.push(txt);
    console.log('[Renderer]:', txt);
  });

  await window.waitForFunction(() => {
    try {
      localStorage.setItem('__e2e_probe__', '1');
      localStorage.removeItem('__e2e_probe__');
      return true;
    } catch {
      return false;
    }
  }, { timeout: 30000 });

  await window.evaluate(({ model, apiKey }) => {
    localStorage.setItem('has_completed_onboarding', 'true');
    localStorage.setItem('ai_worker_settings', JSON.stringify({
      state: {
        openrouterModel: model,
        preferredProvider: 'openrouter',
        openrouterApiKey: apiKey,
        theme: 'dark',
        displayMode: 'dev'
      },
      version: 0,
    }));
  }, { apiKey: TARGET_API_KEY, model: TARGET_MODEL });

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
            displayMode: 'dev',
          },
          version: 0,
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

  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await window.locator('button[title="Start Voice Mode"]').waitFor({ state: 'visible', timeout: 15000 });

  const results = [];
  const push = (name, passed, details) => {
    results.push({ name, passed, details });
    console.log(`${passed ? '✅' : '❌'} ${name}: ${details}`);
  };

  console.log('\n📋 Focus Scenario: S05 Manual Delegation');
  await startNewChat(window);
  const s05 = await sendPromptAndWait(
    window,
    "Go to news.ycombinator.com and find the top 3 stories. For the #1 story, use a sub-agent to open the link, read the article, and summarize the key points in less than 100 words.",
    ['hacker news', 'summary', 'story', 'article', 'points']
  );
  await screenshot(window, 'focus-s05');
  const s05HasSubAgent = logsContain('Sub-agent created') || logsContain('delegate_sub_task');
  push('S05: Manual Delegation', !s05.timedOut && s05HasSubAgent, `Timed out: ${s05.timedOut}, sub-agent seen: ${s05HasSubAgent}, duration: ${s05.durationS}s`);

  console.log('\n📋 Focus Scenario: S21G Immediate Reply');
  // Hard reset chat store to guarantee first-turn behavior for this scenario.
  await resetChatState(window);
  const s21g = await sendPromptAndWait(
    window,
    'What is the difference between TCP and UDP?',
    ['tcp', 'udp', 'protocol', 'connection', 'reliable'],
    60
  );
  await screenshot(window, 'focus-s21g');
  const s21gNoTools = !logsContain('Executing tool:');
  push('S21G: Immediate Reply', !s21g.timedOut && s21gNoTools, `Timed out: ${s21g.timedOut}, no tools: ${s21gNoTools}, duration: ${s21g.durationS}s`);

  const failed = results.filter((r) => !r.passed).length;
  console.log('\n📊 Focus Summary');
  results.forEach((r) => console.log(`  ${r.passed ? '✅' : '❌'} ${r.name} — ${r.details}`));
  console.log(`Total: ${results.length} | Failed: ${failed}`);

  await electronApp.close();
  process.exit(failed > 0 ? 1 : 0);
})();
