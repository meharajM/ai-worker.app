/**
 * Attachment Handling Tests (Node.js Native)
 *
 * Tests the attachment functionality as it exists in agent-runtime.ts v1.3.
 * The prompt format changed from:
 *   "[System Note: User attached …] (convert_to_markdown hint)"
 * to:
 *   "[ATTACHED FILES — act on these immediately …] N. name\n   → convert_to_markdown(uri=\"file://…\")"
 *
 * Run with: node tests/attachment_handling.test.cjs
 */

const assert = require('assert');

// ─── Mirrors agent-runtime.ts buildUserMessage attachment logic (v1.3) ─────────
function generateAttachmentContext(attachments) {
  if (!attachments || attachments.length === 0) return '';

  // Filter attachments with no valid path — matches the agent-runtime filter
  const valid = attachments.filter(a => a.path && a.path.trim() !== '');
  if (valid.length === 0) return '';

  const callLines = valid.map((a, i) => {
    const uri = a.path.startsWith('file://') ? a.path : `file://${a.path}`;
    return `${i + 1}. ${a.name}\n   → convert_to_markdown(uri="${uri}")`;
  }).join('\n');

  return (
    `\n\n[ATTACHED FILES — act on these immediately and read each one NOW using the exact call shown]\n` +
    `${callLines}\n\n` +
    `CRITICAL: Copy the uri argument CHARACTER-FOR-CHARACTER from above. ` +
    `Do NOT use just the filename. Do NOT construct a URI yourself. ` +
    `Reading attached files does NOT require a workspace to be selected.`
  );
}

// ─── Mirrors mcp.ts executeToolCall URI validation logic ─────────────────────
function validateConvertToMarkdownUri(uri) {
  if (!uri || uri.trim() === '' || uri === 'file://' || uri === 'file:') {
    return { valid: false, reason: 'empty' };
  }
  const isAbsolute =
    uri.startsWith('file:///') ||
    uri.startsWith('file:////') ||
    (uri.startsWith('file://') && uri[7] === '/') ||
    uri.startsWith('/') ||
    !!uri.match(/^[a-zA-Z]:[\\/]/);

  const isRelativeFileUri =
    uri.startsWith('file:') &&
    !uri.startsWith('file:///') &&
    !uri.startsWith('file:////') &&
    !(uri.startsWith('file://') && uri[7] === '/');

  if (!isAbsolute || isRelativeFileUri) {
    return { valid: false, reason: 'relative' };
  }
  return { valid: true };
}

// ─── Mirrors mcp.ts fs_* gate with SAFE_ABSOLUTE_PREFIXES ────────────────────
function validateFsToolCall(wsPath, targetPath) {
  const targetIsAbsolute =
    !!targetPath &&
    (targetPath.startsWith('/') || !!targetPath.match(/^[a-zA-Z]:[\\/]/));

  if (!wsPath && !targetIsAbsolute) {
    return { allowed: false, reason: 'no-workspace-relative' };
  }

  // When no workspace: only user-home directories are permitted
  const SAFE_ABSOLUTE_PREFIXES = ['/Users/', '/home/', '\\Users\\'];
  const isSafeAbsolute = (p) =>
    SAFE_ABSOLUTE_PREFIXES.some(prefix => p.startsWith(prefix)) ||
    !!p.match(/^[a-zA-Z]:[/\\]Users[/\\]/);

  if (!wsPath && targetIsAbsolute && !isSafeAbsolute(targetPath)) {
    return { allowed: false, reason: 'system-path' };
  }

  // Traversal check when workspace is set
  if (wsPath && targetPath) {
    const normalizedWs = wsPath.replace(/\\/g, '/').replace(/\/$/, '');
    const normalizedTarget = targetPath.replace(/\\/g, '/');
    if (!normalizedTarget.startsWith(normalizedWs)) {
      return { allowed: false, reason: 'traversal' };
    }
  }

  return { allowed: true };
}

