// ==UserScript==
// @name         GitHub – PR reading order
// @namespace    riley.github.tweaks
// @version      0.1
// @description  Show the changed files of a pull request in a good order to read them: dependencies first, then the files that use them, then tests, docs and generated files
// @match        https://github.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      github.com
// @connect      patch-diff.githubusercontent.com
// @connect      api.github.com
// ==/UserScript==

(function () {
  'use strict';

  // Layout of this file:
  //   Settings     values that you can change
  //   Diff         get the diff of the pull request and parse it
  //   Analysis     file kinds, imports between changed files, the order
  //   Panel        the floating list, the keys, the "read" marks
  //   Loader       start again after each GitHub page change
  //
  // The analysis reads only the diff. It finds an import only if the
  // import line is in a hunk (a new file shows all its imports).

  // ---------------------------------------------------------------- Settings

  // Slack Sea Glass colors. To use a different theme, change only these.
  const THEME_LIGHT = {
    bar: '#A9EDEF',
    panel: '#F6FDFD',
    text: '#033640',
    dim: '#5B7F86',
    selected: '#611F69',
    selectedText: '#F9EDFF',
    line: '#CFE9EB',
    add: '#007A5A',
    del: '#C01343',
  };
  const THEME_DARK = {
    bar: '#053C48',
    panel: '#0C2329',
    text: '#F8F8F8',
    dim: '#8FB0B6',
    selected: '#7D3986',
    selectedText: '#EFE1F5',
    line: '#17404A',
    add: '#4FD1A1',
    del: '#F2809B',
  };

  const KEY_NEXT = ']';
  const KEY_PREVIOUS = '[';
  const STORE_PREFIX = 'tm-gh-reading-order:';

  // ---------------------------------------------------------------- Diff

  function pullFromLocation() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/([^/]+))?/);
    return m ? { owner: m[1], repo: m[2], number: m[3], tab: m[4] || '' } : null;
  }

  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (r) => (r.status === 200 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status))),
        onerror: () => reject(new Error('network')),
      });
    });
  }

  // The .diff URL redirects to a different origin, thus page fetch() can
  // fail. Tampermonkey's request does not have that limit. The public API
  // is the last alternative (public repositories only).
  async function getDiff(pull) {
    const url = `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.number}.diff`;
    const attempts = [];
    if (typeof GM_xmlhttpRequest === 'function') attempts.push(() => gmGet(url));
    attempts.push(async () => {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
    attempts.push(async () => {
      const r = await fetch(`https://api.github.com/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`, {
        headers: { Accept: 'application/vnd.github.v3.diff' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
    let lastError;
    for (const attempt of attempts) {
      try {
        const text = await attempt();
        if (text.startsWith('diff --git')) return text;
        lastError = new Error('not a diff');
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  // Returns [{ path, status, additions, deletions, lines }]. "lines" has
  // the added lines and the context lines (the text of the new file that
  // the diff shows).
  function parseDiff(text) {
    const files = [];
    let file = null;
    let inHunk = false;
    for (const line of text.split('\n')) {
      if (line.startsWith('diff --git ')) {
        const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
        file = { path: m ? m[2] : '', status: 'modified', additions: 0, deletions: 0, lines: [] };
        files.push(file);
        inHunk = false;
      } else if (!file) {
        continue;
      } else if (!inHunk) {
        if (line.startsWith('@@')) inHunk = true;
        else if (line.startsWith('new file mode')) file.status = 'added';
        else if (line.startsWith('deleted file mode')) file.status = 'deleted';
        else if (line.startsWith('rename to ')) {
          file.status = 'renamed';
          file.path = line.slice('rename to '.length);
        } else if (line.startsWith('+++ b/')) file.path = line.slice(6);
      } else if (line.startsWith('@@')) {
        continue;
      } else if (line.startsWith('+')) {
        file.additions += 1;
        file.lines.push(line.slice(1));
      } else if (line.startsWith('-')) {
        file.deletions += 1;
      } else if (line.startsWith(' ')) {
        file.lines.push(line.slice(1));
      }
    }
    return files;
  }

  // ---------------------------------------------------------------- Analysis

  // The reading order of the kinds. Source files are first.
  const KIND_ORDER = ['source', 'test', 'config', 'docs', 'generated'];

  function kindOf(path) {
    const p = path.toLowerCase();
    const name = p.split('/').pop();
    if (
      /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|go\.sum|poetry\.lock|gemfile\.lock)$/.test(p) ||
      /\.(snap|min\.js|map|svg|png|jpg|jpeg|gif|ico|woff2?)$/.test(name) ||
      /(^|\/)(dist|build|__snapshots__|generated|vendor)\//.test(p)
    ) {
      return 'generated';
    }
    if (
      /(^|\/)(tests?|__tests__|e2e|cypress|spec|specs)\//.test(p) ||
      /(_test|_spec)\.[a-z]+$/.test(name) ||
      /\.(test|spec|unit\.spec|cy\.spec|cy)\.[a-z]+$/.test(name) ||
      /^test_.*\.py$/.test(name)
    ) {
      return 'test';
    }
    if (/\.(md|mdx|rst|txt|adoc)$/.test(name) || /(^|\/)docs?\//.test(p)) return 'docs';
    if (/\.(json|ya?ml|toml|ini|edn|lock|env|properties)$/.test(name) || /(^|\/)\.[^/]+$/.test(p) || /^dockerfile/.test(name)) {
      return 'config';
    }
    return 'source';
  }

  function stripExtension(path) {
    return path.replace(/(\.d)?\.[a-z0-9]+$/i, '');
  }

  // "foo_test.clj" -> "foo", "Foo.unit.spec.tsx" -> "Foo".
  function testSubjectName(path) {
    const name = path.split('/').pop();
    const subject = name
      .replace(/\.(unit\.spec|cy\.spec|test|spec|cy)\.[a-z]+$/i, '')
      .replace(/(_test|_spec)\.[a-z]+$/i, '')
      .replace(/^test_(.*)\.py$/i, '$1');
    return subject === name ? null : subject;
  }

  function joinPath(dir, relative) {
    const parts = dir ? dir.split('/') : [];
    for (const part of relative.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }

  // Returns the import specifiers that the visible lines of a file show.
  // Each item: { spec, relative }. "spec" is a path without extension.
  function importsOf(file) {
    const specs = [];
    const ext = (file.path.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
    const text = file.lines.join('\n');
    let m;
    if (/^(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(ext)) {
      const re = /(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["']([^"']+)["']/g;
      while ((m = re.exec(text))) {
        const spec = m[1].replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
        specs.push({ spec, relative: spec.startsWith('.') });
      }
    } else if (/^(clj|cljs|cljc|bb)$/.test(ext)) {
      // [metabase.foo.bar-baz :as baz] -> metabase/foo/bar_baz
      const re = /[[(\s]([a-z][\w\-]*(?:\.[\w\-*+!?]+)+)(?=[\s\])])/g;
      while ((m = re.exec(text))) {
        specs.push({ spec: m[1].replace(/\./g, '/').replace(/-/g, '_'), relative: false });
      }
    } else if (ext === 'py') {
      const re = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
      while ((m = re.exec(text))) {
        const mod = m[1] || m[2];
        const dots = (mod.match(/^\.+/) || [''])[0].length;
        if (dots) {
          specs.push({ spec: '../'.repeat(dots - 1) + './' + mod.slice(dots).replace(/\./g, '/'), relative: true });
        } else {
          specs.push({ spec: mod.replace(/\./g, '/'), relative: false });
        }
      }
    } else if (/^(go|rs|java|kt|rb|scss|css)$/.test(ext)) {
      const re = /["']([\w@.\-/]+)["']/g;
      while ((m = re.exec(text))) {
        if (m[1].includes('/')) specs.push({ spec: stripExtension(m[1]), relative: m[1].startsWith('.') });
      }
    }
    return specs;
  }

  // Adds to each file: kind, deps (changed files that it uses), usedBy.
  function linkFiles(files) {
    const byStem = new Map();
    for (const f of files) {
      f.kind = kindOf(f.path);
      f.deps = new Set();
      f.usedBy = new Set();
      const stem = stripExtension(f.path);
      byStem.set(stem, f);
      if (/\/index$/.test(stem)) byStem.set(stem.replace(/\/index$/, ''), f);
    }
    const stems = [...byStem.keys()];

    function resolve(from, item) {
      if (item.relative) {
        const dir = from.path.split('/').slice(0, -1).join('/');
        return byStem.get(joinPath(dir, item.spec)) || null;
      }
      // An alias or a namespace: the changed file whose path ends with it.
      const suffix = '/' + item.spec.replace(/^[@~]\//, '');
      if (suffix.split('/').length < 3) return null; // one segment: too vague
      let found = null;
      for (const stem of stems) {
        if (('/' + stem).endsWith(suffix)) {
          if (found && found !== byStem.get(stem)) return null; // not clear
          found = byStem.get(stem);
        }
      }
      return found;
    }

    for (const f of files) {
      if (f.status === 'deleted') continue;
      for (const item of importsOf(f)) {
        const target = resolve(f, item);
        if (target && target !== f) {
          f.deps.add(target);
          target.usedBy.add(f);
        }
      }
    }

    // A test goes with the file that it tests.
    const sources = files.filter((f) => f.kind === 'source');
    for (const f of files) {
      if (f.kind !== 'test') continue;
      const subject = testSubjectName(f.path);
      if (!subject) continue;
      const matches = sources.filter((s) => stripExtension(s.path).split('/').pop() === subject);
      const fromImports = [...f.deps].filter((d) => d.kind === 'source');
      f.subject = matches.find((s) => f.deps.has(s)) || (matches.length === 1 ? matches[0] : fromImports[0]) || null;
    }
    for (const f of files) {
      if (f.kind === 'test' && !f.subject) {
        f.subject = [...f.deps].find((d) => d.kind === 'source') || null;
      }
    }
    return files;
  }

  // Dependencies first: you read a definition before the code that uses
  // it. A test comes immediately after its subject. Then the other
  // tests, config, docs, generated files.
  function readingOrder(files) {
    const order = [];
    const done = new Set();
    const byPath = (a, b) => a.path.localeCompare(b.path);
    const testsOf = (f) => files.filter((t) => t.kind === 'test' && t.subject === f).sort(byPath);

    function emit(f, depth) {
      if (done.has(f)) return;
      done.add(f);
      f.depth = depth;
      order.push(f);
    }
    function visit(f, trail) {
      if (done.has(f) || trail.has(f)) return;
      trail.add(f);
      for (const dep of [...f.deps].filter((d) => d.kind === f.kind).sort(byPath)) visit(dep, trail);
      emit(f, 0);
      for (const t of testsOf(f)) emit(t, 1);
    }

    const sources = files.filter((f) => f.kind === 'source');
    // Start from the entry points (no changed file uses them). The files
    // that an entry point needs come before it, thus related files stay
    // together.
    const entries = sources.filter((f) => ![...f.usedBy].some((u) => u.kind === 'source')).sort(byPath);
    for (const f of entries) visit(f, new Set());
    for (const f of sources.sort(byPath)) visit(f, new Set()); // import cycles
    for (const kind of KIND_ORDER.slice(1)) {
      // In each kind also: a file comes after the files that it uses
      // (for example a test helper before the tests).
      for (const f of files.filter((x) => x.kind === kind).sort(byPath)) visit(f, new Set());
    }
    return order;
  }

  function analyze(diffText) {
    return readingOrder(linkFiles(parseDiff(diffText)));
  }

  // ---------------------------------------------------------------- Panel

  const CSS = `
    #tm-ro { position: fixed; right: 16px; bottom: 16px; z-index: 99; width: 340px;
      max-height: 70vh; display: flex; flex-direction: column; border-radius: 8px;
      overflow: hidden; font: 13px/1.4 Lato, -apple-system, "Segoe UI", sans-serif;
      background: var(--tm-ro-panel); color: var(--tm-ro-text);
      border: 1px solid var(--tm-ro-line); box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    #tm-ro * { font-weight: 400; box-sizing: border-box; }
    #tm-ro-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px;
      background: var(--tm-ro-bar); cursor: pointer; user-select: none; }
    #tm-ro-title { flex: 1; }
    #tm-ro-count, #tm-ro-keys { color: var(--tm-ro-dim); font-size: 12px; }
    #tm-ro-progress { height: 2px; background: var(--tm-ro-line); }
    #tm-ro-progress > div { height: 100%; background: var(--tm-ro-selected); transition: width .2s; }
    #tm-ro-list { overflow-y: auto; margin: 0; padding: 4px 0; list-style: none; }
    #tm-ro.tm-ro-closed #tm-ro-list, #tm-ro.tm-ro-closed #tm-ro-keys { display: none; }
    #tm-ro.tm-ro-closed { width: auto; }
    .tm-ro-group { padding: 6px 12px 2px; color: var(--tm-ro-dim); font-size: 11px;
      text-transform: uppercase; letter-spacing: .04em; }
    .tm-ro-row { display: flex; align-items: baseline; gap: 8px; padding: 3px 12px; cursor: pointer; }
    .tm-ro-row:hover { background: var(--tm-ro-line); }
    .tm-ro-row.tm-ro-current { background: var(--tm-ro-selected); color: var(--tm-ro-selectedText); }
    .tm-ro-row.tm-ro-current .tm-ro-dir, .tm-ro-row.tm-ro-current .tm-ro-n,
    .tm-ro-row.tm-ro-current .tm-ro-add, .tm-ro-row.tm-ro-current .tm-ro-del { color: inherit; }
    .tm-ro-n { width: 18px; text-align: right; color: var(--tm-ro-dim); font-size: 11px; flex: none; }
    .tm-ro-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tm-ro-dir { color: var(--tm-ro-dim); font-size: 11px; }
    .tm-ro-read .tm-ro-name { opacity: .5; text-decoration: line-through; }
    .tm-ro-deleted .tm-ro-file { font-style: italic; }
    .tm-ro-stat { flex: none; font-size: 11px; font-variant-numeric: tabular-nums; }
    .tm-ro-add { color: var(--tm-ro-add); }
    .tm-ro-del { color: var(--tm-ro-del); }
    .tm-ro-indent { padding-left: 34px; }
    #tm-ro-keys { padding: 6px 12px; border-top: 1px solid var(--tm-ro-line); }
  `;

  let state = null; // { key, pull, order, read:Set, current, root }

  function isDark() {
    const el = document.documentElement;
    const mode = el.getAttribute('data-color-mode');
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function loadRead(key) {
    try {
      return new Set(JSON.parse(localStorage.getItem(STORE_PREFIX + key) || '[]'));
    } catch (e) {
      return new Set();
    }
  }
  function saveRead() {
    try {
      localStorage.setItem(STORE_PREFIX + state.key, JSON.stringify([...state.read]));
    } catch (e) {
      /* storage is not available: the marks stay for this page only */
    }
  }

  async function sha256Hex(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // GitHub gives each file of a pull request the anchor diff-<sha256 of path>.
  async function goToFile(index) {
    const file = state.order[index];
    if (!file) return;
    if (state.current != null && state.current !== index) state.read.add(state.order[state.current].path);
    state.current = index;
    saveRead();
    render();
    const anchor = 'diff-' + (await sha256Hex(file.path));
    const pull = pullFromLocation();
    if (pull && (pull.tab === 'files' || pull.tab === 'changes')) {
      const target = document.getElementById(anchor);
      if (target) target.scrollIntoView({ block: 'start' });
      if (location.hash !== '#' + anchor) location.hash = anchor;
    } else {
      sessionStorage.setItem(STORE_PREFIX + 'current', state.key + '\n' + file.path);
      location.assign(`/${state.pull.owner}/${state.pull.repo}/pull/${state.pull.number}/files#${anchor}`);
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function render() {
    const { root, order, read, current } = state;
    const theme = isDark() ? THEME_DARK : THEME_LIGHT;
    for (const [name, value] of Object.entries(theme)) root.style.setProperty('--tm-ro-' + name, value);

    const done = order.filter((f) => read.has(f.path)).length;
    root.querySelector('#tm-ro-count').textContent = `${done} of ${order.length} read`;
    root.querySelector('#tm-ro-progress > div').style.width = order.length ? (100 * done) / order.length + '%' : '0';

    const list = root.querySelector('#tm-ro-list');
    list.textContent = '';
    let group = null;
    order.forEach((file, index) => {
      const label = file.depth ? group : file.kind;
      if (label !== group) {
        group = label;
        const names = { source: 'Code, dependencies first', test: 'Other tests', config: 'Config', docs: 'Docs', generated: 'Generated, skim' };
        list.append(el('li', 'tm-ro-group', names[group]));
      }
      const row = el('li', 'tm-ro-row');
      if (file.depth) row.classList.add('tm-ro-indent');
      if (read.has(file.path)) row.classList.add('tm-ro-read');
      if (index === current) row.classList.add('tm-ro-current');
      if (file.status === 'deleted') row.classList.add('tm-ro-deleted');
      const parts = file.path.split('/');
      const name = el('span', 'tm-ro-name');
      name.append(el('span', 'tm-ro-file', parts.pop()), ' ', el('span', 'tm-ro-dir', parts.slice(-2).join('/')));
      const stat = el('span', 'tm-ro-stat');
      stat.append(el('span', 'tm-ro-add', '+' + file.additions), ' ', el('span', 'tm-ro-del', '−' + file.deletions));
      row.append(el('span', 'tm-ro-n', file.depth ? '' : String(index + 1)), name, stat);
      const uses = [...file.deps].map((d) => d.path.split('/').pop());
      const usedBy = [...file.usedBy].map((d) => d.path.split('/').pop());
      row.title =
        file.path +
        (file.status !== 'modified' ? `\n${file.status}` : '') +
        (uses.length ? `\nuses: ${uses.join(', ')}` : '') +
        (usedBy.length ? `\nused by: ${usedBy.join(', ')}` : '') +
        (file.subject ? `\ntest of: ${file.subject.path.split('/').pop()}` : '');
      row.addEventListener('click', (event) => {
        if (event.altKey) {
          // Alt+click: change the "read" mark only.
          if (read.has(file.path)) read.delete(file.path);
          else read.add(file.path);
          saveRead();
          render();
        } else {
          goToFile(index);
        }
      });
      list.append(row);
    });
    const currentRow = list.querySelector('.tm-ro-current');
    if (currentRow) currentRow.scrollIntoView({ block: 'nearest' });
  }

  function buildPanel() {
    const style = el('style');
    style.id = 'tm-ro-style';
    style.textContent = CSS;
    document.head.append(style);

    const root = el('div');
    root.id = 'tm-ro';
    const head = el('div');
    head.id = 'tm-ro-head';
    const title = el('span', null, 'Reading order');
    title.id = 'tm-ro-title';
    const count = el('span');
    count.id = 'tm-ro-count';
    head.append(title, count);
    const progress = el('div');
    progress.id = 'tm-ro-progress';
    progress.append(el('div'));
    const list = el('ol');
    list.id = 'tm-ro-list';
    const keys = el('div', null, `${KEY_PREVIOUS} previous \u00b7 ${KEY_NEXT} next \u00b7 alt+click: mark as read`);
    keys.id = 'tm-ro-keys';
    root.append(head, progress, list, keys);

    if (localStorage.getItem(STORE_PREFIX + 'closed') === '1') root.classList.add('tm-ro-closed');
    head.addEventListener('click', () => {
      const closed = root.classList.toggle('tm-ro-closed');
      localStorage.setItem(STORE_PREFIX + 'closed', closed ? '1' : '0');
    });
    document.body.append(root);
    return root;
  }

  function removePanel() {
    document.getElementById('tm-ro')?.remove();
    document.getElementById('tm-ro-style')?.remove();
    state = null;
  }

  function onKey(event) {
    if (!state || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && (target.closest('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)) return;
    if (event.key !== KEY_NEXT && event.key !== KEY_PREVIOUS) return;
    event.preventDefault();
    const step = event.key === KEY_NEXT ? 1 : -1;
    const from = state.current == null ? (step > 0 ? -1 : state.order.length) : state.current;
    const next = Math.min(state.order.length - 1, Math.max(0, from + step));
    goToFile(next);
  }

  // ---------------------------------------------------------------- Loader

  let loadingKey = null;

  async function start() {
    const pull = pullFromLocation();
    if (!pull) {
      removePanel();
      return;
    }
    const key = `${pull.owner}/${pull.repo}#${pull.number}`;
    if ((state && state.key === key) || loadingKey === key) return;
    removePanel();
    loadingKey = key;
    try {
      const order = analyze(await getDiff(pull));
      if (loadingKey !== key || !order.length) return;
      state = { key, pull, order, read: loadRead(key), current: null, root: buildPanel() };
      // After a move from a different tab to the files tab: keep the row.
      const saved = (sessionStorage.getItem(STORE_PREFIX + 'current') || '').split('\n');
      if (saved[0] === key) {
        const index = order.findIndex((f) => f.path === saved[1]);
        if (index >= 0) state.current = index;
      }
      render();
    } catch (e) {
      console.warn('[reading-order] no diff:', e);
    } finally {
      if (loadingKey === key) loadingKey = null;
    }
  }

  // For tests: the analysis without the page.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseDiff, linkFiles, readingOrder, analyze, kindOf };
    return;
  }

  document.addEventListener('keydown', onKey);
  // GitHub changes pages without a reload (Turbo, React router).
  document.addEventListener('turbo:load', start);
  window.addEventListener('popstate', start);
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      start();
    }
    if (state) {
      const dark = isDark();
      if (state.dark !== dark) {
        state.dark = dark;
        render();
      }
    }
  }, 1000);
  start();
})();
