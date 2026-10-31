/* =====================================================================
   Minimal .docx -> HTML converter (no dependencies)

   A .docx file is a ZIP container with WordprocessingML inside. This module
   reads the archive with zlib, walks `word/document.xml` and produces a small,
   self-contained HTML fragment: headings, paragraphs, bold/italic runs, links,
   nested lists, simple tables, embedded images and horizontal rules.

   It is deliberately read-only and forgiving: anything it does not understand
   is skipped instead of failing the whole document.
   ===================================================================== */
const zlib = require('zlib');

/* ---------------- ZIP ---------------- */
function findEndOfCentralDirectory(buf) {
  const SIG = 0x06054b50;
  const floor = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === SIG) return i;
  }
  return -1;
}

// Returns a Map of entry name -> uncompressed Buffer.
function readZip(buf) {
  const entries = new Map();
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw new Error('Not a Word document (no ZIP directory)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (localOffset + 30 > buf.length) continue;
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    try {
      if (method === 0) entries.set(name, raw);
      else if (method === 8) entries.set(name, zlib.inflateRawSync(raw));
    } catch (_) {
      // a corrupt member is not worth failing the document for
    }
  }
  return entries;
}

function zipText(zip, name) {
  const b = zip.get(name);
  return b ? b.toString('utf8') : '';
}

