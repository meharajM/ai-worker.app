/* eslint-disable */
/**
 * create-libsignal-shim.cjs
 *
 * Pre-build script that ensures `node_modules/libsignal` exists with the
 * CORRECT package name ("libsignal") so electron-builder copies it into the
 * asar without renaming it to "@whiskeysockets/libsignal-node".
 *
 * Baileys does:  require('libsignal')
 * The GitHub package's inner name is "@whiskeysockets/libsignal-node", so
 * electron-builder renames the folder inside the asar, breaking the lookup.
 *
 * Fix: overwrite the package.json name field before the build runs.
 */

const fs = require('fs');
const path = require('path');

const libsignalDir = path.join(__dirname, '..', 'node_modules', 'libsignal');
const pkgFile = path.join(libsignalDir, 'package.json');

if (!fs.existsSync(libsignalDir)) {
  console.error('[shim] node_modules/libsignal not found — run `npm install` first.');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));

if (pkg.name !== 'libsignal') {
  const original = pkg.name;
  pkg.name = 'libsignal';
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[shim] Fixed libsignal package name: "${original}" → "libsignal"`);
} else {
  console.log('[shim] libsignal package name already correct — skipping.');
}