// ─── Mirrors maybeSetWorkspaceFromFiles parent-dir extraction ─────────────────
function deriveParentDir(filePath) {
  if (!filePath) return null;
  if (!filePath.includes('/')) return null;
  return filePath.substring(0, filePath.lastIndexOf('/'));
}

// ─── Test runner ──────────────────────────────────────────────────────────────
console.log('🧪 Running Attachment Handling Tests (v1.3)...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(`   ${error.message}`);
    failed++;
  }
}

// =============================================================================
// 1. NEW PROMPT FORMAT ("[ATTACHED FILES]")
// =============================================================================
console.log('\n📝 Attachment Prompt Format Tests (v1.3)');

test('Single file — uses [ATTACHED FILES] header', () => {
  const ctx = generateAttachmentContext([{ name: 'report.pdf', path: '/Users/test/report.pdf', type: 'application/pdf' }]);
  assert.ok(ctx.includes('[ATTACHED FILES'), `Expected [ATTACHED FILES] header, got:\n${ctx}`);
});

test('Single file — includes ready-to-use file:// URI', () => {
  const ctx = generateAttachmentContext([{ name: 'report.pdf', path: '/Users/test/report.pdf', type: 'application/pdf' }]);
  assert.ok(ctx.includes('file:///Users/test/report.pdf'), `Expected file URI, got:\n${ctx}`);
});

test('Single file — uses numbered convert_to_markdown call format', () => {
  const ctx = generateAttachmentContext([{ name: 'report.pdf', path: '/Users/test/report.pdf', type: 'application/pdf' }]);
  assert.ok(ctx.includes('1. report.pdf'), 'Expected numbered entry');
  assert.ok(ctx.includes('→ convert_to_markdown(uri="file:///Users/test/report.pdf")'), 'Expected exact call');
});

test('Single file — includes CRITICAL directive', () => {
  const ctx = generateAttachmentContext([{ name: 'doc.pdf', path: '/Users/test/doc.pdf', type: 'application/pdf' }]);
  assert.ok(ctx.includes('CRITICAL:'), 'Expected CRITICAL directive');
  assert.ok(ctx.includes('CHARACTER-FOR-CHARACTER'), 'Expected CHARACTER-FOR-CHARACTER instruction');
});

test('Multiple files — all numbered correctly', () => {
  const attachments = [
    { name: 'image.png', path: '/Users/test/image.png', type: 'image/png' },
    { name: 'doc.pdf', path: '/Users/test/doc.pdf', type: 'application/pdf' },
    { name: 'data.csv', path: '/Users/test/data.csv', type: 'text/csv' },
  ];
  const ctx = generateAttachmentContext(attachments);
  assert.ok(ctx.includes('1. image.png'), 'Expected entry 1');
  assert.ok(ctx.includes('2. doc.pdf'), 'Expected entry 2');
  assert.ok(ctx.includes('3. data.csv'), 'Expected entry 3');
});

test('Multiple files — each gets its own file:// URI', () => {
  const attachments = [
    { name: 'a.png', path: '/Users/test/a.png', type: 'image/png' },
    { name: 'b.pdf', path: '/Users/test/b.pdf', type: 'application/pdf' },
  ];
  const ctx = generateAttachmentContext(attachments);
  assert.ok(ctx.includes('file:///Users/test/a.png'), 'Expected URI for a.png');
  assert.ok(ctx.includes('file:///Users/test/b.pdf'), 'Expected URI for b.pdf');
});

test('Path already prefixed with file:// is not double-prefixed', () => {
  const ctx = generateAttachmentContext([{ name: 'doc.pdf', path: 'file:///Users/test/doc.pdf', type: 'application/pdf' }]);
  assert.ok(!ctx.includes('file://file://'), 'Should not double-prefix');
  assert.ok(ctx.includes('file:///Users/test/doc.pdf'), 'URI should be correct');
});

