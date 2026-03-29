const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

delete process.env.ELECTRON_RUN_AS_NODE;

function getElectronExecPath() {
  const macPath = path.join(__dirname, '../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const linuxPath = path.join(__dirname, '../../node_modules/electron/dist/electron');
  if (fs.existsSync(macPath)) return macPath;
  if (fs.existsSync(linuxPath)) return linuxPath;
  return 'electron';
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-abrupt-summary-'));
  const tempUserDataDir = path.join(tempRoot, 'user-data');
  fs.mkdirSync(tempUserDataDir, { recursive: true });

  const electronApp = await electron.launch({
    executablePath: getElectronExecPath(),
    args: [path.join(__dirname, '../../out/main/index.js'), '--no-sandbox', `--user-data-dir=${tempUserDataDir}`],
    timeout: 60000,
    env: { ...process.env, NODE_ENV: 'production' }
  });

  try {
    const window = await electronApp.firstWindow();
    await window.setViewportSize({ width: 1280, height: 900 });

    await window.addInitScript(() => {
      localStorage.setItem('skipDepsCheck', 'true');

      let completionCount = 0;
      const originalFetch = window.fetch.bind(window);

      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input?.url || '';

        if (url.includes('/models')) {
          return new Response(
            JSON.stringify({
              object: 'list',
              data: [{ id: 'mock-gpt-4' }]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }

        if (url.includes('/chat/completions')) {
          completionCount += 1;
          const payload = {
            choices: [{
              message: {
                role: 'assistant',
                content: `Attempt ${completionCount}`,
                tool_calls: [{
                  id: `call_${completionCount}`,
                  type: 'function',
                  function: {
                    name: 'unknown_tool_xyz',
                    arguments: JSON.stringify({ attempt: completionCount })
                  }
                }]
              }
            }]
          };

          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }

        return originalFetch(input, init);
      };
    });

    await window.waitForLoadState('domcontentloaded');
    await window.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });

    const missingDeps = window.locator('text=Missing Dependencies');
    if (await missingDeps.isVisible().catch(() => false)) {
      await window.locator('text=Skip for now').first().click();
      await missingDeps.waitFor({ state: 'hidden', timeout: 5000 });
    }

    await window.click('button[title="Settings"]');
    await window.click('text=OpenAI');
    const keyInput = window.locator('input[type="password"]');
    await keyInput.waitFor({ state: 'visible', timeout: 10000 });
    await keyInput.fill('sk-mock-key');
    await window.click('button[title="Chat"]');

    const chatInput = window.locator('[data-testid="chat-textarea"]');
    await chatInput.waitFor({ state: 'visible', timeout: 15000 });
    await chatInput.fill('abrupt now');
    await window.locator('button:has(svg.lucide-send):not([disabled])').click({ force: true });

    await window.waitForTimeout(20000);
    const bodyText = await window.locator('body').innerText();
    const normalized = bodyText.toLowerCase();
    if (!normalized.includes('partial work summary')) {
      await window.screenshot({ path: path.join(tempRoot, 'abrupt-summary-fail.png') });
      throw new Error(`Expected salvage summary heading. Debug snippet:\n${bodyText.substring(0, 2000)}`);
    }
    assert.ok(normalized.includes('completed'));
    assert.ok(normalized.includes('partial findings'));
    assert.ok(normalized.includes('failed / blocked'));
  } finally {
    await electronApp.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('abrupt_summary_mocked failed:', error);
  process.exit(1);
});
