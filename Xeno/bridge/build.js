#!/usr/bin/env node
/**
 * Builds the pulse_xeno native addon against the Electron headers.
 *
 * The addon is what lets main.js call the Xeno C++ core directly
 * (Initialize / GetClients / Execute / Compilable) instead of driving the
 * core over its HTTP control plane from a child process.
 *
 *   node Xeno/bridge/build.js            (or: npm run build:xeno from the root)
 *
 * Environment overrides:
 *   PULSE_ELECTRON_VERSION   target Electron version (default: root package.json)
 *   npm_config_arch          target architecture (default: current arch)
 *   npm_config_disturl       header mirror (default: https://electronjs.org/headers)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const BRIDGE_DIR = __dirname;
const ROOT_DIR = path.resolve(BRIDGE_DIR, '..', '..');

function readElectronVersion() {
  if (process.env.PULSE_ELECTRON_VERSION) return process.env.PULSE_ELECTRON_VERSION;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    const raw = (pkg.devDependencies && pkg.devDependencies.electron) || '';
    const clean = String(raw).replace(/[^0-9.]/g, '');
    if (clean) return clean;
  } catch (_) {
    /* fall through to the running Node version */
  }
  return process.versions.node;
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, Object.assign({ cwd: BRIDGE_DIR, stdio: 'inherit', shell: process.platform === 'win32' }, options));
    child.on('error', (error) => resolve({ code: 1, error }));
    child.on('close', (code) => resolve({ code: code || 0 }));
  });
}

async function main() {
  const target = readElectronVersion();
  const arch = process.env.npm_config_arch || (process.arch === 'ia32' ? 'ia32' : process.arch);
  const distUrl = process.env.npm_config_disturl || 'https://electronjs.org/headers';

  console.log(`▸ building pulse_xeno for Electron ${target} (${process.platform}-${arch})`);

  const args = ['rebuild', `--target=${target}`, `--arch=${arch}`, `--dist-url=${distUrl}`];

  const localGyp = path.join(BRIDGE_DIR, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
  let result;

  if (fs.existsSync(localGyp)) {
    console.log('▸ using the local node-gyp');
    result = await run(process.execPath, [localGyp, ...args]);
  } else {
    console.log('▸ resolving node-gyp through npx (adds ~10 s on the first run)');
    result = await run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'node-gyp@11', ...args]);
  }

  if (result.code !== 0) {
    console.error('\n✖ the native bridge could not be built.');
    console.error('  Windows : install "Desktop development with C++" in the Visual Studio Installer.');
    console.error('  macOS   : xcode-select --install');
    console.error('  Linux   : sudo apt install build-essential python3');
    console.error('\n  Pulse still works without it: Execute/Attach then drive the core through');
    console.error('  Xeno.exe with child_process over 127.0.0.1:19283.\n');
    process.exit(result.code || 1);
  }

  console.log(`\n✔ pulse_xeno.node is ready — restart Pulse and press Attach.`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
