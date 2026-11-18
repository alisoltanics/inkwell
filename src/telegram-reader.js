// Turns a rendered page into chat messages, so a note can be read inside
// Telegram without a download. Only the tags Telegram's HTML mode knows are
// kept (bold, italic, code, pre, links, quotes); everything else becomes
// plain text with line breaks where the page had blocks.

const MESSAGE_LIMIT = 3800;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»' };

function decode(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] != null ? ENTITIES[n.toLowerCase()] : m));
}

function safeChar(code) {
  try { return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''; } catch (_) { return ''; }
}

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(text) {
  return esc(text).replace(/"/g, '&quot;');
}

function stripTags(markup) {
  return decode(String(markup).replace(/<[^>]*>/g, ''));
}

function htmlToBlocks(html) {
  const source = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, '');
  const body = (/<body\b[^>]*>([\s\S]*)<\/body>/i.exec(source) || [null, source])[1];

  const blocks = [];
  let cur = '';
  let pre = 0;
  let quote = 0;
  const lists = [];
  const links = [];

  const flush = () => {
    // a quote stays in one message: its paragraphs are line breaks, not blocks
    if (quote) { cur += '\n'; return; }
    const text = cur.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.replace(/<[^>]*>/g, '').trim()) { blocks.push(text); cur = ''; return; }
    // only opening tags so far (a quote about to get its paragraph): keep them
    if (!/<[a-z]/i.test(cur)) cur = '';
  };

  const re = /<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)|</gi;
  let m;
  while ((m = re.exec(body))) {
    if (m[4] != null) {
      const text = decode(m[4]);
      cur += esc(pre ? text : text.replace(/\s+/g, ' '));
      continue;
    }
    if (!m[2]) { cur += '&lt;'; continue; }
    const close = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (/^h[1-6]$/.test(tag)) {
      if (close) { cur += '</b>'; flush(); } else { flush(); cur += '<b>'; }
    } else if (tag === 'b' || tag === 'strong') cur += close ? '</b>' : '<b>';
    else if (tag === 'i' || tag === 'em') cur += close ? '</i>' : '<i>';
    else if (tag === 'u' || tag === 'ins') cur += close ? '</u>' : '<u>';
    else if (tag === 's' || tag === 'del' || tag === 'strike') cur += close ? '</s>' : '<s>';
    else if (tag === 'code') { if (!pre) cur += close ? '</code>' : '<code>'; }
    else if (tag === 'pre') {
      if (close) { if (pre) { pre--; cur += '</pre>'; flush(); } } else { flush(); pre++; cur += '<pre>'; }
    } else if (tag === 'a') {
      if (close) { cur += links.pop() ? '</a>' : ''; } else {
        const href = (/href\s*=\s*"([^"]*)"/i.exec(attrs) || /href\s*=\s*'([^']*)'/i.exec(attrs) || [])[1];
        const ok = href && /^(https?:|mailto:)/i.test(decode(href));
        links.push(!!ok);
        if (ok) cur += '<a href="' + escAttr(decode(href)) + '">';
      }
    } else if (tag === 'blockquote') {
      if (close) {
        quote = Math.max(0, quote - 1);
        if (!quote) { cur = cur.replace(/\s+$/, '') + '</blockquote>'; flush(); }
      } else { if (!quote) { flush(); cur += '<blockquote>'; } quote++; }
    }
    else if (tag === 'br') cur += '\n';
    else if (tag === 'li') {
      if (close) flush(); else {
        flush();
        const top = lists[lists.length - 1];
        const depth = '  '.repeat(Math.max(0, lists.length - 1));
        if (top && top.ordered) { top.n++; cur += depth + top.n + '. '; } else cur += depth + '• ';
      }
    } else if (tag === 'ul' || tag === 'ol') {
      if (close) { lists.pop(); flush(); } else { flush(); lists.push({ ordered: tag === 'ol', n: 0 }); }
    } else if (tag === 'td' || tag === 'th') { if (close) cur += '  '; }
    else if (tag === 'img') {
      const alt = (/alt\s*=\s*"([^"]*)"/i.exec(attrs) || [])[1];
      if (alt) cur += '🖼 ' + esc(decode(alt));
    } else if (['p', 'div', 'section', 'article', 'tr', 'table', 'figure', 'figcaption', 'header', 'footer', 'main', 'hr', 'dd', 'dt', 'dl'].includes(tag)) {
      flush();
    }
  }
  flush();
  return blocks;
}

function splitLong(block) {
  if (block.length <= MESSAGE_LIMIT) return [block];
  const pieces = [];
  if (block.startsWith('<pre>')) {
    const inner = block.replace(/^<pre>/, '').replace(/<\/pre>$/, '');
    let part = '';
    for (const line of inner.split('\n')) {
      if (part.length + line.length + 1 > MESSAGE_LIMIT - 20) { pieces.push('<pre>' + part + '</pre>'); part = ''; }
      part += (part ? '\n' : '') + line.slice(0, MESSAGE_LIMIT - 20);
    }
    if (part) pieces.push('<pre>' + part + '</pre>');
    return pieces;
  }
  // a long run of prose: tags are dropped so none can be cut in half
  const plain = esc(stripTags(block.replace(/<\/?(b|i|u|s|code|a|blockquote)\b[^>]*>/g, (t) => t.replace(/<[^>]*>/, ''))));
  const words = block.replace(/<[^>]*>/g, '').split(/(\s+)/);
  let part = '';
  for (const word of words) {
    if (part.length + word.length > MESSAGE_LIMIT) { pieces.push(esc(decode(part))); part = ''; }
    part += word;
  }
  if (part.trim()) pieces.push(esc(decode(part)));
  return pieces.length ? pieces : [plain.slice(0, MESSAGE_LIMIT)];
}

// Messages ready for sendMessage with parse_mode HTML.
function htmlToMessages(html) {
  const messages = [];
  let cur = '';
  let last = '';
  for (const block of htmlToBlocks(html)) {
    for (const piece of splitLong(block)) {
      if (cur && cur.length + piece.length + 2 > MESSAGE_LIMIT) { messages.push(cur); cur = ''; }
      const item = /^(• |\d+\. |\s+(• |\d+\. ))/;
      const glue = item.test(piece) && item.test(last) ? '\n' : '\n\n';
      cur += (cur ? glue : '') + piece;
      last = piece;
    }
  }
  if (cur) messages.push(cur);
  return messages.map((text) => text.replace(/<blockquote>\n+/g, '<blockquote>'));
}

function plainText(messageHtml) {
  return stripTags(messageHtml);
}

module.exports = { htmlToMessages, plainText };