/* ---------------- helpers ---------------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/emf',
  wmf: 'image/wmf',
};

function attrs(src) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(src))) out[m[1]] = m[2];
  return out;
}

const REL_TYPE = {
  image: '/image',
  hyperlink: '/hyperlink',
};

function parseRels(xml) {
  const map = new Map();
  const re = /<Relationship\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = attrs(m[1]);
    if (!a.Id || !a.Target) continue;
    let kind = '';
    for (const key of Object.keys(REL_TYPE)) {
      if ((a.Type || '').endsWith(REL_TYPE[key])) kind = key;
    }
    map.set(a.Id, { target: a.Target, kind });
  }
  return map;
}

// numId -> 'bullet' | 'decimal' (first level wins)
function parseNumbering(xml) {
  const abstractKinds = new Map();
  const abstractRe = /<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g;
  let m;
  while ((m = abstractRe.exec(xml))) {
    const a = attrs(m[1]);
    const id = a['w:abstractNumId'];
    if (id == null) continue;
    const fmt = m[2].match(/<w:numFmt\b[^>]*w:val="([^"]+)"/);
    abstractKinds.set(id, fmt ? fmt[1] : 'bullet');
  }
  const byNum = new Map();
  const numRe = /<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g;
  while ((m = numRe.exec(xml))) {
    const a = attrs(m[1]);
    const id = a['w:numId'];
    const abs = m[2].match(/<w:abstractNumId\b[^>]*w:val="([^"]+)"/);
    if (id == null || !abs) continue;
    byNum.set(id, abstractKinds.get(abs[1]) || 'bullet');
  }
  return byNum;
}

function headingLevel(style, outline) {
  if (style) {
    const h = /^heading\s*([1-9])$/i.exec(style) || /^heading([1-9])$/i.exec(style);
    if (h) return Math.min(6, Number(h[1]));
    if (/^title$/i.test(style)) return 1;
    if (/^subtitle$/i.test(style)) return 2;
  }
  if (outline != null && outline !== '') {
    const n = Number(outline);
    if (Number.isFinite(n) && n >= 0) return Math.min(6, n + 1);
  }
  return 0;
}

function isQuoteStyle(style) {
  return !!style && /quote/i.test(style);
}

/* ---------------- document walk ---------------- */
const TOKEN_RE = /<(\/?)([\w:.-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;

function docxToHtml(buffer) {
  const zip = readZip(buffer);
  const docXml = zipText(zip, 'word/document.xml');
  if (!docXml) throw new Error('Not a Word document (missing word/document.xml)');
  const rels = parseRels(zipText(zip, 'word/_rels/document.xml.rels'));
  const numbering = parseNumbering(zipText(zip, 'word/numbering.xml'));

  const out = [];           // finished block HTML
  const cellStack = [];     // open table cell buffers
  let para = null;          // { text, style, outline, numId, ilvl, align, tag }
  let run = { b: false, i: false, u: false, s: false };
  let inDeleted = false;
  let inProperties = 0;     // inside w:pPr / w:rPr
  let linkHref = '';        // non-empty while a w:hyperlink run is active
  let tableDepth = 0;
  let skipDepth = 0;        // inside w:instrText / w:delText / fields
  const counters = new Map(); // numId:level -> next number

  const target = () => (cellStack.length ? cellStack[cellStack.length - 1] : out);
  const pushHtml = (html) => target().push(html);

  function pushText(text) {
    if (!text || !para) return;
    let s = escapeHtml(text);
    if (run.b) s = `<strong>${s}</strong>`;
    if (run.i) s = `<em>${s}</em>`;
    if (run.u) s = `<u>${s}</u>`;
    if (run.s) s = `<s>${s}</s>`;
    if (linkHref) s = `<a href="${escapeHtml(linkHref)}" target="_blank" rel="noopener">${s}</a>`;
    para.text += s;
  }

  function closeParagraph() {
    if (!para) return;
    const text = para.text.trim();
    const hasImage = para.text.includes('<img');
    if (!text && !hasImage) { para = null; return; }
    const inCell = cellStack.length > 0;

    let html = '';
    if (para.numId) {
      const kind = numbering.get(para.numId) || 'bullet';
      const level = Math.max(0, Math.min(8, Number(para.ilvl != null ? para.ilvl : 0) || 0));
      const key = para.numId + ':' + level;
      const indent = 8 + level * 22;
      const marker = kind === 'bullet'
        ? '•'
        : (() => {
          const n = (counters.get(key) || 0) + 1;
          counters.set(key, n);
          return n + '.';
        })();
      html = `<div class="docx-li docx-li-${kind}" style="margin-inline-start:${indent}px">`
        + `<span class="docx-marker">${marker}</span><span class="docx-li-body">${para.text}</span></div>`;
    } else {
      for (const k of [...counters.keys()]) if (k.startsWith(para.numId + ':')) counters.delete(k);
      if (!para.numId) counters.clear();
      const level = headingLevel(para.style, para.outline);
      const quote = isQuoteStyle(para.style);
      const align = para.align && para.align !== 'left' && para.align !== 'start'
        ? ` style="text-align:${escapeHtml(para.align)}"` : '';
      if (level) html = `<h${level}${align}>${para.text}</h${level}>`;
      else if (quote) html = `<blockquote>${para.text}</blockquote>`;
      else html = `<p${align}>${para.text}</p>`;
    }
    pushHtml(html);
    para = null;
  }

  function openParagraph() {
    closeParagraph();
    para = { text: '', style: '', outline: null, numId: null, ilvl: 0, align: '' };
  }

  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(docXml))) {
    const closing = m[1] === '/';
    const name = m[2];
    const rawAttrs = m[3] || '';
    const selfClosing = m[4] === '/';
    const text = m[5];

    if (text != null) {
      if (skipDepth > 0) continue;
      if (name == null) { /* pure text token */ }
      if (text.trim() || (para && text)) pushText(text);
      continue;
    }

    // elements we never render
    if (/^w:(?:instrText|delText|del|moveFrom|commentReference|proofErr|bookmarkStart|bookmarkEnd)$/.test(name)) {
      if (!selfClosing && ['w:instrText', 'w:delText', 'w:del', 'w:moveFrom'].includes(name)) skipDepth++;
      if (closing && ['w:instrText', 'w:delText', 'w:del', 'w:moveFrom'].includes(name)) skipDepth = Math.max(0, skipDepth - 1);
      continue;
    }

    switch (name) {
      case 'w:p':
        if (selfClosing) { openParagraph(); closeParagraph(); }
        else if (closing) closeParagraph();
        else openParagraph();
        break;
      case 'w:pPr':
        if (!selfClosing) inProperties += 1;
        break;
      case 'w:rPr':
        if (!selfClosing) inProperties += 1;
        break;
      case 'w:r':
        if (!selfClosing) run = { b: false, i: false, u: false, s: false };
        break;
      case 'w:pStyle':
        if (para) para.style = attrs(rawAttrs)['w:val'] || '';
        break;
      case 'w:outlineLvl':
        if (para) para.outline = attrs(rawAttrs)['w:val'];
        break;
      case 'w:jc':
        if (para) para.align = attrs(rawAttrs)['w:val'] || '';
        break;
      case 'w:numId':
        if (para) para.numId = attrs(rawAttrs)['w:val'] || null;
        break;
      case 'w:ilvl':
        if (para) para.ilvl = Number(attrs(rawAttrs)['w:val'] || 0);
        break;
      case 'w:b':
        run.b = selfClosing ? true : attrs(rawAttrs)['w:val'] !== '0';
        break;
      case 'w:i':
        run.i = selfClosing ? true : attrs(rawAttrs)['w:val'] !== '0';
        break;
      case 'w:u': {
        const v = attrs(rawAttrs)['w:val'];
        run.u = selfClosing ? v !== 'none' : v !== 'none';
        break;
      }
      case 'w:strike':
        run.s = selfClosing ? true : attrs(rawAttrs)['w:val'] !== '0';
        break;
      case 'w:tab':
        if (para) para.text += ' ';
        break;
      case 'w:br': {
        const type = attrs(rawAttrs)['w:type'];
        if (type === 'page') pushHtml('<hr class="docx-page-break">');
        else if (para) para.text += '<br>';
        break;
      }
      case 'w:tbl':
        closeParagraph();
        if (closing) { pushHtml('</tbody></table>'); tableDepth = Math.max(0, tableDepth - 1); }
        else { pushHtml('<table class="docx-table"><tbody>'); tableDepth += 1; }
        break;
      case 'w:tr':
        if (closing) pushHtml('</tr>');
        else pushHtml('<tr>');
        break;
      case 'w:tc':
        if (closing) {
          const cell = cellStack.pop() || [];
          (cellStack.length ? cellStack[cellStack.length - 1] : out).push(`<td>${cell.join('')}</td>`);
        } else {
          closeParagraph();
          cellStack.push([]);
        }
        break;
      case 'w:hyperlink': {
        const a = attrs(rawAttrs);
        if (closing) { linkHref = ''; break; }
        const rel = a['r:id'] ? rels.get(a['r:id']) : null;
        linkHref = rel && rel.kind === 'hyperlink' ? rel.target : '';
        break;
      }
      case 'a:blip': {
        const a = attrs(rawAttrs);
        const id = a['r:embed'] || a['r:link'];
        const rel = id ? rels.get(id) : null;
        if (!rel || rel.kind !== 'image') break;
        const relPath = rel.target.replace(/^\.\.\//, '');
        const zipPath = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${relPath}`;
        const data = zip.get(zipPath.replace('/word/word/', 'word/'));
        if (!data) break;
        const ext = (zipPath.split('.').pop() || '').toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        pushHtml(`<img class="docx-image" alt="" src="data:${mime};base64,${data.toString('base64')}">`);
        break;
      }
      default:
        break;
    }
    if (closing && (name === 'w:pPr' || name === 'w:rPr')) inProperties = Math.max(0, inProperties - 1);
  }
  closeParagraph();
  while (tableDepth > 0) { out.push('</tbody></table>'); tableDepth -= 1; }

  return { html: out.join('\n') };
}

module.exports = { docxToHtml, readZip };
