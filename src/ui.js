/* =========================================================================
   Pulse — renderer (UI logic)
   Works with the real Monaco editor when the AMD bundle is reachable
   (node_modules/monaco-editor, unpacked next to app.asar when packaged) and
   with the built-in Pulse editor otherwise. Both back ends expose the same
   adapter API to the rest of the file.
   ========================================================================= */

'use strict';

/* ------------------------------------------------------------------ state */

const state = {
  tabs: [],
  activeTabId: null,
  runner: 'node',
  runners: [],
  busy: false,
  runId: null,
  attached: false,
  attachMode: null,
  bridge: { running: false, port: null },
  wrap: true,
  appInfo: null,
  engine: 'pulse-core',
};

const $ = (id) => document.getElementById(id);

const dom = {
  tabs: $('tabs'),
  host: $('editor-host'),
  boot: $('editor-boot'),
  fallback: $('pulse-editor'),
  gutter: $('gutter'),
  highlight: $('highlight').querySelector('code'),
  input: $('code'),
  console: $('console'),
  consoleMeta: $('console-meta'),
  runnerSelect: $('runner-select'),
  runnerMeta: $('runner-meta'),
  utilities: $('utilities'),
  filelist: $('filelist'),
  attachPanel: $('attach-panel'),
  statusFile: $('status-file'),
  statusRunner: $('status-runner'),
  appVersion: $('app-version'),
  attachDot: $('attach-dot'),
  attachStatusText: $('attach-status-text'),
  bridgeDot: document.getElementById('bridge-row').querySelector('.dot'),
  bridgeText: $('bridge-text'),
  st: {
    pos: $('st-pos'),
    lang: $('st-lang'),
    engine: $('st-engine'),
    message: $('st-message'),
    mem: $('st-mem'),
    platform: $('st-platform'),
    time: $('st-time'),
  },
};

/* --------------------------------------------------------------- fallback */
/*  Pulse editor: textarea + highlighted overlay + line gutter.             */

const RULES = {
  javascript: [
    { type: 'comment', re: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/` },
    { type: 'string', re: String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\`(?:\\.|[^\\\\\`])*\`` },
    { type: 'number', re: String.raw`\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b` },
    { type: 'keyword', re: String.raw`\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|default|break|continue|new|class|extends|super|this|typeof|instanceof|delete|in|of|try|catch|finally|throw|async|await|import|export|from|as|yield|static|null|undefined|true|false|void|with)\b` },
    { type: 'builtin', re: String.raw`\b(?:console|Math|JSON|Object|Array|String|Number|Boolean|Promise|Date|RegExp|Map|Set|Symbol|process|require|module|exports|globalThis|window|document|Buffer)\b` },
    { type: 'func', re: String.raw`\b[A-Za-z_$][\w$]*(?=\s*\()` },
    { type: 'op', re: String.raw`=>|[+\-*/%=<>!&|^~?:]+` },
  ],
  python: [
    { type: 'comment', re: String.raw`#[^\n]*` },
    { type: 'string', re: String.raw`[rbfu]{0,2}'''(?:\\.|[^\\])*?'''|[rbfu]{0,2}"""(?:\\.|[^\\])*?"""|[rbfu]{0,2}'(?:\\.|[^'\\\n])*'|[rbfu]{0,2}"(?:\\.|[^"\\\n])*"` },
    { type: 'number', re: String.raw`\b\d+(?:\.\d+)?\b` },
    { type: 'keyword', re: String.raw`\b(?:def|class|return|if|elif|else|for|while|break|continue|import|from|as|pass|raise|try|except|finally|with|lambda|yield|global|nonlocal|assert|del|in|is|not|and|or|None|True|False|async|await|self)\b` },
    { type: 'builtin', re: String.raw`\b(?:print|len|range|str|int|float|list|dict|set|tuple|open|enumerate|zip|map|filter|sum|min|max|abs|sorted|type|isinstance|input|json|os|sys|time)\b` },
    { type: 'func', re: String.raw`\b[A-Za-z_][\w]*(?=\s*\()` },
    { type: 'op', re: String.raw`[+\-*/%=<>!&|^~:]+` },
  ],
  powershell: [
    { type: 'comment', re: String.raw`#[^\n]*|<#[\s\S]*?#>` },
    { type: 'string', re: String.raw`"(?:\\.|[^"\\])*"|'(?:[^']*)'` },
    { type: 'keyword', re: String.raw`\b(?:function|param|if|else|elseif|switch|foreach|for|while|do|until|return|break|continue|try|catch|finally|throw|begin|process|end|filter|workflow|class|using|namespace)\b` },
    { type: 'builtin', re: String.raw`(?:Get-\w+|Set-\w+|New-\w+|Write-\w+|Out-\w+|Invoke-\w+|Start-\w+|Stop-\w+|Test-\w+|\$Host|\$env:\w+|\$_\b)` },
    { type: 'number', re: String.raw`\b\d+(?:\.\d+)?\b` },
    { type: 'op', re: String.raw`-[a-zA-Z]+|[|&;]+|[+\-*/%=<>!]+` },
  ],
  bat: [
    { type: 'comment', re: String.raw`^\s*(?:rem|::)[^\n]*` },
    { type: 'keyword', re: String.raw`\b(?:echo|set|if|else|for|in|do|goto|call|exit|start|pause|cls|shift|endlocal|setlocal|pushd|popd|title|type|del|copy|move|md|rd)\b` },
    { type: 'builtin', re: String.raw`%[\w]+%|%%[\w]` },
    { type: 'string', re: String.raw`"(?:[^"]*)"` },
  ],
  markdown: [
    { type: 'keyword', re: '^\\s{0,3}#{1,6}[^\\n]*' },
    { type: 'string', re: '\\[[^\\]]*\\]\\([^)]*\\)' },
    { type: 'builtin', re: '^\\s{0,3}[-*+]\\s[^\\n]*|\\*\\*[^\\*]+\\*\\*' },
  ],
  shell: [
    { type: 'comment', re: String.raw`#[^\n]*` },
    { type: 'string', re: String.raw`"(?:\\.|[^"\\])*"|'[^']*'` },
    { type: 'keyword', re: String.raw`\b(?:if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|export|local|source|echo|cd|set|exit)\b` },
    { type: 'builtin', re: String.raw`\$(?:[\w@#?*!$-]+|\{[^}]+\})` },
    { type: 'number', re: String.raw`\b\d+\b` },
  ],
  json: [
    { type: 'string', re: String.raw`"(?:\\.|[^"\\])*"\s*(?=:)` },
    { type: 'builtin', re: String.raw`"(?:\\.|[^"\\])*"` },
    { type: 'keyword', re: String.raw`\b(?:true|false|null)\b` },
    { type: 'number', re: String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b` },
  ],
  html: [
    { type: 'comment', re: String.raw`<!--[\s\S]*?-->` },
    { type: 'string', re: String.raw`"(?:[^"]*)"|'(?:[^']*)'` },
    { type: 'keyword', re: String.raw`<\/?[a-zA-Z][\w-]*|\/?>` },
    { type: 'builtin', re: String.raw`\b[a-zA-Z-]+(?==)` },
  ],
  css: [
    { type: 'comment', re: String.raw`\/\*[\s\S]*?\*\/` },
    { type: 'string', re: String.raw`"(?:[^"]*)"|'(?:[^']*)'` },
    { type: 'number', re: String.raw`-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b|#[0-9a-fA-F]{3,8}` },
    { type: 'keyword', re: String.raw`[.#]?[a-zA-Z-]+(?=\s*\{)|@[a-zA-Z-]+` },
    { type: 'builtin', re: String.raw`\b[a-zA-Z-]+(?=\s*:)` },
  ],
};

