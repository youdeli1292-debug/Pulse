# Pulse

**Pulse** — безрамочный desktop-редактор кода и менеджер расширений в стиле Dark Cyberpunk:
ядро **Monaco Editor**, запуск скриптов одной клавишей (Node.js / Python / PowerShell / CMD / Bash),
встроенные системные утилиты и живой мост **Attach / Connect** (TCP, процесс по PID, probe порта,
локальный echo-bridge).

Промо-сайт лежит в [`site/`](site/) и может хоститься как статика (GitHub Pages публикует `site/`
«как есть», без сборки).

---

## Содержимое репозитория

| Путь | Назначение |
| --- | --- |
| `package.json` | манифест, зависимости (`electron`, `electron-builder`, `monaco-editor`), конфиг `build` (Windows → `portable`, иконка `icon_pulse.ico`), скрипт `"dist": "electron-builder"` |
| `main.js` | главный процесс Electron: безрамочное окно **800 × 500**, IPC-каналы `pulse:*` (запуск скриптов, системные утилиты, файлы, attach-мост) |
| `src/preload.js` | `contextBridge` — единственный безопасный мост между UI и Node API |
| `src/index.html` | разметка редактора: кастомный titlebar, сайдбар, вкладки, консоль, статусбар |
| `src/ui.css` | Dark Cyberpunk тема (неоновый фиолетовый `#a855f7` + циан) |
| `src/ui.js` | загрузка Monaco (офлайн, из `node_modules`) + встроенный резервный редактор, табы, консоль, выполнение кода, attach-панель |
| `site/` | лендинг: `index.html`, `assets/style.css`, `assets/app.js`, `assets/og-image.png` |
| `icon_pulse.ico` | иконка приложения (256/128/64/48/32/16) |
| `assets/` | исходники изображений |
| `docs/ci/` | готовые GitHub Actions: сборка portable-exe и публикация сайта (см. `docs/ci/README.md`) |

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

На macOS / Linux portable-сборка Windows тоже работает, но для подписи
понадобятся `wine` и `winCodeSign`; проще всего собирать на Windows.

### Что получается на выходе

```
dist/
└── Pulse-1.0.0-x64-portable.exe   ← один самодостаточный файл, установка не требуется
```

---

## Горячие клавиши в приложении

| Клавиши | Действие |
| --- | --- |
| `Ctrl` + `Enter` | Execute — выполнить буфер выбранным интерпретатором |
| `Ctrl` + `O` | Open File |
| `Ctrl` + `S` | Save |
| `Ctrl` + `K` | Clear — очистить редактор |
| `Ctrl` + `L` | очистить консоль |
| `Ctrl` + `B` | панель Attach / Connect |
| `Ctrl` + `Shift` + `C` | Stop — прервать выполнение |
| `F12` | DevTools |

Кнопки сайдбара: **Execute**, **Clear**, **Attach / Connect**, **Open File** (+ Save).

---

## IPC-каналы (main ⇄ renderer)

| Канал | Назначение |
| --- | --- |
| `pulse:app-info` | версии, платформа, путь к Monaco, рабочая папка |
| `pulse:run` / `pulse:run-utility` | выполнение кода и системных утилит (`ipconfig`, `tasklist`, `ping`, `netstat`, `whoami`, …) |
| `pulse:cancel` | остановка запущенного процесса |
| `pulse:open-file` / `pulse:read-file` / `pulse:save-file` / `pulse:list-workspace` | работа с файлами |
| `pulse:attach` / `pulse:attach-send` / `pulse:detach` / `pulse:probe` | мост подключения (TCP / PID) |
| `pulse:start-bridge` / `pulse:stop-bridge` | локальный TCP echo-сервер |
| `pulse:window-minimize` / `toggle-maximize` / `close` | управление безрамочным окном |

Рендерер работает с `contextIsolation: true` и `nodeIntegration: false` — весь привилегированный
код живёт в `main.js`.

---

## Лицензия

MIT © youdeli1292
