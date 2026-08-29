/**
 * Pulse — main process.
 *
 * Responsibilities:
 *   • create and control the frameless application window (800 x 500);
 *   • expose an IPC bridge used by the renderer (src/ui.js through src/preload.js)
 *     for running external scripts, system utilities and for attaching the
 *     editor to a live process / TCP endpoint;
 *   • keep track of every spawned child process so it can be cancelled.
 *
 * No renderer has Node integration: everything privileged lives here and is
 * reachable only through the explicit `pulse:*` channels listed below.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const http = require('http');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WINDOW_WIDTH = 800;
const WINDOW_HEIGHT = 500;

const IS_WIN = process.platform === 'win32';

/**
 * Every runner the editor can execute code with.
 * `argv` receives the absolute path of the temporary script file.
 */
const RUNNERS = {
  lua: {
    id: 'lua',
    label: 'Lua',
    extension: '.lua',
    language: 'lua',
    binary: () => (IS_WIN ? 'lua' : 'lua5.1'),
    argv: (file) => [file],
    fallbacks: IS_WIN
      ? ['lua5.4', 'lua54', 'lua5.3', 'lua53', 'lua5.2', 'lua52', 'lua5.1', 'lua51', 'luajit']
      : ['lua', 'luajit', 'lua5.4', 'lua5.3', 'lua5.2', 'lua5.1'],
  },
  node: {
    id: 'node',
    label: 'Node.js',
    extension: '.js',
    language: 'javascript',
    binary: () => process.execPath,
    argv: (file) => [file],
  },
  python: {
    id: 'python',
    label: 'Python',
    extension: '.py',
    language: 'python',
    binary: () => (IS_WIN ? 'python' : 'python3'),
    argv: (file) => ['-u', file],
    fallbackBinary: IS_WIN ? 'python3' : 'python',
  },
  powershell: {
    id: 'powershell',
    label: 'PowerShell',
    extension: '.ps1',
    language: 'powershell',
    binary: () => 'powershell',
    argv: (file) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
  },
  cmd: {
    id: 'cmd',
    label: 'CMD / BAT',
    extension: '.bat',
    language: 'bat',
    binary: () => 'cmd.exe',
    argv: (file) => ['/d', '/s', '/c', `"${file}"`],
    windowsOnly: true,
  },
  bash: {
    id: 'bash',
    label: 'Bash',
    extension: '.sh',
    language: 'shell',
    binary: () => 'bash',
    argv: (file) => [file],
    unixOnly: true,
  },
};

/**
 * Whitelisted system utilities that the UI can launch with one click.
 * Arguments are fixed here — the renderer can never inject shell strings.
 */
