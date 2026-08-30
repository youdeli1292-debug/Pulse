# PulseCore/bin — put the compiled core here

This folder is the drop point for the **compiled** core. Pulse looks here
first when you press **Attach** (`main.js → corePaths()`).

Expected files (only one route is required):

| file                        | route                                                          |
| --------------------------- | -------------------------------------------------------------- |
| `PulseCore.dll` / `Xeno.dll` / `Pulse.dll` | **native** — loaded into Electron by `PulseCore/bridge/pulse_core.node` |
| `PulseCore.exe`             | **child** — host process spawned with `child_process`, built from `PulseCore/host/pulse_core_host.cpp` |
| `Xeno.exe` / `Pulse.exe`    | **child** — any standalone core executable that opens port 19283 |

Nothing is committed here on purpose: the binaries are build output of a
separately licensed project. `.gitignore` keeps `*.dll` / `*.exe` out of the
repository, so the folder stays clean.

Quick copy after building the core (Windows CMD, from the Pulse root):

```bat
:: download the core sources and build them
fetch-core.cmd

:: build the host process for the core DLL
cmake -S PulseCore\host -B PulseCore\host\build
cmake --build PulseCore\host\build --config Release
```

Then start Pulse, press **Attach** — the status bar turns from
`Status: Not Attached` (red) to `Status: Attached` (green).

If no core is present, **Execute** falls back to the local Lua interpreter and
the status bar tells you what is missing.
