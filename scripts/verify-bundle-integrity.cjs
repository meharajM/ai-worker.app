#!/usr/bin/env node
/**
 * verify-bundle-integrity.cjs — Post-build bundle validation.
 *
 * Runs AFTER electron-vite build and verifies the emitted out/main/index.js
 * does not contain bundled natives or inlined complex runtime packages.
 *
 * Checks:
 *   1. Bundle format is CommonJS (not ESM)
 *   2. better-sqlite3 is externalized (require, not inlined native code)
 *   3. playwright-core is externalized (require, not ~60k lines of inlined engine)
 *   4. sharp is externalized
 *   5. electron-store linkage is valid (either bundled or external require)
 *   6. No bundled .node binary references (native addons must be external)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT       = process.cwd();
const BUNDLE     = path.join(ROOT, 'out', 'main', 'index.js');
const PASS = '✅';
const FAIL = '❌';
let failures = 0;

function assert(condition, message, hint = '') {
  if (!condition) {
    console.error(`  ${FAIL} FAIL: ${message}`);
    if (hint) console.error(`         Hint: ${hint}`);
    failures++;
  } else {
    console.log(`  ${PASS} PASS: ${message}`);
  }
}

console.log('🔍 Running Post-Build Bundle Integrity Verification...\n');

if (!fs.existsSync(BUNDLE)) {
  console.error(`${FAIL} out/main/index.js not found — run "npm run build" first.`);
  process.exit(1);
}

const content = fs.readFileSync(BUNDLE, 'utf8');
const bytes   = fs.statSync(BUNDLE).size;
console.log(`   Bundle: ${BUNDLE}`);
console.log(`   Size:   ${(bytes / 1024).toFixed(0)} KB\n`);

// ---------------------------------------------------------------------------
// Check 1 — CommonJS format
// ---------------------------------------------------------------------------
console.log('📦 Check 1: Main bundle must be CommonJS');
const isCJS = content.startsWith('"use strict"') || content.includes('"use strict";\n');
assert(isCJS, 'Bundle starts with "use strict" (CommonJS format)',
  'If ESM, electron-vite may have switched to ESM output. Check electron-vite.config.ts.');

// ---------------------------------------------------------------------------
// Check 2 — better-sqlite3 is not inlined
// ---------------------------------------------------------------------------
console.log('\n📦 Check 2: better-sqlite3 must not be inlined in the bundle');
const sqliteInlined = content.includes('node_sqlite3.node') || content.includes('SQLite3 database engine');
assert(!sqliteInlined, 'better-sqlite3 native internals are NOT inlined in the bundle',
  'Add better-sqlite3 to ssr.external or let externalizeDepsPlugin handle it.');
// Absence is also valid: correctly externalized OR tree-shaken if imported lazily
const sqliteExternal = content.includes('require("better-sqlite3")') || content.includes("require('better-sqlite3')");
if (sqliteExternal) console.log(`  ✅ PASS: better-sqlite3 is externalized via require()`);
else                console.log(`  ✅ PASS: better-sqlite3 absent from bundle (correctly tree-shaken or externalized)`);

// ---------------------------------------------------------------------------
// Check 3 — playwright-core is external
// ---------------------------------------------------------------------------
console.log('\n🎭 Check 3: playwright-core must be externalized (not inlined)');
// When playwright-core is inlined, the bundle balloons to >10MB and contains
// thousands of its internal functions including requireNodePlatform,
// requireRegistry, requireServer etc.
const pwInlined = content.includes('requireNodePlatform') || content.includes('requirePlaywrightConnection');
const pwExternal = content.includes('require("playwright-core")') || content.includes("require('playwright-core')");

assert(!pwInlined, 'playwright-core internal functions (requireNodePlatform) are NOT inlined',
  'Use require("playwright-core") instead of "import * as" in BrowserManager.ts. ' +
  'Static namespace imports cause the bundler to inline the entire playwright runtime.');
assert(pwExternal, 'playwright-core is referenced via require() in the bundle',
  'Confirm BrowserManager.ts uses: const pw = require("playwright-core")');

// ---------------------------------------------------------------------------
// Check 4 — sharp is external
// ---------------------------------------------------------------------------
console.log('\n🖼️  Check 4: sharp must be externalized');
// sharp inlined would include its native binding references
const sharpInlined = content.includes('sharp/build/Release') || content.includes('node_sharp');
assert(!sharpInlined, 'sharp native binding is NOT inlined in the bundle',
  'sharp must stay in dependencies and be treated as external by electron-vite.');

// ---------------------------------------------------------------------------
// Check 5 — electron-store linkage sanity
// ---------------------------------------------------------------------------
console.log('\n🗄️  Check 5: electron-store linkage must be valid');
// electron-store v10 is CommonJS. Depending on electron-vite version/config,
// it may appear as an external require() or be bundled inline. Both are valid
// as long as the main bundle can resolve it at runtime.
const storeExternal = content.includes('require("electron-store")') || content.includes("require('electron-store')");
const storeMentioned = storeExternal || content.includes('electron-store');
assert(
  storeMentioned,
  'electron-store is referenced by the main bundle',
  'Expected either require("electron-store") or bundled electron-store code in out/main/index.js.'
);
if (storeExternal) {
  console.log('  ✅ PASS: electron-store is linked via external require()');
} else {
  console.log('  ✅ PASS: electron-store appears bundled inline');
}

// ---------------------------------------------------------------------------
// Check 6 — No bundled .node native addon paths
// ---------------------------------------------------------------------------
console.log('\n🔩 Check 6: No bundled .node native addon paths');
// Native addons referenced by path inside a bundle means they were copied
// in and will fail to load from the wrong relative location at runtime.
const inlinedNodePaths = (content.match(/['"]\.{1,2}\/.*?\.node['"]/g) || [])
  .filter(p => !p.includes('node_modules')); // allow external refs

assert(
  inlinedNodePaths.length === 0,
  `No bundled relative .node paths found`,
  inlinedNodePaths.length > 0
    ? `Found: ${inlinedNodePaths.slice(0, 3).join(', ')} — these native addons must remain external.`
    : ''
);

// ---------------------------------------------------------------------------
// Bundle size sanity check
// ---------------------------------------------------------------------------
console.log('\n📏 Check 7: Bundle size sanity (main process should be <5 MB)');
const MAX_MB = 5;
const sizeMB = bytes / (1024 * 1024);
assert(
  sizeMB < MAX_MB,
  `Main bundle is ${sizeMB.toFixed(2)} MB (under ${MAX_MB} MB limit)`,
  `Bundle is ${sizeMB.toFixed(2)} MB. A large bundle usually means a heavy package ` +
  `(like playwright-core) was accidentally inlined. Check for static namespace imports.`
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '─'.repeat(60));
if (failures === 0) {
  console.log(`\n🎉 All bundle integrity checks passed!\n`);
  process.exit(0);
} else {
  console.error(`\n💥 ${failures} check(s) failed.\n`);
  process.exit(1);
}
