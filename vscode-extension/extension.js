const path = require('path');
const fs = require('fs');
const os = require('os');
const vscode = require('vscode');

const VIEW_TYPE = 'inkwell.preview';

// The palettes that ship with Inkwell's stylesheet and the color mode each one
// is built for. A palette wins over the VS Code theme, because it brings its
// own colors for both surfaces and text.
const PALETTES = {
  'vscode-dark': 'dark',
  chatgpt: 'dark',
  github: 'dark',
  nord: 'dark',
  dracula: 'dark',
  'solarized-dark': 'dark',
  'solarized-light': 'light',
  sepia: 'light',
  rose: 'light',
};

function isLightTheme() {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
}

// What the webview needs to know to look like the app: color mode, palette,
// text scale and base direction.
function previewMeta() {
  const config = vscode.workspace.getConfiguration('inkwellPreview');
  const theme = String(config.get('theme') || 'auto');
  const palette = String(config.get('palette') || 'auto');

  let mode;
  if (palette !== 'auto' && palette !== 'default' && PALETTES[palette]) mode = PALETTES[palette];
  else if (theme === 'dark' || theme === 'light') mode = theme;
  else mode = isLightTheme() ? 'light' : 'dark';

  let paletteAttr = '';
  if (palette === 'auto') paletteAttr = mode === 'dark' ? 'vscode-dark' : '';
  else if (palette !== 'default') paletteAttr = palette;

  const scale = Number(config.get('fontSize')) || 100;
  return {
    theme: mode,
    palette: paletteAttr,
    scale: Math.min(180, Math.max(70, scale)) / 100,
    direction: String(config.get('direction') || 'auto'),
  };
}

function nonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

class InkwellPreviewProvider {
  constructor(context) {
    this.context = context;
    this.panels = new Set();
  }

  resolveCustomTextEditor(document, panel) {
    const webview = panel.webview;
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    // images and other local resources next to the note are allowed too, so a
    // relative picture resolves like it does in the app. An unsaved note has no
    // folder, so the media folder is the only root then.
    const documentDir = document.uri.scheme === 'file'
      ? vscode.Uri.joinPath(document.uri, '..')
      : null;

    webview.options = {
      enableScripts: true,
      localResourceRoots: documentDir ? [mediaRoot, documentDir] : [mediaRoot],
    };

    const uriOf = (name) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, name));
    // relative images must resolve through the webview's own resource origin,
    // not the file: origin, which the page is not allowed to load from
    const baseHref = webview
      .asWebviewUri(documentDir || mediaRoot)
      .toString(true)
      .replace(/\/?$/, '/');
    const htmlNonce = nonce();

    webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${baseHref}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https: http:; media-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${htmlNonce}';">
<link rel="stylesheet" href="${uriOf('style.css')}">
<link rel="stylesheet" href="${uriOf('hljs.css')}">
<link rel="stylesheet" href="${uriOf('katex.css')}">
<link rel="stylesheet" href="${uriOf('preview.css')}">
</head>
<body class="inkwell-preview">
<div class="preview-pane" id="pane">
  <div class="markdown-body" id="content"></div>
