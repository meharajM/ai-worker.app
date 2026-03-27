#!/usr/bin/env node
/**
 * prebuild_checks.cjs — Static pre-build validation.
 *
 * Catches the class of bugs that caused the session-long build pipeline
 * destabilization, WITHOUT needing to actually run a build first:
 *
 *   1. electron-store must be a CJS-compatible version (≤10.x)
 *      Reason: v11+ is pure ESM → throws "Store is not a constructor" in the
 *              CJS main process bundle at runtime.
 *
 *   2. package.json must NOT declare "type":"module"
 *      Reason: electron-vite outputs CJS for the main process; marking the
 *              package as ESM causes Node to reject it at launch.
 *
 *   3. playwright-core must NOT be statically imported in main-process source
 *      Reason: A static "import * from 'playwright-core'" causes the bundler
 *              to inline playwright's entire runtime, which then crashes with
 *              "Cannot find module '../../../package.json'" because the inlined
 *              code resolves paths relative to the original package directory
 *              (which no longer exists in the bundle's location).
 *
 *   4. Heavy native modules must live in "dependencies" (not "devDependencies")
 *      Reason: electron-builder only unpacks/includes runtime dependencies.
 *              Putting native addons in devDeps means they are absent in the
 *              packaged installer.
 *
 *   5. electron-vite.config.ts must declare externalizeDepsPlugin for main
 *      Reason: Without it, ALL node_modules get inlined into the main bundle,
 *              breaking native modules and causing path-resolution crashes.
 *
 *   6. electron-vite.config.ts must have ssr.noExternal: ['electron-store']
 *      Reason: externalizeDepsPlugin would otherwise treat electron-store as
 *              external. Since we bundle it (v10 CJS), it must be noExternal.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (details printed to stderr)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const semver = require('semver');

const ROOT = path.join(__dirname, '..');
const PASS = '✅';
const FAIL = '❌';

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ${FAIL} FAIL: ${message}`);
    failures++;
  } else {
    console.log(`  ${PASS} PASS: ${message}`);
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readJSON(rel) {
  return JSON.parse(readFile(rel));
}

// ---------------------------------------------------------------------------
// Check 1 — electron-store CJS compatibility
// ---------------------------------------------------------------------------
console.log('\n📦 Check 1: electron-store must be CJS-compatible (≤10.x)');
try {
  const pkg = readJSON('package.json');
  const raw = (pkg.dependencies || {})['electron-store'];
  assert(!!raw, `electron-store is listed in dependencies (found: ${raw})`);

  if (raw) {
    // Strip leading ^ ~ >= etc to get the minimum version
    const pinned = raw.replace(/^[^0-9]*/, '');
    const major  = semver.major(semver.coerce(pinned) || '0.0.0');
    assert(
      major <= 10,
      `electron-store version "${raw}" is CJS-compatible. ` +
      `v11+ is pure ESM and will crash at runtime in the main process.`
    );
  }
} catch (e) {
  console.error(`  ${FAIL} ERROR reading package.json: ${e.message}`);
  failures++;
}

// ---------------------------------------------------------------------------
// Check 2 — package.json must NOT have "type":"module"
// ---------------------------------------------------------------------------
console.log('\n📦 Check 2: package.json must not declare "type":"module"');
try {
  const pkg = readJSON('package.json');
  assert(
    pkg.type !== 'module',
    `package.json does not set "type":"module". ` +
    `(electron-vite builds the main process as CJS; an ESM package type breaks it.)`
  );
} catch (e) {
  console.error(`  ${FAIL} ERROR: ${e.message}`);
  failures++;
}

