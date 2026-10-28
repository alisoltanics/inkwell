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
      if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.md')) continue;
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
    const dst = resolveLogical(newPath, { createDirs: true });
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
    if (fs.existsSync(dst.abs)) throw new Error('A folder with that name already exists');
    fs.mkdirSync(path.dirname(dst.abs), { recursive: true });
    fs.renameSync(src.abs, dst.abs);
    return { success: true, path: dst.segments.join('/') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:getNotesDir', async () => {
  return NOTES_DIR;
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

ipcMain.handle('dialog:exportHTML', async (event, suggestedName, payload) => {
  const win = windowFrom(event);
  if (!win) return { success: false, error: 'No window available' };

  const base = docBaseName(suggestedName);

  let filePath;
  try {
    const res = await dialog.showSaveDialog(win, {
      title: 'Export document',
      defaultPath: base + '.html',
      filters: [{ name: 'HTML Document', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return { success: false, canceled: true };
    filePath = res.filePath;
  } catch (e) {
    return { success: false, error: e.message };
  }

  try {
    fs.writeFileSync(filePath, buildStandaloneHtml(payload), 'utf8');
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
      return { cmd, args, stdin: providerConfig.stdin !== false ? '-' : null, parse: providerConfig.parse || 'file' };
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
        env: { ...process.env, ...(spec.env || {}), PATH: aiSearchDirs().join(path.delimiter) },
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
