const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots_issue_repro');

function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach((line) => {
    const match = line.match(/^([^#\s]+)=(.+)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  });
  return env;
}

(async () => {
  console.log('🚀 Starting Issue Repro E2E (Mocked, excludes #15)...');

  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const macPath = path.join(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const linuxPath = path.join(__dirname, '../node_modules/electron/dist/electron');
  const electronExecutable = fs.existsSync(macPath) ? macPath : linuxPath;
  const execPath = fs.existsSync(electronExecutable) ? electronExecutable : 'electron';

  let electronApp;
  const rendererLogs = [];
  const env = { ...process.env, ...loadEnv(), NODE_ENV: 'production' };

  const mark = [];
  const addMark = (issue, status, finding) => {
    mark.push({ issue, status, finding });
    const icon = status === 'reproduced' ? '⚠️' : status === 'not_reproduced' ? '✅' : '❔';
    console.log(`${icon} ${issue}: ${status} — ${finding}`);
  };

  const logsSince = (startIndex) => rendererLogs.slice(startIndex);
  const countLogs = (startIndex, pattern) => logsSince(startIndex).filter((l) => (typeof pattern === 'string' ? l.includes(pattern) : pattern.test(l))).length;
  const hasLog = (startIndex, pattern) => countLogs(startIndex, pattern) > 0;

  try {
    electronApp = await electron.launch({
      executablePath: execPath,
      args: [path.join(__dirname, '../out/main/index.js'), '--no-sandbox'],
      timeout: 90000,
      env,
    });

    const window = await electronApp.firstWindow();
    await window.setViewportSize({ width: 1400, height: 900 });

    window.on('console', (msg) => {
      const text = msg.text();
      rendererLogs.push(text);
      console.log(`[Renderer] ${text}`);
    });

    await window.addInitScript(async () => {
      function normalizeContent(raw) {
        if (typeof raw === 'string') return raw;
        if (Array.isArray(raw)) return raw.map((c) => c?.text || JSON.stringify(c)).join(' ');
        if (raw && typeof raw === 'object') return JSON.stringify(raw);
        return '';
      }

      function createMockResponse(message) {
        return {
          model: 'mock-model',
          choices: [{ message }],
          usage: { total_tokens: 10 },
        };
      }

      localStorage.setItem('skipDepsCheck', 'true');
      localStorage.setItem('__issueReproCounter__', '0');
      localStorage.setItem('__repro13_delegations__', '0');
      localStorage.setItem('__repro12_delegations__', '0');
      localStorage.setItem('__repro16_delegations__', '0');

      const originalFetch = window.fetch.bind(window);

      function makeToolCall(id, name, args) {
        return { id, type: 'function', function: { name, arguments: JSON.stringify(args || {}) } };
      }

      function allowDelegation(key, max) {
        const used = Number.parseInt(localStorage.getItem(key) || '0', 10);
        if (used >= max) return false;
        localStorage.setItem(key, String(used + 1));
        return true;
      }

      function responseFor(lastText, fullBodyText) {
        const normalized = (lastText || '').trim();

        // Sub-agent delegated instructions must resolve directly (avoid recursive delegation loops).
        if (
          normalized.includes('REPRO_13 AMAZON lane') ||
          normalized.includes('REPRO_13 FLIPKART lane') ||
          normalized.includes('REPRO_12 STEP')
        ) {
          return createMockResponse({ role: 'assistant', content: '✓ Done' });
        }

        if (normalized.includes('REPRO_16 slow')) {
          return createMockResponse({ role: 'assistant', content: 'Working...' });
        }

        // Task-decomposer LLM path
        if (normalized.includes('Analyze this workflow automation request') && fullBodyText.includes('REPRO_14')) {
          return createMockResponse({
            role: 'assistant',
            content: JSON.stringify({
              should_parallelize: false,
              contexts: ['current_page'],
              reasoning: 'Forced repro path for conditional wording regression',
            }),
          });
        }

        // Issue #11 staged write loop repro signal
        if (normalized.includes('REPRO_11')) {
          return createMockResponse({
            role: 'assistant',
            content: 'Attempting file write',
            tool_calls: [makeToolCall('repro11_call1', 'fs_write_file', { path: 'repro-loop.txt', content: 'x' })],
          });
        }

        if (normalized.includes('"status":"staged"') || normalized.includes('approval required')) {
          const current = Number.parseInt(localStorage.getItem('__issueReproCounter__') || '0', 10);
          localStorage.setItem('__issueReproCounter__', String(current + 1));
          if (current < 3) {
            return createMockResponse({
              role: 'assistant',
              content: 'Retrying staged write...',
              tool_calls: [makeToolCall(`repro11_retry_${current}`, 'fs_write_file', { path: 'repro-loop.txt', content: `retry-${current}` })],
            });
          }
          return createMockResponse({ role: 'assistant', content: 'Stopping retries.' });
        }

        // Issue #13 parallel delegate path
        if (/^REPRO_13:/.test(normalized)) {
          if (!allowDelegation('__repro13_delegations__', 1)) {
            return createMockResponse({ role: 'assistant', content: 'REPRO_13 delegation budget exhausted.' });
          }
          return createMockResponse({
            role: 'assistant',
            content: 'Delegating in parallel',
            tool_calls: [
              makeToolCall('repro13_a', 'delegate_sub_task', { instruction: 'REPRO_13 AMAZON lane' }),
              makeToolCall('repro13_b', 'delegate_sub_task', { instruction: 'REPRO_13 FLIPKART lane' }),
            ],
          });
        }

        // Issue #12/#27 final result visibility path
        if (/^REPRO_12:/.test(normalized)) {
          if (!allowDelegation('__repro12_delegations__', 1)) {
            return createMockResponse({ role: 'assistant', content: 'REPRO_12 delegation budget exhausted.' });
          }
          return createMockResponse({
            role: 'assistant',
            content: 'Executing visibility repro',
            tool_calls: [
              makeToolCall('repro12_a', 'delegate_sub_task', { instruction: 'REPRO_12 STEP A' }),
              makeToolCall('repro12_b', 'delegate_sub_task', { instruction: 'REPRO_12 STEP B' }),
            ],
          });
        }

        // Issue #16 cross-run bleed repro (slow subtasks)
        if (/^REPRO_16_A:/.test(normalized)) {
          if (!allowDelegation('__repro16_delegations__', 1)) {
            return createMockResponse({ role: 'assistant', content: 'REPRO_16 delegation budget exhausted.' });
          }
          return createMockResponse({
            role: 'assistant',
            content: 'Long run for session isolation repro',
            tool_calls: [
              makeToolCall('repro16_a1', 'delegate_sub_task', { instruction: 'REPRO_16 slow A' }),
              makeToolCall('repro16_a2', 'delegate_sub_task', { instruction: 'REPRO_16 slow B' }),
            ],
          });
        }

        if (/^REPRO_16_B:/.test(normalized)) {
          return createMockResponse({ role: 'assistant', content: 'Second run started.' });
        }

        if (normalized.includes('REPRO_19_JSON')) {
          return createMockResponse({
            role: 'assistant',
            content: '```json\n{\n  "tool": "fs_list_directory",\n  "params": { "path": "." }\n}\n```',
            tool_calls: [],
          });
        }

        if (normalized.includes('REPRO_19_XML')) {
          return createMockResponse({
            role: 'assistant',
            content: '<tools>{"name":"leaked_tool"}</tools>',
            tool_calls: [],
          });
        }

        if (normalized.includes('REPRO_14')) {
          return createMockResponse({ role: 'assistant', content: 'Conditional path completed.' });
        }

        return createMockResponse({ role: 'assistant', content: 'Mock issue repro response.' });
      }

      window.fetch = async (input, init) => {
        let url = input;
        if (typeof input === 'object' && input !== null && 'url' in input) url = input.url;
        const urlStr = String(url);

        if (urlStr.includes('/api/tags')) {
          return new Response(JSON.stringify({ models: [{ name: 'mock-model' }] }), { status: 200 });
        }

        if (urlStr.includes('/api/chat') || urlStr.includes('/chat/completions')) {
          let bodyStr = '';
          if (init && init.body) bodyStr = String(init.body);
          else if (input instanceof Request) bodyStr = await input.text();

          let lastText = '';
          try {
            const body = JSON.parse(bodyStr || '{}');
            const messages = body.messages || [];
            const last = messages[messages.length - 1]?.content;
            lastText = normalizeContent(last);
          } catch {
            lastText = bodyStr;
          }

          const payload = responseFor(lastText, bodyStr);

          // Add deterministic delay to stress overlap behavior for issue #16.
          if (lastText.includes('REPRO_16 slow')) {
            await new Promise((resolve) => setTimeout(resolve, 3500));
            return new Response(JSON.stringify(createMockResponse({ role: 'assistant', content: '✓ Done (slow)' })), { status: 200 });
          }

          return new Response(JSON.stringify(payload), { status: 200 });
        }

        return originalFetch(input, init);
      };
    });

    await window.waitForLoadState('domcontentloaded');
    await window.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });

    const maybeDismissDepsModal = async () => {
      try {
        const modal = window.locator('text=Missing Dependencies');
        await modal.waitFor({ state: 'visible', timeout: 5000 });
        const skip = window.locator('text=Skip for now').first();
        await skip.click();
        await modal.waitFor({ state: 'hidden', timeout: 5000 });
      } catch {
        // no-op
      }
    };

    const setProvider = async () => {
      await window.click('button[title="Settings"]');
      await window.click('text=OpenAI');
      const keyInput = window.locator('input[placeholder="sk-..."]').first();
      await keyInput.waitFor({ state: 'visible', timeout: 10000 });
      await keyInput.fill('sk-mock-issue-repro');
      await window.click('button[title="Chat"]');
      await window.locator('[data-testid="chat-textarea"]').waitFor({ state: 'visible', timeout: 15000 });
    };

    const sendPrompt = async (text) => {
      const chatInput = window.locator('[data-testid="chat-textarea"]');
      await chatInput.waitFor({ state: 'visible', timeout: 15000 });
      await chatInput.click({ force: true });
      await chatInput.fill(text);
      await window.keyboard.press('Enter');
      await window.waitForTimeout(2200);
    };

    const waitForText = async (pattern, timeoutMs = 20000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const assistant = window.locator('[data-testid="message-bubble"][data-role="assistant"]');
        const texts = await assistant.allInnerTexts().catch(() => []);
        const merged = texts.join('\n');
        if ((typeof pattern === 'string' && merged.includes(pattern)) || (pattern instanceof RegExp && pattern.test(merged))) {
          return true;
        }
        await window.waitForTimeout(300);
      }
      return false;
    };

    const startNewChat = async () => {
      const btn = window.locator('[data-testid="new-chat-btn"], button[title="New Chat"], button[title="New Chat Session"]');
      if (await btn.count()) {
        await btn.first().click();
        await window.waitForTimeout(800);
      }
    };

    const setDetailedVisibilityOff = async () => {
      const onBtn = window.locator('button:has-text("Detailed Visibility ON")');
      if (await onBtn.count()) {
        await onBtn.first().click();
        await window.waitForTimeout(400);
      }
    };

    const setDetailedVisibilityOn = async () => {
      const offBtn = window.locator('button:has-text("Detailed Visibility OFF")');
      if (await offBtn.count()) {
        await offBtn.first().click();
        await window.waitForTimeout(400);
      }
    };

    await maybeDismissDepsModal();
    await setProvider();

    // #11 fs_write loop safety
    {
      const start = rendererLogs.length;
      await sendPrompt('REPRO_11: keep writing staged file until approved');
      await waitForText(/File Write Paused|staged|approval/i, 20000);
      const writeCalls = countLogs(start, /Executing tool: fs_write_file/);
      const paused = await waitForText(/File Write Paused/i, 4000);
      if (writeCalls > 1 && !paused) {
        addMark('#11', 'reproduced', `fs_write_file executed ${writeCalls} times without terminal pause`);
      } else if (paused || writeCalls === 1) {
        addMark('#11', 'not_reproduced', `guard active (writes=${writeCalls}, paused=${paused})`);
      } else {
        addMark('#11', 'inconclusive', `writes=${writeCalls}, paused=${paused}`);
      }
    }

    // #13 parallel delegation signal
    {
      const start = rendererLogs.length;
      await sendPrompt('REPRO_13: compare across amazon and flipkart in parallel');
      await window.waitForTimeout(3000);
      const delegateStarts = countLogs(start, /Delegating to sub-agent/);
      if (delegateStarts >= 2) {
        addMark('#13', 'not_reproduced', `multiple delegate_sub_task calls observed (delegates=${delegateStarts})`);
      } else if (delegateStarts > 0) {
        addMark('#13', 'reproduced', `expected multiple delegate_sub_task calls, observed ${delegateStarts}`);
      } else {
        addMark('#13', 'inconclusive', 'delegate path not observed');
      }
    }

    // #14/#26 conditional decomposition regression
    {
      await sendPrompt('REPRO_14: compare prices across amazon.com and flipkart.com if possible');
      await window.waitForTimeout(3500);
      const summaryVisible = await waitForText(/Results from 2 sources|amazon|flipkart/i, 1500);
      if (summaryVisible) {
        addMark('#14/#26', 'not_reproduced', 'multi-context output remained visible');
      } else {
        addMark('#14/#26', 'inconclusive', 'no stable multi-context UI signal observed');
      }
    }

    // #12/#27 compact-mode final result semantics
    {
      await setDetailedVisibilityOff();
      await sendPrompt('REPRO_12: run a multi-step delegated workflow and show final answer');
      await window.waitForTimeout(2500);
      const checklistFailed = await waitForText(/Execution failed/i, 2500);
      const finalAnswerVisible = await waitForText(/STEP A|STEP B|Done|Complete|final answer/i, 2500);
      if (!finalAnswerVisible || checklistFailed) {
        addMark('#12/#27', 'reproduced', `finalAnswerVisible=${finalAnswerVisible}, checklistFailedBadge=${checklistFailed}`);
      } else {
        addMark('#12/#27', 'not_reproduced', 'final result propagated and no false failed badge');
      }
    }

    // #16 run isolation bleed across prompts
    {
      const start = rendererLogs.length;
      await sendPrompt('REPRO_16_A: run a long delegated task in background');
      await window.waitForTimeout(700);
      await startNewChat();
      await sendPrompt('REPRO_16_B: quick follow-up in fresh run');
      await window.waitForTimeout(3500);

      const runStartLines = logsSince(start).filter((l) => /run_start agent=/.test(l));
      const firstRunLine = runStartLines[0] || '';
      const secondRunLine = runStartLines[1] || '';
      const firstAgent = (firstRunLine.match(/agent=([^\s]+)/) || [])[1];
      const secondStartIdx = rendererLogs.findIndex((l, idx) => idx >= start && l === secondRunLine);

      let bleed = false;
      if (firstAgent && secondStartIdx >= 0) {
        bleed = rendererLogs.slice(secondStartIdx + 1).some((l) => l.includes(firstAgent) && /sub_agent|delegate|parallel_/i.test(l));
      }

      if (bleed) {
        addMark('#16', 'reproduced', 'first-run activity continued after second run started');
      } else if (firstAgent) {
        addMark('#16', 'not_reproduced', 'no residual first-run signals detected after new run start');
      } else {
        addMark('#16', 'inconclusive', 'could not correlate run ids from logs');
      }
    }

    // #19 recovery visibility
    {
      await setDetailedVisibilityOn();

      const start = rendererLogs.length;
      await sendPrompt('REPRO_19_JSON');
      await window.waitForTimeout(2000);
      const jsonVisible = hasLog(start, /Identified Alternate JSON Tool Call Format|Successfully recovered \d+ tool calls from content body/i);

      const xmlStart = rendererLogs.length;
      await sendPrompt('REPRO_19_XML');
      await window.waitForTimeout(2000);
      const xmlVisible = hasLog(xmlStart, /Detected XML plan in content, converting to tool call|Identified XML Tool Call/i);

      if (!jsonVisible || !xmlVisible) {
        addMark('#19', 'reproduced', `jsonVisible=${jsonVisible}, xmlVisible=${xmlVisible}`);
      } else {
        addMark('#19', 'not_reproduced', 'JSON/XML recovery markers observed in runtime logs');
      }

      const qualityWarnings = countLogs(start, /Handoff test failed|Plan Response missing|Parallel Response missing/i);
      if (qualityWarnings > 0) {
        addMark('#25', 'reproduced', `quality warning markers detected (${qualityWarnings})`);
      } else {
        addMark('#25', 'not_reproduced', 'no handoff/plan/parallel warning markers detected');
      }
    }

    // #20 speech readiness flood (best-effort)
    {
      const start = rendererLogs.length;
      // Do not toggle mic in CI/repro runs: it can trigger model download/setup
      // and dominate runtime. We only inspect logs already emitted in this run.
      const notReadyCount = countLogs(start, /Recognizer not ready|not ready, ignoring/i);
      if (notReadyCount > 3) {
        addMark('#20', 'reproduced', `speech readiness logs flooded (${notReadyCount})`);
      } else if (notReadyCount > 0) {
        addMark('#20', 'not_reproduced', `speech readiness logs are bounded (${notReadyCount})`);
      } else {
        addMark('#20', 'inconclusive', 'no speech readiness logs observed in this environment');
      }
    }

    // #5 startup markitdown noise
    {
      const markitdownErrors = rendererLogs.filter((l) => /markitdown|uvx|ENOENT/i.test(l));
      if (markitdownErrors.length > 0) {
        addMark('#5', 'reproduced', `startup/runtime markitdown noise detected (${markitdownErrors.length} logs)`);
      } else {
        addMark('#5', 'not_reproduced', 'no markitdown startup noise detected');
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      suite: 'issues_repro_e2e',
      excludedIssue: '#15',
      results: mark,
      summary: {
        reproduced: mark.filter((m) => m.status === 'reproduced').length,
        not_reproduced: mark.filter((m) => m.status === 'not_reproduced').length,
        inconclusive: mark.filter((m) => m.status === 'inconclusive').length,
      },
    };

    const reportPath = path.join(__dirname, 'issues_repro_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📝 Issue repro report saved: ${reportPath}`);
    console.log(JSON.stringify(report.summary));

  } catch (error) {
    console.error('❌ Issue repro suite failed:', error);
    process.exitCode = 1;
  } finally {
    if (electronApp) {
      await electronApp.close().catch(() => {});
    }
  }
})();