const UTILITIES = {
  ipconfig: {
    label: 'ipconfig — network interfaces',
    file: IS_WIN ? 'ipconfig.exe' : 'ifconfig',
    args: IS_WIN ? ['/all'] : ['-a'],
  },
  systeminfo: {
    label: 'systeminfo — machine summary',
    file: IS_WIN ? 'cmd.exe' : 'uname',
    args: IS_WIN ? ['/d', '/c', 'systeminfo'] : ['-a'],
  },
  tasklist: {
    label: 'tasklist — running processes',
    file: IS_WIN ? 'tasklist.exe' : 'ps',
    args: IS_WIN ? [] : ['aux'],
  },
  whoami: {
    label: 'whoami — current user',
    file: IS_WIN ? 'whoami.exe' : 'whoami',
    args: [],
  },
  ping: {
    label: 'ping — reachability check',
    file: IS_WIN ? 'ping.exe' : 'ping',
    args: IS_WIN ? ['-n', '4', '127.0.0.1'] : ['-c', '4', '127.0.0.1'],
  },
  netstat: {
    label: 'netstat — open ports',
    file: IS_WIN ? 'netstat.exe' : 'netstat',
    args: IS_WIN ? ['-ano'] : ['-an'],
  },
  ver: {
    label: 'ver — OS version',
    file: IS_WIN ? 'cmd.exe' : 'uname',
    args: IS_WIN ? ['/d', '/c', 'ver'] : ['-srm'],
  },
  dir: {
    label: 'dir — workspace listing',
    file: IS_WIN ? 'cmd.exe' : 'ls',
    args: IS_WIN ? ['/d', '/c', 'dir'] : ['-lah'],
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let mainWindow = null;

/** runId -> { child, startedAt, cancelled } */
const running = new Map();

/** Active TCP attachment (Attach / Connect). */
let socket = null;
let socketTarget = null;

/** Active PID attachment watcher. */
let pidWatcher = null;

/** Cache of probed interpreter versions. */
let runnerProbeCache = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspaceDir() {
  const dir = path.join(app.getPath('userData'), 'workspace');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Absolute path of the Monaco AMD build. When the app is packaged the
 * dependency is unpacked next to `app.asar`, so the path has to be rewritten.
 */
function monacoPath() {
  const packed = path.join(app.getAppPath(), 'node_modules', 'monaco-editor', 'min', 'vs');
  const unpacked = packed.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`
  );
  if (unpacked !== packed && fs.existsSync(path.join(unpacked, 'loader.js'))) return unpacked;
  if (fs.existsSync(path.join(packed, 'loader.js'))) return packed;
  return null;
}

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.json': 'json',
    '.py': 'python',
    '.ps1': 'powershell',
    '.bat': 'bat',
    '.cmd': 'bat',
    '.sh': 'shell',
    '.bash': 'shell',
    '.html': 'html',
    '.css': 'css',
    '.md': 'markdown',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.txt': 'plaintext',
  };
  return map[ext] || 'plaintext';
}

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function timestamp() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Write user code into the workspace so interpreters can pick it up. */
function writeScript(extension, code) {
  const file = path.join(workspaceDir(), `pulse-${crypto.randomUUID()}${extension || '.txt'}`);
  fs.writeFileSync(file, code == null ? '' : String(code), 'utf8');
  return file;
}

function cleanup(file) {
  if (!file) return;
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (_) {
    /* the file is gone already, nothing to do */
  }
}

function runStreamed({ sender, runId, file, binary, args, options }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let child;

    try {
      child = spawn(binary, args, Object.assign({ cwd: workspaceDir(), windowsHide: true }, options));
    } catch (error) {
      cleanup(file);
      resolve({ runId, ok: false, exitCode: null, signal: null, duration: 0, error: String(error && error.message ? error.message : error) });
      return;
    }

    running.set(runId, { child, startedAt: Date.now(), cancelled: false });

    const push = (stream, chunk) => {
      if (!sender.isDestroyed()) sender.send('pulse:run-output', { runId, stream, chunk: String(chunk), at: timestamp() });
    };

    if (child.stdout) child.stdout.on('data', (d) => push('stdout', d));
    if (child.stderr) child.stderr.on('data', (d) => push('stderr', d));

    child.on('error', (error) => {
      push('stderr', `pulse: cannot start "${binary}" — ${error.message}\n`);
      running.delete(runId);
      cleanup(file);
      resolve({ runId, ok: false, exitCode: null, signal: null, duration: Date.now() - startedAt, error: error.message });
    });

    child.on('close', (exitCode, signal) => {
      const entry = running.get(runId);
      running.delete(runId);
      cleanup(file);
      resolve({
        runId,
        ok: exitCode === 0,
        exitCode,
        signal: signal || null,
        cancelled: Boolean(entry && entry.cancelled),
        duration: Date.now() - startedAt,
      });
    });
  });
}

/** Command line that prints the version of a runner (used only for probing). */
function versionArgs(runnerId) {
  if (runnerId === 'node') return ['-v'];
  if (runnerId === 'python') return ['--version'];
  if (runnerId === 'lua') return ['-v'];
  if (runnerId === 'powershell') {
    return ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'];
  }
  return ['--version'];
}

function binaryCandidates(runner) {
  const list = [typeof runner.binary === 'function' ? runner.binary() : runner.binary];
  if (runner.fallbackBinary) list.push(runner.fallbackBinary);
  if (runner.fallbacks) list.push(...runner.fallbacks);
  return list;
}

/** id -> binary that actually works on this machine (null when nothing found). */
const runnerBinaries = new Map();

function detectRunner(runnerId) {
  const runner = RUNNERS[runnerId];
  if (!runner) return Promise.resolve(null);
  if (runner.windowsOnly && !IS_WIN) return Promise.resolve(null);
  if (runner.unixOnly && IS_WIN) return Promise.resolve(null);
  if (runnerBinaries.has(runnerId)) return Promise.resolve(runnerBinaries.get(runnerId));

  const candidates = binaryCandidates(runner);

  const attempt = (index) => new Promise((resolve) => {
    if (index >= candidates.length) {
      runnerBinaries.set(runnerId, null);
      resolve(null);
      return;
    }
    const bin = candidates[index];
    let out = '';
    let settled = false;
    let child;
    const done = (value) => {
      if (settled) return;
      settled = true;
      if (value) runnerBinaries.set(runnerId, value);
      resolve(value);
    };
    try {
      child = spawn(bin, versionArgs(runnerId), { windowsHide: true });
    } catch (_) {
      attempt(index + 1).then(resolve);
      return;
    }
    if (child.stdout) child.stdout.on('data', (d) => { out += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', () => { try { child.kill(); } catch (_) {} attempt(index + 1).then(resolve); });
    child.on('close', (code) => {
      if (code === 0 || out.trim().length > 0) done(bin);
      else attempt(index + 1).then(resolve);
    });
    setTimeout(() => { try { child.kill(); } catch (_) {} attempt(index + 1).then(resolve); }, 4000);
  });

  return attempt(0);
}

function runnerAvailable(runnerId) {
  return detectRunner(runnerId).then((binary) => Boolean(binary));
}

function robloxProcessNames() {
  return IS_WIN
    ? ['RobloxPlayerBeta.exe', 'RobloxStudio.exe', 'RobloxPlayer.exe']
    : ['RobloxPlayer', 'RobloxStudio', 'Roblox'];
}

function listWorkspace() {
  const dir = workspaceDir();
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const full = path.join(dir, e.name);
        const stat = fs.statSync(full);
        return { name: e.name, path: full, size: stat.size, modified: stat.mtimeMs };
      })
      .sort((a, b) => b.modified - a.modified)
      .slice(0, 200);
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 640,
    minHeight: 420,
    x: Math.max(0, Math.round((width - WINDOW_WIDTH) / 2)),
    y: Math.max(0, Math.round((height - WINDOW_HEIGHT) / 2)),
    frame: false,                 // frameless — the title bar is drawn by the UI
    titleBarStyle: 'hidden',
    title: 'Pulse',
    show: false,
    backgroundColor: '#0a0713',
    resizable: true,
    hasShadow: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon_pulse.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.on('maximize', () => sendToWindow('pulse:window-state', { maximized: true }));
  mainWindow.on('unmaximize', () => sendToWindow('pulse:window-state', { maximized: false }));
  mainWindow.on('enter-full-screen', () => sendToWindow('pulse:window-state', { maximized: true }));
  mainWindow.on('leave-full-screen', () => sendToWindow('pulse:window-state', { maximized: false }));

  // Block navigation away from the local UI and open links in the OS browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file://')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Dev shortcuts.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isToggle =
      input.type === 'keyDown' &&
      ((input.key === 'F12') ||
        (input.control && input.shift && (input.key === 'I' || input.key === 'i')) ||
        (input.meta && input.alt && (input.key === 'I' || input.key === 'i')));
    if (isToggle) {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    }
    if (input.type === 'keyDown' && input.key === 'F5') {
      event.preventDefault();
      mainWindow.webContents.reload();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  running.forEach((entry) => {
    try { entry.child.kill(); } catch (_) {}
  });
  running.clear();
  if (socket) { try { socket.destroy(); } catch (_) {} socket = null; }
  if (pidWatcher) { clearInterval(pidWatcher); pidWatcher = null; }
});

// ---------------------------------------------------------------------------
// IPC — application / window
// ---------------------------------------------------------------------------

ipcMain.handle('pulse:app-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  v8: process.versions.v8,
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  hostname: os.hostname(),
  cpus: os.cpus().length,
  totalMemory: os.totalmem(),
  freeMemory: os.freemem(),
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  workspace: workspaceDir(),
  monacoPath: monacoPath(),
  startedAt: Date.now(),
}));

ipcMain.handle('pulse:window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
  return true;
});

ipcMain.handle('pulse:window-toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle('pulse:window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
  return true;
});

ipcMain.handle('pulse:window-state', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? { maximized: win.isMaximized(), minimized: win.isMinimized(), fullScreen: win.isFullScreen() } : null;
});

ipcMain.handle('pulse:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('pulse:set-progress', (event, value) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setProgressBar(typeof value === 'number' ? value : -1);
  return true;
});

// ---------------------------------------------------------------------------
// IPC — files
// ---------------------------------------------------------------------------

ipcMain.handle('pulse:open-file', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Open file in Pulse',
    defaultPath: workspaceDir(),
    properties: ['openFile', 'multiSelections', 'showHiddenFiles'],
    filters: [
      { name: 'Code', extensions: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'py', 'ps1', 'bat', 'cmd', 'sh', 'html', 'css', 'md', 'yml', 'yaml'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths.length) return { canceled: true, files: [] };

  const files = [];
  for (const filePath of result.filePaths) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 4 * 1024 * 1024) {
        files.push({ path: filePath, name: path.basename(filePath), error: 'file is larger than 4 MB and was skipped' });
        continue;
      }
      files.push({
        path: filePath,
        name: path.basename(filePath),
        content: fs.readFileSync(filePath, 'utf8'),
        language: detectLanguage(filePath),
        size: stat.size,
      });
    } catch (error) {
      files.push({ path: filePath, name: path.basename(filePath), error: error.message });
    }
  }
  return { canceled: false, files };
});

ipcMain.handle('pulse:save-file', async (event, { filePath, content, suggestedName } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  let target = filePath;

  if (!target) {
    const result = await dialog.showSaveDialog(win, {
      title: 'Save file',
      defaultPath: path.join(workspaceDir(), suggestedName || 'pulse-script.js'),
      filters: [{ name: 'All files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath;
  }

  try {
    fs.writeFileSync(target, content == null ? '' : String(content), 'utf8');
    return { canceled: false, path: target, name: path.basename(target), language: detectLanguage(target) };
  } catch (error) {
    return { canceled: false, error: error.message };
  }
});

ipcMain.handle('pulse:read-file', (_event, filePath) => {
  if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
    return { ok: false, error: 'file not found' };
  }
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 4 * 1024 * 1024) return { ok: false, error: 'file is larger than 4 MB' };
    return {
      ok: true,
      path: filePath,
      name: path.basename(filePath),
      content: fs.readFileSync(filePath, 'utf8'),
      language: detectLanguage(filePath),
      size: stat.size,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('pulse:find-roblox', async () => {
  const processes = await findRobloxProcesses();
  return { ok: true, processes, pids: processes.map((processInfo) => processInfo.pid) };
});

ipcMain.handle('pulse:list-workspace', () => listWorkspace());

ipcMain.handle('pulse:show-in-folder', (_event, filePath) => {
  if (typeof filePath === 'string' && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  else shell.openPath(workspaceDir());
  return true;
});

ipcMain.handle('pulse:open-workspace', () => {
  shell.openPath(workspaceDir());
  return true;
});

// ---------------------------------------------------------------------------
// IPC — runners / execution
// ---------------------------------------------------------------------------

ipcMain.handle('pulse:list-runners', async () => {
  if (runnerProbeCache) return runnerProbeCache;
  const ids = Object.keys(RUNNERS);
  const results = await Promise.all(
    ids.map(async (id) => ({
      id,
      label: RUNNERS[id].label,
      extension: RUNNERS[id].extension,
      language: RUNNERS[id].language,
      available: await runnerAvailable(id),
    }))
  );
  runnerProbeCache = results.filter((r) => r.available || r.id === 'node' || r.id === 'powershell' || r.id === 'lua');
  return runnerProbeCache;
});

ipcMain.handle('pulse:list-utilities', () =>
  Object.keys(UTILITIES).map((id) => ({ id, label: UTILITIES[id].label }))
);

async function runLocalLua(event, payload = {}) {
  const { code, runner: runnerId, filePath, keepFile } = payload;
  const runner = RUNNERS[runnerId] || RUNNERS.node;
  const runId = `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const sender = event.sender;

  sender.send('pulse:run-output', {
    runId,
    stream: 'system',
    chunk: `pulse ▸ starting ${runner.label} (${new Date().toLocaleTimeString()})\n`,
    at: timestamp(),
  });

  const binary = await detectRunner(runner.id);
  if (!binary) {
    sender.send('pulse:run-output', {
      runId,
      stream: 'system',
      chunk: `pulse \u25b8 ${runner.label} interpreter was not found on this machine\n`,
      at: timestamp(),
    });
    return { runId, runner: runner.id, ok: false, exitCode: null, signal: null, duration: 0, error: `${runner.label} interpreter not found` };
  }

  // A file that was opened from disk is executed directly (so relative paths
  // and imports keep working); untitled buffers are written to the workspace.
  let scriptPath;
  let temporary = false;
  if (filePath && fs.existsSync(filePath)) {
    scriptPath = filePath;
  } else {
    scriptPath = writeScript(path.extname(filePath || '') || runner.extension, code);
    temporary = !keepFile;
  }

  const result = await runStreamed({
    sender,
    runId,
    file: temporary ? scriptPath : null,
    binary: await detectRunner(runner.id),
    args: runner.argv(scriptPath),
  });

  sender.send('pulse:run-output', {
    runId,
    stream: 'system',
    chunk:
      result.cancelled || result.signal
        ? `pulse ▸ terminated${result.signal ? ` (signal ${result.signal})` : ''} after ${result.duration} ms\n`
        : `pulse ▸ finished with exit code ${result.exitCode} in ${result.duration} ms\n`,
    at: timestamp(),
  });

  return Object.assign({ runner: runner.id, scriptPath }, result);
}

ipcMain.handle('pulse:run', runLocalLua);

ipcMain.handle('pulse:run-utility', async (event, { id, cwd } = {}) => {
  const utility = UTILITIES[id];
  if (!utility) return { ok: false, error: `unknown utility "${id}"` };
  const runId = `util-${Date.now()}`;
  event.sender.send('pulse:run-output', {
    runId,
    stream: 'system',
    chunk: `pulse ▸ ${utility.label}\n`,
    at: timestamp(),
  });
  const result = await runStreamed({
    sender: event.sender,
    runId,
    file: null,
    binary: utility.file,
    args: utility.args,
    options: { cwd: cwd && fs.existsSync(cwd) ? cwd : workspaceDir(), shell: false },
  });
  event.sender.send('pulse:run-output', {
    runId,
    stream: 'system',
    chunk: `pulse ▸ utility finished (exit ${result.exitCode}) in ${result.duration} ms\n`,
    at: timestamp(),
  });
  return Object.assign({ utility: id }, result);
});

ipcMain.handle('pulse:cancel', (_event, runId) => {
  if (runId && running.has(runId)) {
    const entry = running.get(runId);
    entry.cancelled = true;
    try { entry.child.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => { try { entry.child.kill('SIGKILL'); } catch (_) {} }, 2500);
    return { cancelled: true, runId };
  }
  // no id given → stop everything
  let count = 0;
  running.forEach((entry) => {
    entry.cancelled = true;
    try { entry.child.kill('SIGTERM'); } catch (_) {}
    count += 1;
  });
  return { cancelled: true, count };
});

ipcMain.handle('pulse:running', () => Array.from(running.keys()));

// ---------------------------------------------------------------------------
// Xeno C++ core bridge
//
// The original XenoUI (C#) drives the compiled core through four exported
// functions and a local HTTP API. Pulse keeps exactly the same contract, but
// from the Electron main process:
//
//   native (preferred)   LoadLibrary("Xeno.dll")  ->  Initialize / GetClients /
//                        Execute / Compilable, via the pulse_xeno.node addon
//   http (always there)  spawn the compiled core module with child_process and
//                        talk to its HTTP server on 127.0.0.1:19283
//
//   ClientInfo { const char* Version; const char* Username; int PID; }
//   Compilable() returns "success" or the Luau compiler error text.
// ---------------------------------------------------------------------------

const XENO_PORT = Number(process.env.PULSE_XENO_PORT || 19283);
const XENO_HOST = '127.0.0.1';

/** Where the compiled core can live, relative to the project / resources. */
const XENO_DLL_RELATIVE = [
  ['Xeno', 'bin', 'Xeno.dll'],
  ['Xeno', 'x64', 'Release', 'Xeno.dll'],
  ['Xeno', 'Release', 'Xeno.dll'],
  ['Xeno', 'build', 'Release', 'Xeno.dll'],
  ['Xeno', 'bin', 'PulseCore.dll'],
];

const XENO_EXE_RELATIVE = [
  ['Xeno', 'bin', 'Xeno.exe'],
  ['Xeno', 'bin', 'PulseCore.exe'],
  ['Xeno', 'x64', 'Release', 'Xeno.exe'],
  ['Xeno', 'Release', 'Xeno.exe'],
  ['Xeno', 'build', 'Release', 'Xeno.exe'],
];

function resourceRoot() {
  if (app.isPackaged && process.resourcesPath) return process.resourcesPath;
  return app.getAppPath();
}

function packagedOrDev(segments) {
  // Packaged builds ship the core next to the resources folder (see the
  // extraResources entry in package.json), development builds read it from
  // the repository checkout.
  if (app.isPackaged && process.resourcesPath) {
    return [path.join(process.resourcesPath, 'xeno', segments[segments.length - 1]),
      path.join(process.resourcesPath, ...segments)];
  }
  return [path.join(app.getAppPath(), ...segments)];
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function xenoPaths() {
  const dllCandidates = [];
  const exeCandidates = [];
  const addonCandidates = [];

  if (process.env.PULSE_XENO_DLL) dllCandidates.push(process.env.PULSE_XENO_DLL);
  if (process.env.PULSE_XENO_EXE) exeCandidates.push(process.env.PULSE_XENO_EXE);

  XENO_DLL_RELATIVE.forEach((segments) => dllCandidates.push(...packagedOrDev(segments)));
  XENO_EXE_RELATIVE.forEach((segments) => exeCandidates.push(...packagedOrDev(segments)));

  addonCandidates.push(path.join(resourceRoot(), 'Xeno', 'bridge', 'build', 'Release', 'pulse_xeno.node'));
  addonCandidates.push(path.join(resourceRoot(), 'Xeno', 'bridge', 'build', 'Debug', 'pulse_xeno.node'));
  if (app.isPackaged && process.resourcesPath) {
    // electron-builder copies Xeno/bin and the compiled addon to resources/Xeno
    // through the extraResources entry of package.json.
    addonCandidates.push(path.join(process.resourcesPath, 'Xeno', 'bridge', 'build', 'Release', 'pulse_xeno.node'));
    addonCandidates.push(path.join(process.resourcesPath, 'Xeno', 'bridge', 'build', 'Debug', 'pulse_xeno.node'));
    addonCandidates.push(path.join(process.resourcesPath, 'native', 'pulse_xeno.node'));
  }

  return {
    dll: firstExisting(dllCandidates),
    exe: firstExisting(exeCandidates),
    addon: firstExisting(addonCandidates),
  };
}

/** Live state of the bridge. */
const xeno = {
  mode: 'none',          // 'native' | 'child' | 'external' | 'none'
  bridge: null,          // loaded pulse_xeno.node addon
  addonPath: null,
  corePath: null,
  child: null,           // spawned core process (mode === 'child')
  ready: false,
  clients: [],
  pollTimer: null,
  lastError: null,
};

function xenoLog(line, stream = 'system') {
  sendToWindow('pulse:run-output', { runId: 'xeno', stream, chunk: String(line), at: timestamp() });
}

function xenoInfo() {
  const paths = xenoPaths();
  return {
    mode: xeno.mode,
    ready: xeno.ready,
    port: XENO_PORT,
    host: XENO_HOST,
    available: Boolean(paths.dll || paths.exe || paths.addon),
    dllPath: paths.dll,
    exePath: paths.exe,
    addonPath: paths.addon,
    corePath: xeno.corePath,
    clients: xeno.clients,
    lastError: xeno.lastError,
  };
}

/* ------------------------------------------------------------ http layer */

function xenoRequest(method, urlPath, { body = null, contentType = 'text/plain', params = null, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    const headers = { Accept: '*/*', Connection: 'close' };
    if (body !== null && body !== undefined) {
      headers['Content-Type'] = contentType;
      headers['Content-Length'] = Buffer.byteLength(body);
    } else {
      headers['Content-Length'] = '0';
    }

    const request = http.request({ host: XENO_HOST, port: XENO_PORT, path: `${urlPath}${query}`, method, headers }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text: data }));
    });

    request.setTimeout(timeout, () => request.destroy(new Error(`Xeno core did not answer within ${timeout} ms`)));
    request.on('error', reject);
    if (body !== null && body !== undefined) request.write(body);
    request.end();
  });
}

