const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

delete process.env.ELECTRON_RUN_AS_NODE;

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-approval-regression-'));
const tempUserDataDir = path.join(tempRoot, 'user-data');
fs.mkdirSync(tempUserDataDir, { recursive: true });

let electronApp;
let window;

function getElectronExecPath() {
  const macPath = path.join(__dirname, '../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const linuxPath = path.join(__dirname, '../../node_modules/electron/dist/electron');
  if (fs.existsSync(macPath)) return macPath;
  if (fs.existsSync(linuxPath)) return linuxPath;
  return 'electron';
}

async function waitFor(predicate, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function getPendingChanges() {
  return await window.evaluate(() => window.electron.fs.getPendingChanges());
}

async function clearPendingChanges() {
  const pending = await getPendingChanges();
  for (const change of pending) {
    await window.evaluate((changeId) => window.electron.fs.rejectChange(changeId), change.id);
  }
}

async function startWriteAndWaitPending(targetPath, content) {
  const writePromise = window.evaluate(
    ({ targetPath, content }) => window.electron.mcp.callTool('fs-regression', 'fs_write_file', { path: targetPath, content }),
    { targetPath, content }
  );

  const pending = await waitFor(async () => {
    const changes = await getPendingChanges();
    return changes.length > 0 ? changes : null;
  }, 10000, 150);

  return {
    writePromise,
    change: pending[0]
  };
}

before(async () => {
  electronApp = await electron.launch({
    executablePath: getElectronExecPath(),
    args: [path.join(__dirname, '../../out/main/index.js'), '--no-sandbox', `--user-data-dir=${tempUserDataDir}`],
    timeout: 60000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AIW_WA_APPROVAL_TIMEOUT_MS: '1500'
    }
  });

  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.evaluate(() => localStorage.setItem('skipDepsCheck', 'true'));

  const connectResult = await window.evaluate(() =>
    window.electron.mcp.connect({
      id: 'fs-regression',
      name: 'Filesystem Regression',
      command: 'internal-filesystem'
    })
  );
  assert.equal(connectResult?.success, true, 'Failed to connect in-process filesystem MCP server');
});

beforeEach(async () => {
  await clearPendingChanges();
});

after(async () => {
  if (electronApp) {
    await electronApp.close();
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('WA token happy-path (simulated connected channel) commits via token', async () => {
  const targetPath = path.join(tempRoot, 'wa-token-happy.txt');
  const { writePromise, change } = await startWriteAndWaitPending(targetPath, 'approved-via-token');

  const forced = await window.evaluate(
    ({ changeId, token }) => window.electron.fs.testForceWhatsAppApproval(changeId, token),
    { changeId: change.id, token: 'A2BC' }
  );
  assert.equal(forced.success, true, forced.error || 'Failed to force WhatsApp approval mode');

  const pendingRemote = await waitFor(async () => {
    const changes = await getPendingChanges();
    const current = changes.find((c) => c.id === change.id);
    if (current && current.approvalChannel === 'whatsapp' && current.status === 'pending' && current.approvalToken === 'A2BC') {
      return current;
    }
    return null;
  }, 5000, 100);
  assert.ok(pendingRemote, 'Change did not enter WhatsApp priority state');

  const approval = await window.evaluate(() => window.electron.fs.approveChangeByToken('A2BC'));
  assert.equal(approval.success, true, approval.error || 'Token-based approve failed');

  const toolResponse = await writePromise;
  assert.equal(Boolean(toolResponse?.error), false, `Unexpected fs_write_file error: ${toolResponse?.error || ''}`);

  const written = fs.readFileSync(targetPath, 'utf8');
  assert.equal(written, 'approved-via-token');
});

test('WA disconnected path remains desktop-first and approves via desktop modal flow', async () => {
  const targetPath = path.join(tempRoot, 'desktop-only.txt');
  const { writePromise, change } = await startWriteAndWaitPending(targetPath, 'desktop-approved');

  const pending = await getPendingChanges();
  const current = pending.find((c) => c.id === change.id);
  assert.equal(current?.approvalChannel, 'desktop', 'Expected desktop channel when WhatsApp is not connected');
  assert.equal(current?.status, 'pending');

  const approval = await window.evaluate((changeId) => window.electron.fs.approveChange(changeId), change.id);
  assert.equal(approval.success, true, approval.error || 'Desktop approval failed');

  const toolResponse = await writePromise;
  assert.equal(Boolean(toolResponse?.error), false, `Unexpected fs_write_file error: ${toolResponse?.error || ''}`);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'desktop-approved');
});

test('WA timeout auto-falls back to desktop with expired status, then desktop approve succeeds', async () => {
  const targetPath = path.join(tempRoot, 'timeout-fallback.txt');
  const { writePromise, change } = await startWriteAndWaitPending(targetPath, 'timeout-approved');

  const forced = await window.evaluate(
    ({ changeId, token }) => window.electron.fs.testForceWhatsAppApproval(changeId, token),
    { changeId: change.id, token: 'B3CD' }
  );
  assert.equal(forced.success, true, forced.error || 'Failed to force WhatsApp mode for timeout test');

  const expiredChange = await waitFor(async () => {
    const changes = await getPendingChanges();
    const current = changes.find((c) => c.id === change.id);
    if (current && current.approvalChannel === 'desktop' && current.status === 'expired') {
      return current;
    }
    return null;
  }, 8000, 120);
  assert.ok(expiredChange, 'Expected timeout fallback to desktop with expired status');

  const approval = await window.evaluate((changeId) => window.electron.fs.approveChange(changeId), change.id);
  assert.equal(approval.success, true, approval.error || 'Desktop approval after timeout fallback failed');

  const toolResponse = await writePromise;
  assert.equal(Boolean(toolResponse?.error), false, `Unexpected fs_write_file error: ${toolResponse?.error || ''}`);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'timeout-approved');
});
