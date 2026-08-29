# Xeno — the C++ core behind Pulse

`Pulse` is the front-end; this folder is the contract and the glue for the
**original Xeno C++ core** ([tyronetheqt/Xeno](https://github.com/tyronetheqt/Xeno),
Apache-2.0). The upstream repository ships two projects:

| upstream project | what it is                                                        | in Pulse                     |
| ---------------- | ----------------------------------------------------------------- | ---------------------------- |
| `Xeno/Xeno.vcxproj` | the **core**: C++20 (`v143`), `ConfigurationType=DynamicLibrary` → `Xeno.dll` | used as-is (loaded or hosted) |
| `XenoUI/`           | WPF shell + WebView2 + Monaco, talks to the core with P/Invoke    | **replaced** by this Electron UI |

Pulse replaces `XenoUI` only. The core is untouched — it is loaded and driven
through the very same four exports that the old C# interface used.

---

## 1. Layout

```
Xeno/
├── bin/                  ← drop the compiled core here (Xeno.dll, PulseCore.exe)
│   └── README.md
├── include/
│   └── xeno_api.h        ← the binary contract: Initialize / GetClients /
│                           Execute / Compilable + struct XenoClientInfo
├── bridge/               ← Node-API addon: loads Xeno.dll *into* Electron
│   ├── pulse_xeno.cpp    ← load / unload / initialize / getClients /
│   │                        execute / compilable / info
│   ├── binding.gyp
│   ├── build.js          ← builds against the Electron headers
│   └── build.cmd
└── host/
    ├── pulse_core_host.cpp  ← PulseCore.exe: hosts Xeno.dll in its own process
    └── CMakeLists.txt
```

## 2. The contract (`include/xeno_api.h`)

```c
struct XenoClientInfo { const char* Version; const char* Username; int PID; };

void            Initialize(void);                                    // boots the core
XenoClientInfo* GetClients(void);                                    // NULL-terminated array
void            Execute(const char* script, const char** users, int n);
const char*     Compilable(const char* script);                      // "success" | luau error
```

`Initialize()` starts the client scanner (`RobloxPlayerBeta.exe`,
`eurotrucks2.exe`, 250 ms poll) and the HTTP control plane on
`127.0.0.1:19283`:

| endpoint                    | body          | answer                       |
| --------------------------- | ------------- | ---------------------------- |
| `POST /compilable`          | Lua source    | `success` or the Luau error  |
| `POST /loadstring?n=&pid=&cn=` | Lua source | `200` or `{"error": …}`      |
| `POST /send`                | `{"c": …}`    | command dispatcher (`rf`, `lf`, `if`, `mf`, `dfl`, `df`, `cas`, `rq`, `qtp`, `btc`, `rc`, `ax`, `hw`, `adr`, `spf`, `clt`, `gb`, `um`, `prp`) |
| `POST /writefile?p=`        | file content  | writes into the workspace     |
| `POST /setclipboard`        | text          | system clipboard              |

## 3. Building the core (upstream)

```bat
git clone https://github.com/tyronetheqt/Xeno.git
cd Xeno
:: vcpkg dependencies are declared in vcpkg.json (httplib, …)
vcpkg install
:: Visual Studio 2022 — "Desktop development with C++"
msbuild Xeno.sln /p:Configuration=Release /p:Platform=x64

copy Xeno\x64\Release\Xeno.dll  <Pulse>\Xeno\bin\Xeno.dll
```

Any configuration that produces `Xeno.dll` works — `Release|x64` is the one
used upstream. Copy the result into `Xeno\bin` (see `bin/README.md`).

## 4. How Pulse talks to it

`main.js` picks the first available route when you press **Attach**:

1. **native** — `Xeno/bridge/build/Release/pulse_xeno.node` + `Xeno/bin/Xeno.dll`.
   The addon `LoadLibrary`s the core, calls `Initialize()` and then executes
   through `Execute(source, users)`; the client list comes from `GetClients()`.
   Zero process hops, zero sockets.
2. **external** — something is already listening on `127.0.0.1:19283` (e.g. you
   started the core yourself). Pulse simply binds to it.
3. **child** — `child_process.spawn()` of `Xeno/bin/PulseCore.exe`
   (or `Xeno.exe`), cwd set to its folder, then Pulse waits up to 25 s for the
   port and drives it over HTTP. stdout/stderr of the core are forwarded into
   the editor.

Build the addon with (from the repository root):

```bat
npm run build:xeno
```

Build the host process with any C++17 compiler:

```bat
cl /std:c++17 /O2 /EHsc /Fe:Xeno\bin\PulseCore.exe Xeno\host\pulse_core_host.cpp
:: or
cmake -S Xeno\host -B Xeno\host\build && cmake --build Xeno\host\build --config Release
```

Pulse runs perfectly well without either artifact: it then binds to a core
that is already running (route 2) and, when nothing is attached, falls back to
the local Lua interpreter for **Execute**.

Environment overrides (useful while developing): `PULSE_XENO_PORT`,
`PULSE_XENO_DLL`, `PULSE_XENO_EXE`.