/** POST /send — the JSON command dispatcher of the core. */
function xenoSend(command, extra = {}) {
  return xenoRequest('POST', '/send', {
    body: JSON.stringify(Object.assign({ c: command }, extra)),
    contentType: 'application/json',
  });
}

/** POST /compilable — "success" or the Luau compiler error text. */
async function xenoCompilable(source) {
  if (xeno.mode === 'native' && xeno.bridge) {
    const result = xeno.bridge.compilable(String(source));
    return { ok: result === 'success', detail: result, source: 'native' };
  }
  const response = await xenoRequest('POST', '/compilable', { body: String(source), contentType: 'text/plain' });
  const detail = (response.text || '').trim();
  return {
    ok: response.status === 200 && detail === 'success',
    detail: detail || (response.status === 200 ? 'success' : `HTTP ${response.status}`),
    source: 'http',
  };
}

function waitForPort(port, host, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = new net.Socket();
      let settled = false;
      const finish = (ok, error) => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch (_) { /* already gone */ }
        if (ok) resolve(true);
        else if (Date.now() >= deadline) reject(error || new Error(`port ${host}:${port} is not reachable`));
        else setTimeout(attempt, intervalMs);
      };
      socket.setTimeout(1000);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', (error) => finish(false, error));
      socket.connect(port, host);
    };
    attempt();
  });
}