/** Extra flags per grammar (JavaScript has no inline (?i)/(?m) flags). */
const GRAMMAR_FLAGS = { bat: 'gim', markdown: 'gm' };

const MASTER_CACHE = {};

function masterRegex(language) {
  if (MASTER_CACHE[language] !== undefined) return MASTER_CACHE[language];
  const rules = RULES[language];
  if (!rules) { MASTER_CACHE[language] = null; return null; }

  let regex;
  try {
    regex = new RegExp(rules.map((r) => `(${r.re})`).join('|'), GRAMMAR_FLAGS[language] || 'g');
  } catch (error) {
    console.warn(`[pulse] invalid grammar for "${language}":`, error.message);
    MASTER_CACHE[language] = null;
    return null;
  }

  const entry = { regex, rules };
  MASTER_CACHE[language] = entry;
  return entry;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightCode(text, language) {
  const entry = masterRegex(language);
  if (!entry) return escapeHtml(text);

  let out = '';
  let last = 0;
  const re = entry.regex;
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) { re.lastIndex += 1; continue; }
    if (match.index > last) out += escapeHtml(text.slice(last, match.index));
    let type = null;
    for (let i = 1; i <= entry.rules.length; i += 1) {
      if (match[i] !== undefined) { type = entry.rules[i - 1].type; break; }
    }
    out += type
      ? `<span class="tok-${type}">${escapeHtml(match[0])}</span>`
      : escapeHtml(match[0]);
    last = match.index + match[0].length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

const FallbackEditor = {
  language: 'javascript',
  onChange: null,
  onCursor: null,

  init() {
    dom.input.addEventListener('input', () => this.render(true));
    dom.input.addEventListener('scroll', () => {
      dom.highlight.parentElement.scrollTop = dom.input.scrollTop;
      dom.highlight.parentElement.scrollLeft = dom.input.scrollLeft;
      dom.gutter.scrollTop = dom.input.scrollTop;
    });
    dom.input.addEventListener('keyup', () => this.cursor());
    dom.input.addEventListener('click', () => this.cursor());
    dom.input.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        const el = dom.input;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        el.value = `${el.value.slice(0, start)}  ${el.value.slice(end)}`;
        el.selectionStart = el.selectionEnd = start + 2;
        this.render(true);
      }
    });
    this.render();
  },

  getValue() { return dom.input.value; },

  setValue(value, language) {
    dom.input.value = value == null ? '' : String(value);
    if (language) this.language = language;
    dom.input.scrollTop = 0;
    this.render();
    this.cursor();
  },

  setLanguage(language) {
    this.language = language;
    this.render();
  },

  focus() { dom.input.focus(); },

  layout() { this.render(); },

  render(notify) {
    const value = dom.input.value;
    dom.highlight.innerHTML = `${highlightCode(value, this.language)}\n`;
    const lines = value.split('\n').length;
    const caretLine = value.slice(0, dom.input.selectionStart).split('\n').length;
    const numbers = [];
    for (let i = 1; i <= Math.max(lines, 1); i += 1) {
      numbers.push(i === caretLine ? `<span class="ln-active">${i}</span>` : String(i));
    }
    dom.gutter.innerHTML = numbers.join('\n');
    if (notify && typeof this.onChange === 'function') this.onChange(value);
  },

  cursor() {
    if (typeof this.onCursor !== 'function') return;
    const value = dom.input.value;
    const upto = value.slice(0, dom.input.selectionStart);
    const lines = upto.split('\n');
    this.onCursor({ lineNumber: lines.length, column: lines[lines.length - 1].length + 1 });
  },
};

