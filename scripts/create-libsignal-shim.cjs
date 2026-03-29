const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();

// Find the target depending on where npm installed it
const topLevelDir = path.join(projectRoot, 'node_modules', 'libsignal');
const scopedDir = path.join(projectRoot, 'node_modules', '@whiskeysockets', 'libsignal-node');

function patchLibsignalName() {
  console.log('🔧 Verifying libsignal folder structure...');

  let targetDir = null;

  if (fs.existsSync(scopedDir) && fs.existsSync(path.join(scopedDir, 'package.json'))) {
    targetDir = scopedDir;
  } else if (fs.existsSync(topLevelDir) && fs.existsSync(path.join(topLevelDir, 'package.json'))) {
    targetDir = topLevelDir;
  } else {
    console.warn(`[shim] Could not find libsignal to patch.`);
    return;
  }

  const pkgPath = path.join(targetDir, 'package.json');
  try {
    const pkgData = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgData);

    if (pkg.name !== 'libsignal') {
      console.log(`[shim] Patching libsignal package name from '${pkg.name}' to 'libsignal'...`);
      pkg.name = 'libsignal';
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      console.log('[shim] Successfully patched libsignal package.json for electron-builder.');
    } else {
      console.log('[shim] libsignal package name already correct — skipping.');
    }
  } catch (error) {
    console.error('[shim] Failed to patch libsignal package.json:', error);
  }
}

patchLibsignalName();