/* -------------------------------------------------- native addon (FFI) */

function loadNativeBridge(addonPath) {
  if (!addonPath || !fs.existsSync(addonPath)) return { ok: false, error: 'addon not built' };
  try {
    const addon = require(addonPath);
    if (typeof addon.load !== 'function' || typeof addon.initialize !== 'function') {
      return { ok: false, error: 'addon does not expose the Xeno bridge API' };
    }
    return { ok: true, addon };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}

/* --------------------------------------------------------- client list */

function readClientsNative() {
  const raw = xeno.bridge.getClients();
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((client) => client && Number(client.id || client.pid || 0) > 0)
    .map((client) => ({
      pid: Number(client.id || client.pid),
      name: client.name || 'unknown',
      version: client.version || '',
    }));
}

async function readClientsHttp() {
  const found = await findRobloxProcesses();
  return found.map((processInfo) => ({
    pid: processInfo.pid,
    name: processInfo.name,
    version: '',
  }));
}

function findRobloxProcesses() {
  return new Promise((resolve) => {
    const names = robloxProcessNames();
    const match = (name) => names.some((n) => name.toLowerCase().includes(n.toLowerCase().replace(/\.exe$/, '')));

    if (IS_WIN) {
      execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
        if (error) { resolve([]); return; }
        const list = [];
        String(stdout).split(/\r?\n/).forEach((line) => {
          const columns = line.split('","');
          if (columns.length < 2) return;
          const name = columns[0].replace(/^"/, '').trim();
          const pid = Number(String(columns[1]).replace(/"/g, '').trim());
          if (pid > 0 && match(name)) list.push({ pid, name });
        });
        resolve(list);
      });
      return;
    }

    execFile('ps', ['-eo', 'pid=,comm='], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      if (error) { resolve([]); return; }
      const list = [];
      String(stdout).split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const [pidPart, ...rest] = trimmed.split(/\s+/);
        const pid = Number(pidPart);
        const name = rest.join(' ');
        if (pid > 0 && match(name)) list.push({ pid, name });
      });
      resolve(list);
    });
  });
}

