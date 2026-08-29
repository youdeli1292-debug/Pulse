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

function runnerAvailable(runnerId) {
  return new Promise((resolve) => {
    const runner = RUNNERS[runnerId];
    if (!runner) return resolve(false);
    if (runner.windowsOnly && !IS_WIN) return resolve(false);
    if (runner.unixOnly && IS_WIN) return resolve(false);

    const probe = (bin, useFallback) => {
      const args = runnerId === 'node' ? ['-v'] : runnerId === 'python' ? ['--version'] : ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'];
      const child = spawn(bin, args, { windowsHide: true });
      let out = '';
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      child.on('error', () => {
        if (!useFallback && runner.fallbackBinary) probe(runner.fallbackBinary, true);
        else done(false);
      });
      if (child.stdout) child.stdout.on('data', (d) => { out += d.toString(); });
      if (child.stderr) child.stderr.on('data', (d) => { out += d.toString(); });
      child.on('close', (code) => done(code === 0 || out.trim().length > 0));
      setTimeout(() => { try { child.kill(); } catch (_) {} done(out.trim().length > 0); }, 4000);
    };

    probe(typeof runner.binary === 'function' ? runner.binary() : runner.binary, false);
  });
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
  runnerProbeCache = results.filter((r) => r.available || r.id === 'node' || r.id === 'powershell');
  return runnerProbeCache;
});

ipcMain.handle('pulse:list-utilities', () =>
  Object.keys(UTILITIES).map((id) => ({ id, label: UTILITIES[id].label }))
);

ipcMain.handle('pulse:run', async (event, payload = {}) => {
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
    binary: typeof runner.binary === 'function' ? runner.binary() : runner.binary,
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
});

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

ipcMain.handle('pulse:attach', (event, options = {}) => {
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
  return { ok: true };
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
