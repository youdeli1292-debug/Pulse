# Pulse

**Pulse** — безрамочный Lua-экзекутор для Roblox в стиле Dark Cyberpunk: ядро **Monaco Editor**,
жёстко настроенное на синтаксис **Lua**, запуск скрипта одной клавишей, встроенный **Script Hub**
с готовыми скриптами и тонкий статус-бар с индикатором `Status: Not Attached` / `Status: Attached`.

Промо-сайт лежит в [`site/`](site/) и публикуется как статика (GitHub Pages отдаёт `site/`
без сборки).

---

## Содержимое репозитория

| Путь | Назначение |
| --- | --- |
| `package.json` | манифест, зависимости (`electron`, `electron-builder`, `monaco-editor`), конфиг `build` (Windows → `portable`, иконка `icon_pulse.ico`), скрипт `"dist": "electron-builder"` |
| `main.js` | главный процесс Electron: безрамочное окно **800 × 500**, IPC-каналы `pulse:*` — Lua-раннер (автопоиск `lua` / `luajit`), поиск процесса Roblox, attach по PID, файлы, окно |
| `src/preload.js` | `contextBridge` — единственный безопасный мост между UI и Node API |
| `src/index.html` | разметка: кастомный titlebar, сайдбар, редактор, Script Hub, статус-бар |
| `src/ui.css` | Dark Cyberpunk тема (неоновый фиолетовый `#a855f7` + циан), плотная монолитная вёрстка |
| `src/ui.js` | Monaco (только Lua) + резервный редактор с Lua-подсветкой, кнопки, Script Hub (7 скриптов), статус-бар, выполнение кода |
| `site/` | лендинг: `index.html`, `assets/style.css`, `assets/app.js`, `assets/og-image.jpg` |
| `icon_pulse.ico` | иконка приложения (256/128/64/48/32/16) |
| `docs/ci/` | готовые GitHub Actions: сборка portable-exe и публикация сайта |

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
│ ⤓ Save     │                                  │ ▸ ESP                │
│ ❯❯ Script  │                                  │ ▸ SpeedHack          │
│    Hub     │                                  │ ▸ Infinite Yield     │
│            │                                  │ ▸ Noclip / Anti-AFK  │
├────────────┴──────────────────────────────────┴──────────────────────┤
│ Status: Not Attached   ready              Ln 12, Col 4   lua   monaco │
└──────────────────────────────────────────────────────────────────────┘
```

- **Lua только.** Выпадающего списка языков нет: Monaco и резервный редактор всегда работают
  в режиме `lua`, подсветка рассчитана на Lua-синтаксис.
- **Script Hub** (справа) — 7 готовых скриптов: Fly Script, AimBot, ESP, SpeedHack,
  Infinite Yield, Noclip, Anti-AFK. Клик по названию загружает код в редактор, поле поиска
  фильтрует список, кнопка ❯❯ / `Ctrl+H` скрывает и показывает панель.
- **Статус-бар** внизу: слева бейдж `Status: Not Attached` (красный) или `Status: Attached`
  (зелёный) — переключается кнопкой **Attach**. Attach ищет процесс Roblox
  (`tasklist` в Windows, `ps` в Unix), привязывается к его PID и следит за ним: как только игра
  закроется, бейдж снова станет красным.
- **Вывод выполнения** показывается во всплывающей панели над редактором (код возврата,
  время, stdout/stderr) — постоянной консоли в интерфейсе нет.

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

Все команды выполняются в **PowerShell** или **CMD** из папки проекта.

```bat
:: 1. Установить зависимости (один раз)
npm install

:: 2. Собрать portable-файл Windows (x64)
npm run dist

::   Готовый файл:  dist\Pulse-1.0.0-x64-portable.exe
```

Дополнительные варианты:

```bat
:: x64 + x86
npm run dist:win

:: только x64
npm run dist:win64

:: быстрая проверка без упаковки (содержимое app-папки)
npm run dist:dir
```

На macOS / Linux portable-сборка Windows тоже работает, но для подписи понадобятся `wine` и
`winCodeSign`; проще всего собирать на Windows.

### Что получается на выходе

```
dist/
└── Pulse-1.0.0-x64-portable.exe   ← один самодостаточный файл, установка не требуется
```

---

## Горячие клавиши

| Клавиши | Действие |
| --- | --- |
| `Ctrl` + `Enter` | Execute — выполнить Lua-буфер |
| `Ctrl` + `K` | Clear — очистить редактор |
| `Ctrl` + `B` | Attach / Detach |
| `Ctrl` + `H` | показать / скрыть Script Hub |
| `Ctrl` + `O` | Open File |
| `Ctrl` + `S` | Save |
| `Ctrl` + `Shift` + `C` | Stop — прервать выполнение |
| `F12` | DevTools |

Кнопки сайдбара: **Execute**, **Clear**, **Attach**, **Open File**, **Save**, **Script Hub**.

---

## Выполнение Lua

При запуске Pulse ищет интерпретатор (`lua`, `luajit`, `lua5.4` … `lua5.1`) и показывает
результат в сайдбаре (`lua: ready` / `lua: not found`). Если интерпретатор не найден, скрипты
можно редактировать и загружать из Script Hub, но при запуске вы увидите
`Lua interpreter not found`.

Скрипт из Script Hub — это обычный Lua-код, его можно запустить локально (например,
`print`-вызовы) или вставить в свой исполнитель внутри Roblox.

---

## IPC-каналы (main ⇄ renderer)

| Канал | Назначение |
| --- | --- |
| `pulse:app-info` | версии, платформа, путь к Monaco |
| `pulse:list-runners` | наличие Lua-интерпретатора |
| `pulse:run` / `pulse:cancel` | выполнение Lua-буфера или `.lua`-файла, отмена |
| `pulse:find-roblox` | поиск процесса Roblox → список PID |
| `pulse:attach` / `pulse:detach` | привязка к PID и отключение |
| `pulse:open-file` / `pulse:read-file` / `pulse:save-file` | работа с файлами |
| `pulse:window-minimize` / `toggle-maximize` / `close` | управление безрамочным окном |

Рендерер работает с `contextIsolation: true` и `nodeIntegration: false` — весь привилегированный
код живёт в `main.js`.

---

## Лицензия

MIT © youdeli1292
