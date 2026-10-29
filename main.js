const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const Store = require('electron-store');

app.setName('Inkwell');

const store = new Store({ name: 'inkwell' });
let NOTES_DIR = store.get('notesDir') || '';

function ensureNotesDir(dir) {
  const target = dir || NOTES_DIR;
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
}

if (NOTES_DIR) ensureNotesDir(NOTES_DIR);

function setNotesDir(newDir) {
  if (!newDir) return NOTES_DIR;
  try {
    const abs = path.resolve(newDir);
    if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
    NOTES_DIR = abs;
    store.set('notesDir', NOTES_DIR);
    ensureNotesDir(NOTES_DIR);
    return NOTES_DIR;
  } catch (e) {
    throw e;
  }
}

/* ================= PLAIN FILE STORAGE ================= */
// Notes are ordinary .md files with ordinary folder names. Paths that come
// from the renderer are validated and must stay inside the notes directory.

function normalizeSegments(logicalPath) {
  const raw = String(logicalPath == null ? '' : logicalPath).replace(/\\/g, '/');
  const parts = [];
  for (const seg of raw.split('/')) {
    const s = seg.trim();
    if (s === '..') throw new Error('Invalid path');
    if (!s || s === '.') continue;
    if (/[\x00-\x1f<>:"|?*]/.test(s)) throw new Error('Invalid characters in path');
    if (s.length > 200) throw new Error('Name too long');
    parts.push(s);
  }
  if (!parts.length) throw new Error('Invalid path');
  if (parts.length > 12) throw new Error('Path too deep');
  return parts;
}

function insideNotesDir(abs) {
  if (!NOTES_DIR) throw new Error('Choose a vault folder first');
  const rel = path.relative(NOTES_DIR, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveLogical(logicalPath, { createDirs = false } = {}) {
  const parts = normalizeSegments(logicalPath);
  const abs = path.join(NOTES_DIR, ...parts);
  if (!insideNotesDir(abs)) throw new Error('Invalid path');
  if (createDirs) fs.mkdirSync(path.dirname(abs), { recursive: true });
  return { abs, segments: parts };
}

function resolveDir(logicalPath, { createDirs = false } = {}) {
  const parts = normalizeSegments(logicalPath);
  const abs = path.join(NOTES_DIR, ...parts);
  if (!insideNotesDir(abs)) throw new Error('Invalid path');
  if (createDirs && !fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
  return { abs, segments: parts };
}

function listDirSafe(dirAbs) {
  try {
    return fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

function parentOf(segments) {
  return segments.slice(0, -1).join('/');
}

function joinLogical(dirPath, name) {
  return dirPath ? dirPath + '/' + name : name;
}

function walkNotes(dirAbs, prefix, files, folders) {
  for (const ent of listDirSafe(dirAbs)) {
    if (ent.name.startsWith('.')) continue;
    const logical = joinLogical(prefix, ent.name);
    const abs = path.join(dirAbs, ent.name);
    try {
      if (ent.isDirectory()) {
        const st = fs.statSync(abs);
        folders.push({ path: logical, modified: st.mtimeMs });
        walkNotes(abs, logical, files, folders);
        continue;
      }
      if (!ent.isFile() || !/\.(?:md|html?)$/i.test(ent.name)) continue;
      const st = fs.statSync(abs);
      files.push({ name: ent.name, path: logical, modified: st.mtimeMs, size: st.size });
    } catch (_) {}
  }
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Inkwell',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    // no OS title bar / window chrome — the app draws its own controls
    frame: false,
    backgroundColor: '#0a0e17',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools();
    }
  });

  const sendWinState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('win:state', {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    });
  };
  for (const evt of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(evt, sendWinState);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

/* ================= FILE IPC ================= */

ipcMain.handle('fs:list', async () => {
  try {
    if (!NOTES_DIR) return { files: [], folders: [] };
    const files = [];
    const folders = [];
    walkNotes(NOTES_DIR, '', files, folders);
    files.sort((a, b) => b.modified - a.modified);
    folders.sort((a, b) => a.path.localeCompare(b.path));
    return { files, folders };
  } catch (e) {
    return { files: [], folders: [], error: e.message };
  }
});

ipcMain.handle('fs:read', async (event, filename) => {
  try {
    const res = resolveLogical(filename);
    if (!fs.existsSync(res.abs)) throw new Error('File not found');
    return { success: true, content: fs.readFileSync(res.abs, 'utf8') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:write', async (event, filename, content) => {
  try {
    const res = resolveLogical(filename, { createDirs: true });
    const logical = res.segments[res.segments.length - 1];
    if (!logical.toLowerCase().endsWith('.md')) throw new Error('Invalid filename');
    fs.writeFileSync(res.abs, String(content ?? ''), 'utf8');
    return { success: true, path: res.segments.join('/') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:create', async (event, filename) => {
  try {
    const res = resolveLogical(filename, { createDirs: true });
    const logical = res.segments[res.segments.length - 1];
    if (!logical.toLowerCase().endsWith('.md')) throw new Error('Filename must end with .md');
    if (fs.existsSync(res.abs)) throw new Error('File already exists');
    const title = logical.replace(/\.md$/i, '');
    fs.writeFileSync(res.abs, '# ' + title + '\n\n', 'utf8');
    return { success: true, path: res.segments.join('/') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:delete', async (event, filename) => {
  try {
    const res = resolveLogical(filename);
    if (!fs.existsSync(res.abs)) throw new Error('File not found');
    fs.unlinkSync(res.abs);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:rename', async (event, oldPath, newPath) => {
  try {
    const src = resolveLogical(oldPath);
    if (!fs.existsSync(src.abs)) throw new Error('Source file does not exist');
    const newSegments = normalizeSegments(newPath);
    if (!newSegments[newSegments.length - 1].toLowerCase().endsWith('.md')) {
      throw new Error('Filename must end with .md');
    }
    // A rename must never create folders: the destination directory has to
    // already exist, otherwise the note would land in a freshly built tree.
    const dst = resolveLogical(newPath, { createDirs: false });
    if (!fs.existsSync(path.dirname(dst.abs))) throw new Error('Target folder does not exist');
    if (fs.existsSync(dst.abs) && src.abs !== dst.abs) throw new Error('A file with that name already exists');
    fs.renameSync(src.abs, dst.abs);
    return { success: true, path: dst.segments.join('/') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:mkdir', async (event, folderPath) => {
  try {
    const res = resolveDir(folderPath, { createDirs: true });
    return { success: true, path: res.segments.join('/') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:rmdir', async (event, folderPath) => {
  try {
    const res = resolveDir(folderPath);
    if (!fs.existsSync(res.abs)) throw new Error('Folder not found');
    if (res.abs === NOTES_DIR) throw new Error('Cannot delete the notes root');
    fs.rmSync(res.abs, { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:renameFolder', async (event, oldPath, newPath) => {
  try {
    const src = resolveDir(oldPath);
    if (!fs.existsSync(src.abs)) throw new Error('Source folder does not exist');
    const newSegments = normalizeSegments(newPath);
    if (src.segments.join('/') === newSegments.join('/')) return { success: true, path: newPath };
    const dst = resolveDir(newSegments.join('/'), { createDirs: false });
    if (!fs.existsSync(path.dirname(dst.abs))) throw new Error('Target folder does not exist');
    if (fs.existsSync(dst.abs)) throw new Error('A folder with that name already exists');
    // no mkdir here: renaming a folder never builds new parent folders either
    fs.renameSync(src.abs, dst.abs);
    return { success: true, path: dst.segments.join('/') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:getNotesDir', async () => {
  return NOTES_DIR;
});

/* ================= ARCHIVE ================= */
// Archived items are plain files moved into .inkwell/archive/<original path>.
// walkNotes() skips dot folders, so they vanish from the notes tree while
// staying readable in the vault; restoring moves them back where they came
// from because the archive keeps the original folder structure.
function archiveRoot() {
  return path.join(NOTES_DIR, '.inkwell', 'archive');
}

// remove folders that became empty inside the archive (never the archive root)
function pruneEmptyArchiveDirs(dirAbs) {
  const root = archiveRoot();
  let cur = dirAbs;
  while (cur.startsWith(root) && cur !== root) {
    try {
      if (fs.readdirSync(cur).length) break;
      fs.rmdirSync(cur);
    } catch (_) {
      break;
    }
    cur = path.dirname(cur);
  }
}

ipcMain.handle('archive:list', async () => {
  try {
    if (!NOTES_DIR) return { files: [], folders: [] };
    const base = archiveRoot();
    const files = [];
    const folders = [];
    if (fs.existsSync(base)) walkNotes(base, '', files, folders);
    files.sort((a, b) => b.modified - a.modified);
    folders.sort((a, b) => a.path.localeCompare(b.path));
    return { files, folders };
  } catch (e) {
    return { files: [], folders: [], error: e.message };
  }
});

ipcMain.handle('archive:add', async (event, logicalPath) => {
  try {
    if (!NOTES_DIR) throw new Error('Choose a vault folder first');
    const segments = normalizeSegments(logicalPath);
    if (segments[0] === '.inkwell') throw new Error('Already archived');
    const srcAbs = path.join(NOTES_DIR, ...segments);
    if (!insideNotesDir(srcAbs)) throw new Error('Invalid path');
    if (!fs.existsSync(srcAbs)) throw new Error('Item not found');
    const dstAbs = path.join(archiveRoot(), ...segments);
    if (fs.existsSync(dstAbs)) throw new Error('An archived copy of this item already exists');
    fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
    fs.renameSync(srcAbs, dstAbs);
    return { success: true, path: segments.join('/') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('archive:restore', async (event, archivedPath) => {
  try {
    if (!NOTES_DIR) throw new Error('Choose a vault folder first');
    const segments = normalizeSegments(archivedPath);
    const srcAbs = path.join(archiveRoot(), ...segments);
    if (!fs.existsSync(srcAbs)) throw new Error('Archived item not found');
    const dstAbs = path.join(NOTES_DIR, ...segments);
    if (!insideNotesDir(dstAbs)) throw new Error('Invalid path');
    if (fs.existsSync(dstAbs)) throw new Error('A note with that name already exists');
    fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
    fs.renameSync(srcAbs, dstAbs);
    pruneEmptyArchiveDirs(path.dirname(srcAbs));
    return { success: true, path: segments.join('/') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('archive:delete', async (event, archivedPath) => {
  try {
    const segments = normalizeSegments(archivedPath);
    const target = path.join(archiveRoot(), ...segments);
    if (!fs.existsSync(target)) throw new Error('Archived item not found');
    fs.rmSync(target, { recursive: true, force: true });
    pruneEmptyArchiveDirs(path.dirname(target));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:setNotesDir', async (event, dirPath) => {
  try {
    const dir = setNotesDir(dirPath);
    return { success: true, path: dir };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:chooseNotesDir', async (event) => {
  const win = windowFrom(event);
  try {
    const res = await dialog.showOpenDialog(win || BrowserWindow.getFocusedWindow(), {
      title: 'Select vault folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: NOTES_DIR,
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) {
      return { success: false, canceled: true };
    }
    return { success: true, path: path.resolve(res.filePaths[0]) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  ico: 'image/x-icon',
};

ipcMain.handle('fs:readBinary', async (event, logicalPath) => {
  try {
    const res = resolveLogical(logicalPath);
    if (!fs.existsSync(res.abs)) throw new Error('File not found');
    if (!fs.statSync(res.abs).isFile()) throw new Error('Not a file');
    const buf = fs.readFileSync(res.abs);
    const ext = path.extname(logicalPath).slice(1).toLowerCase();
    return {
      success: true,
      base64: buf.toString('base64'),
      mime: MIME_BY_EXT[ext] || 'application/octet-stream',
      size: buf.length,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:writeBinary', async (event, logicalPath, base64) => {
  try {
    const res = resolveLogical(logicalPath, { createDirs: true });
    const buf = Buffer.from(String(base64 || ''), 'base64');
    fs.writeFileSync(res.abs, buf);
    return { success: true, path: res.segments.join('/') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/* ================= WINDOW CHROME ================= */

function windowFrom(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow;
}

ipcMain.handle('win:minimize', (event) => {
  const win = windowFrom(event);
  if (win) win.minimize();
});

ipcMain.handle('win:toggleMaximize', (event) => {
  const win = windowFrom(event);
  if (!win) return { maximized: false };
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return { maximized: win.isMaximized() };
});

ipcMain.handle('win:toggleFullscreen', (event) => {
  const win = windowFrom(event);
  if (!win) return { fullscreen: false };
  win.setFullScreen(!win.isFullScreen());
  return { fullscreen: win.isFullScreen() };
});

ipcMain.handle('win:isMaximized', (event) => {
  const win = windowFrom(event);
  return { maximized: !!(win && win.isMaximized()), fullscreen: !!(win && win.isFullScreen()) };
});

ipcMain.handle('win:close', (event) => {
  const win = windowFrom(event);
  if (win) win.close();
});

/* ================= DOCUMENT EXPORT (self-contained HTML) ================= */

const { buildStandaloneHtml } = require('./html');

function docBaseName(suggestedName) {
  return String(suggestedName || 'note')
    .replace(/\.md$/i, '')
    .split('/').pop()
    .replace(/[\\:*?"<>|]/g, '-')
    .trim() || 'note';
}

ipcMain.handle('dialog:exportHTML', async (event, sourcePath, payload) => {
  const win = windowFrom(event);
  if (!win) return { success: false, error: 'No window available' };

  try {
    const source = resolveLogical(sourcePath);
    if (!source.abs.toLowerCase().endsWith('.md')) throw new Error('Only Markdown documents can be exported');
    if (!fs.existsSync(source.abs)) throw new Error('Markdown document not found');
    const outputSegments = [...source.segments];
    outputSegments[outputSegments.length - 1] = outputSegments[outputSegments.length - 1].replace(/\.md$/i, '.html');
    // An archived note exports beside the note in the vault. Writing inside
    // .inkwell/archive would hide the file from the list (dot folders are skipped).
    if (outputSegments.length >= 3 && outputSegments[0] === '.inkwell' && outputSegments[1] === 'archive') {
      outputSegments.splice(0, 2);
    }
    const output = resolveLogical(outputSegments.join('/'), { createDirs: true });
    fs.writeFileSync(output.abs, buildStandaloneHtml(payload), 'utf8');
    return { success: true, path: output.abs };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Render the standalone HTML in an offscreen window and hand it to the
// system print dialog. The payload is the same one exportHTML uses, so the
// printed output matches the exported HTML exactly.
ipcMain.handle('print:html', async (event, payload) => {
  const win = windowFrom(event);
  if (!win) return { success: false, error: 'No window available' };

  let html;
  try {
    html = buildStandaloneHtml(payload);
  } catch (e) {
    return { success: false, error: 'Failed to build document: ' + e.message };
  }

  const tmpFile = path.join(app.getPath('temp'), `inkwell-print-${Date.now()}-${process.pid}.html`);
  try { fs.writeFileSync(tmpFile, html, 'utf8'); } catch (e) {
    return { success: false, error: e.message };
  }
  const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };

  return await new Promise((resolve) => {
    const printWin = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!printWin.isDestroyed()) printWin.destroy();
      resolve(result);
    };

    printWin.webContents.once('did-finish-load', () => {
      // silent:false → show the OS print dialog (page preview + printer choice)
      printWin.webContents.print({ silent: false, printBackground: true }, (error) => {
        if (error && !/cancel/i.test(String(error.message || error))) {
          done({ success: false, error: String(error.message || error) });
        } else {
          done({ success: true });
        }
      });
    });
    printWin.webContents.once('did-fail-load', (_e, code, desc) => {
      done({ success: false, error: `Failed to render document (${desc || code})` });
    });
    printWin.on('closed', () => done({ success: false, error: 'Print window was closed' }));

    printWin.loadFile(tmpFile).catch((e) => done({ success: false, error: e.message }));
  });
});

/* ================= TELEGRAM SETTINGS + SENDING ================= */

function getTelegramConfig() {
  const saved = store.get('telegram') || {};
  const env = process.env;
  const botToken = String(saved.botToken || env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(saved.chatId || env.TELEGRAM_CHAT_ID || '').trim();
  let source = 'none';
  if (saved.botToken || saved.chatId) source = 'settings';
  else if (botToken || chatId) source = 'env';
  return { botToken, chatId, source };
}

function validTelegramToken(token) {
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(token);
}

async function telegramApi(method, body) {
  const { botToken } = getTelegramConfig();
  const resp = await fetch('https://api.telegram.org/bot' + botToken + '/' + method, {
    method: 'POST',
    body,
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const desc = (json && json.description) || ('HTTP ' + resp.status);
    throw new Error(desc);
  }
  return json.result;
}

ipcMain.handle('settings:getTelegram', async () => {
  const cfg = getTelegramConfig();
  return { success: true, ...cfg };
});

ipcMain.handle('settings:setTelegram', async (event, config) => {
  try {
    const botToken = String((config && config.botToken) || '').trim();
    const chatId = String((config && config.chatId) || '').trim();
    if (botToken && !validTelegramToken(botToken)) {
      return { success: false, error: 'That does not look like a valid bot token.' };
    }
    if (botToken && !chatId) {
      return { success: false, error: 'A chat ID is required when a bot token is set.' };
    }
    store.set('telegram', { botToken, chatId });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('telegram:test', async (event, config) => {
  const saved = getTelegramConfig();
  const botToken = String((config && config.botToken) || saved.botToken || '').trim();
  const chatId = String((config && config.chatId) || saved.chatId || '').trim();
  if (!botToken || !chatId) {
    return { success: false, error: 'Telegram is not configured yet.' };
  }
  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('text', '✅ Inkwell is connected. This is a test message.');
    const resp = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
      method: 'POST',
      body: form,
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok || !json || json.ok !== true) {
      return { success: false, error: (json && json.description) || ('HTTP ' + resp.status) };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('telegram:sendHTML', async (event, suggestedName, payload) => {
  const win = windowFrom(event);
  if (!win) return { success: false, error: 'No window available' };

  const creds = getTelegramConfig();
  if (!creds.botToken || !creds.chatId) {
    return { success: false, error: 'Telegram is not configured. Open Settings → Telegram.' };
  }

  const base = docBaseName(suggestedName);
  const filename = base + '.html';

  let html;
  try {
    html = buildStandaloneHtml(payload);
  } catch (e) {
    return { success: false, error: 'Failed to build document: ' + e.message };
  }

  try {
    const form = new FormData();
    form.append('chat_id', creds.chatId);
    form.append('caption', filename);
    form.append('document', new Blob([html], { type: 'text/html' }), filename);
    await telegramApi('sendDocument', form);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/* ================= ASK AI ================= */
// Non-interactive CLIs installed on the machine. The renderer only sends a
// provider id + prompt text; the command itself is fixed here so the renderer
// can never inject arbitrary shell/cmd arguments.

const AI_TIMEOUT = 180000;
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const THINK_RE = /<\/?think(?:ing)?>/gi;

function aiSearchDirs() {
  const home = app.getPath('home');
  const dirs = [];
  const seen = new Set();
  const push = (d) => { if (d && !seen.has(d)) { seen.add(d); dirs.push(d); } };
  for (const d of (process.env.PATH || '').split(path.delimiter)) push(d);
  [
    path.join(home, '.local', 'bin'),
    path.join(home, '.opencode', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin', '/usr/bin', '/bin',
    '/usr/local/sbin', '/usr/sbin', '/sbin', '/snap/bin',
    // Codex CLI ships inside the ChatGPT desktop app
    '/usr/lib/chatgpt/resources',
    '/usr/lib/chatgpt',
  ].forEach(push);
  return dirs;
}

function resolveExecutable(cmd) {
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
  for (const dir of aiSearchDirs()) {
    const full = path.join(dir, cmd);
    try { if (fs.existsSync(full)) return full; } catch (_) {}
  }
  return null;
}

function captureAICommand(cmd, args, options = {}) {
  const executable = resolveExecutable(cmd);
  if (!executable) return Promise.resolve({ ok: false, error: `Could not find "${cmd}" on PATH.` });
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(executable, args, {
        cwd: NOTES_DIR || app.getPath('home'),
        env: { ...process.env, ...(options.env || {}), PATH: aiSearchDirs().join(path.delimiter) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      resolve({ ok: false, error: `${cmd} model discovery timed out.` });
    }, options.timeout || 20000);
    proc.stdout.on('data', (chunk) => { if (stdout.length < 2_000_000) stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { if (stderr.length < 30000) stderr += chunk.toString(); });
    proc.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, error: error.message }); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0
        ? { ok: true, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) }
        : { ok: false, error: stripAnsi(stderr || stdout).trim() || `${cmd} exited with code ${code}` });
    });
    proc.stdin.end();
  });
}

function listCodexModels() {
  const executable = resolveExecutable('codex');
  if (!executable) return Promise.resolve({ ok: false, error: 'Codex CLI was not found.' });
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(executable, ['app-server'], {
        cwd: NOTES_DIR || app.getPath('home'),
        env: { ...process.env, PATH: aiSearchDirs().join(path.delimiter) },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    let buffer = '';
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { proc.kill('SIGTERM'); } catch (_) {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'Codex model discovery timed out.' }), 20000);
    const send = (message) => proc.stdin.write(JSON.stringify(message) + '\n');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        let message;
        try { message = JSON.parse(line); } catch (_) { continue; }
        if (message.id === 1) {
          if (message.error) return finish({ ok: false, error: message.error.message || 'Codex initialization failed.' });
          send({ method: 'initialized', params: {} });
          send({ method: 'model/list', id: 2, params: { limit: 200, includeHidden: false } });
        } else if (message.id === 2) {
          if (message.error) return finish({ ok: false, error: message.error.message || 'Could not list Codex models.' });
          const entries = message.result && Array.isArray(message.result.data) ? message.result.data : [];
          const models = entries.filter((model) => model && model.id && !model.hidden).map((model) => ({
            id: String(model.model || model.id),
            name: String(model.displayName || model.name || model.id),
          }));
          finish({ ok: true, models });
        }
      }
    });
    proc.on('error', (error) => finish({ ok: false, error: error.message }));
    proc.on('close', (code) => {
      if (!finished) finish({ ok: false, error: `Codex app-server exited with code ${code}.` });
    });
    proc.stdin.on('error', () => {});
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'inkwell', title: 'Inkwell', version: app.getVersion() } } });
  });
}

function listClaudeModels(providerConfig = {}) {
  const env = { ...readClaudeEnv(), ...(providerConfig.env || {}), ...providerCredentialEnv(providerConfig) };
  const models = [
    { id: 'sonnet', name: 'Claude Sonnet (latest)' },
    { id: 'opus', name: 'Claude Opus (latest)' },
    { id: 'haiku', name: 'Claude Haiku (latest)' },
  ];
  const configured = [env.ANTHROPIC_MODEL, env.ANTHROPIC_DEFAULT_OPUS_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_DEFAULT_HAIKU_MODEL];
  try {
    const file = path.join(app.getPath('home'), '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    configured.push(settings.model);
    if (settings.env && typeof settings.env === 'object') {
      configured.push(settings.env.ANTHROPIC_MODEL, settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL);
    }
  } catch (_) {}
  for (const value of configured) {
    const id = String(value || '').trim();
    if (id && !models.some((model) => model.id === id)) models.push({ id, name: id });
  }
  return Promise.resolve({ ok: true, models });
}

async function discoverAIModels(providerId, providerConfig = {}) {
  const type = providerConfig.type || providerId;
  if (Array.isArray(providerConfig.models) && providerConfig.models.length) {
    return { ok: true, models: providerConfig.models.map((model) => typeof model === 'string' ? ({ id: model, name: model }) : model).filter((model) => model && model.id) };
  }
  if (type === 'claude' || providerId === 'claude') return listClaudeModels(providerConfig);
  if (type === 'codex' || providerId === 'codex') return listCodexModels();
  if (type === 'opencode' || providerId === 'opencode') {
    const result = await captureAICommand(providerConfig.command || 'opencode', ['models'], { timeout: 20000, env: providerCredentialEnv(providerConfig) });
    if (!result.ok) return { ok: false, models: [], error: result.error };
    const ids = new Set();
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = line.trim().match(/^([\w.-]+\/[\w.:+-]+)$/);
      if (match) ids.add(match[1]);
    }
    return { ok: true, models: Array.from(ids, (id) => ({ id, name: id })) };
  }
  const modelNames = Array.isArray(providerConfig.models) ? providerConfig.models : [];
  return { ok: true, models: modelNames.map((model) => typeof model === 'string' ? ({ id: model, name: model }) : model).filter((model) => model && model.id) };
}

// VS Code stores the user's Claude Code credentials (API key + gateway base
// URL) as JSONC under claudeCode.environmentVariables. We read them so the
// claude CLI talks to the same endpoint the editor uses.
function stripJsonComments(str) {
  let out = '';
  let inStr = false;
  let inLine = false;
  let inBlock = false;
  let esc = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const n = str[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

const claudeEnvCache = { mtime: 0, env: {} };

function readClaudeEnv() {
  const file = path.join(app.getPath('home'), '.config', 'Code', 'User', 'settings.json');
  try {
    const st = fs.statSync(file);
    if (st.mtimeMs === claudeEnvCache.mtime) return claudeEnvCache.env;
    const json = JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8')));
    const list = json && json['claudeCode.environmentVariables'];
    const env = {};
    if (Array.isArray(list)) {
      for (const e of list) {
        if (e && typeof e.name === 'string' && typeof e.value === 'string' && e.value) {
          env[e.name] = e.value;
        }
      }
    }
    claudeEnvCache.mtime = st.mtimeMs;
    claudeEnvCache.env = env;
    return env;
  } catch (_) {
    return claudeEnvCache.env || {};
  }
}

function stripAnsi(s) {
  return String(s).replace(ANSI_RE, '');
}

function parseOpencodeJson(out) {
  let text = '';
  for (const line of String(out).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const ev = JSON.parse(t);
      if (ev && ev.type === 'text' && ev.part && typeof ev.part.text === 'string') {
        text += ev.part.text;
      }
    } catch (_) {}
  }
  return text.replace(THINK_RE, '').trim();
}

const AI_OUTPUT_TOKEN = '__INKWELL_OUT__';

const DEFAULT_CREDENTIAL_ENV = {
  claude: { apiKey: 'ANTHROPIC_API_KEY', baseUrl: 'ANTHROPIC_BASE_URL' },
  default: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
};

// Environment variables carrying a custom provider's API key / base URL.
function providerCredentialEnv(cfg) {
  const env = {};
  if (!cfg || typeof cfg !== 'object') return env;
  const names = DEFAULT_CREDENTIAL_ENV[cfg.type] || DEFAULT_CREDENTIAL_ENV.default;
  const valid = (n) => typeof n === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n.trim());
  const keyName = valid(cfg.apiKeyEnv) ? cfg.apiKeyEnv.trim() : names.apiKey;
  const urlName = valid(cfg.baseUrlEnv) ? cfg.baseUrlEnv.trim() : names.baseUrl;
  if (typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) env[keyName] = cfg.apiKey.trim();
  if (typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim()) env[urlName] = cfg.baseUrl.trim();
  return env;
}

function buildAICommand(provider, prompt, model, providerConfig) {
  if (providerConfig && providerConfig.command && providerConfig.type) {
    const cmd = providerConfig.command;
    const type = providerConfig.type;
    if (type === 'claude' || cmd === 'claude') {
      const args = providerConfig.args ? providerConfig.args.map((a) => String(a)) : ['-p'];
      if (model && providerConfig.useModel !== false) {
        if (!args.includes('--model') && !args.includes('-m')) {
          args.push('--model', model);
        }
      }
      return { cmd, args, stdin: providerConfig.stdin !== false ? prompt : null, parse: providerConfig.parse || 'text', env: providerConfig.useClaudeEnv !== false ? readClaudeEnv() : {} };
    }
    if (type === 'codex' || cmd === 'codex') {
      const args = providerConfig.args ? providerConfig.args.map((a) => String(a)) : ['exec', '--skip-git-repo-check', '-s', 'read-only', '--color', 'never'];
      if (model && providerConfig.useModel !== false) {
        if (!args.includes('-m') && !args.includes('--model')) {
          args.push('-m', model);
        }
      }
      if (!args.includes('-o')) {
        args.push('-o', AI_OUTPUT_TOKEN, '-');
      }
      if (!args.includes('-')) args.push('-');
      return { cmd, args, stdin: prompt, parse: providerConfig.parse || 'file' };
    }
    if (type === 'opencode' || cmd === 'opencode') {
      const args = providerConfig.args ? providerConfig.args.map((a) => String(a)) : ['run', '--format', 'json'];
      if (model && providerConfig.useModel !== false) {
        if (!args.includes('-m') && !args.includes('--model')) {
          args.push('-m', model);
        }
      }
      if (providerConfig.passPromptAsArg !== false) {
        args.push(prompt);
        return { cmd, args, stdin: providerConfig.stdin || null, parse: providerConfig.parse || 'opencode-json' };
      }
      return { cmd, args, stdin: prompt, parse: providerConfig.parse || 'opencode-json' };
    }
    // Generic custom provider
    const args = providerConfig.args ? providerConfig.args.map((a) => String(a)) : [];
    if (model && providerConfig.useModel !== false) {
      if (providerConfig.modelFlag) {
        if (!args.includes(providerConfig.modelFlag)) args.push(providerConfig.modelFlag, model);
      } else if (!args.includes('-m') && !args.includes('--model')) {
        // try to infer - don't add by default
      }
    }
    if (providerConfig.promptFlag) {
      args.push(providerConfig.promptFlag, prompt);
      return { cmd, args, stdin: providerConfig.stdin || null, parse: providerConfig.parse || 'text' };
    }
    if (providerConfig.passPromptAsArg !== false && args.indexOf(prompt) === -1) {
      args.push(prompt);
    }
    return { cmd, args, stdin: providerConfig.stdin !== false && providerConfig.promptFlag ? null : (providerConfig.stdin === undefined ? (providerConfig.passPromptAsArg === false ? prompt : null) : providerConfig.stdin), parse: providerConfig.parse || 'text' };
  }

  switch (provider) {
    case 'claude': {
      const args = ['-p'];
      if (model) args.push('--model', model);
      return { cmd: 'claude', args, stdin: prompt, parse: 'text', env: readClaudeEnv() };
    }
    case 'codex': {
      const args = ['exec', '--skip-git-repo-check', '-s', 'read-only', '--color', 'never'];
      if (model) args.push('-m', model);
      args.push('-o', AI_OUTPUT_TOKEN, '-');
      return { cmd: 'codex', args, stdin: prompt, parse: 'file' };
    }
    case 'opencode': {
      const args = ['run', '--format', 'json'];
      if (model) args.push('-m', model);
      args.push(prompt);
      return { cmd: 'opencode', args, stdin: null, parse: 'opencode-json' };
    }
    default:
      return null;
  }
}

const aiProcs = new Map();

ipcMain.handle('ai:listModels', async (_event, payload) => {
  try {
    const providerId = String(payload && payload.provider || '');
    const providerConfig = payload && payload.providerConfig && typeof payload.providerConfig === 'object' ? payload.providerConfig : {};
    if (!providerId) return { ok: false, models: [], error: 'No AI provider selected.' };
    return await discoverAIModels(providerId, providerConfig);
  } catch (error) {
    return { ok: false, models: [], error: error.message || String(error) };
  }
});

function killAIFor(id) {
  const rec = aiProcs.get(id);
  if (!rec) return;
  try { rec.proc.kill('SIGKILL'); } catch (_) {}
  clearTimeout(rec.timer);
  aiProcs.delete(id);
}

ipcMain.handle('ai:cancel', (event) => {
  killAIFor(event.sender.id);
  return { ok: true };
});

ipcMain.handle('ai:ask', (event, payload) => {
  const provider = payload && payload.provider;
  const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
  const model = payload && typeof payload.model === 'string' ? payload.model.trim() : '';
  const providerConfig = payload && payload.providerConfig;
  const spec = buildAICommand(provider, prompt, model, providerConfig);
  if (!spec) return { ok: false, error: 'Unknown provider: ' + provider };
  if (!prompt.trim()) return { ok: false, error: 'Empty prompt' };

  const cmdPath = resolveExecutable(spec.cmd);
  if (!cmdPath) {
    return {
      ok: false,
      error: 'Could not find "' + spec.cmd + '". Make sure it is installed and on your PATH.',
    };
  }

  let outputFile = null;
  if (spec.parse === 'file') {
    outputFile = path.join(
      os.tmpdir(),
      'inkwell-ai-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt'
    );
    spec.args = spec.args.map((a) => (a === AI_OUTPUT_TOKEN ? outputFile : a));
  }

  killAIFor(event.sender.id);

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmdPath, spec.args, {
        cwd: NOTES_DIR,
        env: { ...process.env, ...(spec.env || {}), ...providerCredentialEnv(providerConfig), PATH: aiSearchDirs().join(path.delimiter) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      if (outputFile) { try { fs.unlinkSync(outputFile); } catch (_) {} }
      return resolve({ ok: false, error: e.message });
    }

    let stdout = '';
    let stderr = '';
    let finished = false;

    const done = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (outputFile) { try { fs.unlinkSync(outputFile); } catch (_) {} }
      const rec = aiProcs.get(event.sender.id);
      if (rec && rec.proc === proc) aiProcs.delete(event.sender.id);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      done({ ok: false, error: 'Timed out after ' + Math.round(AI_TIMEOUT / 1000) + 's' });
    }, AI_TIMEOUT);

    aiProcs.set(event.sender.id, { proc, timer });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => {
      done({ ok: false, error: 'Could not run "' + spec.cmd + '": ' + e.message });
    });
    proc.on('close', (code) => {
      let text;
      if (spec.parse === 'file') {
        try { text = fs.readFileSync(outputFile, 'utf8').trim(); } catch (_) { text = ''; }
        text = stripAnsi(text).replace(THINK_RE, '').trim();
      } else if (spec.parse === 'opencode-json') {
        text = parseOpencodeJson(stdout) || stripAnsi(stdout).replace(THINK_RE, '').trim();
      } else {
        text = stripAnsi(stdout).replace(THINK_RE, '').trim();
      }
      const errOut = stripAnsi(stderr).trim();
      if (/not logged in|please run \/login/i.test(text)) return done({ ok: false, error: text });
      if (!text && errOut) return done({ ok: false, error: errOut });
      if (!text && code !== 0) return done({ ok: false, error: spec.cmd + ' exited with code ' + code });
      if (!text) return done({ ok: false, error: 'No response from ' + spec.cmd });
      done({ ok: true, text });
    });

    if (spec.stdin != null) {
      proc.stdin.on('error', () => {});
      proc.stdin.write(spec.stdin);
      proc.stdin.end();
    } else if (proc.stdin) {
      proc.stdin.end();
    }
  });
});
