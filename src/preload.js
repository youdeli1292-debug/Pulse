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

  /* ------------------------------------------------------------ execution */
  listRunners: safe('pulse:list-runners'),
  listUtilities: safe('pulse:list-utilities'),
  run: safe('pulse:run'),
  runUtility: safe('pulse:run-utility'),
  cancel: safe('pulse:cancel'),
  running: safe('pulse:running'),

  /* ------------------------------------------------------- attach / bridge */
  attach: safe('pulse:attach'),
  attachSend: safe('pulse:attach-send'),
  detach: safe('pulse:detach'),
  probe: safe('pulse:probe'),
  findRoblox: safe('pulse:find-roblox'),
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
