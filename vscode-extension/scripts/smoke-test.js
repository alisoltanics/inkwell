// Smoke test for the extension host code, runnable without VS Code:
//   node scripts/smoke-test.js
// It mocks the few vscode APIs the extension touches, activates it, resolves a
// fake custom text editor and checks the generated webview HTML, the messages
// sent to the page and the command wiring.
const Module = require('module');
const path = require('path');

const root = path.join(__dirname, '..');
const registered = { customEditors: [], commands: [], handlers: {}, messages: [], warnings: [], errors: [] };
const disposable = () => ({ dispose() {} });

function makeUri(fsPath) {
  return {
    scheme: 'file',
    path: fsPath,
    fsPath,
    toString() { return 'file://' + fsPath; },
  };
}

const settings = { theme: 'auto', palette: 'auto', fontSize: 110, direction: 'rtl', vaultPath: '', vaultFolderPerWorkspace: true };

const vscode = {
  Uri: {
    joinPath(uri, ...parts) { return makeUri(path.join(uri.fsPath || uri.path, ...parts)); },
  },
  ViewColumn: { Active: -1, Beside: -2 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  window: {
    activeColorTheme: { kind: 2 },
    activeTextEditor: undefined,
    registerCustomEditorProvider(type, provider, options) {
      registered.customEditors.push({ type, provider, options });
      return disposable();
    },
    onDidChangeActiveColorTheme() { return disposable(); },
    showInformationMessage(...args) { registered.messages.push(args); return Promise.resolve(undefined); },
    showWarningMessage(...args) { registered.warnings.push(args); return Promise.resolve(registered.warningChoice); },
    showErrorMessage(...args) { registered.errors.push(args); return Promise.resolve(undefined); },
    async showOpenDialog() { return registered.folderChoice ? [makeUri(registered.folderChoice)] : undefined; },
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
      return {
        get: (key) => settings[key],
        update: async (key, value) => { settings[key] = value; },
      };
    },
    getWorkspaceFolder(uri) {
      const root = registered.workspaceRoot;
      if (!root) return undefined;
      const file = uri.fsPath || uri.path || '';
      if (file !== root && !file.startsWith(root + path.sep)) return undefined;
      return { name: path.basename(root), uri: makeUri(root), index: 0 };
    },
    async openTextDocument(uri) {
      return { uri, getText: () => require('fs').readFileSync(uri.fsPath, 'utf8') };
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
  'commands registered': registered.commands.length === 3,
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

/* ---- sending a note to the vault ---- */
const os = require('os');
const nodeFs = require('fs');

async function vaultChecks() {
  const work = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-smoke-'));
  const project = path.join(work, 'my-project');
  const noteDir = path.join(project, 'docs');
  const vault = path.join(work, 'vault');
  nodeFs.mkdirSync(noteDir, { recursive: true });
  nodeFs.mkdirSync(vault, { recursive: true });
  const notePath = path.join(noteDir, 'flow.md');
  nodeFs.writeFileSync(notePath, '# Flow\n\nsome **text**\n', 'utf8');

  registered.workspaceRoot = project;
  registered.folderChoice = vault;
  settings.vaultPath = '';
  settings.vaultFolderPerWorkspace = true;

  const send = () => registered.handlers['inkwell.preview.sendToVault']();
  const copied = path.join(vault, 'my-project', 'docs', 'flow.md');
  vscode.window.activeTextEditor = {
    document: {
      uri: makeUri(notePath),
      isDirty: false,
      getText: () => nodeFs.readFileSync(notePath, 'utf8'),
    },
  };

  await send();
  checks['vault path is remembered'] = settings.vaultPath === vault;
  checks['note is copied into the vault'] = nodeFs.existsSync(copied)
    && nodeFs.readFileSync(copied, 'utf8') === '# Flow\n\nsome **text**\n';
  checks['copy keeps the workspace path'] = copied.endsWith(path.join('my-project', 'docs', 'flow.md'));
  checks['a copied note is reported'] = registered.messages.some((args) => /Copied to the Inkwell vault/.test(String(args[0])));

  // the same text again: nothing to ask, nothing to write
  registered.messages.length = 0;
  registered.warnings.length = 0;
  await send();
  checks['an unchanged note is skipped'] = registered.warnings.length === 0
    && registered.messages.some((args) => /Already in the Inkwell vault/.test(String(args[0])));

  // changed text, the user picks Replace
  nodeFs.writeFileSync(notePath, '# Flow\n\nnew text\n', 'utf8');
  registered.warnings.length = 0;
  registered.warningChoice = 'Replace';
  await send();
  checks['replace overwrites the copy'] = registered.warnings.length === 1
    && nodeFs.readFileSync(copied, 'utf8') === '# Flow\n\nnew text\n';

  // different text again, and now the user keeps both
  nodeFs.writeFileSync(notePath, '# Flow\n\nanother draft\n', 'utf8');
  registered.warningChoice = 'Keep both';
  await send();
  checks['keep both writes a second file'] = nodeFs.existsSync(path.join(vault, 'my-project', 'docs', 'flow-2.md'));

  // flat layout drops the copy straight into the vault
  settings.vaultFolderPerWorkspace = false;
  await send();
  checks['flat layout copies to the vault root'] = nodeFs.existsSync(path.join(vault, 'flow.md'));
  settings.vaultFolderPerWorkspace = true;

  nodeFs.rmSync(work, { recursive: true, force: true });
}

vaultChecks()
  .catch((error) => {
    checks['nothing failed on the way'] = false;
    console.error(error);
  })
  .then(() => {
    checks['nothing failed on the way'] = checks['nothing failed on the way'] !== false && registered.errors.length === 0;
    let failed = 0;
    for (const [name, ok] of Object.entries(checks)) {
      console.log((ok ? '  ok   ' : '  FAIL ') + name);
      if (!ok) failed += 1;
    }
    console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
    process.exit(failed ? 1 : 0);
  });
