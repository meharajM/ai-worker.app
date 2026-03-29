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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-subagent-salvage-'));
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

      let parentCompletionCount = 0;
      let subCompletionCount = 0;
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
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const lastUser = [...messages].reverse().find((m) => m && m.role === 'user')?.content || '';
          const isSubAgentPrompt =
            typeof lastUser === 'string' && lastUser.includes('Return key findings only. End with "✓ Done".');

          if (isSubAgentPrompt) {
            subCompletionCount += 1;

            // Sub-agent round 1: request a tool that will fail (creates salvageable tool output).
            if (subCompletionCount === 1) {
              return new Response(
                JSON.stringify({
                  choices: [{
                    message: {
                      role: 'assistant',
                      content: 'Trying tool call before finishing.',
                      tool_calls: [{
                        id: 'sub_call_1',
                        type: 'function',
                        function: {
                          name: 'unknown_tool_xyz',
                          arguments: JSON.stringify({ from: 'sub-agent' })
                        }
                      }]
                    }
                  }]
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
              );
            }

            // Sub-agent round 2: hard crash to trigger delegate_sub_task catch path.
            throw new Error('forced sub-agent crash for salvage test');
          }

          parentCompletionCount += 1;
          if (parentCompletionCount === 1) {
            return new Response(
              JSON.stringify({
                choices: [{
                  message: {
                    role: 'assistant',
                    content: 'Delegating task.',
                    tool_calls: [{
                      id: 'parent_delegate_1',
                      type: 'function',
                      function: {
                        name: 'delegate_sub_task',
                        arguments: JSON.stringify({
                          instruction: 'Collect useful details from the target.',
                          context: 'Need concise findings.'
                        })
                      }
                    }]
                  }
                }]
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }

          throw new Error('forced parent crash after delegate for salvage summary test');
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
    await chatInput.fill('run delegated workflow');
    await window.locator('button:has(svg.lucide-send):not([disabled])').click({ force: true });

    await window.waitForTimeout(22000);
    const bodyText = await window.locator('body').innerText();
    const normalized = bodyText.toLowerCase();
    const snippet = bodyText.substring(0, 3200);

    if (!normalized.includes('partial work summary')) {
      await window.screenshot({ path: path.join(tempRoot, 'subagent-salvage-fail.png') });
      throw new Error(`Expected crash salvage text in UI. Debug snippet:\n${bodyText.substring(0, 2200)}`);
    }
    assert.ok(
      normalized.includes('sub-agent failed') || normalized.includes('unknown_tool_xyz') || normalized.includes('failed / blocked'),
      `Expected sub-agent failure signal in salvage summary. Debug snippet:\n${snippet}`
    );
    assert.ok(
      normalized.includes('partial findings before crash') ||
      normalized.includes('partial findings') ||
      normalized.includes('unknown_tool_xyz'),
      `Expected salvaged findings from crashed sub-agent. Debug snippet:\n${snippet}`
    );
  } finally {
    await electronApp.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('subagent_crash_salvage_mocked failed:', error);
  process.exit(1);
});
