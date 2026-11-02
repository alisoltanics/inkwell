const { app, BrowserWindow, ipcMain, Menu, dialog, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const Store = require('electron-store');
const { docxToHtml } = require('./src/docx');

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

/* ================= WATCHING THE VAULT ================= */
// Notes also arrive from outside the app — another editor, a sync folder, the
// VS Code extension — so the folder is watched and the window is told to
// refresh its list instead of waiting for a restart.
let vaultWatcher = null;
let vaultWatchTimer = null;
let vaultPollTimer = null;
const vaultWatchPending = new Set();

function watchableChange(relativePath) {
  const clean = String(relativePath || '').replace(/\\/g, '/');
  if (!clean) return '';
  // internal folders (.inkwell keeps audio, exports and preferences) and editor
  // scratch files are not notes
  if (clean.split('/').some((part) => part.startsWith('.'))) return '';
  if (/(^|\/)(node_modules|__pycache__)(\/|$)/.test(clean)) return '';
  if (/\.(swp|swx|tmp|crdownload|part|download)$/i.test(clean)) return '';
  if (clean === '.DS_Store') return '';
  return clean;
}

function flushVaultChanges() {
  vaultWatchTimer = null;
  const paths = [...vaultWatchPending];
  vaultWatchPending.clear();
  if (!paths.length) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('vault:changed', { paths });
  }
}

function queueVaultChange(relativePath, delay = 350) {
  const rel = watchableChange(relativePath);
  if (!rel) return;
  vaultWatchPending.add(rel);
  if (vaultWatchTimer) clearTimeout(vaultWatchTimer);
  vaultWatchTimer = setTimeout(flushVaultChanges, delay);
}

// A note and its time and size, so a plain folder scan can spot what changed.
function vaultSnapshot(root) {
  const seen = new Map();
  const walk = (dir, prefix, depth) => {
    if (depth > 12 || seen.size > 20000) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        seen.set(relative + '/', 'dir');
        walk(absolute, relative, depth + 1);
        continue;
      }
      try {
        const stat = fs.statSync(absolute);
        seen.set(relative, stat.mtimeMs + ':' + stat.size);
      } catch (_) {
        // the file vanished between readdir and stat
      }
    }
  };
  walk(root, '', 0);
  return seen;
}

function stopVaultWatch() {
  if (vaultWatcher) {
    try { vaultWatcher.close(); } catch (_) {}
    vaultWatcher = null;
  }
  if (vaultPollTimer) {
    clearInterval(vaultPollTimer);
    vaultPollTimer = null;
  }
  if (vaultWatchTimer) {
    clearTimeout(vaultWatchTimer);
    vaultWatchTimer = null;
  }
  vaultWatchPending.clear();
}

function watchVault() {
  stopVaultWatch();
  if (!NOTES_DIR) return;

  // A recursive watch is the cheap way, and what Electron's Node supports on
  // every platform; older runtimes do not have it on Linux.
  try {
    vaultWatcher = fs.watch(NOTES_DIR, { recursive: true }, (event, filename) => {
      queueVaultChange(filename);
    });
    vaultWatcher.on('error', () => {
      try { vaultWatcher.close(); } catch (_) {}
      vaultWatcher = null;
      watchVaultByPolling();
    });
    return;
  } catch (_) {
    vaultWatcher = null;
  }
  watchVaultByPolling();
}

// The fallback: look at the folder every couple of seconds and report what
// appeared, changed or went away. Slow but always available.
function watchVaultByPolling() {
  if (vaultPollTimer || !NOTES_DIR) return;
  let previous = vaultSnapshot(NOTES_DIR);
  vaultPollTimer = setInterval(() => {
    const next = vaultSnapshot(NOTES_DIR);
    for (const [key, stamp] of next) {
      if (previous.get(key) !== stamp) queueVaultChange(key.replace(/\/$/, ''), 60);
    }
    for (const key of previous.keys()) {
      if (!next.has(key)) queueVaultChange(key.replace(/\/$/, ''), 60);
    }
    previous = next;
  }, 2000);
  if (vaultPollTimer.unref) vaultPollTimer.unref();
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

  // a click that would replace the app with a web page opens the browser instead
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow.webContents.getURL()) return;
    event.preventDefault();
    openExternalUrl(url);
  });

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
  watchVault();
  // warm the probe that decides which isolation flags the installed Claude CLI
  // understands, so the first answer is not delayed by it
  getClaudeIsolationFlags().catch(() => {});
  // notes sent to the bot while the app runs are written into the vault
  startTelegramInbox();
});

