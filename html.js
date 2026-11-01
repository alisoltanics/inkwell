const fs = require('fs');
const path = require('path');

// Renders the renderer's print payload into a single self-contained HTML file:
// all stylesheets are inlined, webfonts are embedded as base64 data URIs and
// every image is already inlined as a data URI by the renderer. The result can
// be opened in any browser or sent as a document with no external dependencies.
const RENDERER_DIR = path.join(__dirname, 'src', 'renderer');

const MIME = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function escapeHtmlText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Read a CSS file and inline every local url(...) as a base64 data URI.
// woff/ttf fallbacks are dropped so we only embed the (smaller) woff2 fonts.
function inlineCss(cssPath) {
  let css = fs.readFileSync(cssPath, 'utf8');
  css = css.replace(/,\s*url\([^)]*\.(?:woff|ttf|eot)\)(?:\s*format\([^)]*\))?/gi, '');
  const dir = path.dirname(cssPath);
  css = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (whole, _q, url) => {
    if (/^(data:|https?:|\/\/|#)/i.test(url)) return whole;
    const clean = url.split(/[?#]/)[0];
    try {
      const file = path.resolve(dir, clean);
      const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const b64 = fs.readFileSync(file).toString('base64');
      return `url(data:${mime};base64,${b64})`;
    } catch (_) {
      return whole;
    }
  });
  return css;
}

function buildStandaloneHtml(payload) {
  const p = payload || {};
  const title = escapeHtmlText(p.title || 'Document');
  const dir = p.dir === 'rtl' ? 'rtl' : 'ltr';
  const header = typeof p.headerHtml === 'string' ? p.headerHtml : '';
  const body = typeof p.bodyHtml === 'string' ? p.bodyHtml : '';

  const katexCss = inlineCss(path.join(RENDERER_DIR, 'katex.css'));
  const printCss = inlineCss(path.join(RENDERER_DIR, 'print.css'));

  const screenCss = `
@media screen {
  /* The page fills the window: a wide column with a small gutter, so a table or
     a screenshot is not squeezed into a narrow strip. */
  html { background: #eef1f5; }
  body {
    background: #eef1f5;
    padding: 20px 20px 56px;
    box-sizing: border-box;
    min-height: 100vh;
  }
  .doc-header, .markdown-body {
    width: 100%;
    max-width: 1400px;
    margin-left: auto;
    margin-right: auto;
    box-sizing: border-box;
    background: #ffffff;
  }
  /* Header and body form one sheet: no gap between them on screen. */
  .doc-header {
    margin: 0;
    padding: 30px 44px 14px;
    border-radius: 14px 14px 0 0;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  }
  .markdown-body {
    margin: 0;
    padding: 22px 44px 64px;
    border-radius: 0 0 14px 14px;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  }
}
@media screen and (max-width: 760px) {
  body { padding: 10px 10px 36px; }
  .doc-header { padding: 22px 18px 10px; }
  .markdown-body { padding: 16px 18px 44px; }
}`;

  return `<!DOCTYPE html>
<html lang="${dir === 'rtl' ? 'fa' : 'en'}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${katexCss}</style>
<style>${printCss}</style>
<style>${screenCss}</style>
</head>
<body>
<header class="doc-header">${header}</header>
<article class="markdown-body" dir="${dir}">${body}</article>
</body>
</html>`;
}

module.exports = { buildStandaloneHtml, escapeHtmlText };
