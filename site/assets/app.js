/* =========================================================================
   Pulse — promo site behaviour
   • RU / EN switcher (fully translated, choice kept in localStorage)
   • "copy" buttons for the build commands
   • subtle reveal-on-scroll + active nav highlight
   ========================================================================= */

(function () {
  'use strict';

  const DICT = {
    en: {
      'nav.features': 'Features',
      'nav.preview': 'Preview',
      'nav.install': 'Install',
      'nav.faq': 'FAQ',

      'hero.tag': 'v1.0.0 · Windows portable · open source',
      'hero.title1': 'Code at the speed',
      'hero.title2': 'of a heartbeat',
      'hero.lead':
        'Pulse is a frameless Lua executor for Roblox built around the Xeno C++ core: Monaco locked to Lua syntax, one-keystroke execution straight into the game, a built-in Script Hub of ready-to-run scripts and a live status bar that shows whether the core is attached.',
      'hero.download': 'Download Pulse',
      'hero.allreleases': 'All releases',
      'hero.meta1': 'portable .exe',
      'hero.meta2': 'x64 · no admin rights',
      'hero.meta3': 'license',

      'feat.title': "Everything you need. Nothing you don't.",
      'feat.lead': 'Pulse ships as one portable executable: no installers, no registry, no admin rights.',
      'feat.fast.title': 'Fast Execution',
      'feat.fast.text':
        'Ctrl+Enter sends the Lua buffer to the interpreter and returns the result, the exit code and the elapsed time. Output lands in a floating panel over the editor, and a long script can be cancelled at any moment.',
      'feat.fast.l1': 'lua / luajit auto-detection',
      'feat.fast.l2': 'exit code + duration report',
      'feat.fast.l3': 'floating output panel',
      'feat.ui.title': 'Custom UI',
      'feat.ui.text':
        'A fully frameless 800 × 500 neon-violet shell drawn by hand: custom title bar, drag region, window controls, tabs, gutter, scanline overlay and a compact two-pane layout with no empty space.',
      'feat.ui.l1': 'frameless window + custom chrome',
      'feat.ui.l2': 'editor + Script Hub side by side',
      'feat.ui.l3': 'slim status bar at the bottom',
      'feat.monaco.title': 'Monaco Editor Integration',
      'feat.monaco.text':
        'The same editor engine that powers VS Code, permanently locked to Lua: highlighting, bracket colourisation, suggestions, multi-cursor and a custom pulse-cyber theme — bundled offline inside the app.',
      'feat.monaco.l1': 'Lua syntax, hardcoded',
      'feat.monaco.l2': 'custom neon theme & ligatures',
      'feat.monaco.l3': 'built-in fallback editor',
      'feat.attach.title': 'Attach & Status',
      'feat.attach.text':
        'Press Attach and Pulse boots the Xeno C++ core: it loads Xeno.dll straight into the app (N-API FFI), or spawns PulseCore.exe with child_process, or binds to a core that is already running on port 19283. The status bar flips to a green "Status: Attached" and turns red the moment the core goes away.',
      'feat.attach.l1': 'Xeno.dll loaded in-process (N-API FFI)',
      'feat.attach.l2': 'PulseCore.exe / Xeno.exe via child_process',
      'feat.attach.l3': 'green / red status badge',
      'feat.hub.title': 'Script Hub',
      'feat.hub.text': 'A built-in catalogue of ready-to-run Lua scripts - Fly, AimBot, ESP, SpeedHack, Infinite Yield, Noclip, Anti-AFK. One click loads the source straight into the editor, and the search box filters the list instantly.',
      'feat.hub.l1': '7 scripts out of the box',
      'feat.hub.l2': 'one click, straight into the editor',
      'feat.hub.l3': 'instant search + hideable panel',
      'feat.secure.title': 'Safe by Design',
      'feat.secure.text':
        'The renderer runs with context isolation and without Node integration. Every privileged action travels through an explicit IPC channel, and interpreters are launched without a shell, so nothing can be injected into your system.',
      'feat.secure.l1': 'contextIsolation + preload bridge',
      'feat.secure.l2': 'no shell string interpolation',
      'feat.secure.l3': 'whitelisted system utilities',

      'inst.title': 'Installation',
      'inst.lead': 'Three steps, about a minute, nothing to configure.',
      'inst.s1.title': 'Download the portable build',
      'inst.s1.text':
        'Grab Pulse-1.0.0-x64-portable.exe from the releases page. It is a single self-contained file — Pulse leaves no traces in the registry.',
      'inst.s2.title': 'Put it anywhere and run it',
      'inst.s2.text':
        'Copy the .exe to a folder you own (Desktop, D:\\Tools, a USB stick) and double-click it. Windows SmartScreen may ask for confirmation on the very first launch — press More info → Run anyway.',
      'inst.s3.title': 'Run your first script',
      'inst.s3.text':
        'Press Ctrl+Enter to execute the Lua buffer, Ctrl+H to open the Script Hub, pick a script — and Ctrl+B to attach the Xeno core.',

      'keys.run': 'Execute',
      'keys.open': 'Open file',
      'keys.save': 'Save',
      'keys.clear': 'Clear buffer',
      'keys.attach': 'Attach / Detach',
      'keys.hub': 'Script Hub',
      'keys.devtools': 'DevTools',

      'inst.build.title': 'Building from source',
      'inst.build.text': 'Node.js 18+ is required. Clone the repository and run:',
      'inst.build.hint': 'The finished portable executable appears in dist/.',
      'ui.copy': 'copy',
      'ui.copied': 'copied!',

      'faq.title': 'FAQ',
      'faq.q1': 'Do I need admin rights to run Pulse?',
      'faq.a1':
        'No. The portable build requests the normal user level and writes only inside your user profile (%APPDATA%\\pulse\\workspace).',
      'faq.q2': 'Which interpreter runs the scripts?',
      'faq.a2':
        'Pulse looks for lua / luajit on your system at startup and shows the result in the sidebar. Without an interpreter you can still edit and load scripts — execution simply reports "Lua interpreter not found".',
      'faq.q3': 'Does Pulse need an internet connection?',
      'faq.a3':
        'No. The Monaco bundle, fonts and theme are packaged inside the executable; nothing is loaded from a CDN at runtime.',
      'faq.q4': 'How does Attach work?',
      'faq.a4':
        'Attach tries three routes: the compiled Xeno.dll is loaded straight into the app through the Node-API bridge, otherwise PulseCore.exe is launched with child_process, otherwise Pulse binds to a core that already listens on 127.0.0.1:19283. Clients are reported by the core itself, and the status bar switches between "Status: Not Attached" (red) and "Status: Attached" (green).',
      'faq.q5': 'Monaco did not load — now what?',
      'faq.a5':
        'Pulse falls back to its own editor with line numbers and syntax highlighting, so the app stays usable. Check the console tab for the exact reason.',
      'faq.q6': 'What is inside the Script Hub?',
      'faq.a6': 'Seven commented Lua templates built only on the documented Roblox API - movement, visuals and an admin command bar. They are meant for your own places and private servers: no network calls, no data collection, every effect is reversible.',

      'footer.note': 'Built with Electron, Monaco and a lot of neon. MIT licensed.',
    },

    ru: {
      'nav.features': 'Возможности',
      'nav.preview': 'Интерфейс',
      'nav.install': 'Установка',
      'nav.faq': 'FAQ',

      'hero.tag': 'v1.0.0 · portable для Windows · открытый исходный код',
      'hero.title1': 'Пиши код со скоростью',
      'hero.title2': 'сердечного ритма',
      'hero.lead':
        'Pulse — безрамочный Lua-экзекутор для Roblox на базе C++-ядра Xeno: редактор Monaco, жёстко настроенный на синтаксис Lua, отправка скрипта в игру одной клавишей, встроенный Script Hub с готовыми скриптами и статус-бар, который показывает, подключено ли ядро.',
      'hero.download': 'Скачать Pulse',
      'hero.allreleases': 'Все релизы',
      'hero.meta1': 'portable .exe',
      'hero.meta2': 'x64 · без прав администратора',
      'hero.meta3': 'лицензия',

      'feat.title': 'Всё необходимое — и ничего лишнего.',
      'feat.lead': 'Pulse поставляется одним portable-файлом: без инсталляторов, без реестра, без прав администратора.',
      'feat.fast.title': 'Мгновенный запуск',
      'feat.fast.text':
        'Ctrl+Enter отправляет Lua-код интерпретатору и возвращает вывод, код возврата и время выполнения. Результат появляется в компактной панели над редактором, а длинный скрипт можно прервать в любой момент.',
      'feat.fast.l1': 'автоопределение lua / luajit',
      'feat.fast.l2': 'код возврата и время выполнения',
      'feat.fast.l3': 'всплывающая панель вывода',
      'feat.ui.title': 'Свой интерфейс',
      'feat.ui.text':
        'Полностью безрамочное окно 800 × 500 с неоново-фиолетовой оболочкой: свой заголовок, зона перетаскивания, кнопки окна, вкладки, нумерация строк, эффект скан-линий и плотная компоновка из двух панелей без пустых зон.',
      'feat.ui.l1': 'безрамочное окно со своей оболочкой',
      'feat.ui.l2': 'редактор и Script Hub рядом',
      'feat.ui.l3': 'тонкий статус-бар внизу',
      'feat.monaco.title': 'Интеграция Monaco Editor',
      'feat.monaco.text':
        'Тот же движок, что и в VS Code, навсегда закреплённый за Lua: подсветка, цветные скобки, автодополнение, мультикурсор и собственная тема pulse-cyber — всё офлайн, внутри приложения.',
      'feat.monaco.l1': 'синтаксис Lua, без переключателей',
      'feat.monaco.l2': 'неоновая тема и лигатуры',
      'feat.monaco.l3': 'встроенный резервный редактор',
      'feat.attach.title': 'Attach и статус',
      'feat.attach.text':
        'Нажмите Attach — и Pulse поднимет C++-ядро Xeno: загрузит Xeno.dll прямо в приложение (N-API FFI), либо запустит PulseCore.exe через child_process, либо подключится к уже работающему ядру на порту 19283. Статус-бар станет зелёным «Status: Attached» и снова покраснеет, как только ядро отключится.',
      'feat.attach.l1': 'Xeno.dll загружается в процесс (N-API FFI)',
      'feat.attach.l2': 'PulseCore.exe / Xeno.exe через child_process',
      'feat.attach.l3': 'зелёный / красный индикатор',
      'feat.hub.title': 'Script Hub',
      'feat.hub.text': 'Встроенный каталог готовых Lua-скриптов - Fly, AimBot, ESP, SpeedHack, Infinite Yield, Noclip, Anti-AFK. Один клик загружает исходник прямо в редактор, а строка поиска мгновенно фильтрует список.',
      'feat.hub.l1': '7 скриптов из коробки',
      'feat.hub.l2': 'один клик - и код в редакторе',
      'feat.hub.l3': 'быстрый поиск и скрытие панели',
      'feat.secure.title': 'Безопасность по дизайну',
      'feat.secure.text':
        'Рендерер работает с изоляцией контекста и без Node-интеграции. Любое привилегированное действие идёт через явный IPC-канал, а интерпретаторы запускаются без оболочки, поэтому внедрить команду в систему невозможно.',
      'feat.secure.l1': 'contextIsolation + preload-мост',
      'feat.secure.l2': 'без подстановки строк в shell',
      'feat.secure.l3': 'системные утилиты по списку',

      'inst.title': 'Установка',
      'inst.lead': 'Три шага, примерно минута, ничего настраивать не нужно.',
      'inst.s1.title': 'Скачайте portable-сборку',
      'inst.s1.text':
        'Возьмите Pulse-1.0.0-x64-portable.exe на странице релизов. Это один самодостаточный файл — Pulse не оставляет следов в реестре.',
      'inst.s2.title': 'Положите куда удобно и запустите',
      'inst.s2.text':
        'Скопируйте .exe в любую свою папку (рабочий стол, D:\\Tools, флешку) и дважды щёлкните. При первом запуске Windows SmartScreen может спросить подтверждение — нажмите «Подробнее → Выполнить в любом случае».',
      'inst.s3.title': 'Запустите первый скрипт',
      'inst.s3.text':
        'Нажмите Ctrl+Enter, чтобы выполнить Lua-код, Ctrl+H — чтобы открыть Script Hub и выбрать скрипт, Ctrl+B — чтобы подключить ядро Xeno.',

      'keys.run': 'Выполнить',
      'keys.open': 'Открыть файл',
      'keys.save': 'Сохранить',
      'keys.clear': 'Очистить',
      'keys.attach': 'Attach / Detach',
      'keys.hub': 'Script Hub',
      'keys.devtools': 'DevTools',

      'inst.build.title': 'Сборка из исходников',
      'inst.build.text': 'Нужен Node.js 18+. Клонируйте репозиторий и выполните:',
      'inst.build.hint': 'Готовый portable-файл появится в папке dist/.',
      'ui.copy': 'копировать',
      'ui.copied': 'готово!',

      'faq.title': 'Частые вопросы',
      'faq.q1': 'Нужны ли права администратора?',
      'faq.a1':
        'Нет. Portable-сборка работает на уровне обычного пользователя и пишет данные только в ваш профиль (%APPDATA%\\pulse\\workspace).',
      'faq.q2': 'Какой интерпретатор выполняет скрипты?',
      'faq.a2':
        'При запуске Pulse ищет lua / luajit в системе и показывает результат в сайдбаре. Без интерпретатора можно редактировать и загружать скрипты — при запуске вы просто увидите «Lua interpreter not found».',
      'faq.q3': 'Нужен ли интернет?',
      'faq.a3':
        'Нет. Сборка Monaco, шрифты и тема упакованы внутрь исполняемого файла — ничего не загружается из CDN во время работы.',
      'faq.q4': 'Как работает Attach?',
      'faq.a4':
        'Attach пробует три маршрута: скомпилированная Xeno.dll загружается в приложение через Node-API мост, иначе запускается PulseCore.exe через child_process, иначе Pulse подключается к ядру, которое уже слушает 127.0.0.1:19283. Клиентов сообщает само ядро, а статус-бар переключается между «Status: Not Attached» (красный) и «Status: Attached» (зелёный).',
      'faq.q5': 'Monaco не загрузился — что делать?',
      'faq.a5':
        'Pulse автоматически переключится на собственный редактор с номерами строк и подсветкой, приложение останется рабочим. Точную причину видно во вкладке консоли.',
      'faq.q6': 'Что находится в Script Hub?',
      'faq.a6': 'Семь прокомментированных Lua-шаблонов, собранных только на документированном API Roblox: движение, визуал и админ-панель команд. Они предназначены для ваших собственных мест и приватных серверов: без сетевых вызовов, без сбора данных, любой эффект обратим.',

      'footer.note': 'Сделано на Electron, Monaco и большом количестве неона. Лицензия MIT.',
    },
  };

  const STORAGE_KEY = 'pulse-site-lang';

  function currentLang() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && DICT[saved]) return saved;
    const nav = (navigator.language || 'en').toLowerCase();
    return nav.startsWith('ru') ? 'ru' : 'en';
  }

  function applyLang(lang) {
    const table = DICT[lang] || DICT.en;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (table[key] !== undefined) el.textContent = table[key];
    });
    document.documentElement.lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    const label = document.getElementById('lang-label');
    if (label) label.textContent = lang === 'en' ? 'RU' : 'EN';
  }

  // -------------------------------------------------------------- copy ---
  function bindCopyButtons() {
    document.querySelectorAll('.copy').forEach((button) => {
      button.addEventListener('click', async () => {
        const target = document.getElementById(button.getAttribute('data-copy'));
        if (!target) return;
        const text = target.textContent;
        try {
          await navigator.clipboard.writeText(text);
        } catch (_) {
          const area = document.createElement('textarea');
          area.value = text;
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          area.remove();
        }
        const original = button.textContent;
        const lang = currentLang();
        button.textContent = (DICT[lang] && DICT[lang]['ui.copied']) || 'copied!';
        setTimeout(() => { button.textContent = original; }, 1400);
      });
    });
  }

  // ------------------------------------------------------------ reveal ---
  function bindReveal() {
    const items = document.querySelectorAll('.card, .step, .faq, .window, .build-box');
    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => { el.style.opacity = '1'; });
      return;
    }
    items.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(14px)';
      el.style.transition = 'opacity .5s ease, transform .5s ease';
    });
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'none';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    items.forEach((el) => observer.observe(el));
  }

  // --------------------------------------------------------------- nav ---
  function bindNavHighlight() {
    const links = Array.from(document.querySelectorAll('.nav__links a[href^="#"]'));
    const sections = links
      .map((link) => document.querySelector(link.getAttribute('href')))
      .filter(Boolean);
    if (!sections.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => {
          const active = link.getAttribute('href') === `#${entry.target.id}`;
          link.style.color = active ? '#fff' : '';
          link.style.textShadow = active ? '0 0 14px rgba(168,85,247,.9)' : '';
        });
      });
    }, { threshold: 0.4 });
    sections.forEach((section) => observer.observe(section));
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyLang(currentLang());
    bindCopyButtons();
    bindReveal();
    bindNavHighlight();

    const toggle = document.getElementById('lang-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        applyLang(currentLang() === 'en' ? 'ru' : 'en');
      });
    }
  });
})();
