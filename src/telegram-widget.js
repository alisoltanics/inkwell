// The Telegram widget that browses the vault inside the chat (Bot API 10.4).
//
// A widget is fixed code plus changeable state: this file holds the HTML that
// is sent once and never changes, and the builders that pack a page of the
// browser into the 1024-byte chat state the widget redraws from. The widget
// runs in a sandbox with no network and no disk, so every folder, name, size
// and page number has to travel in that state — hence the short keys and the
// byte caps below.

// Telegram refuses chat_data over 1024 UTF-8 bytes, at sending and in edits.
const STATE_LIMIT = 1024;
// Byte caps keep a page of eight long Persian names inside STATE_LIMIT.
const NAME_LIMIT = 56;
const PATH_LIMIT = 64;
const META_LIMIT = 16;

function truncateUtf8(text, maxBytes) {
  let out = '';
  for (const ch of String(text == null ? '' : text)) {
    if (Buffer.byteLength(out + ch, 'utf8') > maxBytes) break;
    out += ch;
  }
  return out;
}

function formatSize(bytes) {
  const n = Math.max(0, Math.floor(Number(bytes) || 0));
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function formatAge(mtime, now) {
  const seconds = Math.max(0, (now - mtime) / 1000);
  if (seconds < 60) return 'now';
  const minutes = seconds / 60;
  if (minutes < 60) return Math.floor(minutes) + 'm';
  const hours = minutes / 60;
  if (hours < 24) return Math.floor(hours) + 'h';
  const days = hours / 24;
  if (days < 30) return Math.floor(days) + 'd';
  const months = days / 30;
  if (months < 12) return Math.floor(months) + 'mo';
  return Math.floor(months / 12) + 'y';
}

function fileMeta(item, now) {
  if (item.size == null) return '';
  const size = formatSize(item.size);
  const age = item.mtime ? formatAge(item.mtime, now) : '';
  return truncateUtf8(age ? size + ' · ' + age : size, META_LIMIT);
}

// One page of the browser as the widget's chat state. Keys are one letter
// where they are read on every redraw; the widget renders:
//   t current folder token, c breadcrumb, p/k page of k, n/fo/fi counts,
//   r root token, u up token ("" at the root), i rows [kind, token, name, meta].
function buildVaultWidgetState(model) {
  const now = Date.now();
  const state = {
    v: 1,
    t: String(model.token || ''),
    c: truncateUtf8(model.current || '', PATH_LIMIT),
    p: Math.max(1, model.page || 1),
    k: Math.max(1, model.pageCount || 1),
    n: (model.items || []).length,
    fo: (model.folders || []).length,
    fi: (model.files || []).length,
    r: String(model.rootToken || ''),
    u: String(model.upToken || ''),
    i: (model.shown || []).map((item) => {
      const row = [item.folder ? 'd' : 'f', String(item.token || ''), truncateUtf8(item.name, NAME_LIMIT)];
      if (!item.folder) {
        const meta = fileMeta(item, now);
        if (meta) row.push(meta);
      }
      return row;
    }),
  };
  const json = JSON.stringify(state);
  if (Buffer.byteLength(json, 'utf8') > STATE_LIMIT) {
    throw new Error('The widget state is larger than Telegram allows.');
  }
  return json;
}

// Always a caption: it is the text in the chat list, in notifications and in
// search, and what an app without widget support shows instead of the widget.
function buildVaultWidgetCaption(model) {
  const where = model.current ? 'Vault / ' + truncateUtf8(model.current, 150) : 'Vault';
  const n = (model.items || []).length;
  return '📂 ' + where + ' · ' + n + (n === 1 ? ' item' : ' items')
    + ' — tap a folder to open it, a file to receive it.';
}

// The fixed code of the widget. It reads its state, redraws on every
// chatDataChanged, asks the bot with TelegramWidget.request() (the same
// "d:<token>" / "f:<token>" strings the inline buttons use) and renders the
// bot's answer when it carries a fresh state. Nothing here may reach the
// network, scroll, or use an input: buttons are the only controls.
const VAULT_WIDGET_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 4px 6px 6px;
  background: transparent;
  color: var(--tg-theme-text-color);
  font-family: system-ui, sans-serif;
  font-size: var(--tg-text-font-size, 15px);
  line-height: var(--tg-text-line-height, 1.35);
}
#w { display: flex; flex-direction: column; gap: 6px; }
.hd { display: flex; align-items: center; gap: 7px; }
.hd .bi { flex: 0 0 auto; font-size: 16px; }
.hd .cr {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.hd .pg {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--tg-theme-button-color);
  color: var(--tg-theme-button-text-color);
  font-size: .74em;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.sb { padding: 0 1px; font-size: .8em; color: var(--tg-theme-hint-color); }
.st {
  padding: 5px 9px;
  border-radius: 8px;
  background: var(--tg-theme-secondary-bg-color);
  color: var(--tg-theme-accent-text-color, var(--tg-theme-hint-color));
  font-size: .82em;
}
.em {
  padding: 12px 10px;
  border-radius: 10px;
  background: var(--tg-theme-secondary-bg-color);
  color: var(--tg-theme-hint-color);
  font-size: .85em;
  text-align: center;
}
.ls { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; }
.rw {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  margin: 0;
  padding: 7px 10px;
  border: 0;
  border-radius: 10px;
  background: var(--tg-theme-secondary-bg-color);
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: opacity .15s ease;
}
.rw:active { opacity: .7; }
.rw[disabled] { opacity: .55; }
.rw .gi { flex: 0 0 auto; width: 18px; font-size: 15px; text-align: center; }
/* the name takes only what it needs (a button's text would otherwise be
   centered), and the flexible spacer carries the meta to the row's end in
   both directions */
.rw .nm {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 64%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.rw .sp { flex: 1 1 auto; }
.rw .mt {
  flex: 0 0 auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: .76em;
  color: var(--tg-theme-hint-color);
}
.rw .chev { color: var(--tg-theme-accent-text-color); font-size: 1em; font-weight: 700; }
.nv { display: flex; align-items: center; gap: 6px; }
.nv .sp { flex: 1 1 auto; }
.bt {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  border: 0;
  padding: 6px 11px;
  border-radius: var(--tg-button-radius, 10px);
  background: var(--tg-theme-secondary-bg-color);
  color: var(--tg-theme-text-color);
  font: inherit;
  font-size: .8em;
  font-weight: 600;
  cursor: pointer;
  transition: opacity .15s ease;
}
.bt:active { opacity: .7; }
.bt[disabled] { opacity: .5; }
.bt.pr { background: var(--tg-theme-button-color); color: var(--tg-theme-button-text-color); }
.dt { font-size: .68em; color: var(--tg-theme-hint-color); letter-spacing: 1px; }
.dt.on { color: var(--tg-theme-button-color); }
</style>
</head>
<body>
<div id="w"></div>
<script>
(function () {
  var W = window.TelegramWidget;
  var root = document.getElementById('w');
  var st = null;
  var status = '';
  var busy = false;
  var told = false;
  var clearTimer = 0;

  var EX = {
    md: '📝', markdown: '📝', txt: '📄', pdf: '📕', html: '🌐', htm: '🌐', docx: '📘',
    png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼', svg: '🖼',
    bmp: '🖼', avif: '🖼', ico: '🖼'
  };
  var ERR = {
    RATE_LIMITED: 'Slow down a moment.',
    BUSY: 'Wait for the last tap.',
    TIMEOUT: 'No answer from the bot — tap again.',
    NOT_ALLOWED: 'This widget cannot ask the bot here.',
    FAILED: 'Could not reach the bot.',
    INVALID_ANSWER: 'That answer could not be read.'
  };

  function parse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }
  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"]/g, function (ch) {
      return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;';
    });
  }
  function iconOf(kind, name) {
    if (kind === 'd') return '📁';
    var m = /\\.([A-Za-z0-9]+)$/.exec(String(name || ''));
    return (m && EX[m[1].toLowerCase()]) || '📎';
  }

  function build() {
    var s = st;
    if (!s) return '<div class="em">No vault data yet — send <b>/files</b> to open the browser.</div>';
    var page = s.p || 1;
    var pages = s.k || 1;
    var h = '<div class="hd"><span class="bi">📂</span>'
      + '<span class="cr" dir="auto">' + esc(s.c || 'Vault') + '</span>'
      + (pages > 1 ? '<span class="pg">' + page + '/' + pages + '</span>' : '')
      + '</div>';
    h += '<div class="sb" dir="auto">' + (s.fo || 0) + ((s.fo === 1) ? ' folder · ' : ' folders · ')
      + (s.fi || 0) + ((s.fi === 1) ? ' file' : ' files') + '</div>';
    if (status) h += '<div class="st" dir="auto">' + esc(status) + '</div>';
    var list = s.i || [];
    if (!list.length) {
      h += '<div class="em">This folder is empty.</div>';
    } else {
      h += '<ul class="ls">';
      for (var n = 0; n < list.length; n++) {
        var it = list[n];
        var kind = it[0];
        var name = it[2];
        var mt = it[3] || (kind === 'd' ? '›' : '');
        h += '<li><button class="rw" data-d="' + esc(kind + ':' + it[1]) + '">'
          + '<span class="gi">' + iconOf(kind, name) + '</span>'
          + '<span class="nm" dir="auto">' + esc(name) + '</span>'
          + '<span class="sp"></span>'
          + (mt ? '<span class="mt' + (kind === 'd' ? ' chev' : '') + '" dir="auto">' + esc(mt) + '</span>' : '')
          + '</button></li>';
      }
      h += '</ul>';
    }
    var nav = '';
    if (s.u) nav += '<button class="bt" data-d="d:' + esc(s.u) + '">⬆ Up</button>';
    if (s.c) nav += '<button class="bt" data-d="d:' + esc(s.r) + '">⌂</button>';
    if (pages > 1) {
      nav += '<span class="sp"></span>';
      if (pages <= 5) {
        for (var p = 1; p <= pages; p++) {
          nav += '<span class="dt' + (p === page ? ' on' : '') + '">●</span>';
        }
      }
      if (page > 1) nav += '<button class="bt" data-d="d:' + esc(s.t) + ':p' + (page - 1) + '">◀</button>';
      if (page < pages) nav += '<button class="bt pr" data-d="d:' + esc(s.t) + ':p' + (page + 1) + '">▶</button>';
    }
    if (nav) h += '<div class="nv">' + nav + '</div>';
    return h;
  }

  function render() {
    root.innerHTML = build();
    if (!told) {
      told = true;
      if (W && W.ready) { try { W.ready(); } catch (e) {} }
    }
  }

  function setDisabled(off) {
    var buttons = root.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = off;
  }

  function scheduleClear() {
    if (!status) return;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(function () { clearTimer = 0; status = ''; render(); }, 4000);
  }

  // The bot's answer is either a whole fresh state (navigation) or a short
  // note such as "Sending…" (a file tap). The pushed chatDataChanged has the
  // same shape as the first kind.
  function apply(result) {
    var s = typeof result === 'string' ? parse(result) : result;
    if (!s) return;
    if (s.i) { st = s; status = ''; }
    else if (s.m) status = s.m;
    render();
    scheduleClear();
  }

  function haptic(fn) {
    if (W && W.HapticFeedback) { try { fn(W.HapticFeedback); } catch (e) {} }
  }

  root.addEventListener('click', function (e) {
    var node = e.target;
    while (node && node !== root && !(node.getAttribute && node.getAttribute('data-d'))) node = node.parentNode;
    if (!node || node === root || busy || !W || !W.request) return;
    var data = node.getAttribute('data-d');
    if (!data) return;
    busy = true;
    setDisabled(true);
    haptic(function (h) { h.selectionChanged(); });
    W.request(data).then(function (answer) {
      busy = false;
      setDisabled(false);
      apply(answer && answer.result);
    }, function (err) {
      busy = false;
      setDisabled(false);
      status = (err && ERR[err.code]) || 'Could not reach the bot.';
      render();
      scheduleClear();
      haptic(function (h) { h.notificationOccurred('error'); });
    });
  });

  if (W && W.onEvent) {
    W.onEvent('chatDataChanged', function () {
      st = parse(W.chatData);
      status = '';
      render();
    });
  }

  if (W && W.chatData) st = parse(W.chatData);
  render();
  // Ask for fresh state right away: in a private chat the request goes out as
  // soon as the widget is on screen, so the list reflects the desktop even
  // after the chat was left open. Failures (a forward, a preview) are silent.
  if (W && W.request && st && st.t) {
    W.request('d:' + st.t + ':p' + (st.p || 1)).then(function (a) {
      apply(a && a.result);
    }, function () {});
  }
})();
</script>
</body>
</html>`;

module.exports = {
  VAULT_WIDGET_HTML,
  buildVaultWidgetState,
  buildVaultWidgetCaption,
};
