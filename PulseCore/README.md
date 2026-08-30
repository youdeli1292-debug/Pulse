# PulseCore — C++ ядро, к которому подключается Pulse

`Pulse` — это интерфейс. Эта папка — контракт и клей для **C++-ядра**: того
самого проекта, который раньше общался со старой C#-оболочкой. Интерфейс
заменён на Electron, ядро не меняется и подключается как есть, через те же
четыре экспорта.

Исходники ядра в репозиторий **не входят** — их скачивает `fetch-core.cmd`
(в `PulseCore/core`, эта папка в `.gitignore`, как `node_modules`). Так ядро
остаётся сторонним build-входом со своей лицензией и своими зависимостями,
а не копией внутри Pulse.

---

## 1. Структура

```
PulseCore/
├── bin/                  ← сюда класть скомпилированное ядро (DLL/EXE)
│   └── README.md
├── core/                 ← исходники ядра, скачанные fetch-core.cmd (не в git)
├── include/
│   └── pulse_core.h      ← бинарный контракт: Initialize / GetClients /
│                            Execute / Compilable + struct PulseClientInfo
├── bridge/               ← Node-API модуль: грузит DLL ядра прямо в Electron
│   ├── pulse_core.cpp    ← load / unload / initialize / getClients /
│   │                        execute / compilable / info
│   ├── binding.gyp
│   ├── build.js          ← сборка под заголовки Electron
│   └── build.cmd
└── host/
    ├── pulse_core_host.cpp  ← PulseCore.exe: хост-процесс для DLL ядра
    └── CMakeLists.txt
```

## 2. Контракт (`include/pulse_core.h`)

```c
struct PulseClientInfo { const char* Version; const char* Username; int PID; };

void             Initialize(void);                                 // поднимает ядро
PulseClientInfo* GetClients(void);                                 // NULL-terminated
void             Execute(const char* script, const char** users, int n);
const char*      Compilable(const char* script);                   // "success" | ошибка Luau
```

`Initialize()` запускает сканер клиентов (`RobloxPlayerBeta.exe`,
`eurotrucks2.exe`, опрос раз в 250 мс) и HTTP-плоскость управления на
`127.0.0.1:19283`:

| endpoint                     | body       | ответ                    |
| ---------------------------- | ---------- | ------------------------ |
| `POST /compilable`           | Lua-код    | `success` или ошибка Luau |
| `POST /loadstring?n=&pid=&cn=` | Lua-код  | `200` или `{"error": …}` |
| `POST /send`                 | `{"c": …}` | диспетчер команд (`rf`, `lf`, `if`, `mf`, `dfl`, `df`, `cas`, `rq`, `qtp`, `btc`, `rc`, `ax`, `hw`, `adr`, `spf`, `clt`, `gb`, `um`, `prp`) |
| `POST /writefile?p=`         | содержимое | пишет файл в workspace   |
| `POST /setclipboard`         | текст      | системный буфер обмена    |

## 3. Скачать и собрать ядро

```bat
:: из корня репозитория — одной командой
fetch-core.cmd
```

Скрипт клонирует C++-проект в `PulseCore/core`, собирает его через MSBuild
(`Release x64`) и копирует получившуюся DLL в `PulseCore\bin`.

Вручную то же самое:

```bat
git clone --depth 1 https://github.com/tyronetheqt/Xeno.git PulseCore\core
msbuild PulseCore\core\Xeno.sln /p:Configuration=Release /p:Platform=x64
copy PulseCore\core\Xeno\x64\Release\Xeno.dll PulseCore\bin\Xeno.dll
```

Ядро собирается как `DynamicLibrary` (v143, C++20), поэтому на выходе одна
DLL. Если MSBuild ругается на отсутствующие заголовки — в проекте есть
`vcpkg.json`, выполните `vcpkg install` внутри `PulseCore\core`.

Имя DLL не важно: `PulseCore\bin` принимает `PulseCore.dll`, `Xeno.dll`,
`Pulse.dll` и `PulseCore.exe` / `Xeno.exe` / `Pulse.exe`.

## 4. Как Pulse к нему обращается

`main.js` при нажатии **Attach** пробует маршруты по порядку
(`attachCore()`):

1. **native** — `PulseCore/bridge/build/Release/pulse_core.node` + DLL из
   `PulseCore/bin`: `LoadLibrary` + `Initialize()`, выполнение через
   `Execute(source, users)`, список клиентов через `GetClients()`. Без лишних
   процессов и сокетов.
2. **external** — ядро уже запущено и держит `127.0.0.1:19283`: Pulse просто
   подключается к нему.
3. **child** — `child_process.spawn()` для `PulseCore/bin/PulseCore.exe`
   (или `Xeno.exe`): ожидание порта до 25 с, затем работа по HTTP;
   stdout/stderr ядра уходят в редактор.

Мост под Electron собирается так (из корня):

```bat
npm run build:core
```

Хост-процесс — любым компилятором C++17:

```bat
cl /std:c++17 /O2 /EHsc /Fe:PulseCore\bin\PulseCore.exe PulseCore\host\pulse_core_host.cpp
:: или
cmake -S PulseCore\host -B PulseCore\host\build
cmake --build PulseCore\host\build --config Release
```

Без этих артефактов приложение тоже работает: **Attach** подключится к уже
запущенному ядру, а **Execute** без ядра пойдёт через локальный Lua.

Переменные окружения для отладки: `PULSE_CORE_PORT`, `PULSE_CORE_DLL`,
`PULSE_CORE_EXE`.
