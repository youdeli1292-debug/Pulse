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
        'Pulse is a frameless desktop code editor with a Monaco core, one-keystroke script execution and a live attach bridge to any process or TCP endpoint. Dark cyberpunk UI, zero setup, single portable executable.',
      'hero.download': 'Download Pulse',
      'hero.allreleases': 'All releases',
      'hero.meta1': 'portable .exe',
      'hero.meta2': 'x64 · no admin rights',
      'hero.meta3': 'license',

      'feat.title': "Everything you need. Nothing you don't.",
      'feat.lead': 'Pulse ships as one portable executable: no installers, no registry, no admin rights.',
      'feat.fast.title': 'Fast Execution',
      'feat.fast.text':
        'Ctrl+Enter sends the buffer to Node.js, Python, PowerShell, CMD or Bash and streams stdout / stderr straight into the console with timestamps and exit codes. Long runs can be cancelled at any moment.',
      'feat.fast.l1': 'live output streaming',
      'feat.fast.l2': 'exit code + duration report',
      'feat.fast.l3': 'one-click system utilities',
      'feat.ui.title': 'Custom UI',
      'feat.ui.text':
        'A fully frameless 800 × 500 neon-violet shell drawn by hand: custom title bar, drag region, window controls, tabs, gutter, scanline overlay and a dark cyberpunk palette that stays readable for hours.',
      'feat.ui.l1': 'frameless window + custom chrome',
      'feat.ui.l2': 'tabs, workspace explorer, status bar',
      'feat.ui.l3': 'Attach / Connect side panel',
      'feat.monaco.title': 'Monaco Editor Integration',
      'feat.monaco.text':
        'The same editor engine that powers VS Code: syntax highlighting for 10+ languages, bracket colourisation, suggestions, multi-cursor and a custom pulse-cyber theme — bundled offline inside the app.',
      'feat.monaco.l1': 'offline AMD bundle, no CDN',
      'feat.monaco.l2': 'custom neon theme & ligatures',
      'feat.monaco.l3': 'built-in fallback editor',
      'feat.attach.title': 'Attach Bridge',
      'feat.attach.text':
        'Connect the editor to any TCP endpoint, watch a running process by PID, probe a port or spin up a local echo bridge — the traffic lands in the console in real time.',
      'feat.attach.l1': 'TCP client with raw / hex send',
      'feat.attach.l2': 'PID watcher (tasklist / ps)',
      'feat.attach.l3': 'port probe with RTT',
      'feat.files.title': 'Files & Workspace',
      'feat.files.text':
        'Open several files at once, keep them in tabs, save back to disk or into the Pulse workspace folder, and jump between scripts straight from the sidebar.',
      'feat.files.l1': 'multi-tab editing',
      'feat.files.l2': 'language auto-detection',
      'feat.files.l3': 'workspace file list',
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
        'Press Ctrl+Enter to execute the buffer with the selected runner, Ctrl+O to open a file and Ctrl+B to open the Attach / Connect panel.',

      'keys.run': 'Execute',
      'keys.open': 'Open file',
      'keys.save': 'Save',
      'keys.clear': 'Clear buffer',
      'keys.attach': 'Attach panel',
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
      'faq.q2': 'Which interpreters are supported?',
      'faq.a2':
        'Node.js is bundled with the app. Python, PowerShell, CMD and Bash are detected on your system at startup; missing runners are simply marked as unavailable.',
      'faq.q3': 'Does Pulse need an internet connection?',
      'faq.a3':
        'No. The Monaco bundle, fonts and theme are packaged inside the executable; nothing is loaded from a CDN at runtime.',
      'faq.q4': 'What is the Attach / Connect panel for?',
      'faq.a4':
        'It turns Pulse into a small network client: connect to any TCP endpoint, send text, code or hex payloads, watch a local process by PID, probe a port or start a local echo bridge for testing.',
      'faq.q5': 'Monaco did not load — now what?',
      'faq.a5':
        'Pulse falls back to its own editor with line numbers and syntax highlighting, so the app stays usable. Check the console tab for the exact reason.',

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
        'Pulse — безрамочный редактор кода с ядром Monaco, запуском скриптов одной клавишей и живым мостом подключения к любому процессу или TCP-порту. Тёмный киберпанк-интерфейс, ноль настроек, один portable-файл.',
      'hero.download': 'Скачать Pulse',
      'hero.allreleases': 'Все релизы',
      'hero.meta1': 'portable .exe',
      'hero.meta2': 'x64 · без прав администратора',
      'hero.meta3': 'лицензия',

      'feat.title': 'Всё необходимое — и ничего лишнего.',
      'feat.lead': 'Pulse поставляется одним portable-файлом: без инсталляторов, без реестра, без прав администратора.',
      'feat.fast.title': 'Мгновенный запуск',
      'feat.fast.text':
        'Ctrl+Enter отправляет код в Node.js, Python, PowerShell, CMD или Bash и потоком выводит stdout / stderr в консоль с метками времени и кодом возврата. Долгий процесс можно прервать в любой момент.',
      'feat.fast.l1': 'потоковый вывод в реальном времени',
      'feat.fast.l2': 'код возврата и время выполнения',
      'feat.fast.l3': 'системные утилиты в один клик',
      'feat.ui.title': 'Свой интерфейс',
      'feat.ui.text':
        'Полностью безрамочное окно 800 × 500 с неоново-фиолетовой оболочкой, нарисованной вручную: свой заголовок, зона перетаскивания, кнопки окна, вкладки, нумерация строк, эффект скан-линий и тёмная киберпанк-палитра, от которой не устают глаза.',
      'feat.ui.l1': 'безрамочное окно со своей оболочкой',
      'feat.ui.l2': 'вкладки, проводник, строка статуса',
      'feat.ui.l3': 'панель Attach / Connect',
      'feat.monaco.title': 'Интеграция Monaco Editor',
      'feat.monaco.text':
        'Тот же движок, что и в VS Code: подсветка синтаксиса для 10+ языков, цветная парная подсветка скобок, автодополнение, мультикурсор и собственная тема pulse-cyber — всё офлайн, внутри приложения.',
      'feat.monaco.l1': 'офлайн-сборка без CDN',
      'feat.monaco.l2': 'неоновая тема и лигатуры',
      'feat.monaco.l3': 'встроенный резервный редактор',
      'feat.attach.title': 'Мост подключения',
      'feat.attach.text':
        'Подключите редактор к любому TCP-узлу, следите за процессом по PID, проверьте порт или поднимите локальный echo-мост — весь трафик сразу попадает в консоль.',
      'feat.attach.l1': 'TCP-клиент с отправкой текста и hex',
      'feat.attach.l2': 'наблюдение за PID (tasklist / ps)',
      'feat.attach.l3': 'проверка порта с замером RTT',
      'feat.files.title': 'Файлы и рабочая папка',
      'feat.files.text':
        'Открывайте несколько файлов одновременно во вкладках, сохраняйте их обратно на диск или в рабочую папку Pulse и переключайтесь между скриптами прямо из сайдбара.',
      'feat.files.l1': 'редактирование во вкладках',
      'feat.files.l2': 'автоопределение языка',
      'feat.files.l3': 'список файлов рабочей папки',
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
        'Нажмите Ctrl+Enter, чтобы выполнить код выбранным интерпретатором, Ctrl+O — чтобы открыть файл, Ctrl+B — чтобы открыть панель Attach / Connect.',

      'keys.run': 'Выполнить',
      'keys.open': 'Открыть файл',
      'keys.save': 'Сохранить',
      'keys.clear': 'Очистить',
      'keys.attach': 'Подключение',
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
      'faq.q2': 'Какие интерпретаторы поддерживаются?',
      'faq.a2':
        'Node.js встроен в приложение. Python, PowerShell, CMD и Bash определяются в вашей системе при запуске; отсутствующие просто помечаются как недоступные.',
      'faq.q3': 'Нужен ли интернет?',
      'faq.a3':
        'Нет. Сборка Monaco, шрифты и тема упакованы внутрь исполняемого файла — ничего не загружается из CDN во время работы.',
      'faq.q4': 'Зачем панель Attach / Connect?',
      'faq.a4':
        'Она превращает Pulse в миниатюрного сетевого клиента: подключение к любому TCP-узлу, отправка текста, кода или hex-пакетов, наблюдение за процессом по PID, проверка порта и локальный echo-мост для тестов.',
      'faq.q5': 'Monaco не загрузился — что делать?',
      'faq.a5':
        'Pulse автоматически переключится на собственный редактор с номерами строк и подсветкой, приложение останется рабочим. Точную причину видно во вкладке консоли.',

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