async function refreshClients() {
  let clients = [];
  try {
    clients = xeno.mode === 'native' ? readClientsNative() : await readClientsHttp();
  } catch (error) {
    clients = [];
    xeno.lastError = error && error.message ? error.message : String(error);
  }
  xeno.clients = clients;
  sendToWindow('pulse:clients', { clients, mode: xeno.mode, ready: xeno.ready });
  return clients;
}

function startClientPolling() {
  stopClientPolling();
  refreshClients();
  xeno.pollTimer = setInterval(() => { refreshClients().catch(() => {}); }, 1000);
}

function stopClientPolling() {
  if (xeno.pollTimer) {
    clearInterval(xeno.pollTimer);
    xeno.pollTimer = null;
  }
}

/* ------------------------------------------------------- attach / detach */

async function attachXeno() {
  if (xeno.ready) return { ok: true, mode: xeno.mode, clients: xeno.clients, port: XENO_PORT, already: true };

  const paths = xenoPaths();
  xeno.lastError = null;

  // 1. native: load the compiled DLL straight into the Electron process
  if (paths.addon && paths.dll) {
    const loaded = loadNativeBridge(paths.addon);
    if (loaded.ok) {
      try {
        loaded.addon.load(paths.dll);
        loaded.addon.initialize();
        xeno.bridge = loaded.addon;
        xeno.addonPath = paths.addon;
        xeno.corePath = paths.dll;
        xeno.mode = 'native';
        xeno.ready = true;
        xenoLog(`▸ Xeno core loaded in-process (${path.basename(paths.dll)})\n`);
        startClientPolling();
        sendToWindow('pulse:attach-status', { connected: true, mode: 'xeno-native', target: path.basename(paths.dll), clients: xeno.clients });
        return { ok: true, mode: 'native', core: paths.dll, clients: xeno.clients, port: XENO_PORT };
      } catch (error) {
        xeno.lastError = error && error.message ? error.message : String(error);
        xenoLog(`✖ native core failed: ${xeno.lastError}\n`, 'stderr');
      }
    } else {
      xeno.lastError = loaded.error;
      xenoLog(`▸ native bridge unavailable (${loaded.error}) — falling back to the executable\n`);
    }
  }

  // 2. an already running core keeps the port open — just bind to it
  try {
    await waitForPort(XENO_PORT, XENO_HOST, 900);
    xeno.mode = 'external';
    xeno.ready = true;
    xeno.corePath = paths.exe || `external core on ${XENO_HOST}:${XENO_PORT}`;
    xenoLog(`▸ bound to a running Xeno core on ${XENO_HOST}:${XENO_PORT}\n`);
    startClientPolling();
    sendToWindow('pulse:attach-status', { connected: true, mode: 'xeno-external', target: `${XENO_HOST}:${XENO_PORT}`, clients: xeno.clients });
    return { ok: true, mode: 'external', port: XENO_PORT, clients: xeno.clients };
  } catch (_) {
    /* nothing is listening yet — spawn the module below */
  }

  // 3. child_process: start the compiled automation module ourselves
  if (!paths.exe) {
    const error = xeno.lastError
      ? `${xeno.lastError} · no core executable found`
      : 'Xeno core not found — put Xeno.dll / Xeno.exe into Xeno/bin (see Xeno/README.md)';
    xeno.lastError = error;
    return { ok: false, error, hint: 'Xeno/bin' };
  }

  xenoLog(`▸ starting core module ${paths.exe}\n`);

  const child = spawn(paths.exe, [], {
    cwd: path.dirname(paths.exe),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  xeno.child = child;
  xeno.corePath = paths.exe;
  xeno.mode = 'child';

  const forward = (chunk, stream) => {
    String(chunk).split(/\r?\n/).filter(Boolean).forEach((line) => xenoLog(`${line}\n`, stream));
  };
  if (child.stdout) child.stdout.on('data', (chunk) => forward(chunk, 'stdout'));
  if (child.stderr) child.stderr.on('data', (chunk) => forward(chunk, 'stderr'));

  child.on('error', (error) => {
    xeno.lastError = error.message;
    xenoLog(`✖ core process error: ${error.message}\n`, 'stderr');
  });

  child.on('exit', (code, signal) => {
    if (xeno.child === child) {
      xenoLog(`▸ core process exited (code ${code}${signal ? `, signal ${signal}` : ''})\n`, 'system');
      detachXeno(`core exited with code ${code}`);
      sendToWindow('pulse:attach-status', { connected: false, mode: 'xeno-child', reason: `core exited (code ${code})`, clients: [] });
    }
  });

  try {
    await waitForPort(XENO_PORT, XENO_HOST, 25000);
  } catch (error) {
    xeno.lastError = `core did not open ${XENO_HOST}:${XENO_PORT} — ${error.message}`;
    return { ok: false, error: xeno.lastError };
  }

  xeno.ready = true;
  xenoLog(`▸ core is listening on ${XENO_HOST}:${XENO_PORT}\n`);
  startClientPolling();
  sendToWindow('pulse:attach-status', { connected: true, mode: 'xeno-child', target: path.basename(paths.exe), clients: xeno.clients });
  return { ok: true, mode: 'child', core: paths.exe, clients: xeno.clients, port: XENO_PORT };
}

function detachXeno(reason) {
  stopClientPolling();

  if (xeno.child) {
    const child = xeno.child;
    xeno.child = null;
    child.removeAllListeners('exit');
    try { child.kill(); } catch (_) { /* already gone */ }
  }

  const wasReady = xeno.ready;
  xeno.ready = false;
  xeno.mode = 'none';
  xeno.clients = [];
  // The DLL stays loaded on purpose: it owns background threads, and
  // FreeLibrary on a module with running threads would crash the app.
  sendToWindow('pulse:clients', { clients: [], mode: xeno.mode, ready: false });
  return { ok: true, wasReady, reason: reason || 'detached' };
}

/* -------------------------------------------------------------- execute */

async function executeXeno(source, { chunkName = 'Pulse', scriptName = 'pulse-script', pid = null, user = null } = {}) {
  if (!xeno.ready) return { ok: false, error: 'core is not attached' };

  const compile = await xenoCompilable(source).catch((error) => ({
    ok: false,
    detail: error && error.message ? error.message : String(error),
    source: 'error',
  }));
  if (!compile.ok) {
    return { ok: false, engine: 'xeno', error: `compile error: ${compile.detail}`, stage: 'compile' };
  }

  const targets = [];
  if (xeno.mode === 'native' && xeno.bridge) {
    const names = user ? [user] : xeno.clients.map((client) => client.name).filter(Boolean);
    if (!names.length) return { ok: false, engine: 'xeno', error: 'no Roblox client detected', stage: 'target' };
    xeno.bridge.execute(String(source), names);
    targets.push(...names);
    return { ok: true, engine: 'xeno', mode: 'native', targets, stage: 'execute' };
  }

  const pids = pid ? [Number(pid)] : xeno.clients.map((client) => client.pid);
  if (!pids.length) return { ok: false, engine: 'xeno', error: 'no Roblox client detected', stage: 'target' };

  const failures = [];
  for (const targetPid of pids) {
    const response = await xenoRequest('POST', '/loadstring', {
      body: String(source),
      contentType: 'text/plain',
      params: { n: scriptName, pid: String(targetPid), cn: chunkName },
    }).catch((error) => ({ status: 0, text: error && error.message ? error.message : String(error) }));

    if (response.status === 200) targets.push(targetPid);
    else failures.push({ pid: targetPid, error: parseXenoError(response) });
  }

  if (!targets.length) {
    return { ok: false, engine: 'xeno', mode: xeno.mode, error: failures.map((f) => `pid ${f.pid}: ${f.error}`).join(' | '), stage: 'execute' };
  }

  return {
    ok: true,
    engine: 'xeno',
    mode: xeno.mode,
    targets,
    failures,
    stage: 'execute',
  };
}

function parseXenoError(response) {
  try {
    const parsed = JSON.parse(response.text);
    if (parsed && parsed.error) return parsed.error;
  } catch (_) { /* plain text error */ }
  return response.text ? response.text.trim().slice(0, 300) : `HTTP ${response.status}`;
}

// ---------------------------------------------------------------------------
// IPC — Attach / Connect
// ---------------------------------------------------------------------------

function detachSocket(reason) {
  if (socket) {
    try { socket.destroy(); } catch (_) {}
    socket = null;
  }
  socketTarget = null;
  sendToWindow('pulse:attach-status', { connected: false, target: null, reason: reason || 'closed' });
}

function stopPidWatcher() {
  if (pidWatcher) {
    clearInterval(pidWatcher);
    pidWatcher = null;
  }
}

ipcMain.handle('pulse:attach', async (event, options = {}) => {
  // The Attach button is bound to the C++ core: native FFI when the bridge
  // addon and Xeno.dll are available, otherwise the compiled core module is
  // launched through child_process and driven over its HTTP channel.
  const paths = xenoPaths();
  if (!options.mode && (paths.dll || paths.exe || paths.addon)) {
    return attachXeno().catch((error) => ({ ok: false, error: error && error.message ? error.message : String(error) }));
  }

  const mode = options.mode === 'process' ? 'process' : 'tcp';
  stopPidWatcher();
  if (socket) detachSocket('reattaching');

  if (mode === 'process') {
    const pid = Number(options.pid);
    if (!Number.isInteger(pid) || pid <= 0) return { ok: false, error: 'invalid pid' };

    sendToWindow('pulse:attach-status', { connected: true, mode: 'process', target: `pid:${pid}` });

    const poll = () => {
      const file = IS_WIN ? 'tasklist.exe' : 'ps';
      const args = IS_WIN ? ['/fi', `PID eq ${pid}`, '/fo', 'CSV', '/nh'] : ['-o', 'pid=,pcpu=,pmem=,etime=,comm=', '-p', String(pid)];
      execFile(file, args, { windowsHide: true, timeout: 5000 }, (error, stdout, stderr) => {
        const alive = !error && (IS_WIN ? /,"[^"]+"/.test(stdout.trim()) : stdout.trim().length > 0);
        sendToWindow('pulse:attach-data', {
          mode: 'process',
          pid,
          alive,
          text: alive ? stdout.trim() : `process ${pid} is not running`,
          at: timestamp(),
        });
        if (!alive) {
          stopPidWatcher();
          sendToWindow('pulse:attach-status', { connected: false, mode: 'process', target: `pid:${pid}`, reason: 'process exited' });
        }
      });
    };

    poll();
    pidWatcher = setInterval(poll, 2000);
    return { ok: true, mode: 'process', pid };
  }

  const host = String(options.host || '127.0.0.1').trim();
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'invalid port' };

  return new Promise((resolve) => {
    const client = new net.Socket();
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    client.setTimeout(5000);
    client.once('error', (error) => {
      sendToWindow('pulse:attach-data', { mode: 'tcp', text: `connection error: ${error.message}`, at: timestamp(), level: 'error' });
      sendToWindow('pulse:attach-status', { connected: false, mode: 'tcp', target: `${host}:${port}`, reason: error.message });
      socket = null;
      socketTarget = null;
      finish({ ok: false, error: error.message, target: `${host}:${port}` });
    });
    client.on('timeout', () => {
      try { client.destroy(); } catch (_) {}
      finish({ ok: false, error: 'timeout', target: `${host}:${port}` });
    });
    client.on('data', (data) => {
      sendToWindow('pulse:attach-data', { mode: 'tcp', text: data.toString('utf8'), hex: data.toString('hex'), at: timestamp() });
    });
    client.on('close', (hadError) => {
      if (socket === client) detachSocket(hadError ? 'socket error' : 'closed by remote host');
    });

    client.connect(port, host, () => {
      socket = client;
      socketTarget = { host, port };
      client.setTimeout(0);
      sendToWindow('pulse:attach-status', { connected: true, mode: 'tcp', target: `${host}:${port}` });
      sendToWindow('pulse:attach-data', { mode: 'tcp', text: `connected to ${host}:${port}\n`, at: timestamp(), level: 'system' });
      finish({ ok: true, mode: 'tcp', target: `${host}:${port}` });
    });
  });
});

ipcMain.handle('pulse:attach-send', (_event, payload = {}) => {
  if (!socket || socket.destroyed) return { ok: false, error: 'not connected' };
  let data = payload.data == null ? '' : String(payload.data);
  if (payload.newline !== false && !data.endsWith('\n')) data += '\n';
  if (payload.encoding === 'hex') socket.write(Buffer.from(data.replace(/\s+/g, ''), 'hex'));
  else socket.write(Buffer.from(data, 'utf8'));
  sendToWindow('pulse:attach-data', { mode: 'tcp', text: `→ ${data}`, at: timestamp(), level: 'out' });
  return { ok: true, bytes: Buffer.byteLength(data) };
});

ipcMain.handle('pulse:detach', () => {
  stopPidWatcher();
  detachSocket('detached by user');
  const xenoResult = xeno.ready || xeno.child ? detachXeno('detached by user') : { ok: true, wasReady: false };
  sendToWindow('pulse:attach-status', { connected: false, mode: 'detached', reason: 'detached' });
  return { ok: true, xeno: xenoResult };
});

ipcMain.handle('pulse:xeno-info', () => xenoInfo());

ipcMain.handle('pulse:xeno-clients', async () => {
  if (!xeno.ready) return { ready: false, clients: [], mode: xeno.mode };
  const clients = await refreshClients();
  return { ready: true, mode: xeno.mode, clients };
});

ipcMain.handle('pulse:xeno-compilable', async (_event, { source } = {}) => {
  if (!xeno.ready) return { ok: false, error: 'core is not attached' };
  return xenoCompilable(String(source || ''));
});

/**
 * Unified Execute button:
 *   • core attached    -> compile check + Execute()/POST /loadstring in the C++ core
 *   • no core          -> local Lua interpreter (so Pulse stays usable)
 */
ipcMain.handle('pulse:execute', async (event, payload = {}) => {
  const source = payload.code == null ? '' : String(payload.code);

  if (xeno.ready) {
    try {
      const result = await executeXeno(source, {
        chunkName: payload.chunkName || 'Pulse',
        scriptName: payload.scriptName || (payload.filePath ? path.basename(payload.filePath) : 'pulse-script'),
        pid: payload.pid || null,
        user: payload.user || null,
      });
      sendToWindow('pulse:run-output', {
        runId: 'xeno',
        stream: result.ok ? 'system' : 'stderr',
        chunk: result.ok
          ? `\u25b8 sent to ${result.targets.length} client(s) via the ${result.mode} core\n`
          : `\u2716 ${result.error}\n`,
        at: timestamp(),
      });
      return result;
    } catch (error) {
      return { ok: false, engine: 'xeno', error: error && error.message ? error.message : String(error) };
    }
  }

  // no core -> run the buffer with the local Lua interpreter
  return runLocalLua(event, Object.assign({}, payload, { runner: 'lua' }));
});

ipcMain.handle('pulse:probe', (_event, { host, port, timeout } = {}) =>
  new Promise((resolve) => {
    const targetPort = Number(port);
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      resolve({ ok: false, error: 'invalid port' });
      return;
    }
    const startedAt = Date.now();
    const client = new net.Socket();
    let settled = false;
    const done = (ok, error) => {
      if (settled) return;
      settled = true;
      try { client.destroy(); } catch (_) {}
      resolve({ ok, error: error || null, rtt: Date.now() - startedAt, target: `${host}:${targetPort}` });
    };
    client.setTimeout(Number(timeout) || 2000);
    client.once('error', (error) => done(false, error.message));
    client.once('timeout', () => done(false, 'timeout'));
    client.connect(targetPort, String(host || '127.0.0.1'), () => done(true));
  })
);

