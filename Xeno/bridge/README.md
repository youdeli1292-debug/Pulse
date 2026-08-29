# Xeno/bridge — Node-API bridge to the Xeno C++ core

`pulse_xeno.node` is the compiled data-exchange module of Pulse. It loads
`Xeno.dll` into the Electron process with `LoadLibrary` (or `dlopen` on POSIX),
resolves the four exports of the core and hands them to JavaScript:

```js
const bridge = require('./build/Release/pulse_xeno.node');

bridge.load('Xeno/bin/Xeno.dll');   // -> { path, exports: ['Initialize', 'GetClients', 'Execute', 'Compilable'] }
bridge.initialize();                // boots the client scanner + the control plane
bridge.getClients();                // -> [{ pid, id, name, user, version }, …]
bridge.compilable('print(1)');      // -> 'success' | '<luau error>'
bridge.execute('print(1)', ['Builderman']);   // -> 1 (number of targeted clients)
bridge.info();                      // -> { loaded, path, error, platform, exports }
bridge.unload();                    // only when the core has no live threads
```

`main.js` calls exactly these functions (`attachXeno`, `readClientsNative`,
`executeXeno`, `xenoCompilable`). If the addon is missing, Pulse automatically
uses the HTTP route instead (spawned `PulseCore.exe` or an already running core
on `127.0.0.1:19283`), so the application never depends on this build step.

## Build

The addon must be compiled against the **Electron** headers, not against
Node's — otherwise `require()` fails with `ERR_DLOPEN_FAILED` / a module
version mismatch.

From the repository root:

```bat
npm install
npm run build:xeno
```

which runs `node Xeno/bridge/build.js`, i.e.

```bat
node-gyp rebuild --target=<electron version> --arch=x64 --dist-url=https://electronjs.org/headers
```

Requirements:

* **Windows** — Visual Studio 2022 with *Desktop development with C++*
  (the v143 toolset) and Python 3 (needed by node-gyp).
* **macOS** — Xcode command line tools (`xcode-select --install`).
* **Linux** — `build-essential` + `python3`.

Output: `Xeno/bridge/build/Release/pulse_xeno.node`.
