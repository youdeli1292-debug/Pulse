# Xeno/bin — put the compiled core here

This folder is the drop point for the **compiled** Xeno artifacts. Pulse looks
here first when you press **Attach** (`main.js → xenoPaths()`).

Expected files (only one route is required):

| file                | route                                                          |
| ------------------- | -------------------------------------------------------------- |
| `Xeno.dll`          | **native** — loaded into Electron by `Xeno/bridge/pulse_xeno.node` |
| `PulseCore.exe`     | **child** — host process spawned with `child_process`, built from `Xeno/host/pulse_core_host.cpp` |
| `Xeno.exe`          | **child** — any standalone core executable that opens port 19283 |

Nothing is committed here on purpose: the binaries are build output and the
core is licensed separately (Apache-2.0, upstream
[tyronetheqt/Xeno](https://github.com/tyronetheqt/Xeno)). `.gitignore` keeps
`*.dll` / `*.exe` out of the repository so the folder stays clean.

Quick copy after building the core (Windows CMD, from the Pulse root):

```bat
copy Xeno\x64\Release\Xeno.dll Xeno\bin\Xeno.dll
cmake -S Xeno\host -B Xeno\host\build
cmake --build Xeno\host\build --config Release
```

Then start Pulse, press **Attach** — the status bar turns from
`Status: Not Attached` (red) to `Status: Attached` (green).

If no core is present, **Execute** falls back to the local Lua interpreter and
the status bar tells you what is missing.