// ---------------------------------------------------------------------------
// IPC — local TCP echo server, handy for testing the Attach bridge
// ---------------------------------------------------------------------------

let bridgeServer = null;

ipcMain.handle('pulse:start-bridge', (event, { port } = {}) =>
  new Promise((resolve) => {
    if (bridgeServer) {
      const address = bridgeServer.address();
      resolve({ ok: true, port: address && address.port, alreadyRunning: true });
      return;
    }
    bridgeServer = net.createServer((connection) => {
      const remote = `${connection.remoteAddress}:${connection.remotePort}`;
      sendToWindow('pulse:attach-data', { mode: 'tcp', text: `bridge ▸ client connected ${remote}\n`, at: timestamp(), level: 'system' });
      connection.setEncoding('utf8');
      connection.on('data', (chunk) => {
        const text = String(chunk);
        sendToWindow('pulse:attach-data', { mode: 'tcp', text: `bridge ← ${text}`, at: timestamp() });
        const upper = text.toUpperCase();
        connection.write(upper);
        sendToWindow('pulse:attach-data', { mode: 'tcp', text: `bridge → ${upper}`, at: timestamp(), level: 'out' });
      });
      connection.on('end', () => sendToWindow('pulse:attach-data', { mode: 'tcp', text: `bridge ▸ client disconnected ${remote}\n`, at: timestamp(), level: 'system' }));
      connection.on('error', () => {});
    });

    bridgeServer.on('error', (error) => {
      bridgeServer = null;
      resolve({ ok: false, error: error.message });
    });

    bridgeServer.listen(Number(port) || 0, '127.0.0.1', () => {
      const address = bridgeServer.address();
      const bound = address && address.port;
      sendToWindow('pulse:bridge-status', { running: true, port: bound });
      resolve({ ok: true, port: bound });
    });
  })
);

ipcMain.handle('pulse:stop-bridge', () => {
  if (!bridgeServer) return { ok: true, stopped: false };
  const server = bridgeServer;
  bridgeServer = null;
  server.close(() => sendToWindow('pulse:bridge-status', { running: false, port: null }));
  return { ok: true, stopped: true };
});

// ---------------------------------------------------------------------------
// IPC — dialogs from the renderer
// ---------------------------------------------------------------------------

ipcMain.handle('pulse:message-box', async (event, { message, detail, type, buttons } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(win, {
    type: type || 'info',
    buttons: Array.isArray(buttons) && buttons.length ? buttons : ['OK'],
    defaultId: 0,
    title: 'Pulse',
    message: String(message || ''),
    detail: String(detail || ''),
  });
  return result.response;
});