app.on('will-quit', () => {
  stopVaultWatch();
  stopTelegramInbox();
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
    watchVault();
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

/* ================= DUPLICATE / PASTE INTO THE VAULT ================= */
// A free name next to the original: "note copy.md", then "note copy 2.md".
function uniquePathIn(dirAbs, base, ext) {
  let n = 1;
  let candidate = path.join(dirAbs, base + ext);
  while (fs.existsSync(candidate)) {
    n += 1;
    if (n > 500) throw new Error('Could not find a free name');
    candidate = path.join(dirAbs, `${base} ${n}${ext}`);
  }
  return candidate;
}

function logicalFromAbs(abs) {
  return path.relative(NOTES_DIR, abs).split(path.sep).join('/');
}

ipcMain.handle('fs:duplicate', async (event, logicalPath) => {
  try {
    const res = resolveLogical(logicalPath);
    if (!fs.existsSync(res.abs)) throw new Error('File not found');
    if (!fs.statSync(res.abs).isFile()) throw new Error('Not a file');
    const dir = path.dirname(res.abs);
    const ext = path.extname(res.abs);
    const base = path.basename(res.abs, ext);
    const target = uniquePathIn(dir, base + ' copy', ext);
    fs.copyFileSync(res.abs, target);
    return { success: true, path: logicalFromAbs(target) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Files copied in the system file manager: every platform exposes them under a
// different clipboard format, so all known ones are tried.
function clipboardFilePaths() {
  const found = [];
  const add = (value) => {
    const s = String(value || '').trim();
    if (!s || found.includes(s)) return;
    try {
      if (fs.statSync(s).isFile()) found.push(s);
    } catch (_) {}
  };
  const fromUri = (line) => {
    const s = String(line || '').trim();
    if (!s || s.startsWith('#') || s === 'copy' || s === 'cut') return;
    if (/^file:\/\//i.test(s)) {
      try { add(decodeURIComponent(new URL(s).pathname)); } catch (_) {}
      return;
    }
    if (path.isAbsolute(s)) add(s);
  };

  if (process.platform === 'win32') {
    try {
      const buf = clipboard.readBuffer('FileNameW');
      if (buf && buf.length) {
        const text = buf.toString('ucs2').replace(/\0+$/, '');
        for (const part of text.split('\0')) add(part);
      }
    } catch (_) {}
  }
  for (const format of ['text/uri-list', 'public.file-url', 'x-special/gnome-copied-files']) {
    try {
      const text = clipboard.read(format);
      if (text) String(text).split(/\r?\n/).forEach(fromUri);
    } catch (_) {}
  }
  if (!found.length) {
    // plain text that is nothing but absolute paths, one per line
    try {
      const lines = String(clipboard.readText() || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => path.isAbsolute(l))) lines.forEach(fromUri);
    } catch (_) {}
  }
  return found;
}

// What belongs in a Markdown library: notes and the images a note can link.
const PASTEABLE_RE = /\.(?:md|markdown|txt|html?|png|jpe?g|gif|webp|svg|bmp|avif)$/i;

ipcMain.handle('fs:paste', async (event, dirPath) => {
  try {
    if (!NOTES_DIR) throw new Error('Choose a vault folder first');
    const dirAbs = String(dirPath || '') ? resolveDir(dirPath).abs : NOTES_DIR;
    if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) throw new Error('Folder not found');

    const sources = clipboardFilePaths();
    const copied = [];
    let skipped = 0;
    for (const src of sources.slice(0, 50)) {
      if (!PASTEABLE_RE.test(src)) { skipped += 1; continue; }
      try {
        const st = fs.statSync(src);
        if (!st.isFile() || st.size > 512 * 1024 * 1024) { skipped += 1; continue; }
        const ext = path.extname(src);
        const base = path.basename(src, ext);
        const target = uniquePathIn(dirAbs, base, ext);
        fs.copyFileSync(src, target);
        copied.push(logicalFromAbs(target));
      } catch (_) {
        skipped += 1;
      }
    }

    // a screenshot on the clipboard pastes as an image file
    if (!copied.length && !skipped) {
      try {
        const image = clipboard.readImage();
        if (image && !image.isEmpty()) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const target = uniquePathIn(dirAbs, 'pasted image ' + stamp, '.png');
          fs.writeFileSync(target, image.toPNG());
          copied.push(logicalFromAbs(target));
        }
      } catch (_) {}
    }

    if (!copied.length) {
      return { success: false, skipped, empty: !sources.length, error: 'The clipboard holds nothing that can be added' };
    }
    return { success: true, files: copied, skipped };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/* ================= DOCUMENTS OUTSIDE THE VAULT ================= */
// A document opened from any other folder on disk is read-only outside the
// vault: it keeps its own absolute path and is never moved or copied into the
// vault. Writes are only allowed for files the user actually opened here.

const EXTERNAL_KINDS = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  html: 'html',
  htm: 'html',
  docx: 'docx',
};
const externalOpened = new Set();

function externalKind(abs) {
  return EXTERNAL_KINDS[path.extname(abs).slice(1).toLowerCase()] || 'unknown';
}

function loadExternalDocument(absPath) {
  const abs = path.resolve(String(absPath || ''));
  const kind = externalKind(abs);
  if (kind === 'unknown') throw new Error('Unsupported file type');
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error('Not a file');
  if (st.size > 40 * 1024 * 1024) throw new Error('File is too large to open (40 MB limit)');
  externalOpened.add(abs);
  if (kind === 'docx') {
    const { html } = docxToHtml(fs.readFileSync(abs));
    return { success: true, path: abs, name: path.basename(abs), kind, content: '', html };
  }
  return {
    success: true,
    path: abs,
    name: path.basename(abs),
    kind,
    content: fs.readFileSync(abs, 'utf8'),
    size: st.size,
    modified: st.mtimeMs,
  };
}

ipcMain.handle('file:openExternal', async (event) => {
  try {
    const win = windowFrom(event);
    const res = await dialog.showOpenDialog(win, {
      title: 'Open a document',
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['md', 'markdown', 'txt', 'html', 'htm', 'docx'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (!res || res.canceled || !res.filePaths.length) return { success: false, canceled: true };
    return loadExternalDocument(res.filePaths[0]);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('file:readExternal', async (event, absPath) => {
  try {
    return loadExternalDocument(absPath);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('file:writeExternal', async (event, absPath, content) => {
  try {
    const abs = path.resolve(String(absPath || ''));
    const kind = externalKind(abs);
    if (kind !== 'markdown' && kind !== 'text') throw new Error('This document is read-only');
    if (!externalOpened.has(abs)) throw new Error('Open the file before saving it');
    fs.writeFileSync(abs, String(content ?? ''), 'utf8');
    return { success: true, path: abs };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// "Open containing folder": show the item in the OS file manager the way an
// editor does. A vault path is resolved inside the vault; an outside document
// keeps its own path, and only something that exists can be revealed.
ipcMain.handle('shell:reveal', async (event, payload) => {
  try {
    const target = String((payload && payload.path) || '');
    if (!target) throw new Error('No path');
    const abs = payload && payload.external ? path.resolve(target) : resolveLogical(target).abs;
    if (!fs.existsSync(abs)) throw new Error('Not found');
    shell.showItemInFolder(abs);
    return { success: true, path: abs };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// A link in a note belongs to the system browser. The app is a single page with
// no address bar, so a navigation away from it leaves a blank window behind.
function openExternalUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return false;
    shell.openExternal(parsed.toString());
    return true;
  } catch (_) {
    return false;
  }
}

ipcMain.handle('shell:openExternal', async (event, url) => ({ success: openExternalUrl(url) }));

/* ================= OFFLINE TRANSLATION ================= */
// Argos Translate is the offline translator that is actually installable as a
// command line tool. When it is missing the renderer falls back to the AI.
function offlineTranslator() {
  return commandOnPath('argos-translate') ? 'argos-translate' : '';
}

ipcMain.handle('translate:status', async () => {
  const engine = offlineTranslator();
  return { ok: true, engine, offline: !!engine };
});

ipcMain.handle('translate:text', async (event, payload) => {
  const bin = offlineTranslator();
  if (!bin) return { ok: false, error: 'no-engine' };
  const text = String((payload && payload.text) || '').trim();
  const from = String((payload && payload.from) || 'en').trim() || 'en';
  const to = String((payload && payload.to) || 'fa').trim() || 'fa';
  if (!text) return { ok: false, error: 'There is no text to translate' };
  if (from === to) return { ok: true, engine: 'argos', text };
  // long flags on current releases, short ones on older builds
  const attempts = [
    ['--from-lang', from, '--to-lang', to, text],
    ['-f', from, '-t', to, text],
  ];
  let lastError = '';
  for (const args of attempts) {
    const res = await runCommand(bin, args, { timeout: 120000 });
    if (res.ok && String(res.stdout || '').trim()) {
      return { ok: true, engine: 'argos', text: String(res.stdout).trim() };
    }
    lastError = res.error || '';
  }
  return { ok: false, error: lastError || 'The translator returned nothing' };
});

/* ================= READ ALOUD (text to speech) ================= */
// The audio lives next to the vault (hidden .inkwell/audio) so the same note
// always plays the same file and the sound survives a restart. Any note can be
// read: the system engines take the whole text, and the speech API is called in
// sentence-sized chunks. The cap only stops a runaway file (a whole book).
const TTS_MAX_CHARS = 200000;
// one speech request carries at most ~4,096 characters
const TTS_API_CHUNK = 3800;

function ttsDir() {
  if (!NOTES_DIR) throw new Error('No vault is open');
  const dir = path.join(NOTES_DIR, '.inkwell', 'audio');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ttsSlug(logicalPath) {
  const base = path.basename(String(logicalPath || 'note'), path.extname(String(logicalPath || '')));
  const clean = base.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return (clean || 'note').slice(0, 40);
}

// The hash is the text itself: change one word and the old file stops matching,
// which is what "the recording is out of date" means here.
function ttsHash(text) {
  return crypto.createHash('sha1').update(String(text || ''), 'utf8').digest('hex').slice(0, 10);
}

function ttsBaseName(logicalPath, text) {
  return `${ttsSlug(logicalPath)}-${ttsHash(text)}`;
}

function ttsLanguage(text) {
  const sample = String(text || '').slice(0, 800);
  if (/[\u0600-\u06FF]/.test(sample)) {
    return /[پچژگک]/.test(sample) ? 'fa' : 'ar';
  }
  if (/[\u0400-\u04FF]/.test(sample)) return 'ru';
  return 'en';
}

function runCommand(command, args, options = {}) {
  const { input, ...spawnOptions } = options;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, ...spawnOptions });
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    // a voice engine that reads its text from stdin (piper) gets it here
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(input == null ? '' : input);
    }
    let stderr = '';
    let stdout = '';
    // Decode the streams as UTF-8 text: decoding each chunk on its own breaks a
    // character that straddles a chunk boundary, which shows up as "\uFFFD" in
    // Persian output from the offline translator.
    if (child.stderr) child.stderr.setEncoding('utf8');
    if (child.stdout) child.stdout.setEncoding('utf8');
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk; });
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr, error: code === 0 ? '' : (stderr.trim() || `exit ${code}`) }));
  });
}

// Each platform ships a voice engine that can write a file: espeak on Linux,
// say on macOS, SAPI on Windows. Nothing is installed by the app.
// Which offline voices exist on this machine, best quality first. espeak is
// the last choice on purpose: it is the one that sounds robotic.
function piperModels() {
  const dirs = [
    process.env.PIPER_MODEL ? path.dirname(process.env.PIPER_MODEL) : '',
    path.join(os.homedir(), '.local', 'share', 'piper'),
    path.join(os.homedir(), '.piper'),
    NOTES_DIR ? path.join(NOTES_DIR, '.inkwell', 'voices') : '',
  ].filter(Boolean);
  const found = [];
  if (process.env.PIPER_MODEL && fs.existsSync(process.env.PIPER_MODEL)) found.push(process.env.PIPER_MODEL);
  for (const dir of dirs) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (entry.toLowerCase().endsWith('.onnx')) found.push(path.join(dir, entry));
      }
    } catch (_) {}
  }
  return [...new Set(found)];
}

function piperModelFor(language) {
  const models = piperModels();
  if (!models.length) return '';
  const wanted = String(language || 'en').toLowerCase();
  return models.find((file) => path.basename(file).toLowerCase().includes(wanted)) || models[0];
}

// Which voices this espeak build really has: a voice that is not installed
// would silently fall back to the default robot.
const espeakVoiceCache = new Map();
async function espeakVoices(bin) {
  if (espeakVoiceCache.has(bin)) return espeakVoiceCache.get(bin);
  const res = await runCommand(bin, ['--voices']);
  const names = new Set();
  for (const line of String(res.stdout || '').split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 4) names.add(cols[3].toLowerCase());
  }
  espeakVoiceCache.set(bin, names);
  return names;
}

// espeak ships many "variants" on top of the base voice (`en-us+klatt`), and the
// default one is the most mechanical. They are offered as choices, with a test
// button, instead of guessing which one sounds best to a given person.
const TTS_VARIANTS = ['klatt', 'klatt2', 'klatt3', 'klatt4', 'klatt5', 'female3', 'female4', 'male3', 'male4', 'whisper'];
const TTS_LANG_CODES = { en: 'en-US', fa: 'fa', ar: 'ar', ru: 'ru', tr: 'tr', es: 'es', fr: 'fr', de: 'de', it: 'it', zh: 'cmn', hi: 'hi' };

function storedVoice() {
  return String((storedAIKeys().tts || {}).voice || '').trim();
}

// speech-dispatcher lists its voices as "<Language name>+<variant>  <code>  <variant>"
function spdVoiceList(stdout, langCode) {
  const found = { base: '', variants: [] };
  for (const line of String(stdout || '').split('\n')) {
    const match = line.match(/^\s*(.+?)\+([A-Za-z0-9_-]+)\s{2,}([A-Za-z-]+)\s{2,}/);
    if (!match) {
      const base = line.match(/^\s*(.+?)\s{2,}([A-Za-z-]+)\s{2,}none\s*$/);
      if (base && base[2].toLowerCase().startsWith(langCode.toLowerCase().slice(0, 2))) {
        found.base = base[1].trim();
      }
      continue;
    }
    const [, name, variant, lang] = match;
    if (!lang.toLowerCase().startsWith(langCode.toLowerCase().slice(0, 2))) continue;
    if (!found.base) found.base = name.trim();
    if (TTS_VARIANTS.includes(variant)) found.variants.push(variant);
  }
  found.variants = [...new Set(found.variants)];
  return found;
}

async function listSystemVoices(language) {
  const lang = TTS_LANG_CODES[language] || 'en-US';
  const engine = detectSystemVoice(language);
  const out = [];
  if (engine === 'espeak-ng' || engine === 'espeak') {
    const available = await espeakVoices(engine);
    const base = language === 'en' ? 'en-us' : language;
    if (!available.size || available.has(base)) {
      out.push({ id: '', label: `${base} (default)` });
      for (const variant of TTS_VARIANTS) out.push({ id: `${base}+${variant}`, label: `${base}+${variant}` });
    }
    for (const name of available) {
      if (name === base || name.startsWith('mb-')) continue;
      if (!name.startsWith(base)) continue;
      out.push({ id: name, label: name });
    }
    return { engine: engine || 'espeak', base, voices: out.slice(0, 24) };
  }
  if (process.platform === 'linux') {
    const res = await runCommand('spd-say', ['-L']);
    const found = spdVoiceList(res.stdout, lang);
    if (found.base) {
      out.push({ id: '', label: `${found.base} (default)` });
      for (const variant of found.variants) out.push({ id: `${found.base}+${variant}`, label: variant });
    }
    return { engine: 'spd-say', base: found.base, voices: out.slice(0, 24) };
  }
  if (process.platform === 'darwin') {
    const res = await runCommand('say', ['-v', '?']);
    for (const line of String(res.stdout || '').split('\n')) {
      const match = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s/);
      if (!match || !match[2].toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) continue;
      out.push({ id: match[1].trim(), label: `${match[1].trim()} (${match[2]})` });
    }
    return { engine: 'say', base: '', voices: out.slice(0, 30) };
  }
  return { engine: engine || '', base: '', voices: [] };
}

ipcMain.handle('tts:voices', async (event, payload) => {
  try {
    const list = await listSystemVoices(String((payload && payload.language) || 'en'));
    const chosen = storedVoice();
    return { ok: true, ...list, chosen };
  } catch (e) {
    return { ok: false, error: e.message, voices: [] };
  }
});

// espeak with the settings that sound least mechanical: the voice the reader
// picked (or MBROLA), a slower rate and a lower pitch.
async function espeakToFile(bin, text, outFile, tempText, language) {
  const available = await espeakVoices(bin);
  const preferred = language === 'en' ? 'en-us' : language === 'fa' ? 'fa' : language;
  const chosen = storedVoice();
  const order = [chosen, `mb-${language}1`, preferred, language].filter((voice, i, list) => voice && list.indexOf(voice) === i);
  for (const voice of order) {
    const isVariant = voice.includes('+');
    if (available.size && !isVariant && !available.has(voice.toLowerCase())) continue;
    const res = await runCommand(bin, ['-v', voice, '-s', '160', '-p', '42', '-g', '4', '-w', outFile, '-f', tempText]);
    if (res.ok && fs.existsSync(outFile)) return { ok: true, engine: `${bin} · ${voice}` };
  }
  const res = await runCommand(bin, ['-v', language, '-s', '160', '-p', '42', '-w', outFile, '-f', tempText]);
  if (res.ok && fs.existsSync(outFile)) return { ok: true, engine: bin };
  return { ok: false, error: res.error };
}

async function systemTtsToFile(text, outFile, tempText, language) {
  const mode = String((storedAIKeys().tts || {}).engine || 'auto');

  if (process.platform === 'darwin') {
    if (mode === 'api') return { ok: false, error: 'system voice disabled' };
    // the built-in voices are natural; 175 words a minute reads like a person
    const voice = storedVoice();
    const args = ['-r', '175'];
    if (voice) args.push('-v', voice);
    args.push('-o', outFile, '--file-format=WAVE', '--data-format=LEI16@22050', '-f', tempText);
    const res = await runCommand('say', args);
    return res.ok && fs.existsSync(outFile) ? { ok: true, engine: 'say' } : { ok: false, error: res.error };
  }

  if (process.platform === 'win32') {
    if (mode === 'api') return { ok: false, error: 'system voice disabled' };
    const script = [
      'Add-Type -AssemblyName System.Speech;',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
      '$s.Rate = -1;',
      `$s.SetOutputToWaveFile('${outFile.replace(/'/g, "''")}');`,
      `$s.Speak([System.IO.File]::ReadAllText('${tempText.replace(/'/g, "''")}'));`,
      '$s.Dispose();',
    ].join(' ');
    const res = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return res.ok && fs.existsSync(outFile) ? { ok: true, engine: 'sapi' } : { ok: false, error: res.error };
  }

  if (mode === 'api') return { ok: false, error: 'system voice disabled' };

  // 1) piper: a neural voice, close to a real speaker
  const model = piperModelFor(language);
  if (model) {
    const res = await runCommand('piper', ['-m', model, '-f', outFile], { input: await fs.promises.readFile(tempText) });
    if (res.ok && fs.existsSync(outFile)) return { ok: true, engine: 'piper · ' + path.basename(model, '.onnx') };
  }

  // 2) pico2wave: small and clearly better than espeak
  const picoLang = language === 'fa' ? 'fa-IR' : language === 'ar' ? 'ar-SA' : language === 'ru' ? 'ru-RU' : 'en-US';
  const pico = await runCommand('pico2wave', ['-w', outFile, '-l', picoLang, String(text || '')]);
  if (pico.ok && fs.existsSync(outFile)) return { ok: true, engine: 'pico2wave' };

  // 3) espeak-ng / espeak
  for (const bin of ['espeak-ng', 'espeak']) {
    const res = await espeakToFile(bin, text, outFile, tempText, language);
    if (res.ok) return res;
  }
  return { ok: false, error: 'no system voice' };
}

// The speech API takes about 4,000 characters per request, so a long note is
// split on sentence ends and the parts are joined back into one file.
function ttsChunks(text, limit = TTS_API_CHUNK) {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  const parts = [];
  let rest = body;
  while (rest.length > limit) {
    let cut = -1;
    for (const mark of ['. ', '! ', '? ', '\u061F ', '\u06D4 ', '\n']) {
      const at = rest.lastIndexOf(mark, limit);
      if (at > cut) cut = at;
    }
    if (cut < limit * 0.4) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.4) cut = limit;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

async function apiTtsToFile(text, outFile) {
  const saved = storedAIKeys().tts || {};
  const key = apiProviderKey({ id: 'tts', apiKey: saved.apiKey, apiKeyEnv: saved.apiKeyEnv || 'OPENAI_API_KEY' });
  if (!key) return { ok: false, error: 'no key' };
  const base = normalizeApiBase(saved.baseUrl) || 'https://api.openai.com/v1';
  // the HD model is the one that sounds like a person reading
  const model = String(saved.model || '').trim() || 'gpt-4o-mini-tts';
  const chunks = ttsChunks(text);
  if (!chunks.length) return { ok: false, error: 'There is no text to read' };
  const buffers = [];
  for (const chunk of chunks) {
    const res = await fetch(base + '/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, voice: saved.voice || 'alloy', input: chunk, response_format: 'mp3' }),
    });
    if (!res.ok) {
      let detail = '';
      try { const data = await res.json(); detail = (data && data.error && data.error.message) || ''; } catch (_) {}
      return { ok: false, error: detail || `HTTP ${res.status}` };
    }
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  fs.writeFileSync(outFile, buffers.length === 1 ? buffers[0] : Buffer.concat(buffers));
  return { ok: fs.existsSync(outFile), engine: 'openai', chunks: chunks.length };
}

function commandOnPath(bin) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, bin + ext);
      try { if (fs.existsSync(file)) return file; } catch (_) {}
    }
  }
  return '';
}

// Which voice the app can use right now: a system engine that writes a file, an
// AI voice with a saved key, or neither (the renderer then speaks offline).
// The same order systemTtsToFile() uses, so the badge tells the truth.
function detectSystemVoice(language = 'en') {
  if (process.platform === 'darwin') return commandOnPath('say') ? 'say' : '';
  if (process.platform === 'win32') return commandOnPath('powershell.exe') ? 'sapi' : '';
  const model = piperModelFor(language);
  if (model && commandOnPath('piper')) return 'piper';
  if (commandOnPath('pico2wave')) return 'pico2wave';
  if (commandOnPath('espeak-ng')) return 'espeak-ng';
  if (commandOnPath('espeak')) return 'espeak';
  return '';
}

ipcMain.handle('tts:status', async () => {
  const system = detectSystemVoice();
  const saved = storedAIKeys().tts || {};
  const hasKey = !!apiProviderKey({ id: 'tts', apiKey: saved.apiKey, apiKeyEnv: saved.apiKeyEnv || 'OPENAI_API_KEY' });
  const saved2 = storedAIKeys().tts || {};
  return {
    ok: true,
    system: !!system,
    engine: system,
    piperModel: system === 'piper' ? path.basename(piperModelFor('en'), '.onnx') : '',
    api: hasKey,
    mode: String(saved2.engine || 'auto'),
    platform: process.platform,
  };
});

ipcMain.handle('tts:generate', async (event, payload) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-tts-'));
  try {
    const logicalPath = String((payload && payload.path) || '');
    const text = String((payload && payload.text) || '').trim();
    if (!text) throw new Error('There is no text to read');
    if (text.length > TTS_MAX_CHARS) throw new Error('This document is too long to read aloud');
    const dir = ttsDir();
    const base = ttsBaseName(logicalPath, text);
    const force = !!(payload && payload.force);
    const cached = force ? null : ['.wav', '.mp3'].map((ext) => path.join(dir, base + ext)).find((file) => fs.existsSync(file));
    if (cached) return { ok: true, cached: true, file: cached, ext: path.extname(cached).slice(1) };

    const tempText = path.join(tempDir, 'speech.txt');
    fs.writeFileSync(tempText, text, 'utf8');
    const language = ttsLanguage(text);
    const wavOut = path.join(dir, base + '.wav');
    const mode = String((storedAIKeys().tts || {}).engine || 'auto');
    const system = mode === 'api'
      ? { ok: false, error: 'system voice disabled' }
      : await systemTtsToFile(text, wavOut, tempText, language);
    let engine = system.ok ? (system.engine || 'system') : '';
    if (!system.ok) {
      if (mode === 'system') {
        return { ok: false, error: 'no-engine', system: system.error, api: 'disabled' };
      }
      const apiOut = path.join(dir, base + '.mp3');
      const api = await apiTtsToFile(text, apiOut);
      if (!api.ok) {
        return { ok: false, error: 'no-engine', system: system.error, api: api.error };
      }
      engine = api.engine;
    }
    const file = fs.existsSync(wavOut) ? wavOut : path.join(dir, base + '.mp3');
    if (!fs.existsSync(file)) throw new Error('The voice engine produced no audio');
    // older recordings of the same note are no longer reachable from the note
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(ttsSlug(logicalPath) + '-') && !entry.startsWith(base)) {
        try { fs.rmSync(path.join(dir, entry), { force: true }); } catch (_) {}
      }
    }
    return { ok: true, cached: false, file, ext: path.extname(file).slice(1), engine, size: fs.statSync(file).size };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// The last resort, when nothing can write an audio file: hand the text to the
// operating system's own speaker. Nothing is saved, but the note is read aloud.
// Only one utterance at a time: starting a new one stops whatever is still
// being said, otherwise two voices talk over each other.
let osSpeaker = null;

async function stopOsSpeaker() {
  if (osSpeaker) {
    try { osSpeaker.kill(); } catch (_) {}
    osSpeaker = null;
  }
  if (process.platform === 'linux') {
    try { await runCommand('spd-say', ['-C']); } catch (_) {}
  } else if (process.platform === 'darwin') {
    try { await runCommand('killall', ['say']); } catch (_) {}
  }
}

ipcMain.handle('tts:speak', async (event, payload) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-say-'));
  try {
    const text = String((payload && payload.text) || '').trim();
    if (!text) throw new Error('There is no text to read');
    const lang = String((payload && payload.lang) || ttsLanguage(text));
    // the player's speed, mapped onto each speaker's own scale
    const wanted = Number((payload && payload.rate) || 1);
    const rate = Number.isFinite(wanted) ? Math.min(2, Math.max(0.5, wanted)) : 1;
    await stopOsSpeaker();
    if (process.platform === 'win32') {
      const file = path.join(tempDir, 'speech.txt');
      fs.writeFileSync(file, text, 'utf8');
      const sapiRate = Math.max(-10, Math.min(10, Math.round((rate - 1) * 6)));
      const script = [
        'Add-Type -AssemblyName System.Speech;',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
        `$s.Rate = ${sapiRate};`,
        `$s.Speak([System.IO.File]::ReadAllText('${file.replace(/'/g, "''")}'));`,
      ].join(' ');
      osSpeaker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, detached: true, stdio: 'ignore' });
      osSpeaker.on('exit', () => { osSpeaker = null; });
      osSpeaker.unref();
      return { ok: true, engine: 'sapi', rate };
    }
    if (process.platform === 'darwin') {
      const file = path.join(tempDir, 'speech.txt');
      fs.writeFileSync(file, text, 'utf8');
      // say counts words per minute; 175 is its natural pace
      const wpm = Math.round(175 * rate);
      const sayArgs = ['-r', String(wpm)];
      const voice = storedVoice();
      if (voice) sayArgs.push('-v', voice);
      sayArgs.push('-f', file);
      osSpeaker = spawn('say', sayArgs, { detached: true, stdio: 'ignore' });
      osSpeaker.on('exit', () => { osSpeaker = null; });
      osSpeaker.unref();
      return { ok: true, engine: 'say', rate };
    }
    // speech-dispatcher: speaks without writing a file, -100..+100 for speed
    const spdRate = Math.max(-90, Math.min(90, Math.round((rate - 1) * 85)));
    const spdArgs = ['-r', String(spdRate), '-l', lang];
    const spdVoice = storedVoice();
    if (spdVoice) spdArgs.push('-y', spdVoice);
    spdArgs.push(text);
    osSpeaker = spawn('spd-say', spdArgs, { detached: true, stdio: 'ignore' });
    osSpeaker.on('exit', () => { osSpeaker = null; });
    osSpeaker.unref();
    return { ok: true, engine: 'spd-say', rate: spdRate };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    // the child already read the file by the time it matters; clean up later
    setTimeout(() => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {} }, 20000);
  }
});