/* ----------------------------------------------------------- monaco setup */

let monaco = null;
let monacoEditor = null;

function monacoTheme() {
  return {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5b4b7a', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c084fc' },
      { token: 'string', foreground: '86efac' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'type', foreground: '67e8f9' },
      { token: 'identifier', foreground: 'e6dcf5' },
      { token: 'delimiter', foreground: 'd8b4fe' },
      { token: 'tag', foreground: 'f472b6' },
    ],
    colors: {
      'editor.background': '#08060f',
      'editor.foreground': '#e6dcf5',
      'editorLineNumber.foreground': '#4b3a68',
      'editorLineNumber.activeForeground': '#c98bff',
      'editorCursor.foreground': '#c98bff',
      'editor.selectionBackground': '#6d28d9aa',
      'editor.inactiveSelectionBackground': '#6d28d955',
      'editor.lineHighlightBackground': '#160d26',
      'editorLineNumber.dimmed': '#3a2b57',
      'editorGutter.background': '#08060f',
      'editorIndentGuide.background1': '#1d1233',
      'editorIndentGuide.activeBackground1': '#6d28d9',
      'editorWidget.background': '#100a1c',
      'editorWidget.border': '#2a1a44',
      'editorSuggestWidget.background': '#100a1c',
      'editorSuggestWidget.selectedBackground': '#2a1a44',
      'scrollbarSlider.background': '#a855f766',
      'scrollbarSlider.hoverBackground': '#a855f7aa',
      'scrollbarSlider.activeBackground': '#a855f7cc',
      'editorBracketMatch.background': '#3b1d6b',
      'editorBracketMatch.border': '#a855f7',
    },
  };
}

