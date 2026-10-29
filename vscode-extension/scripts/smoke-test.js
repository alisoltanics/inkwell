// Smoke test for the extension host code, runnable without VS Code:
//   node scripts/smoke-test.js
// It mocks the few vscode APIs the extension touches, activates it, resolves a
// fake custom text editor and checks the generated webview HTML, the messages
// sent to the page and the command wiring.
const Module = require('module');
const path = require('path');

const root = path.join(__dirname, '..');
const registered = { customEditors: [], commands: [], handlers: {} };
const disposable = () => ({ dispose() {} });

function makeUri(fsPath) {
  return {
    scheme: 'file',
    path: fsPath,
    fsPath,
    toString() { return 'file://' + fsPath; },
  };
}

const settings = { theme: 'auto', palette: 'auto', fontSize: 110, direction: 'rtl' };

const vscode = {
  Uri: {
    joinPath(uri, ...parts) { return makeUri(path.join(uri.fsPath || uri.path, ...parts)); },
  },
  ViewColumn: { Active: -1, Beside: -2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  window: {
    activeColorTheme: { kind: 2 },
    activeTextEditor: undefined,
    registerCustomEditorProvider(type, provider, options) {
      registered.customEditors.push({ type, provider, options });
      return disposable();
    },
    onDidChangeActiveColorTheme() { return disposable(); },
    showInformationMessage() {},
  },
  commands: {
    registerCommand(id, handler) {
      registered.commands.push(id);
      registered.handlers[id] = handler;
      return disposable();
    },
    async executeCommand(...args) { registered.executed = args; },
  },
  workspace: {
    getConfiguration() {
      return { get: (key) => settings[key] };
    },
    onDidChangeTextDocument() { return disposable(); },
    onDidSaveTextDocument() { return disposable(); },
    onDidChangeConfiguration() { return disposable(); },
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require(path.join(root, 'extension.js'));
extension.activate({ subscriptions: [], extensionUri: makeUri(root) });

const entry = registered.customEditors[0];
const messages = [];
const panel = {
  webview: {
    options: {},
    html: '',
    cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
    asWebviewUri(uri) {
      return { toString: () => 'https://file+.vscode-resource.vscode-cdn.net' + uri.fsPath };
    },
    postMessage(message) { messages.push(message); return Promise.resolve(true); },
    onDidReceiveMessage(handler) { panel.onMessage = handler; return disposable(); },
  },
  onDidDispose() { return disposable(); },
};

entry.provider.resolveCustomTextEditor(
  { uri: makeUri('/home/ali/notes/note.md'), getText: () => '# Hello\n\nSome **text**.' },
  panel
);

const html = panel.webview.html;
const assets = ['style.css', 'hljs.css', 'katex.css', 'preview.css', 'markdown-bundle.js', 'preview.js'];
const checks = {
  'custom editor registered': entry.type === 'inkwell.preview',
  'commands registered': registered.commands.length === 2,
  'scripts enabled': panel.webview.options.enableScripts === true,
  'media folder allowed': (panel.webview.options.localResourceRoots || []).some((uri) => /media$/.test(uri.fsPath)),
  'note folder allowed for images': (panel.webview.options.localResourceRoots || []).some((uri) => /notes$/.test(uri.fsPath)),
  'base href uses the webview origin': /<base href="https:\/\/file\+\.vscode-resource[^"]*\/notes\/">/.test(html),
  'content security policy set': /Content-Security-Policy/.test(html) && /script-src 'nonce-/.test(html),
  'every asset linked': assets.every((name) => html.includes('/media/' + name)),
  'both scripts carry a nonce': (html.match(/nonce="[A-Za-z0-9]{32}"/g) || []).length === 2,
};

panel.onMessage({ type: 'ready' });
const first = messages[messages.length - 1] || {};
checks['document is sent on ready'] = first.type === 'render' && first.text === '# Hello\n\nSome **text**.';
checks['settings reach the page'] = !!first.meta && first.meta.theme === 'dark' && first.meta.palette === 'vscode-dark' && first.meta.direction === 'rtl';

let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) failed += 1;
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
