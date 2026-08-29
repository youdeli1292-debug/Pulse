/**
 * Pulse — preload script.
 *
 * The renderer runs with contextIsolation enabled and without Node
 * integration, so this file is the only place where privileged APIs are
 * reachable. Everything is published on `window.pulse` through contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

const safe = (channel, mapper) => (...args) => ipcRenderer.invoke(channel, ...args).then(mapper || ((x) => x));

contextBridge.exposeInMainWorld('pulse', {
  /* ---------------------------------------------------------------- meta */
  appInfo: safe('pulse:app-info'),

  /* -------------------------------------------------------------- window */
  minimize: safe('pulse:window-minimize'),
  toggleMaximize: safe('pulse:window-toggle-maximize'),
  close: safe('pulse:window-close'),
  windowState: safe('pulse:window-state'),
  setProgress: safe('pulse:set-progress'),
  openExternal: safe('pulse:open-external'),

  /* --------------------------------------------------------------- files */
  openFile: safe('pulse:open-file'),
  readFile: safe('pulse:read-file'),
  saveFile: safe('pulse:save-file'),
  listWorkspace: safe('pulse:list-workspace'),
  showInFolder: safe('pulse:show-in-folder'),
  openWorkspace: safe('pulse:open-workspace'),

  /* ---------------------------------------------------- C++ core (Xeno) */
  /** Information about the compiled core module and the current bridge mode. */
  xenoInfo: safe('pulse:xeno-info'),
  /** Attach / detach: loads Xeno.dll (native) or spawns the core executable. */
  attach: safe('pulse:attach'),
  detach: safe('pulse:detach'),
  /** Refresh the list of Roblox clients known to the core. */
  xenoClients: safe('pulse:xeno-clients'),
  /** Luau syntax check performed by the core ("success" or the error text). */
  xenoCompilable: safe('pulse:xeno-compilable'),
  /** Execute: core when attached, local Lua interpreter otherwise. */
  execute: safe('pulse:execute'),
  findRoblox: safe('pulse:find-roblox'),

  /* ------------------------------------------------------------ execution */
  listRunners: safe('pulse:list-runners'),
  listUtilities: safe('pulse:list-utilities'),
  run: safe('pulse:run'),
  runUtility: safe('pulse:run-utility'),
  cancel: safe('pulse:cancel'),
  running: safe('pulse:running'),

  /* ------------------------------------------------------- attach / bridge */
  attachSend: safe('pulse:attach-send'),
  probe: safe('pulse:probe'),
  startBridge: safe('pulse:start-bridge'),
  stopBridge: safe('pulse:stop-bridge'),

  /* -------------------------------------------------------------- dialogs */
  messageBox: safe('pulse:message-box'),

  /**
   * Subscribe to main-process events.
   * Returns an unsubscribe function.
   */
  on(channel, listener) {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