// ---------------------------------------------------------------------------
// Check 3 — No static import of playwright-core in main-process source files
// ---------------------------------------------------------------------------
console.log('\n🎭 Check 3: playwright-core must not be statically imported in main process');
const MAIN_SRC = path.join(ROOT, 'src', 'main');
const STATIC_IMPORT_RE = /^import\s+\*\s+as\s+\w+\s+from\s+['"]playwright-core['"]/m;
const NAMED_IMPORT_RE  = /^import\s+\{[^}]+\}\s+from\s+['"]playwright-core['"]/m;

function walkSync(dir, ext, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSync(full, ext, results);
    else if (entry.isFile() && entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

try {
  const tsFiles = walkSync(MAIN_SRC, '.ts');
  let foundStatic = false;
  for (const file of tsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    // Named imports like `import { Page } from 'playwright-core'` are fine —
    // they only import types/interfaces which are erased at build time.
    // Namespace imports like `import * as playwrightCore from 'playwright-core'`
    // cause the bundler to pull in the entire runtime.
    if (STATIC_IMPORT_RE.test(src)) {
      const rel = path.relative(ROOT, file);
      console.error(`  ${FAIL} FAIL: Namespace import of playwright-core found in ${rel}`);
      console.error(`         This causes the bundler to inline playwright internals,`);
      console.error(`         leading to "Cannot find module '../../../package.json'" at runtime.`);
      console.error(`         Fix: use require('playwright-core') inside the function/module body.`);
      foundStatic = true;
      failures++;
    }
  }
  if (!foundStatic) {
    assert(true, 'No namespace import (import * as) of playwright-core in main-process source.');
  }
} catch (e) {
  console.error(`  ${FAIL} ERROR walking main source: ${e.message}`);
  failures++;
}

// ---------------------------------------------------------------------------
// Check 4 — Native/heavy runtime modules must be in "dependencies"
// ---------------------------------------------------------------------------
console.log('\n📦 Check 4: native/runtime modules must be in "dependencies" not "devDependencies"');
const RUNTIME_MODULES = [
  'better-sqlite3',
  'playwright-core',
  'sharp',
  '@whiskeysockets/baileys',
  'electron-store',
  'ws'
];
try {
  const pkg = readJSON('package.json');
  const deps    = Object.keys(pkg.dependencies    || {});
  const devDeps = Object.keys(pkg.devDependencies || {});
  for (const mod of RUNTIME_MODULES) {
    const inDeps    = deps.includes(mod);
    const inDevDeps = devDeps.includes(mod);
    assert(
      inDeps && !inDevDeps,
      `"${mod}" is in "dependencies" (not devDependencies). ` +
      `Runtime modules in devDeps are excluded from packaged installers.`
    );
  }
} catch (e) {
  console.error(`  ${FAIL} ERROR: ${e.message}`);
  failures++;
}

// ---------------------------------------------------------------------------
// Check 5 — electron-vite.config.ts uses externalizeDepsPlugin for main
// ---------------------------------------------------------------------------
console.log('\n⚙️  Check 5: electron-vite.config.ts must use externalizeDepsPlugin for main');
try {
  const config = readFile('electron-vite.config.ts');
  assert(
    /externalizeDepsPlugin\(\)/.test(config),
    'externalizeDepsPlugin() is present in electron-vite.config.ts. ' +
    'Without it, all node_modules are bundled into the main process.'
  );
} catch (e) {
  console.error(`  ${FAIL} ERROR: ${e.message}`);
  failures++;
}

// ---------------------------------------------------------------------------
// Check 6 — electron-vite.config.ts declares ssr.noExternal for electron-store
// ---------------------------------------------------------------------------
console.log('\n⚙️  Check 6: electron-vite.config.ts must declare noExternal: [\'electron-store\']');
try {
  const config = readFile('electron-vite.config.ts');
  assert(
    /noExternal\s*:\s*\[['"]electron-store['"]\]/.test(config),
    "ssr.noExternal: ['electron-store'] is declared. " +
    "Without it, externalizeDepsPlugin externalizes electron-store and the CJS main bundle cannot resolve it."
  );
} catch (e) {
  console.error(`  ${FAIL} ERROR: ${e.message}`);
  failures++;
}

// ---------------------------------------------------------------------------
// Check 7 — Preload script extension must match package.json format
// ---------------------------------------------------------------------------
console.log('\n🔌 Check 7: Browser preload script must use .js extension (not .mjs)');
try {
  let mainIndexFiles = walkSync(MAIN_SRC, '.ts');
  const mainTsPath = mainIndexFiles.find(f => f.endsWith('index.ts') || f.endsWith('main.ts'));
  if (mainTsPath) {
    const mainTs = fs.readFileSync(mainTsPath, 'utf8');
    if (mainTs.includes('preload:')) {
      assert(
        !mainTs.includes('index.mjs') && mainTs.includes('index.js'),
        'MainWindow preload configuration points to "index.js". ' +
        'Because package.json does not use "type: module", electron-vite compiles the preload as .js. ' +
        'If set to index.mjs, the renderer loses window.electron APIs.'
      );
    }
  }
} catch (e) {
  console.error(`  ${FAIL} ERROR checking preload path: ${e.message}`);
  failures++;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '─'.repeat(60));
if (failures === 0) {
  console.log(`\n🎉 All pre-build checks passed!\n`);
  process.exit(0);
} else {
  console.error(`\n💥 ${failures} check(s) failed. Fix the above issues before running a build.\n`);
  process.exit(1);
}
