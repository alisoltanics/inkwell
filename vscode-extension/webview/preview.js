// Runs inside the webview. It renders with Inkwell's own markdown-it bundle and
// keeps the small extras the app adds on top of it: a language class on code
// blocks and the interactive flashcard deck.
(function () {
  const vscode = acquireVsCodeApi();
  const md = window.__md;
  const hljs = window.__hljs;
  const content = document.getElementById('content');
  const pane = document.getElementById('pane');

  if (!md) {
    if (content) content.textContent = 'Inkwell Preview could not load its Markdown renderer.';
    return;
  }

  // Same as the app: keep the authored language on the code block so it is not
  // auto-detected (and labelled wrongly) a second time.
  md.options.highlight = function (str, lang) {
    const esc = String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    if (lang && hljs.getLanguage(lang)) {
      try {
        const html = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        const safe = String(lang).replace(/[^\w+#.-]/g, '');
        return '<pre class="hljs"><code class="language-' + safe + '">' + html + '</code></pre>';
      } catch (_) {}
    }
    return '<pre class="hljs"><code>' + esc + '</code></pre>';
  };

  /* ---- flashcards: ```flashcards fences still hold plain Q:/A: text ---- */
  function parseFlashcardBlock(text) {
    const cards = [];
    const qLine = /^Q\s*[:.)]\s*(.*)$/i;
    const aLine = /^A\s*[:.)]\s*(.*)$/i;
    for (const block of String(text || '').split(/\n[ \t]*\n/)) {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      if (!lines.length) continue;
      const question = [];
      const answer = [];
      let inAnswer = false;
      for (const line of lines) {
        if (!inAnswer) {
          const a = line.match(aLine);
          if (a) { inAnswer = true; answer.push(a[1]); continue; }
          const q = line.match(qLine);
          if (q) { question.push(q[1]); continue; }
          question.push(line);
          continue;
        }
        answer.push(line);
      }
      const q = question.join(' ').trim();
      const a = answer.join(' ').trim();
      if (!q || !a) continue;
      cards.push({ q, a });
      if (cards.length >= 60) break;
    }
    return cards.length ? cards : null;
  }

  function inline(text) {
    return md.renderInline(String(text || ''));
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = function (tokens, idx, options, env, self) {
    const info = String(tokens[idx].info || '').trim().split(/\s+/)[0].toLowerCase();
    if (info === 'flashcards' || info === 'flashcard') {
      const cards = parseFlashcardBlock(tokens[idx].content);
      if (cards) return '<div class="md-flashdeck" data-flashdeck="' + escapeAttr(JSON.stringify(cards)) + '"></div>\n';
    }
    return defaultFence.call(this, tokens, idx, options, env, self);
  };

  // A static deck with click-to-flip cards, using the app's own classes so the
  // stylesheet that came with it does all the work.
  function buildFlashdeck(cards) {
    const wrap = document.createElement('div');
    wrap.className = 'flashdeck-block';

    const head = document.createElement('div');
    head.className = 'flashdeck-head';
    const count = document.createElement('span');
    count.className = 'flashdeck-count';
    count.textContent = cards.length === 1 ? '1 card' : cards.length + ' cards';
    const hint = document.createElement('span');
    hint.className = 'flashdeck-hint';
    hint.textContent = 'Click a card to flip it';
    const revealAll = document.createElement('button');
    revealAll.type = 'button';
    revealAll.className = 'flashdeck-all';
    revealAll.textContent = 'Reveal all';
    head.append(count, hint, revealAll);

    const deck = document.createElement('div');
    deck.className = 'flashdeck';
    cards.forEach((card, index) => {
      const el = document.createElement('div');
      el.className = 'flashcard';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-pressed', 'false');
      el.innerHTML = '<div class="flashcard-q"><span class="flashcard-num">' + (index + 1) + '</span>'
        + '<span class="flashcard-q-text">' + inline(card.q) + '</span>'
        + '<span class="flashcard-toggle" aria-hidden="true">'
        + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
        + '</span></div>'
        + '<div class="flashcard-a">' + inline(card.a) + '</div>';
      const toggle = () => {
        const on = el.classList.toggle('revealed');
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
      });
      deck.appendChild(el);
    });

    revealAll.addEventListener('click', (event) => {
      event.stopPropagation();
      const all = Array.from(deck.querySelectorAll('.flashcard'));
      const reveal = all.some((card) => !card.classList.contains('revealed'));
      all.forEach((card) => {
        card.classList.toggle('revealed', reveal);
        card.setAttribute('aria-pressed', reveal ? 'true' : 'false');
      });
      revealAll.textContent = reveal ? 'Hide all' : 'Reveal all';
    });

    wrap.append(head, deck);
    return wrap;
  }

  function hydrateFlashcards(root) {
    root.querySelectorAll('.md-flashdeck[data-flashdeck]').forEach((placeholder) => {
      let cards = [];
      try { cards = JSON.parse(placeholder.getAttribute('data-flashdeck') || '[]'); } catch (_) { cards = []; }
      if (!cards.length) return;
      placeholder.replaceWith(buildFlashdeck(cards));
    });
  }

  /* ---- rendering ---- */
  let lastText = null;

  function scrollRatio() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? window.scrollY / max : 0;
  }

  function restoreScroll(ratio) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max > 0 && ratio > 0) window.scrollTo(0, Math.round(max * ratio));
  }

  function applyMeta(meta) {
    if (!meta) return;
    const html = document.documentElement;
    html.dataset.theme = meta.theme === 'light' ? 'light' : 'dark';
    if (meta.palette) html.dataset.palette = meta.palette;
    else delete html.dataset.palette;
    document.body.style.setProperty('--content-scale', String(meta.scale || 1));
    const dir = meta.direction === 'ltr' || meta.direction === 'rtl' ? meta.direction : 'auto';
    content.setAttribute('dir', dir);
    if (dir !== 'auto') html.setAttribute('dir', dir);
    else html.removeAttribute('dir');
  }

  function render(text) {
    const ratio = scrollRatio();
    const wasEmpty = lastText === null;
    lastText = String(text == null ? '' : text);
    content.innerHTML = md.render(lastText);
    hydrateFlashcards(content);
    restoreScroll(wasEmpty ? 0 : ratio);
    vscode.setState({ text: lastText });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'render') return;
    applyMeta(message.meta);
    render(message.text);
  });

  const saved = vscode.getState();
  if (saved && typeof saved.text === 'string') {
    // restore instantly while the extension sends the live buffer
    render(saved.text);
  }
  vscode.postMessage({ type: 'ready' });
})();
