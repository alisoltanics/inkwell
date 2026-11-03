// Renders a note that arrived from Telegram into the same self-contained HTML
// file the app exports: the Markdown is rendered with the same plugins as the
// preview, local images are embedded as data URIs, and html.js adds the styles
// and fonts. The result is sent back to the chat as a document.
const fs = require('fs');
const path = require('path');
const { buildStandaloneHtml, escapeHtmlText } = require('../html');

// A picture in a note is embedded in the page, so the exported file has no
// external dependencies. A 15 MB image is already generous for a note.
const IMAGE_LIMIT = 15 * 1024 * 1024;
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

let renderer = null;

function markdownRenderer() {
  if (renderer) return renderer;
  // Loaded on the first note from the phone: the plugins and the highlighter
  // are large and have no business delaying the window at launch.
  const MarkdownIt = require('markdown-it');
  const { full: emoji } = require('markdown-it-emoji');
  const footnote = require('markdown-it-footnote');
  const taskLists = require('markdown-it-task-lists');
  const mark = require('markdown-it-mark');
  const ins = require('markdown-it-ins');
  const sub = require('markdown-it-sub');
  const sup = require('markdown-it-sup');
  const anchor = require('markdown-it-anchor');
  const katex = require('@traptitech/markdown-it-katex');
  const hljs = require('highlight.js');
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true,
    highlight(str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          const html = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
          const safeLang = String(lang).replace(/[^\w+#.-]/g, '');
          return `<pre class="hljs"><code class="language-${safeLang}">${html}</code></pre>`;
        } catch (_) {}
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
    },
  })
    .use(emoji)
    .use(footnote)
    .use(taskLists)
    .use(mark)
    .use(ins)
    .use(sub)
    .use(sup)
    .use(anchor, { permalink: false })
    .use(katex, { throwOnError: false, errorColor: '#cc0000' });
  renderer = md;
  return md;
}

// First strong directional character decides, as in the preview. Markdown
// punctuation has no direction, so a Persian message opens right-to-left.
function detectDirection(text) {
  const strong = /([\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF])|([A-Za-z\u00C0-\u024F])/;
  const match = strong.exec(String(text || ''));
  return match && match[1] ? 'rtl' : 'ltr';
}

function mimeForFile(file) {
  return IMAGE_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function insideVault(root, file) {
  const base = path.resolve(root);
  const target = path.resolve(file);
  return target === base || target.startsWith(base + path.sep);
}

// A note's relative image path is resolved from the note's own folder, exactly
// like the preview does. Absolute paths and URLs keep the preview's meaning.
function vaultImageFile(src, noteDir, root) {
  let clean = String(src || '').split('#')[0].split('?')[0].trim();
  if (!clean || /^(?:data:|blob:|mailto:|\/\/)/i.test(clean)) return null;
  clean = clean.replace(/^\.\//, '');
  if (clean.startsWith('/')) clean = clean.slice(1);
  try { clean = decodeURIComponent(clean); } catch (_) {}
  const file = path.resolve(noteDir, clean);
  return insideVault(root, file) ? file : null;
}

async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return '';
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\//i.test(type)) return '';
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > IMAGE_LIMIT) return '';
    return `data:${type || 'image/png'};base64,${bytes.toString('base64')}`;
  } catch (_) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function imageDataUri(src, noteDir, root) {
  const value = String(src || '').trim();
  if (!value || /^data:/i.test(value)) return value;
  if (/^(?:https?:)?\/\//i.test(value)) return fetchImage(value);
  const file = vaultImageFile(value, noteDir, root);
  if (!file) return '';
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > IMAGE_LIMIT) return '';
    const bytes = await fs.promises.readFile(file);
    return `data:${mimeForFile(file)};base64,${bytes.toString('base64')}`;
  } catch (_) {
    return '';
  }
}

// Embed every <img> the rendered Markdown produced. A picture that cannot be
// read is dropped, as in the export dialog, instead of showing an empty box.
async function inlineImages(html, noteDir, root) {
  const tags = [...new Set((String(html).match(/<img\b[^>]*>/gi) || []))];
  if (!tags.length) return html;

  const replacements = new Map();
  await Promise.all(tags.map(async (tag) => {
    const attr = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (!attr) { replacements.set(tag, ''); return; }
    const src = attr[1] != null ? attr[1] : attr[2];
    const uri = await imageDataUri(src, noteDir, root);
    replacements.set(tag, uri ? tag.replace(attr[0], 'src="' + uri + '"') : '');
  }));

  let out = html;
  for (const [tag, replacement] of replacements) out = out.split(tag).join(replacement);
  return out;
}

function dateLabel(date) {
  const at = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return at.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function documentHeader(title, date) {
  return `<h1>${escapeHtmlText(title)}</h1><div class="doc-meta">Inkwell &middot; ${escapeHtmlText(dateLabel(date))}</div>`;
}

async function buildTelegramNoteHtml({ vaultRoot, relPath, markdown, title, date, dir }) {
  const root = path.resolve(vaultRoot);
  const noteDir = path.dirname(path.join(root, String(relPath || '')));
  const source = String(markdown || '');
  const body = await inlineImages(markdownRenderer().render(source), noteDir, root);
  const name = String(title || path.basename(String(relPath || ''), path.extname(String(relPath || ''))) || 'note');

  return buildStandaloneHtml({
    title: name,
    headerHtml: documentHeader(name, date),
    bodyHtml: body,
    // The direction chosen for the note in the app wins over guessing from the
    // text: a file explicitly set to RTL stays RTL even when its first words
    // are Latin.
    dir: dir === 'rtl' || dir === 'ltr' ? dir : detectDirection(source),
  });
}

// A Word file has no Markdown source: its own converter supplies the body, and
// the text of that body decides the reading direction unless the app holds an
// explicit direction for that file.
function buildTelegramDocxHtml({ buffer, title, date, dir }) {
  const { docxToHtml } = require('./docx');
  const { html } = docxToHtml(buffer);
  return buildStandaloneHtml({
    title,
    headerHtml: documentHeader(title, date),
    bodyHtml: html,
    dir: dir === 'rtl' || dir === 'ltr'
      ? dir
      : detectDirection(String(html).replace(/<[^>]*>/g, ' ')),
  });
}

module.exports = { buildTelegramNoteHtml, buildTelegramDocxHtml, detectDirection };