function loadMonaco(basePath) {
  return new Promise((resolve, reject) => {
    if (!basePath) { reject(new Error('monaco bundle not found')); return; }

    // Never let the boot screen hang: give the AMD bundle 15 s to appear.
    const timer = setTimeout(() => {
      reject(new Error('monaco loader timed out after 15 s'));
    }, 15000);
    const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };
    const done = settle(resolve);
    const fail = settle(reject);

    const baseUrl = basePath.replace(/\\/g, '/').replace(/^\/*/, '/');
    const fileUrl = `file://${baseUrl}`;

    // Web workers cannot be spawned from file:// in Electron; the shim below
    // keeps Monaco fully usable (editing + highlighting) without them.
    window.MonacoEnvironment = {
      baseUrl: `${fileUrl}/`,
      getWorkerUrl() {
        const shim = [
          'self.MonacoEnvironment = { baseUrl: "' + `${fileUrl}/` + '" };',
          'try { importScripts("' + `${fileUrl}/base/worker/workerMain.js` + '"); }',
          'catch (e) { self.postMessage = self.postMessage || function(){}; }',
        ].join('\n');
        return `data:text/javascript;charset=utf-8,${encodeURIComponent(shim)}`;
      },
    };

    const script = document.createElement('script');
    script.src = `${fileUrl}/loader.js`;
    script.onload = () => {
      if (!window.require || typeof window.require.config !== 'function') {
        fail(new Error('AMD loader unavailable'));
        return;
      }
      window.require.config({ paths: { vs: `${fileUrl}` } });
      window.require(['vs/editor/editor.main'], () => {
        done(window.monaco);
      }, (error) => fail(error instanceof Error ? error : new Error(String(error && error.message))));
    };
    script.onerror = () => fail(new Error('cannot load monaco loader.js'));
    document.head.appendChild(script);
  });
}

function buildMonacoEditor() {
  const container = document.createElement('div');
  container.id = 'monaco-container';
  dom.host.appendChild(container);

  monaco.editor.defineTheme('pulse-cyber', monacoTheme());

  monacoEditor = monaco.editor.create(container, {
    value: '',
    language: 'javascript',
    theme: 'pulse-cyber',
    automaticLayout: true,
    fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace',
    fontSize: 12.5,
    lineHeight: 20,
    fontLigatures: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all',
    cursorBlinking: 'phase',
    cursorSmoothCaretAnimation: 'on',
    smoothScrolling: true,
    padding: { top: 10, bottom: 10 },
    roundedSelection: true,
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: true },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
    wordWrap: state.wrap ? 'on' : 'off',
    tabSize: 2,
    suggestOnTriggerCharacters: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    contextmenu: true,
  });

  monacoEditor.onDidChangeModelContent(() => {
    const tab = activeTab();
    if (tab) markDirty(tab);
    updatePositionFromMonaco();
  });
  monacoEditor.onDidChangeCursorPosition(updatePositionFromMonaco);

  // Language services that need workers are switched off: the app must stay
  // fully functional when it runs from the file:// protocol.
  if (monaco.languages.typescript) {
    const options = { noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true };
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(options);
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(options);
  }
  if (monaco.languages.json) {
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false, allowComments: true });
  }

  dom.fallback.hidden = true;
  state.engine = 'monaco';
  renderStatus();
}

/* ------------------------------------------------------- editor  adapter */

const Editor = {
  get mode() { return monacoEditor ? 'monaco' : 'fallback'; },

  getValue() {
    if (monacoEditor) return monacoEditor.getValue();
    return FallbackEditor.getValue();
  },

  setValue(value, language) {
    if (monacoEditor) {
      const model = monacoEditor.getModel();
      if (model) monaco.editor.setModelLanguage(model, language || 'plaintext');
      monacoEditor.setValue(value == null ? '' : String(value));
      monacoEditor.setPosition({ lineNumber: 1, column: 1 });
      monacoEditor.focus();
      return;
    }
    FallbackEditor.setValue(value, language);
    FallbackEditor.focus();
  },

  setLanguage(language) {
    if (monacoEditor) {
      const model = monacoEditor.getModel();
      if (model) monaco.editor.setModelLanguage(model, language);
    } else {
      FallbackEditor.setLanguage(language);
    }
  },

  focus() {
    if (monacoEditor) monacoEditor.focus();
    else FallbackEditor.focus();
  },

  setWrap(on) {
    if (monacoEditor) monacoEditor.updateOptions({ wordWrap: on ? 'on' : 'off' });
    dom.input.classList.toggle('is-wrap', on);
    dom.highlight.classList.toggle('is-wrap', on);
    dom.console.classList.toggle('is-wrap', on);
  },

  layout() {
    if (monacoEditor) monacoEditor.layout();
    else FallbackEditor.layout();
  },
};

/* ------------------------------------------------------------------ tabs */

let tabSeq = 0;

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || null;
}

function addTab({ name, path = null, content = '', language = 'plaintext' }) {
  const tab = { id: `tab-${++tabSeq}`, name, path, language, dirty: false, model: null, content };
  state.tabs.push(tab);
  setActiveTab(tab.id);
  renderTabs();
  return tab;
}

function closeTab(id) {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index < 0) return;
  const [tab] = state.tabs.splice(index, 1);
  if (tab.model && monaco) tab.model.dispose();
  if (!state.tabs.length) {
    state.activeTabId = null;
    addTab({ name: 'untitled.js', content: SAMPLE, language: 'javascript' });
  } else if (state.activeTabId === id) {
    setActiveTab(state.tabs[Math.max(0, index - 1)].id);
  }
  renderTabs();
}

function setActiveTab(id) {
  const previous = activeTab();
  if (previous) {
    previous.content = monacoEditor ? monacoEditor.getValue() : FallbackEditor.getValue();
  }

  state.activeTabId = id;
  const tab = activeTab();
  if (!tab) return;

  if (monacoEditor && monaco) {
    if (!tab.model) tab.model = monaco.editor.createModel(tab.content, tab.language);
    monacoEditor.setModel(tab.model);
  } else {
    FallbackEditor.setValue(tab.content, tab.language);
  }

  dom.statusFile.textContent = tab.name + (tab.dirty ? ' •' : '');
  dom.st.lang.textContent = tab.language;
  renderTabs();
  updatePosition();
}

function markDirty(tab) {
  if (!tab) return;
  const wasDirty = tab.dirty;
  tab.dirty = true;
  if (!wasDirty) {
    dom.statusFile.textContent = `${tab.name} •`;
    renderTabs();
  }
}

function renderTabs() {
  dom.tabs.innerHTML = '';
  state.tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = `tab${tab.id === state.activeTabId ? ' is-active' : ''}${tab.dirty ? ' is-dirty' : ''}`;
    el.title = tab.path || tab.name;
    const name = document.createElement('span');
    name.className = 'tab__name';
    name.textContent = tab.name + (tab.dirty ? ' •' : '');
    const close = document.createElement('button');
    close.className = 'tab__close';
    close.textContent = '✕';
    close.title = 'Close tab';
    close.addEventListener('click', (event) => { event.stopPropagation(); closeTab(tab.id); });
    el.append(name, close);
    el.addEventListener('click', () => setActiveTab(tab.id));
    dom.tabs.appendChild(el);
  });
}