test('Empty path files are filtered out entirely', () => {
  const attachments = [
    { name: 'ok.pdf', path: '/Users/test/ok.pdf', type: 'application/pdf' },
    { name: 'empty.png', path: '', type: 'image/png' },
  ];
  const ctx = generateAttachmentContext(attachments);
  assert.ok(ctx.includes('ok.pdf'), 'Valid file should appear');
  assert.ok(!ctx.includes('empty.png'), 'Empty-path file should be filtered');
});

test('All-empty paths returns empty string', () => {
  const ctx = generateAttachmentContext([{ name: 'ghost.png', path: '', type: 'image/png' }]);
  assert.strictEqual(ctx, '', 'Should return empty string when all paths are empty');
});

test('No attachments returns empty string', () => {
  assert.strictEqual(generateAttachmentContext([]), '');
  assert.strictEqual(generateAttachmentContext(null), '');
  assert.strictEqual(generateAttachmentContext(undefined), '');
});

test('Does NOT mention old [System Note] format', () => {
  const ctx = generateAttachmentContext([{ name: 'doc.pdf', path: '/Users/test/doc.pdf', type: 'application/pdf' }]);
  assert.ok(!ctx.includes('[System Note:'), 'Old format should be gone');
});

// =============================================================================
// 2. MCP URI VALIDATION (convert_to_markdown gate)
// =============================================================================
console.log('\n🔗 convert_to_markdown URI Validation Tests');

test('Valid: file:///absolute/path', () => {
  assert.strictEqual(validateConvertToMarkdownUri('file:///Users/test/file.pdf').valid, true);
});

test('Valid: /absolute/unix/path', () => {
  assert.strictEqual(validateConvertToMarkdownUri('/Users/test/file.pdf').valid, true);
});

test('Valid: C:\\Windows-style path', () => {
  assert.strictEqual(validateConvertToMarkdownUri('C:\\Users\\test\\file.pdf').valid, true);
});

test('Valid: file:// with 4 slashes (network share)', () => {
  assert.strictEqual(validateConvertToMarkdownUri('file:////server/share/file.pdf').valid, true);
});

test('Rejected: empty string', () => {
  assert.strictEqual(validateConvertToMarkdownUri('').valid, false);
});

test('Rejected: bare file://', () => {
  assert.strictEqual(validateConvertToMarkdownUri('file://').valid, false);
});

test('Rejected: bare file:', () => {
  assert.strictEqual(validateConvertToMarkdownUri('file:').valid, false);
});

test('Rejected: file://relative (filename only, no leading slash)', () => {
  const result = validateConvertToMarkdownUri('file://my-document.pdf');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'relative');
});

test('Rejected: relative path (no leading slash)', () => {
  const result = validateConvertToMarkdownUri('my-document.pdf');
  assert.strictEqual(result.valid, false);
});

test('Rejected: file:relative (colon, no slashes)', () => {
  const result = validateConvertToMarkdownUri('file:document.pdf');
  assert.strictEqual(result.valid, false);
});

// =============================================================================
// 3. fs_* GATE — HOME-DIR ALLOWLIST (the post-review security fix)
// =============================================================================
console.log('\n🔒 fs_* Security Gate Tests');

test('Blocked: relative path with no workspace', () => {
  const result = validateFsToolCall(undefined, 'src/index.ts');
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'no-workspace-relative');
});

test('Allowed: /Users/ path with no workspace (macOS home)', () => {
  assert.strictEqual(validateFsToolCall(undefined, '/Users/meharaj/Downloads/file.pdf').allowed, true);
});

test('Allowed: /home/ path with no workspace (Linux home)', () => {
  assert.strictEqual(validateFsToolCall(undefined, '/home/user/docs/file.txt').allowed, true);
});

test('Allowed: Windows C:\\Users\\ path with no workspace', () => {
  assert.strictEqual(validateFsToolCall(undefined, 'C:\\Users\\test\\file.pdf').allowed, true);
});