</div>
<script nonce="${htmlNonce}" src="${uriOf('markdown-bundle.js')}"></script>
<script nonce="${htmlNonce}" src="${uriOf('preview.js')}"></script>
</body>
</html>`;

    let debounce = null;
    const send = () => {
      if (!webview) return;
      webview.postMessage({ type: 'render', text: document.getText(), meta: previewMeta() });
    };
    const sendSoon = () => {
      clearTimeout(debounce);
      debounce = setTimeout(send, 120);
    };

    const entry = { panel, send };
    this.panels.add(entry);

    const disposables = [
      // live updates while typing, without re-rendering on every keystroke
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === document.uri.toString()) sendSoon();
      }),
      // a save can change what the note points at (images, included files)
      vscode.workspace.onDidSaveTextDocument((saved) => {
        if (saved.uri.toString() === document.uri.toString()) send();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('inkwellPreview')) send();
      }),
      webview.onDidReceiveMessage((message) => {
        if (message && message.type === 'ready') send();
      }),
      panel.onDidDispose(() => {
        clearTimeout(debounce);
        this.panels.delete(entry);
        for (const disposable of disposables) disposable.dispose();
      }),
    ];
  }

  // Theme switches are app wide, so every open preview is refreshed.
  refreshAll() {
    for (const entry of this.panels) {
      try { entry.send(); } catch (_) {}
    }
  }
}

// Commands can be called from the palette (no argument), from the editor title
// (a Uri) or from a context menu (an object holding the resource Uri).
function asUri(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.scheme === 'string') return value;
  if (value.resourceUri && typeof value.resourceUri.scheme === 'string') return value.resourceUri;
  if (value.uri && typeof value.uri.scheme === 'string') return value.uri;
  return null;
}

function targetUri(value) {
  const fromArgument = asUri(value);
  if (fromArgument) return fromArgument;
  const editor = vscode.window.activeTextEditor;
  return editor ? editor.document.uri : null;
}

async function openPreview(uri, column) {
  const target = targetUri(uri);
  if (!target) {
    vscode.window.showInformationMessage('Open a Markdown file first.');
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE, column);
}

/* ============ SEND TO THE INKWELL VAULT ============ */
// The vault is a plain folder of Markdown files, so "sending" a document is
// copying its text there: no export format, no second copy to keep in sync.

function expandHome(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text === '~') return os.homedir();
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(os.homedir(), text.slice(2));
  return text;
}

async function isDirectory(target) {
  try {
    return (await fs.promises.stat(target)).isDirectory();
  } catch (_) {
    return false;
  }
}

async function fileExists(target) {
  try {
    await fs.promises.access(target);
    return true;
  } catch (_) {
    return false;
  }
}

// A free name next to the file that is already there: note.md, note-2.md, …
async function freeName(target) {
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let n = 2; n < 500; n++) {
    const candidate = path.join(dir, `${base}-${n}${ext}`);
    if (!(await fileExists(candidate))) return candidate;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

// Asks for the vault the first time and remembers the answer.
async function vaultRoot() {
  const config = vscode.workspace.getConfiguration('inkwellPreview');
  const configured = expandHome(config.get('vaultPath'));
  if (configured && await isDirectory(configured)) return configured;

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Use as Inkwell vault',
    title: 'Choose the folder Inkwell keeps your notes in',
  });
  if (!picked || !picked.length) return '';
  const chosen = picked[0].fsPath;
  await config.update('vaultPath', chosen, vscode.ConfigurationTarget.Global);
  return chosen;
}

// Where the copy goes: a note from a workspace keeps its place under a folder
// named after that workspace, unless the setting asks for a flat vault.
function vaultDestination(uri, vault) {
  const config = vscode.workspace.getConfiguration('inkwellPreview');
  const keepTree = config.get('vaultFolderPerWorkspace') !== false;
  const file = uri.fsPath || uri.path || '';
  let relative = path.basename(file);
  if (keepTree && typeof vscode.workspace.getWorkspaceFolder === 'function') {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const root = folder && folder.uri && (folder.uri.fsPath || folder.uri.path);
    if (root) {
      const inside = path.relative(root, file);
      if (inside && !inside.startsWith('..') && !path.isAbsolute(inside)) {
        relative = path.join(path.basename(root), inside);
      }
    }
  }
  return path.join(vault, relative);
}

async function documentFor(uri) {
  const editor = vscode.window.activeTextEditor;
  if (editor && (!uri || editor.document.uri.fsPath === uri.fsPath)) return editor.document;
  if (!uri) return null;
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch (_) {
    return null;
  }
}

async function sendToVault(value) {
  const uri = targetUri(value);
  const document = await documentFor(uri);
  if (!document) {
    vscode.window.showInformationMessage('Open a Markdown file first.');
    return;
  }
  if (uri && !/\.(md|markdown)$/i.test(uri.fsPath || uri.path || '')) {
    vscode.window.showInformationMessage('Only Markdown notes can go to the vault.');
    return;
  }
  if (document.isDirty) await document.save();

  const vault = await vaultRoot();
  if (!vault) return;

  let destination = vaultDestination(document.uri, vault);
  const text = document.getText();
  if (await fileExists(destination)) {
    const current = await fs.promises.readFile(destination, 'utf8').catch(() => null);
    if (current === text) {
      vscode.window.showInformationMessage(`Already in the Inkwell vault: ${path.relative(vault, destination)}`);
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `${path.basename(destination)} is already in the vault.`,
      { modal: true, detail: path.relative(vault, destination) },
      'Replace',
      'Keep both'
    );
    if (!choice) return;
    if (choice === 'Keep both') destination = await freeName(destination);
  }

  try {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(destination, text, 'utf8');
  } catch (error) {
    vscode.window.showErrorMessage(`Could not copy the note: ${error && error.message ? error.message : error}`);
    return;
  }

  const action = await vscode.window.showInformationMessage(
    `Copied to the Inkwell vault: ${path.relative(vault, destination)}`,
    'Reveal'
  );
  if (action === 'Reveal') {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(destination));
  }
}

function activate(context) {
  const provider = new InkwellPreviewProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('inkwell.preview.open', (uri) => openPreview(uri, vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('inkwell.preview.openToSide', (uri) => openPreview(uri, vscode.ViewColumn.Beside)),
    vscode.commands.registerCommand('inkwell.preview.sendToVault', (uri) => sendToVault(uri)),
    vscode.window.onDidChangeActiveColorTheme(() => provider.refreshAll())
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