function syncActiveContent() {
  const tab = activeTab();
  if (!tab) return;
  if (monacoEditor) tab.content = monacoEditor.getValue();
  else tab.content = FallbackEditor.getValue();
}

/* --------------------------------------------------------------- console */

const ANSI_RE = /\u001b\[([0-9;]*)m/g;
const ANSI_MAP = {
  30: 'ansi-red', 31: 'ansi-red', 32: 'ansi-green', 33: 'ansi-yellow',
  34: 'ansi-blue', 35: 'ansi-magenta', 36: 'ansi-cyan', 37: '',
  90: 'ansi-dim', 1: 'ansi-bold', 2: 'ansi-dim', 0: '',
};

function ansiToHtml(text) {
  let out = '';
  let last = 0;
  let open = false;
  ANSI_RE.lastIndex = 0;
  let match;
  while ((match = ANSI_RE.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, match.index));
    if (open) { out += '</span>'; open = false; }
    const codes = (match[1] || '0').split(';').filter(Boolean);
    const classes = codes.map((c) => ANSI_MAP[Number(c)]).filter((c) => c !== undefined && c !== '');
    if (classes.length) {
      out += `<span class="${classes.join(' ')}">`;
      open = true;
    }
    last = match.index + match[0].length;
  }
  out += escapeHtml(text.slice(last));
  if (open) out += '</span>';
  return out;
}

function log(text, kind = 'stdout', time = null) {
  const line = document.createElement('span');
  line.className = `ln ln--${kind}`;
  const stamp = document.createElement('span');
  stamp.className = 'ln__time';
  stamp.textContent = time || new Date().toLocaleTimeString('en-GB');
  const body = document.createElement('span');
  body.innerHTML = ansiToHtml(String(text));
  line.append(stamp, body);
  dom.console.appendChild(line);

  while (dom.console.childElementCount > 1500) dom.console.removeChild(dom.console.firstChild);
  dom.console.scrollTop = dom.console.scrollHeight;
}

function clearConsole() {
  dom.console.innerHTML = '';
}

/* -------------------------------------------------------------- execution */

async function execute() {
  if (state.busy) return;
  const tab = activeTab();
  if (!tab) return;

  syncActiveContent();
  if (!tab.content.trim()) {
    setMessage('nothing to execute — the buffer is empty');
    return;
  }

  state.busy = true;
  state.runId = null;
  setBusyUi(true);
  dom.consoleMeta.textContent = `running · ${state.runner}`;
  log(`▸ execute ${tab.name} with ${state.runner}`, 'system');

  const useFile = Boolean(tab.path && !tab.dirty);
  const payload = useFile
    ? { runner: state.runner, filePath: tab.path, keepFile: true }
    : { runner: state.runner, code: tab.content, filePath: tab.path };

  try {
    const result = await window.pulse.run(payload);
    state.runId = result.runId;
    dom.consoleMeta.textContent = result.ok
      ? `exit ${result.exitCode} · ${result.duration} ms`
      : `exit ${result.exitCode ?? 'null'} · ${result.duration} ms · ${result.error || 'failed'}`;
    if (result.error) log(`✖ ${result.error}`, 'error');
    setMessage(`finished with exit code ${result.exitCode} in ${result.duration} ms`);
    await window.pulse.setProgress(1);
    setTimeout(() => window.pulse.setProgress(-1), 600);
  } catch (error) {
    log(`✖ ${error && error.message ? error.message : error}`, 'error');
    setMessage('execution failed');
  } finally {
    state.busy = false;
    setBusyUi(false);
    refreshWorkspace();
  }
}

async function stopExecution() {
  const result = await window.pulse.cancel(state.runId || undefined);
  log(`■ stop requested (${result.cancelled ? 'sent' : 'no active process'})`, 'system');
  state.busy = false;
  setBusyUi(false);
}

function setBusyUi(busy) {
  const button = $('btn-execute');
  button.classList.toggle('is-busy', busy);
  button.querySelector('.action__text').textContent = busy ? 'Running…' : 'Execute';
  $('btn-stop').disabled = !busy;
}

async function runUtility(id, label) {
  if (state.busy) return;
  state.busy = true;
  setBusyUi(true);
  dom.consoleMeta.textContent = `utility · ${id}`;
  try {
    const result = await window.pulse.runUtility({ id });
    if (result.error) log(`✖ ${result.error}`, 'error');
  } catch (error) {
    log(`✖ ${error && error.message ? error.message : error}`, 'error');
  } finally {
    state.busy = false;
    setBusyUi(false);
    setMessage(`utility "${label || id}" finished`);
  }
}

/* ------------------------------------------------------------------ files */

