const path = require('path');
const vscode = require('vscode');

const VIEW_TYPE = 'inkwell.preview';

// The palettes that ship with Inkwell's stylesheet and the color mode each one
// is built for. A palette wins over the VS Code theme, because it brings its
// own colors for both surfaces and text.
const PALETTES = {
  'vscode-dark': 'dark',
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

function activate(context) {
  const provider = new InkwellPreviewProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('inkwell.preview.open', (uri) => openPreview(uri, vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('inkwell.preview.openToSide', (uri) => openPreview(uri, vscode.ViewColumn.Beside)),
    vscode.window.onDidChangeActiveColorTheme(() => provider.refreshAll())
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