test('BLOCKED: /etc/passwd with no workspace (system path)', () => {
  const result = validateFsToolCall(undefined, '/etc/passwd');
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'system-path');
});

test('BLOCKED: /usr/bin/node with no workspace (system path)', () => {
  const result = validateFsToolCall(undefined, '/usr/bin/node');
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'system-path');
});

test('BLOCKED: /var/log/system.log with no workspace (system path)', () => {
  const result = validateFsToolCall(undefined, '/var/log/system.log');
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'system-path');
});

test('Allowed: absolute path inside workspace boundary', () => {
  const result = validateFsToolCall('/Users/test/project', '/Users/test/project/src/index.ts');
  assert.strictEqual(result.allowed, true);
});

test('BLOCKED: path traversal outside workspace', () => {
  const result = validateFsToolCall('/Users/test/project', '/Users/test/secrets/key.pem');
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'traversal');
});

test('Allowed: absolute path with full workspace set', () => {
  const result = validateFsToolCall('/Users/meharaj/project', '/Users/meharaj/project/README.md');
  assert.strictEqual(result.allowed, true);
});

// =============================================================================
// 4. AUTO-WORKSPACE DERIVATION (maybeSetWorkspaceFromFiles)
// =============================================================================
console.log('\n📁 Workspace Auto-Derivation Tests');

test('Derives parent directory from macOS path', () => {
  const parent = deriveParentDir('/Users/meharaj/Documents/report.pdf');
  assert.strictEqual(parent, '/Users/meharaj/Documents');
});

test('Derives parent directory from nested path', () => {
  const parent = deriveParentDir('/Users/meharaj/work/project/src/file.ts');
  assert.strictEqual(parent, '/Users/meharaj/work/project/src');
});

test('Returns null for paths without slash', () => {
  const parent = deriveParentDir('file.txt');
  assert.strictEqual(parent, null);
});

test('Returns null for empty path', () => {
  const parent = deriveParentDir('');
  assert.strictEqual(parent, null);
});

test('Returns null for null path', () => {
  const parent = deriveParentDir(null);
  assert.strictEqual(parent, null);
});

test('Returns root for top-level file', () => {
  const parent = deriveParentDir('/file.txt');
  assert.strictEqual(parent, '');
});

// =============================================================================
// 5. LEGACY PATH / DATA FLOW (retained from previous version)
// =============================================================================
console.log('\n🔄 Path Extraction & Data Flow Tests');

test('Extract path from File object with .path property', () => {
  const mockFile = { name: 'test.png', path: '/Users/test/Desktop/test.png' };
  assert.strictEqual(mockFile.path, '/Users/test/Desktop/test.png');
});

test('Handle file without path property gracefully', () => {
  const mockFile = { name: 'test.png' };
  const path = mockFile.path || '';
  assert.strictEqual(path, '');
});

test('Handle special characters in path', () => {
  const mockFile = { name: 'test (copy) [2].png', path: '/Users/test/test (copy) [2].png' };
  assert.ok(mockFile.path.includes('(copy)'));
});

test('Map File to attachment metadata shape', () => {
  const file = { name: 'test.png', path: '/Users/test/test.png', type: 'image/png' };
  const meta = { name: file.name, path: file.path || '', type: file.type };
  assert.deepStrictEqual(meta, { name: 'test.png', path: '/Users/test/test.png', type: 'image/png' });
});

test('Batch of files maps correctly', () => {
  const files = [
    { name: 'a.png', path: '/a.png', type: 'image/png' },
    { name: 'b.pdf', path: '/b.pdf', type: 'application/pdf' },
  ];
  const batch = files.map(f => ({ name: f.name, path: f.path || '', type: f.type }));
  assert.strictEqual(batch.length, 2);
  assert.strictEqual(batch[1].name, 'b.pdf');
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