async function openFile() {
  const result = await window.pulse.openFile();
  if (!result || result.canceled) { setMessage('open file cancelled'); return; }

  result.files.forEach((file) => {
    if (file.error) {
      log(`✖ ${file.name}: ${file.error}`, 'error');
      return;
    }
    addTab({ name: file.name, path: file.path, content: file.content, language: file.language });
    log(`▸ opened ${file.path} (${file.size} bytes)`, 'system');
  });
  setMessage(`${result.files.length} file(s) opened`);
}

async function saveFile() {
  const tab = activeTab();
  if (!tab) return;
  syncActiveContent();
  const result = await window.pulse.saveFile({ filePath: tab.path, content: tab.content, suggestedName: tab.name });
  if (!result || result.canceled) { setMessage('save cancelled'); return; }
  if (result.error) { log(`✖ save failed: ${result.error}`, 'error'); return; }
  tab.path = result.path;
  tab.name = result.name;
  tab.language = result.language || tab.language;
  tab.dirty = false;
  dom.statusFile.textContent = tab.name;
  if (monacoEditor && tab.model) monaco.editor.setModelLanguage(tab.model, tab.language);
  log(`▸ saved ${result.path}`, 'system');
  renderTabs();
  refreshWorkspace();
}

async function refreshWorkspace() {
  const files = await window.pulse.listWorkspace();
  dom.filelist.innerHTML = '';
  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'filelist__empty';
    empty.textContent = 'workspace is empty';
    dom.filelist.appendChild(empty);
    return;
  }
  files.slice(0, 40).forEach((file) => {
    const item = document.createElement('div');
    item.className = 'filelist__item';
    item.textContent = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`;
    item.title = file.path;
    item.addEventListener('click', () => openWorkspaceFile(file.path, file.name));
    dom.filelist.appendChild(item);
  });
}

async function openWorkspaceFile(filePath, name) {
  const file = await window.pulse.readFile(filePath);
  if (!file.ok) {
    log(`✖ ${name || filePath}: ${file.error}`, 'error');
    return;
  }
  addTab({ name: file.name, path: file.path, content: file.content, language: file.language });
  log(`▸ opened ${file.path} (${file.size} bytes)`, 'system');
  setMessage(`opened ${file.name}`);
}

/* -------------------------------------------------------------- attach UI */

function toggleAttachPanel(force) {
  const show = typeof force === 'boolean' ? force : dom.attachPanel.hidden;
  dom.attachPanel.hidden = !show;
  if (show) $('attach-host').focus();
  Editor.layout();
}

function setAttachStatus(info) {
  state.attached = Boolean(info && info.connected);
  state.attachMode = (info && info.mode) || null;
  dom.attachDot.classList.toggle('is-on', state.attached);
  dom.attachStatusText.textContent = state.attached
    ? `attached · ${info.target || info.mode}`
    : (info && info.reason ? `detached · ${info.reason}` : 'detached');
}

async function connectTcp() {
  const host = $('attach-host').value.trim() || '127.0.0.1';
  const port = Number($('attach-port').value);
  log(`▸ connecting to ${host}:${port} …`, 'system');
  const result = await window.pulse.attach({ mode: 'tcp', host, port });
  if (!result.ok) log(`✖ connect failed: ${result.error}`, 'error');
  else setMessage(`connected to ${host}:${port}`);
}

async function probeTcp() {
  const host = $('attach-host').value.trim() || '127.0.0.1';
  const port = Number($('attach-port').value);
  const result = await window.pulse.probe({ host, port, timeout: 2000 });
  log(
    result.ok ? `✓ ${host}:${port} reachable in ${result.rtt} ms` : `✖ ${host}:${port} unreachable (${result.error})`,
    result.ok ? 'ok' : 'error'
  );
}

async function sendPayload(kind) {
  let data = $('attach-payload').value;
  if (kind === 'code') data = Editor.getValue();
  const result = await window.pulse.attachSend({ data, encoding: kind === 'hex' ? 'hex' : 'utf8' });
  if (!result.ok) log(`✖ send failed: ${result.error}`, 'error');
}

async function attachPid() {
  const pid = Number($('attach-pid').value);
  const result = await window.pulse.attach({ mode: 'process', pid });
  if (!result.ok) log(`✖ attach failed: ${result.error}`, 'error');
  else log(`▸ watching pid ${pid}`, 'system');
}

async function startBridge() {
  const result = await window.pulse.startBridge({ port: 0 });
  if (!result.ok) { log(`✖ bridge failed: ${result.error}`, 'error'); return; }
  log(`▸ bridge listening on 127.0.0.1:${result.port}`, 'system');
  $('attach-port').value = result.port;
  $('attach-host').value = '127.0.0.1';
}

async function stopBridge() {
  await window.pulse.stopBridge();
}

/* -------------------------------------------------------------- statusbar */

function setMessage(text) {
  dom.st.message.textContent = text;
}

function updatePositionFromMonaco() {
  if (!monacoEditor) return;
  const position = monacoEditor.getPosition();
  if (position) dom.st.pos.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
}

function updatePosition() {
  if (monacoEditor) updatePositionFromMonaco();
  else FallbackEditor.cursor();
}

function renderStatus() {
  dom.st.engine.textContent = state.engine === 'monaco' ? 'monaco' : 'pulse-core';
  if (state.appInfo) {
    dom.st.platform.textContent = `${state.appInfo.platform}/${state.appInfo.arch} · electron ${state.appInfo.electron}`;
    dom.appVersion.textContent = `v${state.appInfo.version}`;
  }
}

function tick() {
  const now = new Date();
  dom.st.time.textContent = now.toLocaleTimeString('en-GB');
  if (performance && performance.memory) {
    const mb = performance.memory.usedJSHeapSize / (1024 * 1024);
    dom.st.mem.textContent = `${mb.toFixed(1)} MB`;
  }
}

/* ------------------------------------------------------------------ init */

const SAMPLE = `// ─────────────────────────────────────────────────────────────
//  PULSE ▸ quick start
//  Ctrl+Enter  execute   ·   Ctrl+O  open   ·   Ctrl+B  attach
// ─────────────────────────────────────────────────────────────

const pulse = {
  engine: 'Pulse',
  version: '1.0.0',
  runners: ['node', 'python', 'powershell', 'cmd', 'bash'],
};

function heartbeat(times = 5, bpm = 120) {
  const delay = 60000 / bpm;
  for (let i = 1; i <= times; i += 1) {
    process.stdout.write(\`\\u2661 beat \${i} · \${Math.round(delay)} ms apart\\n\`);
  }
}

heartbeat();
console.log('Pulse is online:', pulse.engine, pulse.version);
console.log('runners:', pulse.runners.join(', '));
`;

async function initRunners() {
  const runners = await window.pulse.listRunners();
  state.runners = runners;
  dom.runnerSelect.innerHTML = '';
  runners.forEach((runner) => {
    const option = document.createElement('option');
    option.value = runner.id;
    option.textContent = runner.available ? runner.label : `${runner.label} (not found)`;
    dom.runnerSelect.appendChild(option);
  });
  const preferred = runners.find((r) => r.available && r.id === 'node') || runners.find((r) => r.available);
  if (preferred) {
    state.runner = preferred.id;
    dom.runnerSelect.value = preferred.id;
  }
  dom.runnerMeta.textContent = runners
    .map((r) => `${r.available ? '●' : '○'} ${r.label}`)
    .join('\n');
  dom.runnerMeta.style.whiteSpace = 'pre';
  dom.statusRunner.textContent = (runners.find((r) => r.id === state.runner) || {}).label || state.runner;
}

async function initUtilities() {
  const utilities = await window.pulse.listUtilities().catch(() => []);
  dom.utilities.innerHTML = '';
  utilities.forEach((utility) => {
    const button = document.createElement('button');
    button.className = 'util';
    button.textContent = utility.label;
    button.title = utility.label;
    button.addEventListener('click', () => runUtility(utility.id, utility.label));
    dom.utilities.appendChild(button);
  });
}

function bindUi() {
  $('btn-min').addEventListener('click', () => window.pulse.minimize());
  $('btn-max').addEventListener('click', () => window.pulse.toggleMaximize());
  $('btn-close').addEventListener('click', () => window.pulse.close());

  $('btn-execute').addEventListener('click', execute);
  $('btn-clear').addEventListener('click', () => {
    Editor.setValue('', activeTab() ? activeTab().language : 'plaintext');
    setMessage('buffer cleared');
  });
  $('btn-attach').addEventListener('click', () => toggleAttachPanel());
  $('btn-open').addEventListener('click', openFile);
  $('btn-save').addEventListener('click', saveFile);
  $('btn-workspace').addEventListener('click', () => window.pulse.openWorkspace());

  $('btn-stop').addEventListener('click', stopExecution);
  $('btn-clear-console').addEventListener('click', () => { clearConsole(); setMessage('console cleared'); });
  $('btn-wrap').addEventListener('click', (event) => {
    state.wrap = !state.wrap;
    event.currentTarget.classList.toggle('is-on', state.wrap);
    Editor.setWrap(state.wrap);
  });

  dom.runnerSelect.addEventListener('change', (event) => {
    state.runner = event.target.value;
    const runner = state.runners.find((r) => r.id === state.runner);
    dom.statusRunner.textContent = runner ? runner.label : state.runner;
    const tab = activeTab();
    if (tab && runner && !tab.path) {
      tab.language = runner.language;
      dom.st.lang.textContent = tab.language;
      Editor.setLanguage(tab.language);
    }
    setMessage(`runner → ${state.runner}`);
  });

  // attach panel
  $('attach-close').addEventListener('click', () => toggleAttachPanel(false));
  $('attach-connect').addEventListener('click', connectTcp);
  $('attach-probe').addEventListener('click', probeTcp);
  $('attach-disconnect').addEventListener('click', async () => {
    await window.pulse.detach();
    log('▸ disconnected', 'system');
  });
  $('attach-send-line').addEventListener('click', () => sendPayload('line'));
  $('attach-send-code').addEventListener('click', () => sendPayload('code'));
  $('attach-send-hex').addEventListener('click', () => sendPayload('hex'));
  $('attach-pid-go').addEventListener('click', attachPid);
  $('attach-pid-stop').addEventListener('click', async () => {
    await window.pulse.detach();
  });
  $('bridge-start').addEventListener('click', startBridge);
  $('bridge-stop').addEventListener('click', stopBridge);

  document.querySelectorAll('.tabs-mini__btn').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tabs-mini__btn').forEach((b) => b.classList.toggle('is-active', b === button));
      document.querySelectorAll('.tab-page').forEach((page) => {
        page.hidden = page.dataset.page !== button.dataset.tab;
      });
    });
  });

  // keyboard
  window.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();

    if (key === 'enter') { event.preventDefault(); execute(); }
    else if (key === 'k') { event.preventDefault(); Editor.setValue('', activeTab() ? activeTab().language : 'plaintext'); setMessage('buffer cleared'); }
    else if (key === 'b') { event.preventDefault(); toggleAttachPanel(); }
    else if (key === 'o') { event.preventDefault(); openFile(); }
    else if (key === 's') { event.preventDefault(); saveFile(); }
    else if (key === 'c' && event.shiftKey) { event.preventDefault(); stopExecution(); }
    else if (key === 'l') { event.preventDefault(); clearConsole(); }
  });

  window.addEventListener('resize', () => Editor.layout());
}

