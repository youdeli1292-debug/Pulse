# Pulse

**Pulse** — безрамочный Lua-экзекутор для Roblox в стиле Dark Cyberpunk. Это Electron-оболочка
для оригинального C++-ядра **Xeno** ([tyronetheqt/Xeno](https://github.com/tyronetheqt/Xeno),
Apache-2.0): старый C#-интерфейс заменён полностью, само ядро не
изменяется и подключается как есть.

Что внутри:

- ядро **Monaco Editor**, жёстко настроенное на синтаксис **Lua** (выпадающего списка языков нет);
- кнопка **Execute** отправляет буфер в C++-ядро, а если ядро недоступно — запускает код
  локальным интерпретатором Lua;
- кнопка **Attach** поднимает ядро: нативная загрузка DLL ядра через N-API модуль,
  либо запуск `PulseCore.exe` через `child_process`, либо подключение к уже
  работающему ядру на `127.0.0.1:19283`;
- встроенный **Script Hub** с готовыми Lua-скриптами;
- тонкий статус-бар с индикатором `Status: Not Attached` (красный) → `Status: Attached` (зелёный).

Промо-сайт лежит в [`site/`](site/) и публикуется как статика (GitHub Pages отдаёт `site/`
без сборки).

---

## Содержимое репозитория

| Путь | Назначение |
| --- | --- |
| `package.json` | манифест, зависимости (`electron`, `electron-builder`, `monaco-editor`), конфиг `build` (Windows → `portable`, иконка `icon_pulse.ico`), скрипты `dist` и `build:core` |
| `main.js` | главный процесс Electron: безрамочное окно **800 × 500**, IPC-каналы `pulse:*`, мост к C++-ядру (FFI / `child_process` / HTTP 19283), локальный Lua-раннер, файлы, окно |
| `src/preload.js` | `contextBridge` — единственный безопасный мост между UI и Node API |
| `src/index.html` | разметка: кастомный titlebar, панель управления, редактор, Script Hub, статус-бар |
| `src/ui.css` | Dark Cyberpunk тема (неоновый фиолетовый `#a855f7` + циан), плотная монолитная вёрстка |
| `src/ui.js` | Monaco (только Lua) + резервный редактор с Lua-подсветкой, кнопки, Script Hub (7 скриптов), статус-бар, attach/execute |
| `PulseCore/` | контракт и клей для C++-ядра: `include/pulse_core.h`, `bridge/` (N-API модуль), `host/` (`PulseCore.exe`), `bin/` (сюда класть скомпилированное ядро) |
| `build.cmd` | сборка portable-exe одной командой |
| `fetch-core.cmd` | скачивает и собирает C++-ядро в `PulseCore/core` |
| `site/` | лендинг: `index.html`, `assets/style.css`, `assets/app.js`, `assets/og-image.jpg` |
| `icon_pulse.ico` | иконка приложения (256/128/64/48/32/16) |
| `docs/ci/` | готовые GitHub Actions: сборка portable-exe и публикация сайта |

Подробности по ядру — в [`PulseCore/README.md`](PulseCore/README.md).

---

## Интерфейс

```
┌──────────────────────────────────────────────────────────────────────┐
│ ▢ PULSE  v1.0.0            script.lua · lua              ─  □  ✕      │
├────────────┬──────────────────────────────────┬──────────────────────┤
│ ▶ Execute  │  Monaco Editor  (Lua)            │ Script Hub      ✕    │
│ ⌫ Clear    │                                  │ 🔎 search scripts…   │
│ ⛓ Attach   │  local Players = game:...        │ ▸ Fly Script         │
│ ⧉ Open File│  ...                             │ ▸ AimBot             │
│ ❯❯ Script  │                                  │ ▸ ESP                │
│    Hub     │                                  │ ▸ SpeedHack          │
│            │                                  │ ▸ Infinite Yield     │
│  core  …   │                                  │ ▸ Noclip / Anti-AFK  │
│  mode  …   │                                  │                      │
├────────────┴──────────────────────────────────┴──────────────────────┤
│ Status: Attached  clients: 2  ready   Ln 12, Col 4   lua   monaco    │
└──────────────────────────────────────────────────────────────────────┘
```

- **Lua только.** Monaco и резервный редактор всегда работают в режиме `lua`.
- **Панель управления** (слева) — ровно пять кнопок: **Execute**, **Clear**, **Attach**,
  **Open File**, **Script Hub**. Ниже — служебные строки `core`, `mode`, `clients`, `engine`.
- **Script Hub** (справа) — 7 готовых скриптов: Fly Script, AimBot, ESP, SpeedHack,
  Infinite Yield, Noclip, Anti-AFK. Клик по названию загружает код в редактор, поле поиска
  фильтрует список, кнопка ❯❯ / `Ctrl+H` скрывает и показывает панель.
- **Статус-бар** внизу: бейдж `Status: Not Attached` (красный) или `Status: Attached`
  (зелёный), счётчик `clients: N`, сообщение, позиция курсора, `lua`, движок редактора.
  Постоянной консоли в интерфейсе нет — вывод выполнения приходит всплывающей панелью
  над редактором.

---

## Как Pulse работает с C++-ядром

`PulseCore/include/pulse_core.h` описывает бинарный контракт — ровно те же четыре экспорта,
которые использовал старый C#-интерфейс:

```c
struct PulseClientInfo { const char* Version; const char* Username; int PID; };

void             Initialize(void);
PulseClientInfo* GetClients(void);                                 // NULL-terminated
void            Execute(const char* script, const char** users, int n);
const char*     Compilable(const char* script);                    // "success" | ошибка Luau
```

`Initialize()` поднимает сканер клиентов (`RobloxPlayerBeta.exe`, `eurotrucks2.exe`) и
HTTP-плоскость управления на `127.0.0.1:19283` (`POST /compilable`, `/loadstring`, `/send`,
`/writefile`, `/setclipboard`).

Кнопка **Attach** (`main.js → attachCore()`) пробует маршруты по порядку:

1. **native** — `PulseCore/bridge/build/Release/pulse_core.node` + DLL ядра из
   `PulseCore/bin`: `LoadLibrary` + `Initialize()`, выполнение через
   `Execute(source, users)`, список клиентов через `GetClients()`. Без лишних процессов и сокетов.
2. **external** — ядро уже запущено и держит порт 19283: Pulse просто подключается к нему.
3. **child** — `child_process.spawn()` для `PulseCore/bin/PulseCore.exe`,
   ожидание порта до 25 с, затем работа по HTTP; stdout/stderr ядра уходят в редактор.

**Execute** (`pulse:execute`) всегда сначала проверяет синтаксис (`/compilable` или
`Compilable()`), а затем отправляет исходник в ядро; если ядро не подключено — запускает код
локальным интерпретатором Lua.

Переменные окружения для отладки: `PULSE_CORE_PORT`, `PULSE_CORE_DLL`, `PULSE_CORE_EXE`.

---

## Сборка C++-части

```bat
:: Скачать исходники ядра, собрать их и положить DLL в PulseCorein
fetch-core.cmd

:: N-API мост под Electron (нужен только для нативного маршрута)
npm run build:core

:: Хост-процесс для DLL ядра (нужен для маршрута child_process)
cmake -S PulseCore\host -B PulseCore\host\build
cmake --build PulseCore\host\build --config Release

::    либо одной командой MSVC:
::    cl /std:c++17 /O2 /EHsc /Fe:PulseCore\bin\PulseCore.exe PulseCore\host\pulse_core_host.cpp
```

Без этих артефактов приложение всё равно работает: **Attach** подключается к уже запущенному
ядру, а **Execute** при отсутствии ядра использует локальный Lua.

---

## Быстрый старт (разработка)

```bash
git clone https://github.com/youdeli1292-debug/Pulse.git
cd Pulse
npm install
npm start
```

---

## Компиляция в готовый .exe (Windows)

**Одна команда** (PowerShell или CMD, из папки проекта):

```bat
build.cmd
```

Она сама ставит зависимости, собирает нативный мост к ядру (если установлен
Visual Studio) и пакует portable-файл:

```
dist\Pulse-1.0.0-x64-portable.exe
```

То же самое по шагам, если prefer ручной режим:

```bat
npm install
npm run dist
```

Дополнительные варианты:

```bat
:: сначала нативный мост к ядру, затем portable-сборка
npm run build:core && npm run dist

:: x64 + x86
npm run dist:win

:: только x64
npm run dist:win64

:: быстрая проверка без упаковки (содержимое app-папки)
npm run dist:dir

:: скачать и собрать само C++-ядро
fetch-core.cmd
```

На macOS / Linux portable-сборка Windows тоже работает, но для подписи понадобятся `wine` и
`winCodeSign`; проще всего собирать на Windows.

### Что получается на выходе

```
dist/
└── Pulse-1.0.0-x64-portable.exe   ← один самодостаточный файл, установка не требуется
```

Рядом с `app.asar` electron-builder кладёт `resources/PulseCore/` — туда попадают
`PulseCore/bin/*` и собранный `pulse_core.node`, поэтому portable-версия подхватывает ядро
без дополнительных действий.

---

## Горячие клавиши

| Клавиши | Действие |
| --- | --- |
| `Ctrl` + `Enter` | Execute — отправить Lua-буфер в ядро / запустить локально |
| `Ctrl` + `K` | Clear — очистить редактор |
| `Ctrl` + `B` | Attach / Detach |
| `Ctrl` + `H` | показать / скрыть Script Hub |
| `Ctrl` + `O` | Open File |
| `Ctrl` + `S` | Save |
| `Ctrl` + `Shift` + `C` | Stop — прервать локальный запуск |
| `F12` | DevTools |

Кнопки панели управления: **Execute**, **Clear**, **Attach**, **Open File**, **Script Hub**.

---

## Локальный Lua

Если ядро не подключено, **Execute** запускает буфер через найденный интерпретатор
(`lua`, `luajit`, `lua5.4` … `lua5.1`): результат, код возврата и время выполнения
показываются во всплывающей панели. Если интерпретатор не найден, скрипты можно
редактировать и загружать из Script Hub, а при запуске вы увидите
`Lua interpreter not found`.

Скрипты из Script Hub — обычный Lua-код, рассчитанный на Roblox-окружение
(`game:GetService(...)`, `RunService`, `UserInputService`).

---

## IPC-каналы (main ⇄ renderer)

| Канал | Назначение |
| --- | --- |
| `pulse:app-info` | версии, платформа, путь к Monaco |
| `pulse:core-info` | путь к ядру, доступность, режим, клиенты, последняя ошибка |
| `pulse:attach` / `pulse:detach` | подключение к C++-ядру (FFI / `child_process` / внешнее ядро) и отключение |
| `pulse:core-clients` | запросить список клиентов ядра |
| `pulse:core-compilable` | проверка синтаксиса Luau средствами ядра |
| `pulse:execute` | выполнение: ядро, если подключено, иначе локальный Lua |
| `pulse:run` / `pulse:cancel` | локальный запуск Lua-буфера или `.lua`-файла, отмена |
| `pulse:list-runners` | наличие Lua-интерпретатора |
| `pulse:open-file` / `pulse:read-file` / `pulse:save-file` | работа с файлами |
| `pulse:window-minimize` / `toggle-maximize` / `close` | управление безрамочным окном |

События от главного процесса: `pulse:attach-status`, `pulse:clients`, `pulse:run-output`,
`pulse:window-state`.

Рендерер работает с `contextIsolation: true` и `nodeIntegration: false` — весь привилегированный
код живёт в `main.js`.

---

## Лицензия

MIT © youdeli1292

Исходники C++-ядра в этот репозиторий не входят: `fetch-core.cmd` скачивает их
в `PulseCore/core` во время сборки — см. [`PulseCore/README.md`](PulseCore/README.md).