ipcMain.handle('tts:cancel', async () => {
  try {
    await stopOsSpeaker();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});


// The renderer plays the file from a Blob, so the audio never needs a file://
// permission and the vault path stays in the main process.
ipcMain.handle('tts:read', async (event, payload) => {
  try {
    const file = path.resolve(String((payload && payload.file) || ''));
    const dir = ttsDir();
    if (!file.startsWith(dir + path.sep)) throw new Error('Not an audio file');
    if (!fs.existsSync(file)) throw new Error('File not found');
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.mp3' ? 'audio/mpeg' : 'audio/wav';
    return { ok: true, base64: fs.readFileSync(file).toString('base64'), mime };
  } catch (e) {
    return { ok: false, error: e.message };
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

/* ================= TELEGRAM INBOX (notes from the phone) ================= */
// Messages sent to the configured bot are written into the vault, so a phone can
// add to a note without any sync service. Only the configured chat is accepted,
// bot commands are ignored, and the update offset is stored so a restart does
// not import the same message twice.
const TELEGRAM_INBOX_FOLDER = 'Inbox';
let telegramInbox = { running: false, lastAt: 0, lastPath: '', lastError: '', abort: null };

function telegramInboxSaved() {
  const saved = store.get('telegramInbox');
  return {
    enabled: !!(saved && saved.enabled === true),
    target: saved && typeof saved.target === 'string' ? saved.target : '',
  };
}

function telegramInboxStatus() {
  const saved = telegramInboxSaved();
  const creds = getTelegramConfig();
  return {
    ok: true,
    enabled: saved.enabled,
    target: saved.target,
    running: telegramInbox.running,
    ready: !!(creds.botToken && creds.chatId),
    lastAt: telegramInbox.lastAt,
    lastPath: telegramInbox.lastPath,
    lastError: telegramInbox.lastError,
    folder: TELEGRAM_INBOX_FOLDER,
  };
}

function telegramInboxSlug(text) {
  const firstLine = String(text || '').split('\n').find((line) => line.trim()) || 'telegram';
  const slug = firstLine
    .replace(/[\\/:*?"<>|#*_`~[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
    .trim();
  return slug || 'telegram';
}

function telegramInboxStamp(seconds) {
  const at = new Date((seconds || Math.floor(Date.now() / 1000)) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

// A message becomes Markdown: the text as it was written, with the moment it
// arrived kept in a comment so the note stays clean when it is rendered.
async function saveTelegramInboxMessage(message, settings) {
  if (!NOTES_DIR) return;
  const raw = String(message.text || message.caption || '').trim();
  if (!raw || raw.startsWith('/')) return;
  const stamp = telegramInboxStamp(message.date);
  const note = path.join(NOTES_DIR, settings.target);
  try {
    if (settings.target) {
      // append to the chosen note
      const existing = await fs.promises.readFile(note, 'utf8').catch(() => '');
      const tail = existing.replace(/\s*$/, '');
      const block = (tail ? '\n\n' : '') + `<!-- telegram ${stamp} -->\n${raw}\n`;
      await fs.promises.mkdir(path.dirname(note), { recursive: true });
      await fs.promises.writeFile(note, tail + block, 'utf8');
      telegramInbox.lastPath = settings.target;
    } else {
      // one note per message, in Inbox/
      const dir = path.join(NOTES_DIR, TELEGRAM_INBOX_FOLDER);
      await fs.promises.mkdir(dir, { recursive: true });
      const base = telegramInboxSlug(raw);
      let rel = `${TELEGRAM_INBOX_FOLDER}/${base}.md`;
      let n = 2;
      while (fs.existsSync(path.join(NOTES_DIR, rel))) {
        rel = `${TELEGRAM_INBOX_FOLDER}/${base} ${n}.md`;
        n += 1;
      }
      const title = (raw.split('\n')[0] || base).replace(/^#+\s*/, '').slice(0, 90);
      const content = `# ${title}\n\n${raw}\n\n<!-- telegram ${stamp} -->\n`;
      await fs.promises.writeFile(path.join(NOTES_DIR, rel), content, 'utf8');
      telegramInbox.lastPath = rel;
    }
    telegramInbox.lastAt = Date.now();
    telegramInbox.lastError = '';
    // the list follows the folder on its own, but this makes it instant
    queueVaultChange(telegramInbox.lastPath);
  } catch (e) {
    telegramInbox.lastError = 'Could not save the message: ' + (e && e.message ? e.message : String(e));
  }
}

// A reply goes back to the phone, so a command shows what it changed.
async function telegramInboxReply(text) {
  const creds = getTelegramConfig();
  if (!creds.botToken || !creds.chatId) return;
  try {
    const form = new FormData();
    form.append('chat_id', creds.chatId);
    form.append('text', String(text || '').slice(0, 4000));
    await telegramApi('sendMessage', form);
  } catch (_) {}
}

function notifyTelegramInboxChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('telegram:inbox-changed', telegramInboxStatus());
  }
}

// The note a /to command names: an exact vault path, or the one note with that
// file name. A path that does not exist yet is created, because "write this into
// Notes.md" is a reasonable thing to ask for from a phone.
function resolveInboxTarget(query) {
  const raw = String(query || '').trim().replace(/^\/+/, '').replace(/\\/g, '/');
  if (!raw) return { error: '' };
  const withExt = /\.md$/i.test(raw) ? raw : raw + '.md';
  const direct = path.join(NOTES_DIR, withExt);
  if (fs.existsSync(direct)) return { target: withExt, created: false };
  const wanted = path.basename(withExt).toLowerCase();
  const matches = [];
  const walk = (dir, prefix, depth) => {
    if (depth > 6 || matches.length > 25) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (/.inkwell|node_modules|\.git/i.test(entry.name)) continue;
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, depth + 1);
      else if (/\.md$/i.test(entry.name) && entry.name.toLowerCase() === wanted) matches.push(rel);
    }
  };
  walk(NOTES_DIR, '', 0);
  if (matches.length === 1) return { target: matches[0], created: false };
  if (matches.length > 1) {
    return { error: 'Several notes are called ' + wanted + ': ' + matches.slice(0, 8).join(', ') + '. Send the folder too, e.g. /to ' + matches[0] };
  }
  try {
    fs.mkdirSync(path.dirname(direct), { recursive: true });
    fs.writeFileSync(direct, '', 'utf8');
    return { target: withExt, created: true };
  } catch (e) {
    return { error: 'Could not create ' + withExt + ': ' + (e && e.message ? e.message : String(e)) };
  }
}

// Commands, so the phone decides where the next messages go:
//   /new            one note per message, in Inbox/
// Telegram shows a command menu (the list behind the "/" button) from the
// commands registered for the chat. They are registered for this chat only, so a
// bot that other tools also use keeps its global list untouched.
const TELEGRAM_COMMANDS = {
  en: [
    { command: 'to', description: 'Write into a note, e.g. /to Inbox.md' },
    { command: 'new', description: 'One note per message, in Inbox/' },
    { command: 'status', description: 'Where the next message goes' },
    { command: 'help', description: 'What this bot can do' },
  ],
  fa: [
    { command: 'to', description: 'نوشتن داخل یک نوت، مثلاً /to Inbox.md' },
    { command: 'new', description: 'هر پیام یک نوت جدید در Inbox/' },
    { command: 'status', description: 'پیام بعدی کجا نوشته می‌شود' },
    { command: 'help', description: 'این ربات چه کارهایی می‌کند' },
  ],
};

async function syncTelegramCommands() {
  const creds = getTelegramConfig();
  if (!creds.botToken || !creds.chatId) {
    return { ok: false, error: 'Telegram is not configured. Save a bot token and chat ID first.' };
  }
  const chatId = /^-?\d+$/.test(creds.chatId) ? Number(creds.chatId) : creds.chatId;
  const scope = JSON.stringify({ type: 'chat', chat_id: chatId });
  try {
    for (const [language, commands] of Object.entries(TELEGRAM_COMMANDS)) {
      const form = new FormData();
      form.append('scope', scope);
      form.append('commands', JSON.stringify(commands));
      if (language !== 'en') form.append('language_code', language);
      await telegramApi('setMyCommands', form);
    }
    return { ok: true, commands: TELEGRAM_COMMANDS.en.map((c) => '/' + c.command) };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

//   /to <note>      append to that note instead
//   /status         what is happening now
//   /help           the list
function telegramInboxCommand(text) {
  const [rawCommand, ...rest] = String(text || '').trim().split(/\s+/);
  const command = String(rawCommand || '').toLowerCase().replace(/@[\w_]+$/, ''); // /to@MyBot
  const argument = rest.join(' ').trim();
  const saved = telegramInboxSaved();
  const where = saved.target ? '«' + saved.target + '»' : 'a new note in ' + TELEGRAM_INBOX_FOLDER + '/';

  if (command === '/start' || command === '/help') {
    return [
      'Write from your phone:',
      '• send a message — it goes into ' + where,
      '• /to <note> — write into that note from now on (it is created if it does not exist)',
      '• /new — back to one note per message, in ' + TELEGRAM_INBOX_FOLDER + '/',
      '• /status — where messages go right now',
    ].join('\n');
  }
  if (command === '/status') {
    return (saved.enabled ? 'Listening. ' : 'The inbox is off in Inkwell. ')
      + 'Messages go into ' + where + '.';
  }
  if (command === '/new') {
    store.set('telegramInbox', { enabled: saved.enabled, target: '' });
    notifyTelegramInboxChanged();
    return 'Every message now becomes a new note in ' + TELEGRAM_INBOX_FOLDER + '/.';
  }
  if (command === '/to') {
    if (!argument) return 'Send /to <note>, for example /to Inbox.md';
    const found = resolveInboxTarget(argument);
    if (found.error) return found.error;
    store.set('telegramInbox', { enabled: saved.enabled, target: found.target });
    notifyTelegramInboxChanged();
    return (found.created ? 'Created «' : 'Writing into «') + found.target + '». Send /new to go back to one note per message.';
  }
  return 'Unknown command. Send /help to see what the bot can do.';
}

async function telegramInboxLoop() {
  telegramInbox.running = true;
  telegramInbox.lastError = '';
  let offset = Number(store.get('telegramInboxOffset') || 0) || 0;
  // a first start imports the last day of messages, not the whole history
  let onlySince = offset ? 0 : Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  while (telegramInboxSaved().enabled) {
    const creds = getTelegramConfig();
    if (!creds.botToken || !creds.chatId) {
      telegramInbox.lastError = 'Telegram is not configured. Open Settings → Telegram.';
      break;
    }
    const controller = new AbortController();
    telegramInbox.abort = controller;
    const timer = setTimeout(() => controller.abort(), 40000);
    let updates = null;
    try {
      const query = '?timeout=25&allowed_updates=' + encodeURIComponent('["message","channel_post"]')
        + (offset ? '&offset=' + offset : '');
      const res = await fetch('https://api.telegram.org/bot' + creds.botToken + '/getUpdates' + query, { signal: controller.signal });
      const json = await res.json().catch(() => null);
      if (!json || json.ok !== true) {
        let reason = (json && json.description) || ('HTTP ' + res.status);
        // getUpdates and a webhook cannot be used on the same bot
        if (/webhook/i.test(reason) || res.status === 409) {
          reason = 'This bot has a webhook set. Telegram allows a webhook or the inbox, not both — remove the webhook (BotFather: /setwebhook) to use the phone inbox.';
        }
        throw new Error(reason);
      }
      updates = Array.isArray(json.result) ? json.result : [];
    } catch (e) {
      clearTimeout(timer);
      if (!telegramInboxSaved().enabled) break;
      telegramInbox.lastError = /aborted|abort/i.test(String(e && e.message)) ? '' : ('Telegram: ' + (e && e.message ? e.message : String(e)));
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }
    clearTimeout(timer);
    const settings = telegramInboxSaved();
    for (const update of updates) {
      // switched off while the request was in flight: save nothing more
      if (!settings.enabled || !telegramInboxSaved().enabled) break;
      offset = Math.max(offset, (update.update_id || 0) + 1);
      const message = update.message || update.channel_post;
      if (!message) continue;
      // a stranger messaging the bot is ignored
      if (String(message.chat && message.chat.id) !== String(creds.chatId)) continue;
      if (onlySince && (message.date || 0) < onlySince) continue;
      const body = String(message.text || message.caption || '').trim();
      if (!body) continue;
      // a command changes where the next messages go
      if (body.startsWith('/')) {
        await telegramInboxReply(telegramInboxCommand(body));
        continue;
      }
      await saveTelegramInboxMessage(message, telegramInboxSaved());
    }
    if (offset) store.set('telegramInboxOffset', offset);
    onlySince = 0;
  }
  telegramInbox.running = false;
  telegramInbox.abort = null;
}

function startTelegramInbox() {
  if (telegramInbox.running) return;
  if (!telegramInboxSaved().enabled) return;
  telegramInboxLoop().catch((e) => {
    telegramInbox.running = false;
    telegramInbox.lastError = e && e.message ? e.message : String(e);
  });
}

function stopTelegramInbox() {
  const controller = telegramInbox.abort;
  telegramInbox.abort = null;
  telegramInbox.running = false;
  if (controller) { try { controller.abort(); } catch (_) {} }
}

ipcMain.handle('telegram:inboxGet', async () => telegramInboxStatus());

ipcMain.handle('telegram:inboxSet', async (_event, config) => {
  const enabled = !!(config && config.enabled === true);
  const target = String((config && config.target) || '').trim().replace(/^\/+/, '');
  if (enabled) {
    const creds = getTelegramConfig();
    if (!creds.botToken || !creds.chatId) {
      return { ok: false, error: 'Telegram is not configured. Save a bot token and chat ID first.' };
    }
    if (target && !/\.md$/i.test(target)) return { ok: false, error: 'Choose a Markdown note to append to.' };
    if (target && !fs.existsSync(path.join(NOTES_DIR, target))) return { ok: false, error: 'That note does not exist any more.' };
  }
  stopTelegramInbox();
  store.set('telegramInbox', { enabled, target });
  telegramInbox.lastError = '';
  if (enabled) startTelegramInbox();
  // the "/" menu is part of turning the inbox on, not a separate step
  if (enabled) syncTelegramCommands().catch(() => {});
  return telegramInboxStatus();
});

ipcMain.handle('telegram:inboxCommands', async () => syncTelegramCommands());

// Both formats share the same upload; only the file name and MIME type differ.
async function sendTelegramFile(creds, filename, blob) {
  const form = new FormData();
  form.append('chat_id', creds.chatId);
  form.append('caption', filename);
  form.append('document', blob, filename);
  await telegramApi('sendDocument', form);
}

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
    await sendTelegramFile(creds, filename, new Blob([html], { type: 'text/html' }));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// The same note as plain Markdown: nothing to render, so the file is exactly the
// text the editor holds (or the saved translation).
ipcMain.handle('telegram:sendMarkdown', async (event, suggestedName, text) => {
  const win = windowFrom(event);
  if (!win) return { success: false, error: 'No window available' };

  const creds = getTelegramConfig();
  if (!creds.botToken || !creds.chatId) {
    return { success: false, error: 'Telegram is not configured. Open Settings → Telegram.' };
  }

  const body = String(text == null ? '' : text);
  if (!body.trim()) return { success: false, error: 'There is nothing to send' };
  const filename = docBaseName(suggestedName) + '.md';

  try {
    await sendTelegramFile(creds, filename, new Blob([body], { type: 'text/markdown' }));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/* ================= ASK AI ================= */
// Non-interactive CLIs installed on the machine. The renderer only sends a
// provider id + prompt text; the command itself is fixed here so the renderer
// can never inject arbitrary shell/cmd arguments.

// A model is allowed to take its time: a slow answer is better than an error the
// user has to work around, so this only stops a truly stuck process.
const AI_TIMEOUT = 300000;
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const THINK_RE = /<\/?think(?:ing)?>/gi;

function aiSearchDirs() {
  const home = app.getPath('home');
  const dirs = [];
  const seen = new Set();
  const push = (d) => { if (d && !seen.has(d)) { seen.add(d); dirs.push(d); } };
  for (const d of (process.env.PATH || '').split(path.delimiter)) push(d);

  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  [
    path.join(home, '.local', 'bin'),
    path.join(home, '.opencode', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.local', 'share', 'pnpm'),
    path.join(home, 'bin'),
    // the CLI installers keep a copy here, outside any package manager
    path.join(home, '.claude', 'local', 'bin'),
  ].forEach(push);

  // node version managers put npm globals in versioned folders
  try {
    const nvm = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvm)) {
      for (const version of fs.readdirSync(nvm).sort().reverse()) push(path.join(nvm, version, 'bin'));
    }
  } catch (_) {}

  if (isWin) {
    [path.join(appData, 'npm'), path.join(localAppData, 'pnpm'), path.join(localAppData, 'Microsoft', 'WinGet', 'Links')].forEach(push);
  }

  if (isMac) {
    [
      '/opt/homebrew/bin', '/opt/homebrew/sbin',
      '/opt/local/bin',
      path.join(home, 'Library', 'pnpm'),
      // the ChatGPT desktop app ships the Codex CLI inside the bundle
      '/Applications/ChatGPT.app/Contents/Resources',
    ].forEach(push);
  }

  [
    '/usr/local/bin', '/usr/bin', '/bin',
    '/usr/local/sbin', '/usr/sbin', '/sbin', '/snap/bin',
    // Codex CLI ships inside the ChatGPT desktop app (Linux)
    '/usr/lib/chatgpt/resources',
    '/usr/lib/chatgpt',
  ].forEach(push);
  return dirs;
}

// On Windows a CLI installed by npm is a pair of shims: `opencode` (a POSIX
// shell script) and `opencode.cmd`. Only the ones listed in PATHEXT can be
// executed, so the bare name must never win there.
function windowsExecutableExtensions() {
  const raw = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  const seen = new Set();
  for (const part of raw.split(';')) {
    const ext = part.trim().toLowerCase();
    if (ext) seen.add(ext);
  }
  for (const ext of ['.exe', '.cmd', '.bat']) seen.add(ext);
  return Array.from(seen);
}

function resolveExecutable(cmd) {
  if (cmd.includes('/') || cmd.includes('\\')) return fs.existsSync(cmd) ? cmd : null;
  const isWindows = process.platform === 'win32';
  const extensions = isWindows ? windowsExecutableExtensions() : [''];
  for (const dir of aiSearchDirs()) {
    for (const ext of extensions) {
      const full = path.join(dir, cmd + ext);
      try { if (fs.existsSync(full)) return full; } catch (_) {}
    }
  }
  return null;
}

// .cmd / .bat files cannot be executed by CreateProcess directly, they need the
// command interpreter; everything else is spawned as before.
function spawnExecutable(executable, args, options) {
  const argv = Array.isArray(args) ? args : [];
  const isScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  if (!isScript) return spawn(executable, argv, options);
  const comspec = process.env.ComSpec || 'cmd.exe';
  const quote = (value) => {
    const text = String(value);
    return /[\s"&|<>^]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const line = [quote(executable), ...argv.map(quote)].join(' ');
  return spawn(comspec, ['/d', '/s', '/c', line], { ...options, windowsVerbatimArguments: true });
}

function captureAICommand(cmd, args, options = {}) {
  const executable = resolveExecutable(cmd);
  if (!executable) return Promise.resolve({ ok: false, error: `Could not find "${cmd}" on PATH.` });
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawnExecutable(executable, args, {
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
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => { if (stdout.length < 2_000_000) stdout += chunk; });
    proc.stderr.on('data', (chunk) => { if (stderr.length < 30000) stderr += chunk; });
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
      proc = spawnExecutable(executable, ['app-server'], {
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
  if (type === 'api') {
    const configured = (Array.isArray(providerConfig.models) ? providerConfig.models : [])
      .map((model) => (typeof model === 'string' ? { id: model, name: model } : model))
      .filter((model) => model && model.id);
    const base = normalizeApiBase(providerConfig.baseUrl);
    const key = apiProviderKey(providerConfig);
    if (base && key) {
      for (const url of apiEndpointCandidates(providerConfig.baseUrl, 'models')) {
        try {
          const res = await fetch(url, { headers: { Authorization: 'Bearer ' + key } });
          if (!res.ok) continue;
          const data = await res.json();
          const entries = Array.isArray(data && data.data) ? data.data : (Array.isArray(data && data.models) ? data.models : []);
          const models = entries
            .map((model) => {
              const id = model && (model.id || model.name);
              return id ? { id: String(id), name: prettyModelName(String(id)) } : null;
            })
            .filter(Boolean);
          if (models.length) return { ok: true, models };
        } catch (_) {
          // offline or a blocked endpoint: fall back to the configured list
        }
      }
    }
    return { ok: true, models: configured };
  }
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

// OpenCode's "--format json" prints one event per line. Text arrives in parts
// that can be repeated (a part is re-sent as it grows), so the last text of a
// part wins instead of being appended twice. Failures are events too, and a raw
// JSON dump must never reach the answer pane, so the reason is pulled out here.
function parseOpencodeJson(out) {
  const parts = new Map();
  const order = [];
  let error = '';
  let loose = '';
  let sawJson = false;
  for (const line of String(out).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(t); } catch (_) { continue; }
    sawJson = true;
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'error') {
      const info = ev.error || ev.part || {};
      const message = typeof info === 'string' ? info : (info.data && info.data.message) || info.message || ev.message || '';
      if (message) error = String(message);
      continue;
    }
    if (ev.type !== 'text') continue;
    const part = ev.part || {};
    const value = typeof part.text === 'string' ? part.text : (typeof ev.text === 'string' ? ev.text : '');
    if (!value) continue;
    const id = part.id || part.messageID || null;
    if (id) {
      if (!parts.has(id)) order.push(id);
      parts.set(id, value);
    } else {
      loose += value;
    }
  }
  const text = order.map((id) => parts.get(id)).join('') + loose;
  return { text: text.replace(THINK_RE, '').trim(), error, sawJson };
}

const AI_OUTPUT_TOKEN = '__INKWELL_OUT__';
// A prompt longer than this cannot survive a command line on Windows (32k for a
// real executable, 8k for a .cmd shim), so it is only ever sent on stdin.
const AI_ARG_PROMPT_LIMIT = 7000;

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

/* ---- HTTP (OpenAI compatible) providers -----------------------------------
   Type "api" providers talk to an OpenAI-compatible endpoint directly
   (POST {base}/chat/completions), so services that ship no CLI — DeepSeek for
   one — work without anything installed on the machine.
   ------------------------------------------------------------------------- */

const DEFAULT_API_MODEL = 'deepseek-chat';

// Friendly names for model ids a service reports in lowercase form.
const KNOWN_MODEL_NAMES = {
  'deepseek-flash': 'DeepSeek V4.1 Flash',
  'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
};

function prettyModelName(id) {
  const raw = String(id || '').trim();
  if (!raw) return raw;
  if (KNOWN_MODEL_NAMES[raw.toLowerCase()]) return KNOWN_MODEL_NAMES[raw.toLowerCase()];
  return raw
    .split(/[-_/]/)
    .filter(Boolean)
    .map((word) => (/^v?\d/i.test(word) ? word.toUpperCase()
      : /^(ai|api|vl|llm|oss)$/i.test(word) ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

// API keys for HTTP providers live in the app's own settings file, not in the
// page state or its prefs, so they never reach the renderer after being saved.
function storedAIKeys() {
  const saved = store.get('aiKeys');
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

// Missing credentials are filled in from the saved settings, so a key stored
// once works for every AI action without being sent back and forth.
function withStoredAICredentials(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const merged = { ...cfg };
  const saved = storedAIKeys()[merged.id] || {};
  if (!merged.apiKey && typeof saved.apiKey === 'string') merged.apiKey = saved.apiKey;
  if (!merged.baseUrl && typeof saved.baseUrl === 'string') merged.baseUrl = saved.baseUrl;
  return merged;
}

function normalizeApiBase(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  return /^https?:\/\//i.test(base) ? base : '';
}

// A base URL arrives in every shape: a bare host, a versioned root, or the full
// endpoint copied from a documentation page. Each candidate is tried in order, so
// "https://api.x.com", "https://api.x.com/v1" and
// "https://api.x.com/v1/chat/completions" all end up in the right place instead
// of returning 404.
function apiEndpointCandidates(baseUrl, endpoint) {
  const raw = normalizeApiBase(baseUrl);
  if (!raw) return [];
  const trimmed = raw.replace(/\/(?:chat\/completions|completions|responses|models)$/i, '');
  const urls = [];
  const push = (base) => {
    const url = base.replace(/\/+$/, '') + '/' + endpoint;
    if (base && !urls.includes(url)) urls.push(url);
  };
  push(trimmed);
  try {
    const parsed = new URL(trimmed);
    const bare = parsed.pathname === '' || parsed.pathname === '/';
    if (bare) push(trimmed + '/v1');
    // a host that already ends in /v1 must not get a second one
    if (/\/v1$/i.test(parsed.pathname)) push(trimmed);
  } catch (_) {}
  return urls;
}

// The key comes from the settings, or from the env var named on the provider,
// or from <PROVIDER_ID>_API_KEY, so a key can also live in the environment.
function apiProviderKey(cfg) {
  if (!cfg || typeof cfg !== 'object') return '';
  if (typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) return cfg.apiKey.trim();
  const declared = typeof cfg.apiKeyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(cfg.apiKeyEnv.trim())
    ? cfg.apiKeyEnv.trim()
    : '';
  if (declared && process.env[declared]) return String(process.env[declared]).trim();
  const fromId = cfg.id ? String(cfg.id).toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY' : '';
  if (fromId && process.env[fromId]) return String(process.env[fromId]).trim();
  return '';
}

function apiResponseText(data) {
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const message = choice && choice.message ? choice.message : null;
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

function apiErrorMessage(res, body, name, url) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = (parsed && parsed.error && (parsed.error.message || parsed.error)) || parsed.message || '';
  } catch (_) {
    detail = String(body || '').trim().slice(0, 300);
  }
  if (res.status === 401 || res.status === 403) return name + ' rejected the API key (HTTP ' + res.status + '). Check the key in Settings → AI.';
  if (res.status === 404) return name + ' answered 404 at ' + (url || 'the base URL') + '. Check the Base URL: most services expect it to end with /v1 (or the full endpoint), and the model name must exist there.';
  if (res.status === 429) return name + ' is rate limiting requests (HTTP 429). Try again in a moment.';
  return name + ' request failed (HTTP ' + res.status + ')' + (url ? ' at ' + url : '') + (detail ? ': ' + detail : '');
}

async function askApiProvider(providerConfig, prompt, model, senderId) {
  const name = String(providerConfig.name || providerConfig.id || 'The provider');
  const base = normalizeApiBase(providerConfig.baseUrl);
  if (!base) return { ok: false, error: name + ' needs a base URL such as https://api.deepseek.com/v1.' };
  const key = apiProviderKey(providerConfig);
  if (!key) return { ok: false, error: 'Add an API key for ' + name + ' in Settings → AI.' };
  const urls = apiEndpointCandidates(providerConfig.baseUrl, 'chat/completions');
  if (!urls.length) return { ok: false, error: name + ' needs a base URL such as https://api.deepseek.com/v1.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);
  if (senderId != null) aiProcs.set(senderId, { proc: { kill: () => controller.abort() }, timer });

  try {
    let notFound = '';
    for (const url of urls) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: model || providerConfig.defaultModel || DEFAULT_API_MODEL,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
        signal: controller.signal,
      });
      const body = await res.text();
      if (!res.ok) {
        // 404 on one shape of the URL often means the other shape is right
        if (res.status === 404 && url !== urls[urls.length - 1]) { notFound = url; continue; }
        return { ok: false, error: apiErrorMessage(res, body, name, url) };
      }
      let data;
      try { data = JSON.parse(body); } catch (_) { return { ok: false, error: name + ' sent a response Inkwell could not read.' }; }
      const text = stripAnsi(apiResponseText(data)).replace(THINK_RE, '').trim();
      if (!text) return { ok: false, error: name + ' returned an empty answer.' };
      return { ok: true, text };
    }
    return { ok: false, error: name + ' answered 404 at ' + (notFound || urls[0]) + '. Check the Base URL: most services expect it to end with /v1 (or the full endpoint), and the model name must exist there.' };
  } catch (error) {
    if (error && error.name === 'AbortError') return { ok: false, error: 'Timed out after ' + Math.round(AI_TIMEOUT / 1000) + 's' };
    return { ok: false, error: name + ' request failed: ' + (error && error.message ? error.message : String(error)) };
  } finally {
    clearTimeout(timer);
    const rec = senderId != null ? aiProcs.get(senderId) : null;
    if (rec && rec.timer === timer) aiProcs.delete(senderId);
  }
}

function buildAICommand(provider, prompt, model, providerConfig, isolationArgs = []) {
  if (providerConfig && providerConfig.command && providerConfig.type) {
    const cmd = providerConfig.command;
    const type = providerConfig.type;
    // HTTP providers never spawn a process; askApiProvider handles them.
    if (type === 'api') return null;
    if (type === 'claude' || cmd === 'claude') {
      const custom = Array.isArray(providerConfig.args) && providerConfig.args.length;
      const args = custom ? providerConfig.args.map((a) => String(a)) : ['-p'];
      if (model && providerConfig.useModel !== false) {
        if (!args.includes('--model') && !args.includes('-m')) {
          args.push('--model', model);
        }
      }
      // custom args mean the user knows what they want: never inject ours
      if (!custom) args.push(...isolationArgs);
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
      // The prompt travels on stdin: OpenCode reads it there when no message
      // argument is given, and a long document would otherwise hit the Windows
      // command-line limit (32k, and 8k when the CLI is a .cmd shim through
      // cmd.exe) — plus cmd.exe would expand %VAR% and !var! inside the text.
      if (providerConfig.passPromptAsArg === true) {
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
      args.push(...isolationArgs);
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
      // the prompt goes on stdin, never on a command line that Windows caps
      return { cmd: 'opencode', args, stdin: prompt, parse: 'opencode-json' };
    }
    default:
      return null;
  }
}

const aiProcs = new Map();

/* ---- one-shot isolation for the built-in CLIs ---- */
// A coding CLI carries its own instructions: CLAUDE.md files, skills, hooks and
// a toolbox. Inheriting them turns a simple "explain this document" into a task
// the assistant finishes with side work (notifications, file edits, shell
// commands) instead of an answer. These flags reduce the call to a plain
// completion. They are probed from the installed CLI, so older versions keep
// working unchanged.
const AI_ONE_SHOT_SYSTEM = [
  'You are a writing assistant embedded in a desktop Markdown editor.',
  'Answer only the request in the user message, using the document text it contains.',
  'The user message is the whole input: never read, list or search files, and never look for context outside it.',
  'Never mention tools, shell commands, environment variables, notifications, sessions or your own setup, and never append notes about what you did.',
].join(' ');

let claudeIsolationFlags;
// the probe itself is cached, not only its result: the startup warm-up and the
// first request must wait for the same probe instead of seeing an empty list
// while it is still running (that would send the request without isolation).
let claudeIsolationProbe;

async function probeClaudeIsolationFlags() {
  const res = await captureAICommand('claude', ['--help'], { timeout: 12000 });
  if (!res.ok) return [];
  const help = res.stdout || '';
  const flags = [];
  // no tools at all: the answer must be text, never a command run
  if (/--tools\b/.test(help)) flags.push('--tools', '');
  // no CLAUDE.md / skills / plugins / hooks / MCP servers
  if (/--safe-mode\b/.test(help)) flags.push('--safe-mode');
  if (/--strict-mcp-config\b/.test(help)) flags.push('--strict-mcp-config');
  if (/--append-system-prompt\b/.test(help)) flags.push('--append-system-prompt', AI_ONE_SHOT_SYSTEM);
  return flags;
}

async function getClaudeIsolationFlags() {
  if (claudeIsolationFlags) return claudeIsolationFlags;
  if (!claudeIsolationProbe) {
    claudeIsolationProbe = probeClaudeIsolationFlags()
      .catch(() => [])
      .then((flags) => {
        claudeIsolationFlags = flags;
        return flags;
      });
  }
  return claudeIsolationProbe;
}

function claudeRequested(provider, providerConfig) {
  if (provider === 'claude') return true;
  if (!providerConfig) return false;
  if (providerConfig.useIsolation === false) return false;
  return providerConfig.type === 'claude' || providerConfig.command === 'claude';
}

ipcMain.handle('ai:listModels', async (_event, payload) => {
  try {
    const providerId = String(payload && payload.provider || '');
    let providerConfig = payload && payload.providerConfig && typeof payload.providerConfig === 'object' ? payload.providerConfig : {};
    if (!providerId) return { ok: false, models: [], error: 'No AI provider selected.' };
    if (providerConfig.type === 'api') providerConfig = withStoredAICredentials(providerConfig);
    return await discoverAIModels(providerId, providerConfig);
  } catch (error) {
    return { ok: false, models: [], error: error.message || String(error) };
  }
});

// Which providers already have a saved key, without ever returning the key.
ipcMain.handle('ai:keyStatus', (_event, payload) => {
  const ids = Array.isArray(payload && payload.ids) ? payload.ids : [];
  const saved = storedAIKeys();
  const status = {};
  for (const rawId of ids) {
    const id = String(rawId);
    const rec = saved[id] || {};
    status[id] = {
      hasKey: !!(rec.apiKey && String(rec.apiKey).trim()),
      baseUrl: typeof rec.baseUrl === 'string' ? rec.baseUrl : '',
    };
  }
  return { ok: true, status };
});

ipcMain.handle('ai:saveKey', (_event, payload) => {
  try {
    const id = String((payload && payload.id) || '').trim();
    if (!id) return { ok: false, error: 'No provider selected.' };
    const apiKey = String((payload && payload.apiKey) || '').trim();
    const baseUrl = String((payload && payload.baseUrl) || '').trim();
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) return { ok: false, error: 'Base URL must start with http:// or https://.' };
    const keys = { ...storedAIKeys() };
    const entry = { ...(keys[id] || {}) };
    if (apiKey) entry.apiKey = apiKey;
    if (baseUrl) entry.baseUrl = baseUrl;
    // the voice section also remembers which engine to prefer
    if (payload && typeof payload.engine === 'string') {
      const engine = payload.engine.trim();
      if (['auto', 'system', 'api'].includes(engine)) entry.engine = engine;
    }
    if (payload && typeof payload.voice === 'string') {
      const voice = payload.voice.trim();
      if (voice) entry.voice = voice;
      else delete entry.voice;
    }
    if (Object.keys(entry).length) keys[id] = entry;
    else delete keys[id];
    store.set('aiKeys', keys);
    return { ok: true, hasKey: !!(keys[id] && keys[id].apiKey), engine: (keys[id] && keys[id].engine) || 'auto' };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

// "Test" in the provider form: prove the key and the base URL work before a long
// answer depends on them. An HTTP provider lists its models (cheap, read-only);
// a CLI provider is only asked whether its command exists.
ipcMain.handle('ai:testProvider', async (_event, payload) => {
  const cfg = withStoredAICredentials(payload && payload.providerConfig);
  if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'No provider selected.' };
  const name = String(cfg.name || cfg.id || 'The provider');
  if (cfg.type === 'api') {
    if (!normalizeApiBase(cfg.baseUrl)) return { ok: false, error: name + ' needs a base URL such as https://api.deepseek.com/v1.' };
    const key = apiProviderKey(cfg);
    if (!key) return { ok: false, error: 'Add an API key for ' + name + ' first.' };
    const urls = apiEndpointCandidates(cfg.baseUrl, 'models');
    let notFound = '';
    for (const url of urls) {
      let res;
      let body;
      try {
        res = await fetch(url, { headers: { Authorization: 'Bearer ' + key } });
        body = await res.text();
      } catch (e) {
        return { ok: false, error: 'Could not reach ' + url + ': ' + (e && e.message ? e.message : String(e)) };
      }
      if (res.ok) {
        let count = 0;
        try {
          const data = JSON.parse(body);
          const list = Array.isArray(data && data.data) ? data.data : (Array.isArray(data && data.models) ? data.models : []);
          count = list.length;
        } catch (_) {}
        return { ok: true, url, detail: 'Connected · ' + (count ? count + ' models available' : 'the endpoint answered') };
      }
      if (res.status === 404) { notFound = url; continue; }
      return { ok: false, error: apiErrorMessage(res, body, name, url) };
    }
    return { ok: false, error: name + ' answered 404 at ' + (notFound || urls[0]) + '. Check the Base URL: most services expect it to end with /v1 (or the full endpoint).' };
  }
  const cmd = String(cfg.command || cfg.type || '').trim();
  if (!cmd || cmd === 'api') return { ok: false, error: 'This provider has no command to test.' };
  const exe = resolveExecutable(cmd);
  if (!exe) return { ok: false, error: 'Could not find "' + cmd + '". Make sure it is installed and on your PATH.' };
  const res = await captureAICommand(cmd, ['--version'], { timeout: 15000, env: providerCredentialEnv(cfg) });
  const first = String((res && res.stdout) || '').trim().split(/\r?\n/)[0];
  return { ok: true, detail: cmd + ' found' + (first ? ' · ' + first : ' at ' + exe) };
});

function killAIFor(id) {
  const rec = aiProcs.get(id);
  if (!rec) return;
  try { rec.proc.kill('SIGKILL'); } catch (_) {}
  clearTimeout(rec.timer);
  aiProcs.delete(id);
}

// Stop must really stop: a request the user cancelled must not be retried.
const aiCancelled = new Set();

ipcMain.handle('ai:cancel', (event) => {
  aiCancelled.add(event.sender.id);
  killAIFor(event.sender.id);
  return { ok: true };
});

// A model CLI can fail for reasons that have nothing to do with the app: the
// provider's endpoint times out on connect, a proxy hiccups, or the service is
// briefly rate limited. Those are worth another try before the user ever sees
// an error, so a request waits longer instead of failing on the first blip.
const AI_ATTEMPTS = 3;
const AI_RETRY_DELAYS = [2000, 6000];
const AI_TRANSIENT_RE = /UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_SOCKET|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|socket hang up|fetch failed|network|temporarily unavailable|timed out|timeout|rate limit|too many requests|overloaded|try again|connection (?:reset|closed|refused|terminated)/i;

function isTransientAIError(message) {
  return AI_TRANSIENT_RE.test(String(message || ''));
}

// A one-shot request already carries the document it is about inside the
// prompt, so the CLI never needs the vault. Running it in an empty scratch
// folder means "explain this document" cannot read a different note: there is
// nothing else in the working directory, and no AGENTS.md/CLAUDE.md of the
// vault is picked up either. The folder is removed when the process ends.
const AI_WORK_DIR_NOTE = [
  'Apart from this instruction file, this folder is intentionally empty:',
  'there is no code here and there are no other documents.',
  'Answer only from the text in the user message; do not read, list or search files.',
].join(' ');

function createAIWorkDir() {
  try {
    const base = path.join(os.tmpdir(), 'inkwell-ai-work');
    fs.mkdirSync(base, { recursive: true });
    // a killed process cannot clean up after itself: drop day-old leftovers
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const entry of fs.readdirSync(base)) {
        const full = path.join(base, entry);
        try { if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true }); } catch (_) {}
      }
    } catch (_) {}
    const dir = fs.mkdtempSync(path.join(base, 'run-'));
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      try { fs.writeFileSync(path.join(dir, name), AI_WORK_DIR_NOTE + '\n'); } catch (_) {}
    }
    return dir;
  } catch (_) {
    return null;
  }
}

function removeAIWorkDir(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// The CLI run itself, with no retry logic: resolves with the parsed answer or
// the failure the process produced. waitMs is the per-request timeout the
// caller resolved (a translation asks for a longer one than a short question).
function runAIProcess(spec, cmdPath, event, outputFile, providerConfig, waitMs) {
  const timeoutMs = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : AI_TIMEOUT;
  const workDir = createAIWorkDir();
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawnExecutable(cmdPath, spec.args, {
        cwd: workDir || NOTES_DIR,
        env: { ...process.env, ...(spec.env || {}), ...providerCredentialEnv(providerConfig), PATH: aiSearchDirs().join(path.delimiter) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      if (outputFile) { try { fs.unlinkSync(outputFile); } catch (_) {} }
      removeAIWorkDir(workDir);
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
      removeAIWorkDir(workDir);
      const rec = aiProcs.get(event.sender.id);
      if (rec && rec.proc === proc) aiProcs.delete(event.sender.id);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      done({ ok: false, error: 'Timed out after ' + Math.round(timeoutMs / 1000) + 's' });
    }, timeoutMs);

    aiProcs.set(event.sender.id, { proc, timer });

    // Decoding each chunk on its own splits a multi-byte character whenever the
    // pipe cuts one in half, which turns Persian/Chinese output into U+FFFD.
    // Reading the streams as text lets Node carry the partial character over.
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (e) => {
      done({ ok: false, error: 'Could not run "' + spec.cmd + '": ' + e.message });
    });
    proc.on('close', (code) => {
      let text;
      let opencodeError = '';
      let opencodeSawJson = false;
      if (spec.parse === 'file') {
        try { text = fs.readFileSync(outputFile, 'utf8').trim(); } catch (_) { text = ''; }
        text = stripAnsi(text).replace(THINK_RE, '').trim();
      } else if (spec.parse === 'opencode-json') {
        const parsed = parseOpencodeJson(stdout);
        text = parsed.text;
        opencodeError = parsed.error;
        opencodeSawJson = parsed.sawJson;
        // a line that is not an event is still something the user can read
        if (!text && !opencodeSawJson) text = stripAnsi(stdout).replace(THINK_RE, '').trim();
      } else {
        text = stripAnsi(stdout).replace(THINK_RE, '').trim();
      }
      const errOut = stripAnsi(stderr).trim();
      if (/not logged in|please run \/login/i.test(text)) return done({ ok: false, error: text });
      if (!text && opencodeError) return done({ ok: false, error: opencodeError });
      if (!text && errOut) return done({ ok: false, error: errOut });
      if (!text && code !== 0) return done({ ok: false, error: spec.cmd + ' exited with code ' + code });
      if (!text) return done({ ok: false, error: 'No response from ' + spec.cmd });
      done({ ok: true, text });
    });

    if (typeof spec.stdin === 'string' && spec.stdin.length) {
      proc.stdin.on('error', () => {});
      proc.stdin.write(spec.stdin);
      proc.stdin.end();
    } else if (proc.stdin) {
      proc.stdin.end();
    }
  });
}

ipcMain.handle('ai:ask', async (event, payload) => {
  const provider = payload && payload.provider;
  const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
  const model = payload && typeof payload.model === 'string' ? payload.model.trim() : '';
  const providerConfig = payload && payload.providerConfig;

  if (providerConfig && providerConfig.type === 'api') {
    if (!prompt.trim()) return { ok: false, error: 'Empty prompt' };
    aiCancelled.delete(event.sender.id);
    killAIFor(event.sender.id);
    let last = { ok: false, error: 'No response' };
    for (let attempt = 1; attempt <= AI_ATTEMPTS; attempt += 1) {
      if (aiCancelled.has(event.sender.id)) return { ok: false, error: 'Cancelled' };
      last = await askApiProvider(withStoredAICredentials(providerConfig), prompt, model, event.sender.id);
      if (last && last.ok) return last;
      if (attempt >= AI_ATTEMPTS || !isTransientAIError(last && last.error)) break;
      await new Promise((resolve) => setTimeout(resolve, AI_RETRY_DELAYS[attempt - 1] || 6000));
    }
    return last;
  }

  const requestedTimeout = Number(payload && payload.timeout);
  const waitMs = Number.isFinite(requestedTimeout) && requestedTimeout >= 15000
    ? Math.min(requestedTimeout, AI_TIMEOUT)
    : AI_TIMEOUT;

  let isolation = [];
  if (claudeRequested(provider, providerConfig)) {
    try { isolation = await getClaudeIsolationFlags(); } catch (_) { isolation = []; }
  }
  const spec = buildAICommand(provider, prompt, model, providerConfig, isolation);
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

  // A custom provider can be configured to take the prompt as an argument. On
  // Windows that argument has a hard ceiling (about 8000 characters through a
  // .cmd shim), so a long document must not be cut there without saying so.
  if (process.platform === 'win32' && spec.stdin == null && prompt.length > AI_ARG_PROMPT_LIMIT
    && spec.args.some((a) => a === prompt)) {
    return {
      ok: false,
      error: 'This provider takes the prompt on the command line, which Windows limits to about 8000 characters. Use Claude, Codex or OpenCode (they read the prompt from the input), or an HTTP provider, for a document this long.',
    };
  }

  aiCancelled.delete(event.sender.id);
  killAIFor(event.sender.id);

  // An older OpenCode build ignores the message on stdin and exits with
  // "You must provide a message or a command". Rather than failing every
  // request, fall back to the argument form once — only when the prompt is
  // small enough for a command line, which is the case such a build can take.
  const argFallback = spec.parse === 'opencode-json' && typeof spec.stdin === 'string'
    && prompt.length <= AI_ARG_PROMPT_LIMIT;
  let activeSpec = spec;

  let last = { ok: false, error: 'No response' };
  for (let attempt = 1; attempt <= AI_ATTEMPTS; attempt += 1) {
    if (aiCancelled.has(event.sender.id)) return { ok: false, error: 'Cancelled' };
    last = await runAIProcess(activeSpec, cmdPath, event, outputFile, providerConfig, waitMs);
    if (last && last.ok) return last;
    if (argFallback && activeSpec === spec && /must provide a message/i.test(String(last && last.error))) {
      activeSpec = { ...spec, stdin: null, args: [...spec.args, prompt] };
      last = await runAIProcess(activeSpec, cmdPath, event, outputFile, providerConfig, waitMs);
      if (last && last.ok) return last;
    }
    if (aiCancelled.has(event.sender.id)) return { ok: false, error: 'Cancelled' };
    if (attempt >= AI_ATTEMPTS || !isTransientAIError(last && last.error)) break;
    // a blip on the provider's side should not reach the user as an error
    await new Promise((resolve) => setTimeout(resolve, AI_RETRY_DELAYS[attempt - 1] || 6000));
  }
  return last;
});