function bindIpc() {
  window.pulse.on('pulse:run-output', (payload) => {
    log(payload.chunk, payload.stream === 'stderr' ? 'stderr' : payload.stream === 'system' ? 'system' : 'stdout', payload.at);
  });

  window.pulse.on('pulse:attach-status', (info) => {
    setAttachStatus(info);
    if (info && info.connected) log(`✓ attached · ${info.target || info.mode}`, 'ok');
    else if (info && info.reason) log(`▸ detached · ${info.reason}`, 'system');
  });

  window.pulse.on('pulse:attach-data', (payload) => {
    const level = payload.level === 'error' ? 'error' : payload.level === 'out' ? 'out' : payload.level === 'system' ? 'system' : 'in';
    log(payload.text, level, payload.at);
  });

  window.pulse.on('pulse:bridge-status', (info) => {
    state.bridge = info;
    dom.bridgeDot.classList.toggle('is-on', Boolean(info && info.running));
    dom.bridgeText.textContent = info && info.running ? `bridge :${info.port}` : 'bridge offline';
  });

  window.pulse.on('pulse:window-state', (info) => {
    if (info) $('btn-max').title = info.maximized ? 'Restore' : 'Maximize';
  });
}

async function boot() {
  bindUi();
  bindIpc();
  FallbackEditor.init();
  FallbackEditor.onChange = () => {
    const tab = activeTab();
    if (tab) markDirty(tab);
  };
  FallbackEditor.onCursor = ({ lineNumber, column }) => {
    dom.st.pos.textContent = `Ln ${lineNumber}, Col ${column}`;
  };

  setBusyUi(false);
  addTab({ name: 'quick-start.js', content: SAMPLE, language: 'javascript' });

  tick();
  setInterval(tick, 1000);

  try {
    state.appInfo = await window.pulse.appInfo();
    renderStatus();
    dom.st.platform.textContent = `${state.appInfo.platform}/${state.appInfo.arch} · electron ${state.appInfo.electron}`;
    log(`▸ Pulse ${state.appInfo.version} · electron ${state.appInfo.electron} · node ${state.appInfo.node}`, 'system');
    log(`▸ workspace ${state.appInfo.workspace}`, 'system');
  } catch (error) {
    log(`✖ cannot read app info: ${error && error.message ? error.message : error}`, 'error');
  }

  await initRunners();
  await initUtilities();
  await refreshWorkspace();

  if (state.appInfo && state.appInfo.monacoPath) {
    try {
      monaco = await loadMonaco(state.appInfo.monacoPath);
      buildMonacoEditor();
      // Re-apply the active tab into the freshly created Monaco instance.
      const tab = activeTab();
      if (tab) {
        tab.model = monaco.editor.createModel(tab.content, tab.language);
        monacoEditor.setModel(tab.model);
      }
      log('▸ Monaco editor core loaded', 'system');
      setMessage('monaco editor ready');
    } catch (error) {
      if (monacoEditor) {
        try { monacoEditor.dispose(); } catch (_) { /* already gone */ }
        monacoEditor = null;
        monaco = null;
      }
      dom.fallback.hidden = false;
      state.engine = 'pulse-core';
      log(`▸ Monaco unavailable (${error && error.message ? error.message : error}) — using the built-in Pulse editor`, 'system');
    }
  } else {
    log('▸ Monaco bundle not found — using the built-in Pulse editor', 'system');
  }

  dom.boot.hidden = true;
  renderStatus();
  Editor.setWrap(state.wrap);
  $('btn-wrap').classList.toggle('is-on', state.wrap);
  Editor.focus();
  updatePosition();
}

document.addEventListener('DOMContentLoaded', boot);
