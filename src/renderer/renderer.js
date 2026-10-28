const md = window.__md;
const hljs = window.__hljs;

// The bundled highlighter renders <pre class="hljs"><code>…</code></pre> without
// the fence language, which makes highlight.js auto-detect on re-highlight and
// label blocks wrongly. Re-override it so the authored language survives as a
// `language-*` class (used for the code-block header) and highlighting happens once.
if (md && md.options) {
  md.options.highlight = function (str, lang) {
    const esc = String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    if (lang && hljs.getLanguage(lang)) {
      try {
        const html = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        const safeLang = String(lang).replace(/[^\w+#.-]/g, '');
        return `<pre class="hljs"><code class="language-${safeLang}">${html}</code></pre>`;
      } catch (_) {}
    }
    return `<pre class="hljs"><code>${esc}</code></pre>`;
  };
}

let state = {
  files: [],
  folders: [],
  filtered: [],
  currentFile: null,
  dirty: false,
  viewMode: 'edit',
  searchQuery: '',
  contextTarget: null,
  contextIsFolder: false,
  expandedFolders: new Set(),
  newFileFolder: '',
  zoom: 100,
  direction: 'auto',
  dirByFile: {},
  splitPos: 50,
  sidebarWidth: 270,
  theme: 'dark',
  pinned: [],
  aiProvider: 'claude',
  aiModels: {},
  aiDock: 'right',
  aiDockW: 400,
  aiDockH: 280,
  aiPrompts: ['Explain this', 'Translate to Persian', 'Explain this in Persian', 'Summarize this', 'What is this?'],
  commentsByFile: {},
  lastFile: null,
  scrollByFile: {},
  cursorByFile: {},
  telegramBusy: false,
  aiProviders: [],
};

const findState = { open: false, query: '', matches: [], index: -1 };

const $ = (id) => document.getElementById(id);

const els = {
  appScreen: $('appScreen'),
  sidebar: $('sidebar'),
  sidebarResizer: $('sidebarResizer'),
  fileList: $('fileList'),
  tabBar: $('tabBar'),
  searchInput: $('searchInput'),
  newFileBtn: $('newFileBtn'),
  newFolderBtn: $('newFolderBtn'),
  vaultPath: $('vaultPath'),
  toggleSidebarBtn: $('toggleSidebarBtn'),
  currentFileName: $('currentFileName'),
  viewToggle: $('viewToggle'),
  saveBtn: $('saveBtn'),
  deleteFileBtn: $('deleteFileBtn'),
  saveStatus: $('saveStatus'),
  wordCount: $('wordCount'),
  editorArea: $('editorArea'),
  editorWrap: $('editorWrap'),
  editor: $('editor'),
  editorHighlight: $('editorHighlight'),
  preview: $('preview'),
  previewContent: $('previewContent'),
  statusMessage: $('statusMessage'),
  vaultLocation: $('vaultLocation'),
  toastContainer: $('toastContainer'),
  contextMenu: $('contextMenu'),
  zoomIn: $('zoomIn'),
  zoomOut: $('zoomOut'),
  zoomLevel: $('zoomLevel'),
  editorToolbar: $('editorToolbar'),
  directionControl: $('directionControl'),
  splitDivider: $('splitDivider'),
  imageLightbox: $('imageLightbox'),
  lightboxImg: $('lightboxImg'),
  lightboxClose: $('lightboxClose'),
  lightboxCaption: $('lightboxCaption'),
  settingsBtn: $('settingsBtn'),
  settingsAiProvider: $('settingsAiProvider'),
  settingsAiModel: $('settingsAiModel'),
  settingsAiPrompts: $('settingsAiPrompts'),
  settingsAiSave: $('settingsAiSave'),
  aiProviderAdd: $('aiProviderAdd'),
  aiProvidersList: $('aiProvidersList'),
  settingsVaultPath: $('settingsVaultPath'),
  settingsVaultChoose: $('settingsVaultChoose'),
  settingsVaultSave: $('settingsVaultSave'),
  settingsVaultStatus: $('settingsVaultStatus'),
  settingsTelegramToken: $('settingsTelegramToken'),
  settingsTelegramChat: $('settingsTelegramChat'),
  settingsTelegramTest: $('settingsTelegramTest'),
  settingsTelegramSave: $('settingsTelegramSave'),
  settingsTelegramTest: $('settingsTelegramTest'),
  themeToggle: $('themeToggle'),
  exportBtn: $('exportBtn'),
  telegramBtn: $('telegramBtn'),
  findBar: $('findBar'),
  findInput: $('findInput'),
  findCount: $('findCount'),
  findPrev: $('findPrev'),
  findNext: $('findNext'),
  findClose: $('findClose'),
  aiToolbarBtn: $('aiToolbarBtn'),
  aiHeaderSelectionBtn: $('aiHeaderSelectionBtn'),
  askCodeHeaderBtn: $('askCodeHeaderBtn'),
  explainCodeToolbarBtn: $('explainCodeToolbarBtn'),
  explainCodeInput: $('explainCodeInput'),
  explainLang: $('explainLang'),
  explainCodeSubmit: $('explainCodeSubmit'),
  aiPanel: $('aiPanel'),
  aiPanelTitle: $('aiPanelTitle'),
  aiFloatBtn: $('aiFloatBtn'),
  aiClose: $('aiClose'),
  aiContextToggle: $('aiContextToggle'),
  aiContextBody: $('aiContextBody'),
  aiProvider: $('aiProvider'),
  aiModel: $('aiModel'),
  aiQuestion: $('aiQuestion'),
  aiAskBtn: $('aiAskBtn'),
  aiSuggestChangeBtn: $('aiSuggestChangeBtn'),
  aiStopBtn: $('aiStopBtn'),
  aiAnswer: $('aiAnswer'),
  aiAnswerActions: $('aiAnswerActions'),
  aiReplaceBtn: $('aiReplaceBtn'),
  aiReviewChangeBtn: $('aiReviewChangeBtn'),
  aiEditReviewLocation: $('aiEditReviewLocation'),
  aiEditReviewBefore: $('aiEditReviewBefore'),
  aiEditReviewAfter: $('aiEditReviewAfter'),
  aiEditAcceptBtn: $('aiEditAcceptBtn'),
  aiEditRejectBtn: $('aiEditRejectBtn'),
  aiAnswerBadge: $('aiAnswerBadge'),
  aiAnswerMeta: $('aiAnswerMeta'),
  aiResizer: $('aiResizer'),
  aiDock: $('aiDock'),
  aiPrompts: $('aiPrompts'),
  aiContextLabel: $('aiContextLabel'),
  docActions: $('docActions'),
  answerDocView: $('answerDocView'),
  answerDocContent: $('answerDocContent'),
  answerDocSub: $('answerDocSub'),
  answerDocBack: $('answerDocBack'),
  answerDocCopy: $('answerDocCopy'),
  answerDocInsert: $('answerDocInsert'),
  answerDocSave: $('answerDocSave'),
  saveAnswerName: $('saveAnswerName'),
  saveAnswerLocation: $('saveAnswerLocation'),
  selFloat: $('selFloat'),
  cmtFloatBtn: $('cmtFloatBtn'),
  commentComposer: $('commentComposer'),
  cmtComposerQuote: $('cmtComposerQuote'),
  cmtComposerBody: $('cmtComposerBody'),
  cmtComposerSave: $('cmtComposerSave'),
  cmtComposerCancel: $('cmtComposerCancel'),
  cmtComposerClose: $('cmtComposerClose'),
  cmtComposerToolbar: $('cmtComposerToolbar'),
  commentsPanel: $('commentsPanel'),
  commentsList: $('commentsList'),
  commentsCount: $('commentsCount'),
  commentsClose: $('commentsClose'),
  commentsToolbarBtn: $('commentsToolbarBtn'),
  commentsBadge: $('commentsBadge'),
  commentModalQuote: $('cmtModalQuote'),
  commentModalBody: $('cmtModalBody'),
  commentModalMeta: $('cmtModalMeta'),
  commentModalJump: $('cmtModalJump'),
  commentModalDelete: $('cmtModalDelete'),
  commentModalEditWrap: $('cmtModalEditWrap'),
  commentModalToolbar: $('cmtModalToolbar'),
  commentModalEditInput: $('cmtModalEditInput'),
  commentModalEditBtn: $('cmtModalEditBtn'),
  commentModalCancelBtn: $('cmtModalCancelBtn'),
  commentModalSaveBtn: $('cmtModalSaveBtn'),
  commentModalCloseBtn: document.querySelector('#modalComment .cmt-modal-close-btn'),
};

const modals = {
  newFile: $('modalNewFile'),
  newFolder: $('modalNewFolder'),
  deleteFile: $('modalDeleteFile'),
  deleteFolder: $('modalDeleteFolder'),
  rename: $('modalRename'),
  renameFolder: $('modalRenameFolder'),
  saveAnswer: $('modalSaveAnswer'),
  comment: $('modalComment'),
  explainCode: $('modalExplainCode'),
  aiEditReview: $('modalAIEditReview'),
  settings: $('modalSettings'),
};

/* ============ TOASTS ============ */
const toastIcons = {
  success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
};

function toast(message, type = 'info', duration = 2600) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${toastIcons[type] || toastIcons.info}</span><span>${escapeHtml(message)}</span>`;
  els.toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 200);
  }, duration);
}

function setStatus(msg) { els.statusMessage.textContent = msg; }

/* ============ THEME ============ */
function preferredTheme() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch (_) {}
  return 'dark';
}

function applyTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  if (els.themeToggle) {
    els.themeToggle.title = state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  savePreferences();
  setStatus('Theme: ' + state.theme);
}

function initTheme() {
  let saved = null;
  try {
    const raw = localStorage.getItem('inkwell.prefs');
    if (raw) saved = JSON.parse(raw).theme;
  } catch (_) {}
  applyTheme(saved === 'light' || saved === 'dark' ? saved : preferredTheme());
  if (els.themeToggle) els.themeToggle.addEventListener('click', toggleTheme);
}

/* ============ WINDOW CONTROLS ============ */
function setupWindowChrome() {
  const api = window.inkwell;
  if (!api) return;

  const on = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };
  on('wcMin', () => api.minimize());
  on('wcMax', () => api.toggleMaximize());
  on('wcClose', () => api.closeWindow());

  const maxBtn = $('wcMax');
  const setMax = (isMax) => { if (maxBtn) maxBtn.classList.toggle('is-max', !!isMax); };

  try { api.isMaximized().then((s) => setMax(s && s.maximized)); } catch (_) {}
  if (api.onWindowState) api.onWindowState((s) => setMax(s && s.maximized));
}

initTheme();
setupWindowChrome();

function formatRelative(ms) {
  const diff = Date.now() - ms;
  const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ============ INIT ============ */
async function initApp() {
  try { await updateVaultDisplay(await window.inkwell.getNotesDir()); } catch (_) {}
  await refreshFiles();
  loadPreferences();
  setupEditorEvents();
  setupToolbar();
  setupZoom();
  setupDirection();
  setupSplitDivider();
  setupSidebarResize();
  setupAI();
  setupSettings();
  setupDocAiBar();
  setupComments();
  setViewMode(state.viewMode);
  updateWordCount();

  if (state.files.length > 0) {
    const last = state.lastFile && state.files.some((f) => f.path === state.lastFile)
      ? state.lastFile : state.files[0].path;
    if (state.lastFile && last !== state.lastFile) state.lastFile = last;
    await selectFile(last);
  } else {
    showEmptyEditor();
  }
  els.editor.focus();
}

async function updateVaultDisplay(dir) {
  const location = dir || 'No vault selected';
  if (els.vaultPath) {
    els.vaultPath.innerHTML = `${iconFolder()} <span>${escapeHtml(shortenPath(location))}</span>`;
    els.vaultPath.title = location;
  }
  if (els.vaultLocation) els.vaultLocation.textContent = location;
}

async function ensureVaultForCreation() {
  const current = await window.inkwell.getNotesDir();
  if (current) return true;
  const selected = await window.inkwell.chooseNotesDir();
  if (!selected || !selected.success || !selected.path) return false;
  const saved = await window.inkwell.setNotesDir(selected.path);
  if (!saved || !saved.success) {
    toast((saved && saved.error) || 'Could not set vault folder', 'error');
    return false;
  }
  await updateVaultDisplay(saved.path);
  return true;
}

/* ============ PREFERENCES (persisted) ============ */
function loadPreferences() {
  try {
    const raw = localStorage.getItem('inkwell.prefs');
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.zoom === 'number') state.zoom = p.zoom;
      if (typeof p.direction === 'string') state.direction = p.direction;
      if (p.dirByFile && typeof p.dirByFile === 'object') state.dirByFile = p.dirByFile;
      if (typeof p.splitPos === 'number') state.splitPos = p.splitPos;
      if (typeof p.sidebarWidth === 'number') state.sidebarWidth = p.sidebarWidth;
      if (typeof p.viewMode === 'string') state.viewMode = p.viewMode;
      if (p.theme === 'light' || p.theme === 'dark') applyTheme(p.theme);
      if (Array.isArray(p.pinned)) state.pinned = p.pinned.filter((x) => typeof x === 'string');
      if (typeof p.aiProvider === 'string') state.aiProvider = p.aiProvider;
      if (p.aiModels && typeof p.aiModels === 'object') state.aiModels = p.aiModels;
      if (['left', 'right', 'bottom'].includes(p.aiDock)) state.aiDock = p.aiDock;
      if (typeof p.aiDockW === 'number') state.aiDockW = p.aiDockW;
      if (typeof p.aiDockH === 'number') state.aiDockH = p.aiDockH;
      if (Array.isArray(p.aiPrompts)) state.aiPrompts = p.aiPrompts.filter((s) => typeof s === 'string');
      if (Array.isArray(p.aiProviders)) state.aiProviders = p.aiProviders.filter((pp) => pp && typeof pp === 'object' && pp.id && pp.name && pp.command);
      if (p.commentsByFile && typeof p.commentsByFile === 'object') state.commentsByFile = p.commentsByFile;
      if (typeof p.lastFile === 'string') state.lastFile = p.lastFile;
      if (p.scrollByFile && typeof p.scrollByFile === 'object') state.scrollByFile = p.scrollByFile;
      if (p.cursorByFile && typeof p.cursorByFile === 'object') state.cursorByFile = p.cursorByFile;
    }
  } catch (_) {}
  applyZoom();
  syncDirectionButtons();
  applySplitPos();
  applySidebarWidth();
  renderTabs();
}

function savePreferences() {
  try {
    localStorage.setItem('inkwell.prefs', JSON.stringify({
      zoom: state.zoom,
      direction: state.direction,
      dirByFile: state.dirByFile,
      splitPos: state.splitPos,
      sidebarWidth: state.sidebarWidth,
      viewMode: state.viewMode,
      theme: state.theme,
      pinned: state.pinned,
      aiProvider: state.aiProvider,
      aiModels: state.aiModels,
      aiDock: state.aiDock,
      aiDockW: state.aiDockW,
      aiDockH: state.aiDockH,
      aiPrompts: state.aiPrompts,
      commentsByFile: state.commentsByFile,
      lastFile: state.lastFile,
      scrollByFile: state.scrollByFile,
      cursorByFile: state.cursorByFile,
      aiProviders: state.aiProviders,
    }));
  } catch (_) {}
}

let prefsSaveTimer = null;
function schedulePrefsSave() {
  clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(savePreferences, 500);
}

/* ============ VIEW POSITION MEMORY ============ */
function rememberEditorPos() {
  if (!state.currentFile) return;
  state.scrollByFile[state.currentFile] = els.editor.scrollTop;
  state.cursorByFile[state.currentFile] = { s: els.editor.selectionStart, e: els.editor.selectionEnd };
  schedulePrefsSave();
}

function rememberPreviewScroll() {
  if (!state.currentFile) return;
  state.scrollByFile[state.currentFile + '::preview'] = els.preview.scrollTop;
  schedulePrefsSave();
}

function restoreFilePos(path) {
  const sc = state.scrollByFile[path];
  const cur = state.cursorByFile[path];
  const psc = state.scrollByFile[path + '::preview'];
  const apply = () => {
    if (cur && typeof cur.s === 'number') {
      try {
        els.editor.selectionStart = cur.s;
        els.editor.selectionEnd = cur.e == null ? cur.s : cur.e;
      } catch (_) {}
    }
    if (typeof sc === 'number') els.editor.scrollTop = sc;
    if (typeof psc === 'number') els.preview.scrollTop = psc;
    syncEditorHighlight();
  };
  apply();
  requestAnimationFrame(apply);
}

/* ============ ZOOM ============ */
function setupZoom() {
  els.zoomIn.addEventListener('click', () => setZoom(state.zoom + 10));
  els.zoomOut.addEventListener('click', () => setZoom(state.zoom - 10));
  els.zoomLevel.addEventListener('click', () => setZoom(100));
}

function setZoom(value) {
  state.zoom = Math.max(50, Math.min(250, Math.round(value / 10) * 10));
  applyZoom();
  savePreferences();
  setStatus(`Zoom ${state.zoom}%`);
}

function applyZoom() {
  document.documentElement.style.setProperty('--content-scale', String(state.zoom / 100));
  els.zoomLevel.textContent = state.zoom + '%';
  schedulePaginate(0);
}

function shortenPath(p) {
  const home = p.replace(/^\/home\/[^/]+/, '~');
  return home;
}

function iconFolder() {
  return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';
}

/* ============ FILE LIST (tree) ============ */
async function refreshFiles() {
  try {
    const tree = await window.inkwell.listFiles();
    state.files = (tree && tree.files) || [];
    state.folders = (tree && tree.folders) || [];
    // auto-expand ancestor folders of the active file
    if (state.currentFile) {
      const parts = state.currentFile.split('/');
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? acc + '/' + parts[i] : parts[i];
        state.expandedFolders.add(acc);
      }
    }
  } catch (e) {
    state.files = [];
    state.folders = [];
    toast('Failed to load files', 'error');
  }
  applyFilter();
  renderFileList();
  renderTabs();
}

function applyFilter() {
  const q = state.searchQuery.trim().toLowerCase();
  if (!q) {
    state.filtered = state.files.slice();
    state.filteredFolders = state.folders.slice();
    return;
  }
  state.filtered = state.files.filter(f => f.path.toLowerCase().includes(q));
  const keep = new Set();
  for (const f of state.filtered) {
    const parts = f.path.split('/');
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i];
      keep.add(acc);
    }
  }
  state.filteredFolders = state.folders.filter(fd =>
    fd.path.toLowerCase().includes(q) || keep.has(fd.path));
}

function iconChevron(open) {
  return `<svg class="chevron${open ? ' open' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
}

function renderFileList() {
  els.fileList.innerHTML = '';

  if (state.filtered.length === 0 && (state.filteredFolders || []).length === 0) {
    const empty = document.createElement('div');
    empty.className = 'file-list-empty';
    empty.innerHTML = state.files.length === 0 && state.folders.length === 0
      ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><div>No markdown files yet.<br>Click <strong>New</strong> to create one.</div>`
      : 'No files match your search.';
    els.fileList.appendChild(empty);
    return;
  }

  const searching = state.searchQuery.trim().length > 0;
  const folders = (state.filteredFolders || []).slice().sort((a, b) => a.path.localeCompare(b.path));
  const files = state.filtered;

  const header = document.createElement('div');
  header.className = 'list-header';
  header.innerHTML = `<span>${searching ? 'Results' : 'Notes'}</span><span class="list-count">${files.length}</span>`;
  els.fileList.appendChild(header);

  const fileItems = new Map();
  for (const f of files) {
    const parent = f.path.split('/').slice(0, -1).join('/');
    if (!fileItems.has(parent)) fileItems.set(parent, []);
    fileItems.get(parent).push(f);
  }

  // root-level files first (folders are nested below)
  const rootFiles = (fileItems.get('') || []).sort((a, b) => b.modified - a.modified);
  for (const f of rootFiles) els.fileList.appendChild(buildFileItem(f));

  // folder subtree
  const childrenOf = new Map();
  for (const fd of folders) {
    const parts = fd.path.split('/');
    const parent = parts.slice(0, -1).join('/');
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(fd);
  }
  for (const fd of childrenOf.get('') || []) {
    els.fileList.appendChild(buildFolderNode(fd, childrenOf, fileItems, searching, 0));
  }
}

function buildFolderNode(folder, childrenOf, fileItems, forcedOpen, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = 'folder-node';

  const open = forcedOpen || state.expandedFolders.has(folder.path);

  const isActiveFolder = !!state.currentFile
    && (state.currentFile === folder.path || state.currentFile.startsWith(folder.path + '/'));

  const directFiles = (fileItems.get(folder.path) || []).length;
  const directSubs = (childrenOf.get(folder.path) || []).length;
  const childCount = directFiles + directSubs;

  const row = document.createElement('div');
  row.className = 'folder-item' + (isActiveFolder ? ' active' : '');
  row.dataset.path = folder.path;
  row.style.paddingLeft = (10 + depth * 14) + 'px';
  row.innerHTML = `
    ${iconChevron(open)}
    <span class="folder-item-icon">${iconFolder()}</span>
    <span class="folder-item-name">${escapeHtml(folder.path.split('/').pop())}</span>
    ${childCount ? `<span class="folder-count">${childCount}</span>` : ''}
    <div class="file-item-actions">
      <button class="rename" title="Rename folder">${renameSvg}</button>
      <button class="danger" title="Delete folder">${trashSvg}</button>
    </div>
  `;
  row.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (state.expandedFolders.has(folder.path)) state.expandedFolders.delete(folder.path);
    else state.expandedFolders.add(folder.path);
    renderFileList();
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    state.contextTarget = folder.path;
    state.contextIsFolder = true;
    showContextMenu(e.clientX, e.clientY);
  });
  row.querySelector('.rename').addEventListener('click', (e) => {
    e.stopPropagation();
    openRenameFolderModal(folder.path);
  });
  row.querySelector('.danger').addEventListener('click', (e) => {
    e.stopPropagation();
    openDeleteFolderModal(folder.path);
  });
  makeRowDraggable(row, folder.path, true);
  wrapper.appendChild(row);

  if (open) {
    const children = document.createElement('div');
    children.className = 'folder-children';
    const subFolders = (childrenOf.get(folder.path) || []).sort((a, b) => a.path.localeCompare(b.path));
    for (const sf of subFolders) {
      children.appendChild(buildFolderNode(sf, childrenOf, fileItems, forcedOpen, depth + 1));
    }
    const ff = (fileItems.get(folder.path) || []).sort((a, b) => b.modified - a.modified);
    for (const f of ff) children.appendChild(buildFileItem(f, depth + 1));
    wrapper.appendChild(children);
  }

  return wrapper;
}

const docIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
const renameSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const trashSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const pinSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const pinFilledSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const tabCloseSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

/* ============ PINNED TABS ============ */
function baseName(path) {
  return String(path).split('/').pop().replace(/\.md$/i, '');
}

function isPinned(path) {
  return state.pinned.includes(path);
}

// Keep the pinned list in sync with files that still exist (e.g. after files
// were deleted outside the app or a folder was removed).
function prunePins() {
  const exists = new Set(state.files.map((f) => f.path));
  const kept = state.pinned.filter((p) => exists.has(p));
  if (kept.length !== state.pinned.length) {
    state.pinned = kept;
    savePreferences();
  }
}

function renderTabs() {
  const bar = els.tabBar;
  if (!bar) return;

  prunePins();

  if (state.pinned.length === 0) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    positionAIPanel();
    return;
  }
  bar.classList.remove('hidden');
  bar.innerHTML = '';

  for (const path of state.pinned) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (path === state.currentFile ? ' active' : '');
    tab.dataset.path = path;
    tab.title = path;
    tab.tabIndex = 0;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', path === state.currentFile ? 'true' : 'false');
    tab.innerHTML = `
      <span class="tab-icon">${pinFilledSvg}</span>
      <span class="tab-name">${escapeHtml(baseName(path))}</span>
      <button class="tab-close" data-unpin title="Unpin" aria-label="Unpin">${tabCloseSvg}</button>
    `;
    tab.addEventListener('click', (e) => {
      if (e.target.closest('[data-unpin]')) return;
      selectFile(path);
    });
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectFile(path);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        unpinFile(path);
      }
    });
    // middle-click unpins, like closing a browser tab
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); unpinFile(path); }
    });
    tab.querySelector('[data-unpin]').addEventListener('click', (e) => {
      e.stopPropagation();
      unpinFile(path);
    });
    bar.appendChild(tab);
  }
  positionAIPanel();
}

function togglePin(path) {
  if (!path) return;
  const i = state.pinned.indexOf(path);
  if (i === -1) {
    state.pinned.push(path);
    toast('Pinned ' + baseName(path), 'success');
  } else {
    state.pinned.splice(i, 1);
    toast('Unpinned ' + baseName(path), 'info');
  }
  savePreferences();
  renderFileList();
  renderTabs();
}

function unpinFile(path) {
  const i = state.pinned.indexOf(path);
  if (i === -1) return;
  state.pinned.splice(i, 1);
  savePreferences();
  renderFileList();
  renderTabs();
}

function buildFileItem(file, depth = 0) {
  const pinned = isPinned(file.path);
  const item = document.createElement('div');
  item.className = 'file-item' + (file.path === state.currentFile ? ' active' : '') + (pinned ? ' has-pin' : '');
  item.dataset.name = file.path;
  item.style.paddingLeft = (10 + depth * 14) + 'px';

  item.innerHTML = `
    <span class="file-item-icon">${docIcon}</span>
    <div class="file-item-body">
      <span class="file-item-name">${escapeHtml(file.name.replace(/\.md$/i, ''))}</span>
      <span class="file-item-meta">${formatRelative(file.modified)}</span>
    </div>
    <div class="file-item-actions">
      <button class="pin${pinned ? ' is-pinned' : ''}" title="${pinned ? 'Unpin from tabs' : 'Pin to tabs'}">${pinned ? pinFilledSvg : pinSvg}</button>
      <button class="rename" title="Rename">${renameSvg}</button>
      <button class="danger" title="Delete">${trashSvg}</button>
    </div>
  `;

  item.addEventListener('click', () => selectFile(file.path));
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    state.contextTarget = file.path;
    state.contextIsFolder = false;
    showContextMenu(e.clientX, e.clientY);
  });
  item.querySelector('.pin').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePin(file.path);
  });
  item.querySelector('.rename').addEventListener('click', (e) => {
    e.stopPropagation();
    openRenameModal(file.path);
  });
  item.querySelector('.danger').addEventListener('click', (e) => {
    e.stopPropagation();
    openDeleteModal(file.path);
  });

  makeRowDraggable(item, file.path, false);

  return item;
}

/* ============ DRAG & DROP (move notes / folders) ============ */
// Rows are draggable; only folder rows and the list background (vault root)
// accept drops. A move is a plain rename on disk, so every path-keyed store
// is remapped through remapMovedPaths() afterwards.
const dnd = {
  path: null, isFolder: false, takenFiles: null, takenDirs: null,
  hintEl: null, hintRoot: false, hoverPath: null, hoverTimer: null, warnedExternal: false,
};

function endDrag() {
  if (dnd.hintEl) { dnd.hintEl.classList.remove('drop-target'); dnd.hintEl = null; }
  if (dnd.hintRoot) { els.fileList.classList.remove('drop-root'); dnd.hintRoot = false; }
  if (dnd.hoverTimer) { clearTimeout(dnd.hoverTimer); dnd.hoverTimer = null; }
  dnd.hoverPath = null;
  dnd.path = null;
  dnd.isFolder = false;
  dnd.takenFiles = null;
  dnd.takenDirs = null;
}

function makeRowDraggable(row, path, isFolder) {
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if ((under && under.closest('button')) || state.searchQuery.trim()) {
      e.preventDefault();
      return;
    }
    dnd.path = path;
    dnd.isFolder = isFolder;
    dnd.takenFiles = new Set(state.files.map((f) => f.path.toLowerCase()));
    dnd.takenDirs = new Set(state.folders.map((f) => f.path.toLowerCase()));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
    setTimeout(() => { if (dnd.path === path) row.classList.add('dragging'); }, 0);
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    endDrag();
  });
}

// Folder row -> move into it; anything else inside a folder's children region
// -> that folder; list background / header -> vault root.
function resolveDropTarget(el) {
  if (!el || !el.closest) return { valid: false };
  const row = el.closest('.folder-item');
  if (row) return { valid: true, dir: row.dataset.path || '', row, root: false };
  if (el.closest('.file-item')) return { valid: false };
  const kids = el.closest('.folder-children');
  if (kids) {
    const owner = kids.parentElement && kids.parentElement.firstElementChild;
    if (owner && owner.classList.contains('folder-item')) {
      return { valid: true, dir: owner.dataset.path || '', row: owner, root: false };
    }
    return { valid: false };
  }
  return { valid: true, dir: '', row: null, root: true };
}

function moveVerdict(dir, src, isFolder) {
  const name = src.split('/').pop();
  const newPath = dir ? dir + '/' + name : name;
  if (newPath === src) return { noop: true };
  if (isFolder && (dir === src || dir.startsWith(src + '/'))) {
    return { ok: false, reason: 'A folder cannot be moved inside itself' };
  }
  const lower = newPath.toLowerCase();
  const taken = isFolder ? dnd.takenDirs : dnd.takenFiles;
  if (taken && taken.has(lower) && lower !== src.toLowerCase()) {
    return { ok: false, reason: 'An item with that name already exists there' };
  }
  if (dir && !state.folders.some((f) => f.path === dir)) {
    return { ok: false, reason: 'The destination folder no longer exists' };
  }
  return { ok: true, newPath };
}

function setDropHint(row, root) {
  if (dnd.hintEl !== row) {
    if (dnd.hintEl) dnd.hintEl.classList.remove('drop-target');
    dnd.hintEl = row;
    if (row) row.classList.add('drop-target');
  }
  if (dnd.hintRoot !== root) {
    els.fileList.classList.toggle('drop-root', root);
    dnd.hintRoot = root;
  }
}

function scheduleFolderExpand(dir, row) {
  const collapsed = row && row.classList.contains('folder-item') &&
    row.querySelector('.chevron:not(.open)');
  if (!collapsed) {
    if (dnd.hoverPath !== dir) {
      clearTimeout(dnd.hoverTimer);
      dnd.hoverTimer = null;
      dnd.hoverPath = null;
    }
    return;
  }
  if (dnd.hoverPath === dir) return;
  clearTimeout(dnd.hoverTimer);
  dnd.hoverPath = dir;
  dnd.hoverTimer = setTimeout(() => {
    dnd.hoverTimer = null;
    if (!dnd.path || dnd.hoverPath !== dir) return;
    state.expandedFolders.add(dir);
    dnd.hintEl = null;
    dnd.hintRoot = false;
    renderFileList();
  }, 650);
}

els.fileList.addEventListener('dragover', (e) => {
  const types = (e.dataTransfer && e.dataTransfer.types) || [];
  const hasFiles = Array.from(types).includes('Files');
  if (!dnd.path) {
    if (hasFiles) {
      e.preventDefault();
      if (!dnd.warnedExternal) {
        dnd.warnedExternal = true;
        toast('Only items inside the library can be moved by dragging', 'info');
      }
    }
    return;
  }
  e.preventDefault();
  const target = resolveDropTarget(e.target);
  const verdict = target.valid ? moveVerdict(target.dir, dnd.path, dnd.isFolder) : null;
  if (!verdict || verdict.noop || !verdict.ok) {
    setDropHint(null, false);
    scheduleFolderExpand(null, null);
    e.dataTransfer.dropEffect = 'none';
    return;
  }
  e.dataTransfer.dropEffect = 'move';
  setDropHint(target.row, target.root);
  scheduleFolderExpand(target.dir, target.row);
});

els.fileList.addEventListener('drop', async (e) => {
  const types = (e.dataTransfer && e.dataTransfer.types) || [];
  if (Array.from(types).includes('Files')) e.preventDefault();
  if (!dnd.path) return;
  e.preventDefault();
  const src = dnd.path;
  const isFolder = dnd.isFolder;
  const target = resolveDropTarget(e.target);
  const verdict = target.valid ? moveVerdict(target.dir, src, isFolder) : null;
  endDrag();
  if (!target.valid || !verdict) return;
  if (verdict.noop) return;
  if (!verdict.ok) { toast(verdict.reason, 'error'); return; }
  await moveItem(src, isFolder, verdict.newPath, target.dir);
});

// keep the window from navigating onto an externally dragged file, and keep
// an in-app drag from being inserted as text in the editor/preview
document.addEventListener('dragover', (e) => {
  const types = (e.dataTransfer && e.dataTransfer.types) || [];
  if (dnd.path || Array.from(types).includes('Files')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  const types = (e.dataTransfer && e.dataTransfer.types) || [];
  if (dnd.path || Array.from(types).includes('Files')) e.preventDefault();
});

function remapMovedPaths(oldPath, newPath) {
  const under = (p) => !!p && (p === oldPath || p.startsWith(oldPath + '/') || p.startsWith(oldPath + '::'));
  const remap = (p) => (p === oldPath ? newPath : newPath + p.slice(oldPath.length));

  if (under(state.currentFile)) state.currentFile = remap(state.currentFile);
  if (under(state.lastFile)) state.lastFile = remap(state.lastFile);
  if (under(state.newFileFolder)) state.newFileFolder = remap(state.newFileFolder);
  state.pinned = state.pinned.map((p) => (under(p) ? remap(p) : p));

  const remapMap = (obj) => {
    const out = {};
    for (const k of Object.keys(obj)) out[under(k) ? remap(k) : k] = obj[k];
    return out;
  };
  state.dirByFile = remapMap(state.dirByFile);
  state.commentsByFile = remapMap(state.commentsByFile);
  state.scrollByFile = remapMap(state.scrollByFile);
  state.cursorByFile = remapMap(state.cursorByFile);

  const expanded = new Set();
  for (const p of state.expandedFolders) expanded.add(under(p) ? remap(p) : p);
  state.expandedFolders = expanded;
  savePreferences();
}

async function moveItem(src, isFolder, newPath, destDir) {
  try {
    const result = isFolder
      ? await window.inkwell.renameFolder(src, newPath)
      : await window.inkwell.renameFile(src, newPath);
    if (!result.success) { toast('Could not move: ' + result.error, 'error'); return; }

    remapMovedPaths(src, newPath);
    if (destDir) state.expandedFolders.add(destDir);
    expandAncestors(newPath);
    await refreshFiles();
    if (state.currentFile) {
      const label = state.currentFile.replace(/\.md$/i, '');
      els.currentFileName.textContent = label;
      els.currentFileName.title = label;
      highlightActive();
    }
    toast(`Moved ${src.split('/').pop()} to ${destDir || 'library root'}`, 'success');
    setStatus(`Moved ${src} → ${newPath}`);
  } catch (e) {
    toast('Could not move item', 'error');
  }
}

/* ============ SELECT / LOAD FILE ============ */
async function selectFile(path) {
  if (state.currentFile && state.currentFile !== path) rememberEditorPos();
  if (state.dirty && state.currentFile && state.currentFile !== path) {
    await saveFile(true);
  }
  if (els.answerDocView && !els.answerDocView.classList.contains('hidden')) closeAnswerDoc();

  try {
    const result = await window.inkwell.readFile(path);
    if (!result.success) { toast('Could not open file: ' + result.error, 'error'); return; }

    state.currentFile = path;
    state.lastFile = path;
    schedulePrefsSave();
    state.dirty = false;
    state.direction = state.dirByFile[path] || 'auto';
    syncDirectionButtons();
    els.editor.value = result.content;
    els.currentFileName.textContent = path.replace(/\.md$/i, '');
    els.currentFileName.title = path.replace(/\.md$/i, '');
    els.deleteFileBtn.disabled = false;
    setSaveStatus('');

    expandAncestors(path);
    renderFileList();
    highlightActive();
    renderTabs();
    updateWordCount();
    applyDirection();
    renderPreview();
    renderEditorHighlight();
    updateDocAiBar();
    updateCommentsBadge();
    if (els.commentsPanel && !els.commentsPanel.classList.contains('hidden')) renderComments();
    restoreFilePos(path);
    setStatus(`Opened ${path}`);
  } catch (e) {
    toast('Could not open file', 'error');
  }
}

function highlightActive() {
  els.fileList.querySelectorAll('.file-item').forEach(el => {
    el.classList.toggle('active', el.dataset.name === state.currentFile);
  });
}

function expandAncestors(path) {
  if (!path) return;
  const parts = path.split('/');
  let acc = '';
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? acc + '/' + parts[i] : parts[i];
    state.expandedFolders.add(acc);
  }
}

function showEmptyEditor() {
  state.currentFile = null;
  state.dirty = false;
  state.direction = 'auto';
  syncDirectionButtons();
  els.editor.value = '';
  els.currentFileName.textContent = 'Welcome';
  els.deleteFileBtn.disabled = true;
  els.previewContent.innerHTML = welcomeHtml();
  setSaveStatus('');
  updateWordCount();
  applyDirection();
  renderEditorHighlight();
  schedulePaginate(0);
  renderTabs();
  updateDocAiBar();
  updateCommentsBadge();
  if (els.commentsPanel && !els.commentsPanel.classList.contains('hidden')) renderComments();
  if (els.answerDocView && !els.answerDocView.classList.contains('hidden')) closeAnswerDoc();
}

function welcomeHtml() {
  return `
    <h1>Welcome to Inkwell</h1>
    <p>A clean Markdown editor with live preview, AI assistance, and Telegram sharing.</p>
    <h3>Get started</h3>
    <ul>
      <li>Click <strong>New</strong> in the sidebar to create your first file</li>
      <li>Toggle between <strong>Edit</strong>, <strong>Preview</strong>, and <strong>Split</strong> views</li>
      <li>Your work auto-saves as you type</li>
      <li>Open <strong>Settings</strong> to configure the AI assistant and Telegram</li>
    </ul>
    <h3>Shortcuts</h3>
    <table>
      <thead><tr><th>Action</th><th>Shortcut</th></tr></thead>
      <tbody>
        <tr><td>Save</td><td><code>Ctrl</code> + <code>S</code></td></tr>
        <tr><td>New file</td><td><code>Ctrl</code> + <code>N</code></td></tr>
        <tr><td>Preview</td><td><code>Ctrl</code> + <code>P</code></td></tr>
        <tr><td>Split view</td><td><code>Ctrl</code> + <code>\\</code></td></tr>
        <tr><td>Toggle sidebar</td><td><code>Ctrl</code> + <code>B</code></td></tr>
      </tbody>
    </table>
    <blockquote>Files are stored as plain Markdown in your Documents/Inkwell folder.</blockquote>
  `;
}

/* ============ EDITOR ============ */
let autosaveTimer = null;

function setupEditorEvents() {
  els.editor.addEventListener('input', () => {
    onEditorChanged();
    hideAIFloat();
  });

  els.editor.addEventListener('scroll', () => {
    syncEditorHighlight();
    hideAIFloat();
    rememberEditorPos();
  });

  window.addEventListener('resize', () => {
    syncEditorHighlight();
    positionAIPanel();
    schedulePaginate(150);
  });

  els.editor.addEventListener('keyup', rememberEditorPos);
  els.editor.addEventListener('blur', rememberEditorPos);

  if (els.preview) {
    els.preview.addEventListener('scroll', rememberPreviewScroll);
  }

  window.addEventListener('beforeunload', () => {
    if (state.currentFile) rememberEditorPos();
    savePreferences();
  });

  els.editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = els.editor.selectionStart;
      const ePos = els.editor.selectionEnd;
      if (s !== ePos) return;
      replaceRange(s, ePos, '  ');
    }
  });

  // show the "Ask AI" trigger when the user finishes selecting text
  els.editor.addEventListener('mouseup', (e) => {
    const start = els.editor.selectionStart;
    const end = els.editor.selectionEnd;
    const text = end > start ? els.editor.value.slice(start, end) : '';
    if (text.trim()) showAIFloat(e.clientX, e.clientY, { text, start, end });
    else hideAIFloat();
  });

  if (els.preview) {
    els.preview.addEventListener('mouseup', () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : '';
      const node = sel && sel.anchorNode;
      if (!text.trim() || !node || !els.previewContent.contains(node)) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const idx = els.editor.value.indexOf(text);
      const unique = idx !== -1 && idx === els.editor.value.lastIndexOf(text);
      showAIFloat(rect.right, rect.bottom + 4, {
        text,
        start: unique ? idx : null,
        end: unique ? idx + text.length : null,
      });
    });
  }
}

function setSaveStatus(status) {
  const map = { saving: ['Saving...', 'saving'], saved: ['Saved', 'saved'], error: ['Error', 'error'], '': ['', ''] };
  const [text, cls] = map[status] || ['', ''];
  els.saveStatus.textContent = text;
  els.saveStatus.className = 'save-status ' + cls;
  if (status === 'saved') {
    clearTimeout(setSaveStatus._t);
    setSaveStatus._t = setTimeout(() => { els.saveStatus.textContent = ''; els.saveStatus.className = 'save-status'; }, 1600);
  }
}

function updateWordCount() {
  const text = els.editor.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const chars = els.editor.value.length;
  els.wordCount.textContent = `${words} ${words === 1 ? 'word' : 'words'} · ${chars} ${chars === 1 ? 'char' : 'chars'}`;
}

/* ============ PAGINATED PREVIEW (PAGE DIVIDERS) ============ */
// Groups the rendered preview into A4-height pages, labels each one with a
// "Page N" footer at its bottom and marks the seam between sheets with a
// dashed cut line. Content keeps its normal width. Export/print always runs
// through stripPrintDecorations(), which removes this chrome again, so
// shared documents stay flat.
let paginateTimer = null;

function schedulePaginate(delay = 0) {
  clearTimeout(paginateTimer);
  paginateTimer = setTimeout(() => { paginateTimer = null; applyPagination(); }, delay);
}

// Weights/faces can finish loading (and change text metrics) after
// document.fonts.ready has already resolved, so re-paginate on every font load.
if (document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', () => schedulePaginate(0));
}

function flattenPreview(root) {
  if (!root.querySelector('.page, .pages')) return;
  root.querySelectorAll('.page-break, .page-footer').forEach((el) => el.remove());
  root.querySelectorAll('.page').forEach((pageEl) => {
    const parent = pageEl.parentNode;
    if (!parent) return;
    const inner = pageEl.querySelector('.page-inner');
    if (inner) { while (inner.firstChild) parent.insertBefore(inner.firstChild, pageEl); }
    parent.removeChild(pageEl);
  });
  root.querySelectorAll('.pages').forEach((wrap) => {
    const parent = wrap.parentNode;
    if (!parent) return;
    while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
    parent.removeChild(wrap);
  });
  // rejoin list continuations so the DOM matches the pre-pagination state
  root.querySelectorAll('[data-page-cont]').forEach((cont) => {
    const prev = cont.previousElementSibling;
    if (prev && prev.tagName === cont.tagName && !prev.hasAttribute('data-page-cont')) {
      while (cont.firstChild) prev.appendChild(cont.firstChild);
    }
    cont.remove();
  });
}

// Nominal A4 page length (height minus 20mm/24mm print margins) at the current
// zoom. Text scales with --content-scale, so page breaks stay zoom-invariant.
function measurePageBudget() {
  const scale = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--content-scale')
  ) || 1;
  return 253 * (96 / 25.4) * scale; // mm -> CSS px
}

function applyPagination() {
  const root = els.previewContent;
  const visible = state.viewMode !== 'edit' && els.preview.offsetParent !== null;
  flattenPreview(root);
  if (!visible) { els.preview.classList.remove('paged'); return; }
  els.preview.classList.add('paged');

  const budget = measurePageBudget();
  if (!(budget > 60)) { els.preview.classList.remove('paged'); return; }

  const nodes = Array.from(root.childNodes);
  if (!nodes.length) return;

  const pagesWrap = document.createElement('div');
  pagesWrap.className = 'pages';
  root.appendChild(pagesWrap);

  let page = null;
  const newPage = () => {
    const p = document.createElement('div');
    p.className = 'page';
    const inner = document.createElement('div');
    inner.className = 'page-inner';
    p.appendChild(inner);
    pagesWrap.appendChild(p);
    return p;
  };
  const innerOf = (p) => p.firstElementChild;
  const pageH = (p) => innerOf(p).getBoundingClientRect().height;
  const pageFits = (p) => pageH(p) <= budget + 1;

  // Place a block; when it would overflow an already-occupied sheet it moves to
  // the next one. A single oversized block (huge code block, tall figure) keeps
  // its sheet and lets that sheet grow past A4 instead of clipping.
  const placeBlock = (node) => {
    if (!page) page = newPage();
    innerOf(page).appendChild(node);
    if (innerOf(page).childElementCount > 1 && !pageFits(page)) {
      innerOf(page).removeChild(node);
      page = newPage();
      innerOf(page).appendChild(node);
    }
    return page;
  };

  const isSplitList = (node) => node.nodeType === 1 &&
    (node.tagName === 'UL' || node.tagName === 'OL') && node.children.length > 1;

  const placeList = (list) => {
    placeBlock(list);
    const frontPage = page;
    const base = list.tagName === 'OL' ? parseInt(list.getAttribute('start') || '1', 10) : NaN;
    let moved = 0;
    let cont = null;
    let contPage = null;
    let cur = list;
    let guard = 0;
    const markStart = () => {
      if (cont && Number.isFinite(base)) cont.setAttribute('start', String(base + moved));
    };
    while (pageH(frontPage) > budget + 1 && cur.children.length > 1 && guard++ < 4000) {
      if (!cont) {
        contPage = newPage();
        cont = document.createElement(cur.tagName);
        cont.dataset.pageCont = '1';
        innerOf(contPage).appendChild(cont);
        page = contPage;
      }
      cont.insertBefore(cur.lastElementChild, cont.firstChild);
      moved += 1;
      markStart();
      while (cur.children.length > 1 && pageH(contPage) <= budget + 1) {
        const cand = cur.lastElementChild;
        cont.insertBefore(cand, cont.firstChild);
        if (pageH(contPage) > budget + 1) { cur.appendChild(cand); break; }
        moved += 1;
        markStart();
      }
      // continuation sheet is oversubscribed (one oversized item): start a new one
      if (pageH(contPage) > budget + 1) cont = null;
    }
  };

  for (const node of nodes) {
    if (isSplitList(node)) {
      placeList(node);
    } else if (node.nodeType === 3 && !node.textContent.trim()) {
      // zero-height whitespace between blocks never forces a break
      if (!page) page = newPage();
      innerOf(page).appendChild(node);
    } else {
      placeBlock(node);
    }
  }

  const pages = Array.from(pagesWrap.children);
  // Avoid stranding a heading as the last block on a sheet.
  for (let i = 0; i + 1 < pages.length; i++) {
    const inner = innerOf(pages[i]);
    const last = inner.lastElementChild;
    if (!last || !/^H[1-6]$/.test(last.tagName) || inner.childElementCount < 2) continue;
    const nextInner = innerOf(pages[i + 1]);
    nextInner.insertBefore(last, nextInner.firstChild);
    if (pageH(pages[i + 1]) > budget + 1 && nextInner.childElementCount > 1) {
      inner.appendChild(last);
    }
  }

  // page seam between sheets (no label — the number lives on the page foot)
  for (let i = 1; i < pages.length; i++) {
    const br = document.createElement('div');
    br.className = 'page-break';
    br.setAttribute('aria-hidden', 'true');
    pagesWrap.insertBefore(br, pages[i]);
  }

  // page number at the bottom of the page it belongs to (last page included)
  pages.forEach((p, i) => {
    const foot = document.createElement('div');
    foot.className = 'page-footer';
    foot.setAttribute('aria-hidden', 'true');
    foot.textContent = 'Page ' + (i + 1);
    p.appendChild(foot);
  });
}

function renderPreview(force = false) {
  if (!force && els.preview.offsetParent === null && state.viewMode === 'edit') return;
  els.previewContent.innerHTML = md.render(els.editor.value || welcomeHtml());
  enhanceCodeBlocks();
  els._imgPromise = Promise.all([
    resolvePreviewImages(),
    (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve(),
  ]).then(() => {
    els.previewContent.querySelectorAll('img').forEach((img) => {
      if (img.complete || img.classList.contains('broken-image')) return;
      img.addEventListener('load', () => schedulePaginate(80), { once: true });
      img.addEventListener('error', () => schedulePaginate(80), { once: true });
    });
    schedulePaginate(60);
  });
  applyDirection();
  decoratePreviewComments();
  if (findState.open && findState.query) applyFindMarks();
  schedulePaginate(0);
}

/* ============ CODE BLOCKS (header + copy) ============ */
const copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function codeLangLabel(code) {
  const m = (code.className || '').match(/language-([\w+#.-]+)/i);
  return m ? m[1] : 'code';
}

function copyText(text) {
  return new Promise((resolve) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => resolve(true), () => resolve(fallbackCopy(text)));
    } else {
      resolve(fallbackCopy(text));
    }
  });
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

function enhanceCodeBlocks() {
  els.previewContent.querySelectorAll('pre').forEach((pre) => {
    if (pre.closest('.code-block')) return;
    const code = pre.querySelector('code');
    if (!code) return;

    const block = document.createElement('div');
    block.className = 'code-block';

    const head = document.createElement('div');
    head.className = 'code-head';

    const lang = document.createElement('span');
    lang.className = 'code-lang';
    lang.textContent = codeLangLabel(code);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'code-copy';
    copy.innerHTML = copyIcon + '<span>Copy</span>';
    copy.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyText(code.textContent).then((ok) => {
        const label = copy.querySelector('span');
        if (ok) {
          copy.classList.add('copied');
          if (label) label.textContent = 'Copied';
        } else {
          if (label) label.textContent = 'Failed';
        }
        setTimeout(() => {
          copy.classList.remove('copied');
          if (label) label.textContent = 'Copy';
        }, 1400);
      });
    });

    head.appendChild(lang);
    head.appendChild(copy);
    block.appendChild(head);

    pre.parentNode.insertBefore(block, pre);
    block.appendChild(pre);
  });
}

/* ============ VAULT IMAGES ============ */
// object URLs are cached for the session so re-rendering (on each keystroke)
// does not re-fetch and re-read every attachment.
const imageUrlCache = new Map();

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function currentFolderPath() {
  if (!state.currentFile) return '';
  const parts = state.currentFile.split('/');
  return parts.slice(0, -1).join('/');
}

// map an <img src> written in a note to a vault-relative logical path
function toVaultImagePath(src) {
  if (!src) return null;
  const clean = src.split('#')[0].split('?')[0].trim();
  if (!clean) return null;
  if (/^(https?:|data:|blob:|mailto:|\/\/)/i.test(clean)) return null; // external
  let rel = clean.replace(/^\.\//, '');
  if (rel.startsWith('/')) rel = rel.slice(1);
  const folder = currentFolderPath();
  return folder ? folder + '/' + rel : rel;
}

async function resolvePreviewImages() {
  const imgs = els.previewContent.querySelectorAll('img');
  for (const img of imgs) {
    const original = img.getAttribute('src');
    if (!original) continue;
    const vpath = toVaultImagePath(original);
    if (!vpath) continue; // leave external images untouched

    img.dataset.vaultPath = vpath;
    img.classList.add('vault-image');
    if (!img.getAttribute('alt')) img.setAttribute('alt', vpath.split('/').pop());

    if (imageUrlCache.has(vpath)) {
      img.src = imageUrlCache.get(vpath);
      continue;
    }
    try {
      const res = await window.inkwell.readBinary(vpath);
      if (!res || !res.success) {
        img.classList.add('broken-image');
        img.removeAttribute('src');
        continue;
      }
      const blob = new Blob([base64ToBytes(res.base64)], { type: res.mime });
      const url = URL.createObjectURL(blob);
      imageUrlCache.set(vpath, url);
      // only apply if this element is still in the document
      if (img.isConnected) img.src = url;
    } catch (_) {}
  }
}

/* ============ IMAGE LIGHTBOX ============ */
function openImageLightbox(src, caption) {
  if (!src) return;
  els.lightboxImg.src = src;
  els.lightboxCaption.textContent = caption || '';
  els.imageLightbox.classList.remove('hidden');
}

function closeImageLightbox() {
  els.imageLightbox.classList.add('hidden');
  els.lightboxImg.removeAttribute('src');
  els.lightboxCaption.textContent = '';
}

els.lightboxClose.addEventListener('click', closeImageLightbox);
els.imageLightbox.addEventListener('click', (e) => {
  if (e.target === els.imageLightbox || e.target === els.lightboxImg) closeImageLightbox();
});
els.previewContent.addEventListener('click', (e) => {
  const img = e.target.closest('img');
  if (img && img.src && !img.classList.contains('broken-image')) {
    openImageLightbox(img.src, img.dataset.vaultPath || img.getAttribute('alt'));
  }
});

/* ============ SAVE ============ */
async function saveFile(silent = false) {
  if (!state.currentFile) {
    if (!silent) toast('No file selected', 'info');
    return false;
  }
  try {
    const result = await window.inkwell.writeFile(state.currentFile, els.editor.value);
    if (!result.success) {
      setSaveStatus('error');
      toast('Save failed: ' + result.error, 'error');
      return false;
    }
    state.dirty = false;
    setSaveStatus('saved');
    setStatus('Saved ' + new Date().toLocaleTimeString());
    // refresh timestamps without losing selection
    const tree = await window.inkwell.listFiles();
    state.files = (tree && tree.files) || [];
    state.folders = (tree && tree.folders) || [];
    applyFilter();
    renderFileList();
    return true;
  } catch (e) {
    setSaveStatus('error');
    if (!silent) toast('Save failed', 'error');
    return false;
  }
}

els.saveBtn.addEventListener('click', () => saveFile(false));

/* ============ EXPORT / SHARE DOCUMENT ============ */
// Build a self-contained payload for the export/share pipeline:
// rendered markdown with vault images inlined as data URIs, comment/find
// decorations stripped, and the document direction resolved.
function stripPrintDecorations(root) {
  // unwrap comment/find highlight wrappers (keep genuine ==highlight== marks)
  root.querySelectorAll('mark.cmt-mark, mark.find-mark, span.cmt-hl, [data-cmt]').forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  // unwrap paged chrome for clean export/print payload
  flattenPreview(root);
  root.querySelectorAll('.code-copy').forEach((el) => el.remove());
  root.querySelectorAll('img.broken-image').forEach((el) => el.remove());
}

async function inlinePrintImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'));

  const toDataUrl = async (url) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error('http ' + r.status);
      const b = await r.blob();
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(b);
      });
    } finally {
      clearTimeout(t);
    }
  };

  await Promise.all(imgs.map(async (img) => {
    const vpath = img.dataset.vaultPath;
    if (vpath) {
      try {
        const res = await window.inkwell.readBinary(vpath);
        if (res && res.success) {
          img.setAttribute('src', `data:${res.mime || 'image/png'};base64,${res.base64}`);
          return;
        }
      } catch (_) {}
      img.remove();
      return;
    }
    const src = img.getAttribute('src') || '';
    if (src.startsWith('data:')) return;
    if (src.startsWith('blob:') || /^https?:/i.test(src)) {
      try {
        img.setAttribute('src', await toDataUrl(src));
      } catch (_) {
        img.remove();
      }
      return;
    }
    // relative or otherwise unresolvable in the print window
    img.remove();
  }));

  // final sweep: never leave an un-inlined image (renders as an empty box)
  root.querySelectorAll('img').forEach((img) => {
    const s = img.getAttribute('src') || '';
    if (!s.startsWith('data:')) img.remove();
  });
}

async function buildPrintPayload() {
  renderPreview(true);
  try { await els._imgPromise; } catch (_) {}
  if (findState.open) clearFindMarks();

  const clone = els.previewContent.cloneNode(true);
  stripPrintDecorations(clone);
  await inlinePrintImages(clone);

  const title = state.currentFile.replace(/\.md$/i, '').split('/').pop();
  const stamp = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const dir = els.previewContent.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';

  return {
    headerHtml: `<h1>${escapeHtml(title)}</h1><div class="doc-meta">Inkwell &middot; ${escapeHtml(stamp)}</div>`,
    bodyHtml: clone.innerHTML,
    dir,
    title,
  };
}

async function exportHTML() {
  if (!state.currentFile) { toast('Open a file first', 'info'); return; }
  if (state.dirty) await saveFile(true);

  let payload;
  try {
    payload = await buildPrintPayload();
  } catch (e) {
    toast('Export failed', 'error');
    return;
  }

  try {
    const res = await window.inkwell.exportHTML(state.currentFile, payload);
    if (res && res.success) {
      toast('Exported HTML: ' + shortenPath(res.path), 'success', 3600);
    } else if (res && !res.canceled) {
      toast('Export failed: ' + (res.error || 'unknown error'), 'error');
    }
  } catch (e) {
    toast('Export failed', 'error');
  } finally {
    if (findState.open && findState.query) applyFindMarks();
  }
}

async function sendDocToTelegram() {
  if (!state.currentFile) { toast('Open a file first', 'info'); return; }
  if (state.telegramBusy) return;
  if (state.dirty) await saveFile(true);

  state.telegramBusy = true;
  const btn = els.telegramBtn;
  if (btn) btn.classList.add('busy');
  try {
    const payload = await buildPrintPayload();
    toast('Sending document to Telegram\u2026', 'info', 2500);
    const res = await window.inkwell.sendDocToTelegram(state.currentFile, payload);
    if (res && res.success) {
      toast('Sent to Telegram', 'success', 3600);
    } else {
      toast('Telegram send failed: ' + ((res && res.error) || 'unknown error'), 'error', 5000);
    }
  } catch (e) {
    toast('Telegram send failed', 'error');
  } finally {
    state.telegramBusy = false;
    if (btn) btn.classList.remove('busy');
    if (findState.open && findState.query) applyFindMarks();
  }
}

els.exportBtn.addEventListener('click', exportHTML);
if (els.telegramBtn) els.telegramBtn.addEventListener('click', sendDocToTelegram);

/* ============ VIEW MODE ============ */
function setViewMode(mode) {
  state.viewMode = mode;
  els.editorArea.className = 'editor-area mode-' + mode;
  els.viewToggle.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
  if (els.editorToolbar) {
    els.editorToolbar.classList.toggle('hidden-toolbar', mode === 'preview');
  }
  if (mode !== 'edit') renderPreview();
  else schedulePaginate(0);
  positionAIPanel();
  savePreferences();
}

els.viewToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.view-btn');
  if (btn) setViewMode(btn.dataset.view);
});

/* ============ SIDEBAR TOGGLE ============ */
els.toggleSidebarBtn.addEventListener('click', () => {
  els.sidebar.classList.toggle('collapsed');
});

/* ============ SEARCH ============ */
els.searchInput.addEventListener('input', () => {
  state.searchQuery = els.searchInput.value;
  applyFilter();
  renderFileList();
});

/* ============ FIND IN FILE ============ */
function openFind() {
  findState.open = true;
  els.findBar.classList.remove('hidden');
  const sel = els.editor.value.substring(els.editor.selectionStart, els.editor.selectionEnd);
  if (sel && !sel.includes('\n')) els.findInput.value = sel;
  els.findInput.focus();
  els.findInput.select();
  runFind(true);
  positionAIPanel();
}

function closeFind() {
  findState.open = false;
  findState.query = '';
  findState.matches = [];
  findState.index = -1;
  els.findBar.classList.add('hidden');
  clearFindMarks();
  updateFindCount();
  renderEditorHighlight();
  positionAIPanel();
}

function runFind(reset) {
  const q = els.findInput.value;
  findState.query = q;
  clearFindMarks();
  if (!q) {
    findState.matches = [];
    findState.index = -1;
    updateFindCount();
    renderEditorHighlight();
    return;
  }
  const text = els.editor.value;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const matches = [];
  let i = lower.indexOf(ql);
  while (i !== -1 && matches.length < 5000) {
    matches.push(i);
    i = lower.indexOf(ql, i + Math.max(1, ql.length));
  }
  findState.matches = matches;
  if (reset || findState.index < 0 || findState.index >= matches.length) findState.index = 0;
  if (!matches.length) {
    updateFindCount();
    renderEditorHighlight();
    return;
  }
  goToMatch(findState.index);
}

function goToMatch(idx) {
  if (!findState.matches.length) return;
  const n = findState.matches.length;
  findState.index = ((idx % n) + n) % n;
  const start = findState.matches[findState.index];
  const end = start + findState.query.length;

  // editor selection + approximate scroll
  els.editor.setSelectionRange(start, end);
  const before = els.editor.value.slice(0, start);
  const line = (before.match(/\n/g) || []).length;
  const lh = parseFloat(getComputedStyle(els.editor).lineHeight) || 24;
  els.editor.scrollTop = Math.max(0, line * lh - els.editor.clientHeight / 2);

  if (state.viewMode !== 'edit') {
    applyFindMarks();
    scrollToPreviewMatch();
  }
  updateFindCount();
  renderEditorHighlight();
}

function updateFindCount() {
  const n = findState.matches.length;
  els.findCount.textContent = n ? `${findState.index + 1}/${n}` : (findState.query ? '0/0' : '');
}

function markNodeText(node, ql) {
  const text = node.nodeValue;
  const lower = text.toLowerCase();
  const frag = document.createDocumentFragment();
  let pos = 0;
  let idx;
  while ((idx = lower.indexOf(ql, pos)) !== -1) {
    if (idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
    const mark = document.createElement('mark');
    mark.className = 'find-mark';
    mark.textContent = text.slice(idx, idx + ql.length);
    frag.appendChild(mark);
    pos = idx + ql.length;
  }
  if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
  node.parentNode.replaceChild(frag, node);
}

function applyFindMarks() {
  if (state.viewMode === 'edit') return;
  if (!findState.query) return;
  const ql = findState.query.toLowerCase();
  const walker = document.createTreeWalker(els.previewContent, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentNode;
    if (!p) continue;
    if (p.nodeName === 'MARK') continue;
    if (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE') continue;
    if (p.closest && p.closest('.code-head')) continue;
    if (n.nodeValue && n.nodeValue.toLowerCase().includes(ql)) nodes.push(n);
  }
  for (const node of nodes) markNodeText(node, ql);

  const marks = els.previewContent.querySelectorAll('mark.find-mark');
  marks.forEach((m) => m.classList.remove('current'));
  if (marks.length) {
    const cur = marks[Math.min(Math.max(findState.index, 0), marks.length - 1)];
    if (cur) cur.classList.add('current');
  }
  schedulePaginate(0);
}

function clearFindMarks() {
  els.previewContent.querySelectorAll('mark.find-mark').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  });
  schedulePaginate(0);
}

/* ---- edit-mode search highlight (backdrop behind the textarea) ---- */
function syncEditorHighlight() {
  const ed = els.editor;
  const hl = els.editorHighlight;
  if (!ed || !hl || !hl.firstChild) return;
  const gutter = ed.offsetWidth - ed.clientWidth;
  hl.style.paddingRight = (32 + Math.max(0, gutter)) + 'px';
  hl.scrollTop = ed.scrollTop;
  hl.scrollLeft = ed.scrollLeft;
}

function renderEditorHighlight() {
  const ed = els.editor;
  const hl = els.editorHighlight;
  if (!ed || !hl) return;
  const text = ed.value;
  const q = findState.open ? findState.query : '';

  const ranges = [];
  for (const r of commentRanges(text)) {
    ranges.push({ start: r.start, end: r.end, tag: 'span', cls: 'cmt-hl', id: r.id });
  }
  if (q) {
    const ql = q.toLowerCase();
    const lower = text.toLowerCase();
    let pos = 0;
    let idx;
    let n = 0;
    while ((idx = lower.indexOf(ql, pos)) !== -1) {
      ranges.push({ start: idx, end: idx + q.length, tag: 'mark', cls: n === findState.index ? 'current' : '', id: '' });
      pos = idx + q.length;
      n++;
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);

  let html = '';
  let pos = 0;
  for (const r of ranges) {
    if (r.start < pos || r.end <= r.start) continue;
    if (r.start > pos) html += escapeHtml(text.slice(pos, r.start));
    const cls = r.cls ? ' class="' + r.cls + '"' : '';
    const attr = r.id ? ' data-cmt="' + r.id + '"' : '';
    html += '<' + r.tag + cls + attr + '>' + escapeHtml(text.slice(r.start, r.end)) + '</' + r.tag + '>';
    pos = r.end;
  }
  if (pos < text.length) html += escapeHtml(text.slice(pos));
  if (text.endsWith('\n')) html += '\n';
  hl.innerHTML = html;
  syncEditorHighlight();
}

function scrollToPreviewMatch() {
  const cur = els.previewContent.querySelector('mark.find-mark.current');
  if (cur && els.preview.offsetParent !== null) {
    cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

els.findInput.addEventListener('input', () => runFind(true));
els.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    goToMatch(e.shiftKey ? findState.index - 1 : findState.index + 1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
    els.editor.focus();
  }
});
els.findPrev.addEventListener('click', () => goToMatch(findState.index - 1));
els.findNext.addEventListener('click', () => goToMatch(findState.index + 1));
els.findClose.addEventListener('click', () => { closeFind(); els.editor.focus(); });

/* ============ DIRECTION (RTL / LTR / AUTO) ============ */
const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
const LTR_RE = /[A-Za-z\u00C0-\u024F]/g;

function setupDirection() {
  els.directionControl.addEventListener('click', (e) => {
    const btn = e.target.closest('.dir-btn');
    if (!btn) return;
    state.direction = btn.dataset.dir;
    if (state.currentFile) state.dirByFile[state.currentFile] = state.direction;
    syncDirectionButtons();
    applyDirection();
    savePreferences();
    setStatus('Direction: ' + state.direction.toUpperCase());
  });
}

function syncDirectionButtons() {
  els.directionControl.querySelectorAll('.dir-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.dir === state.direction);
  });
}

function detectDirection(text) {
  // First strong directional character decides (mirrors dir="auto" / UBA P2/P3),
  // but skip markdown syntax markers so "#' hashes and '*' do not skew results.
  const strong = /([\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF])|([A-Za-z\u00C0-\u024F])/;
  const m = strong.exec(text || '');
  if (m) return m[1] ? 'rtl' : 'ltr';
  // fallback: majority of directional characters
  const rtl = ((text || '').match(RTL_RE) || []).length;
  const ltr = ((text || '').match(LTR_RE) || []).length;
  return rtl > ltr ? 'rtl' : 'ltr';
}

function detectDirectionMajority(text) {
  const rtl = ((text || '').match(RTL_RE) || []).length;
  const ltr = ((text || '').match(LTR_RE) || []).length;
  return rtl > ltr ? 'rtl' : 'ltr';
}

function applyDirection() {
  // editor: in auto AND rtl mode each line detects its own direction so an
  // all-Latin line is not forced right-to-left; ltr stays strictly ltr.
  if (state.direction === 'ltr') {
    els.editor.dir = 'ltr';
    els.editor.classList.remove('bidi-plaintext');
  } else {
    els.editor.dir = state.direction === 'auto' ? 'auto' : 'rtl';
    els.editor.classList.add('bidi-plaintext');
  }

  // mirror direction onto the highlight backdrop so glyphs line up
  if (els.editorHighlight) {
    els.editorHighlight.dir = els.editor.dir;
    els.editorHighlight.classList.toggle('bidi-plaintext', els.editor.classList.contains('bidi-plaintext'));
  }

  // preview: pick effective direction
  const effective = state.direction === 'auto'
    ? detectDirection(els.editor.value)
    : state.direction;
  els.previewContent.setAttribute('dir', effective);
  applyBidiBlocks();
}

// Tag block-level elements with appropriate dir based on content:
// - If document is LTR (explicit), remove dir from blocks.
// - If document is RTL or auto, any block containing ANY RTL character (Arabic/Farsi/Hebrew etc)
//   must render RTL; otherwise render LTR for mixed/Latin content.
const BIDI_BLOCK_SEL = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, div, table';
function hasRtlChar(s) {
  const m = (s || '').match(RTL_RE);
  return m && m.length > 0;
}
function applyBidiBlocksTo(container) {
  const docDir = container.getAttribute('dir');
  if (docDir !== 'rtl') {
    container.querySelectorAll(BIDI_BLOCK_SEL).forEach((el) => {
      el.removeAttribute('dir');
    });
    return;
  }
  container.querySelectorAll(BIDI_BLOCK_SEL).forEach((el) => {
    if (hasRtlChar(el.textContent)) {
      el.setAttribute('dir', 'rtl');
    } else {
      el.setAttribute('dir', 'ltr');
    }
  });
}
function applyBidiBlocks() {
  applyBidiBlocksTo(els.previewContent);
}

/* ============ FORMATTING TOOLBAR ============ */
function setupToolbar() {
  els.editorToolbar.addEventListener('mousedown', (e) => {
    // keep editor selection when clicking toolbar buttons
    if (e.target.closest('.tb-btn')) e.preventDefault();
  });

  els.editorToolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tb-btn');
    if (!btn || !btn.dataset.action) return;
    applyFormat(btn.dataset.action);
  });
}

function replaceRange(start, end, text, selStart, selEnd) {
  const ed = els.editor;
  ed.focus();
  ed.selectionStart = start;
  ed.selectionEnd = end;
  document.execCommand('insertText', false, text);
  if (selStart != null) {
    ed.selectionStart = selStart;
    ed.selectionEnd = selEnd == null ? selStart : selEnd;
  }
  onEditorChanged();
}

function insertAtCursor(before, after = '', placeholder = '') {
  const ed = els.editor;
  const start = ed.selectionStart;
  const end = ed.selectionEnd;
  const selected = ed.value.slice(start, end);
  const text = selected || placeholder;
  const replacement = before + text + after;
  replaceRange(start, end, replacement, start + before.length, start + before.length + text.length);
}

function stripBlockPrefix(line) {
  return line.replace(/^([ \t]*)(?:#{1,6}\s+|>\s+|[-*+]\s+\[[ xX]\]\s|[-*+]\s+|\d+[.)]\s+)/, '$1');
}

function blockRange() {
  const ed = els.editor;
  const value = ed.value;
  const start = value.lastIndexOf('\n', ed.selectionStart - 1) + 1;
  let end = value.indexOf('\n', ed.selectionEnd);
  if (end === -1) end = value.length;
  return { start, end, block: value.slice(start, end) };
}

function prefixLines(prefix, numbered = false) {
  const { start, end, block } = blockRange();
  const lines = block.split('\n');
  const newLines = lines.map((line, i) => {
    const marker = numbered ? `${i + 1}. ` : prefix;
    return marker + stripBlockPrefix(line);
  });
  const newBlock = newLines.join('\n');
  replaceRange(start, end, newBlock, start, start + newBlock.length);
}

function toggleLinePrefix(prefix) {
  const { start, end, block } = blockRange();
  const lines = block.split('\n');
  const allHave = lines.every((line) => {
    const lead = line.match(/^[ \t]*/)[0];
    return line.slice(lead.length).startsWith(prefix);
  });
  const newLines = lines.map((line) => {
    const lead = line.match(/^[ \t]*/)[0];
    const rest = line.slice(lead.length);
    return allHave ? lead + rest.slice(prefix.length) : lead + prefix + stripBlockPrefix(rest);
  });
  const newBlock = newLines.join('\n');
  replaceRange(start, end, newBlock, start, start + newBlock.length);
}

function applyFormat(action) {
  if (!state.currentFile && action !== 'undo' && action !== 'redo') {
    toast('Open or create a file first', 'info');
    return;
  }
  switch (action) {
    case 'undo': document.execCommand('undo'); onEditorChanged(); break;
    case 'redo': document.execCommand('redo'); onEditorChanged(); break;
    case 'bold': insertAtCursor('**', '**', 'bold text'); break;
    case 'italic': insertAtCursor('*', '*', 'italic text'); break;
    case 'strike': insertAtCursor('~~', '~~', 'strikethrough'); break;
    case 'code': insertAtCursor('`', '`', 'code'); break;
    case 'h1': toggleLinePrefix('# '); break;
    case 'h2': toggleLinePrefix('## '); break;
    case 'h3': toggleLinePrefix('### '); break;
    case 'ul': prefixLines('- '); break;
    case 'ol': prefixLines('', true); break;
    case 'task': prefixLines('- [ ] '); break;
    case 'quote': toggleLinePrefix('> '); break;
    case 'link': insertAtCursor('[', '](https://)', 'link text'); break;
    case 'image': insertAtCursor('![', '](https://)', 'alt text'); break;
    case 'codeblock': insertBlock('```\n', '\n```', 'code here'); break;
    case 'table': insertBlock('', '', '| Column A | Column B |\n| --- | --- |\n| Cell 1 | Cell 2 |\n| Cell 3 | Cell 4 |'); break;
    case 'hr': insertBlock('\n', '\n', '---'); break;
  }
  els.editor.focus();
}

function insertBlock(before, after, content) {
  const ed = els.editor;
  const start = ed.selectionStart;
  const end = ed.selectionEnd;
  const value = ed.value;
  const selected = value.slice(start, end) || content;
  const newText = before + selected + after;

  // add blank line separation where helpful
  const before2 = (start > 0 && value[start - 1] !== '\n') ? '\n' : '';
  const after2 = (end < value.length && value[end] !== '\n') ? '\n' : '';

  const full = before2 + newText + after2;
  const selStart = start + before2.length + before.length;
  replaceRange(start, end, full, selStart, selStart + selected.length);
}

function onEditorChanged() {
  state.dirty = true;
  updateWordCount();
  applyDirection();
  renderEditorHighlight();
  renderPreview();
  setSaveStatus('saving');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveFile(true), 900);
}

/* ============ SPLIT DIVIDER ============ */
function setupSplitDivider() {
  const divider = els.splitDivider;
  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    const rect = els.editorArea.getBoundingClientRect();
    let pct = ((e.clientX - rect.left) / rect.width) * 100;
    pct = Math.max(15, Math.min(85, pct));
    state.splitPos = pct;
    els.editorArea.style.setProperty('--split-pos', pct + '%');
  };

  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    savePreferences();
  };

  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  divider.addEventListener('dblclick', () => {
    state.splitPos = 50;
    applySplitPos();
    savePreferences();
  });
}

function applySplitPos() {
  els.editorArea.style.setProperty('--split-pos', state.splitPos + '%');
}

/* ============ SIDEBAR RESIZE ============ */
function applySidebarWidth() {
  document.documentElement.style.setProperty('--sidebar-width', state.sidebarWidth + 'px');
}

function setupSidebarResize() {
  const handle = els.sidebarResizer;
  if (!handle) return;
  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    const left = els.sidebar.getBoundingClientRect().left;
    let width = e.clientX - left;
    width = Math.max(180, Math.min(520, width));
    state.sidebarWidth = Math.round(width);
    applySidebarWidth();
    positionAIPanel();
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    savePreferences();
    positionAIPanel();
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  handle.addEventListener('dblclick', () => {
    state.sidebarWidth = 270;
    applySidebarWidth();
    savePreferences();
  });
}

/* ============ MODALS ============ */
function modalEl(name) {
  return modals[name] || document.getElementById(name) || null;
}
function openModal(name) { const m = modalEl(name); if (m) m.classList.remove('hidden'); }
function closeModal(name) { const m = modalEl(name); if (m) m.classList.add('hidden'); }

function closeAllModals() {
  Object.values(modals).forEach(m => m.classList.add('hidden'));
}

// delegated so every current and future [data-close] control works reliably
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-close]');
  if (btn) closeModal(btn.dataset.close);
});

Object.values(modals).forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

/* ============ NAME HELPERS ============ */
function sanitizeName(s) {
  return String(s).replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-').trim();
}
function sanitizePath(p) {
  return String(p).split('/').map(sanitizeName).filter(Boolean).join('/');
}
function joinPath(dir, name) {
  return dir ? dir + '/' + name : name;
}

/* ============ NEW FILE ============ */
function openNewFileModal(parentFolder) {
  state.newFileFolder = parentFolder || '';
  $('newFileLocation').textContent = state.newFileFolder || 'Library';
  $('newFileName').value = '';
  openModal('newFile');
  setTimeout(() => $('newFileName').focus(), 50);
}

els.newFileBtn.addEventListener('click', () => openNewFileModal(''));

$('newFileName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); createNewFile(); }
});

$('createFileConfirm').addEventListener('click', createNewFile);

$('saveAnswerConfirm').addEventListener('click', createAnswerFile);
els.saveAnswerName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); createAnswerFile(); }
});

async function createNewFile() {
  let name = sanitizeName($('newFileName').value.trim());
  if (!name) { toast('Please enter a valid file name', 'error'); return; }
  if (!name.toLowerCase().endsWith('.md')) name += '.md';

  const folder = state.newFileFolder || '';
  const fullPath = joinPath(folder, name);

  if (!(await ensureVaultForCreation())) return;

  if (state.files.some(f => f.path.toLowerCase() === fullPath.toLowerCase())) {
    toast('A file with that name already exists', 'error');
    return;
  }

  try {
    const result = await window.inkwell.createFile(fullPath);
    if (!result.success) { toast('Could not create file: ' + result.error, 'error'); return; }
    closeModal('newFile');
    if (folder) state.expandedFolders.add(folder);
    await refreshFiles();
    await selectFile(fullPath);
    toast('Created ' + fullPath, 'success');
  } catch (e) {
    toast('Could not create file', 'error');
  }
}

/* ============ NEW FOLDER ============ */
function openNewFolderModal(parentFolder) {
  state.newFolderParent = parentFolder || '';
  $('newFolderLocation').textContent = state.newFolderParent || 'Library';
  $('newFolderName').value = '';
  openModal('newFolder');
  setTimeout(() => $('newFolderName').focus(), 50);
}

els.newFolderBtn.addEventListener('click', () => openNewFolderModal(''));

$('newFolderName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); createNewFolder(); }
});

$('createFolderConfirm').addEventListener('click', createNewFolder);

async function createNewFolder() {
  const name = sanitizeName($('newFolderName').value.trim());
  if (!name) { toast('Please enter a valid folder name', 'error'); return; }

  const parent = state.newFolderParent || '';
  const fullPath = joinPath(parent, name);

  if (!(await ensureVaultForCreation())) return;

  if (state.folders.some(f => f.path.toLowerCase() === fullPath.toLowerCase())) {
    toast('A folder with that name already exists', 'error');
    return;
  }

  try {
    const result = await window.inkwell.mkdir(fullPath);
    if (!result.success) { toast('Could not create folder: ' + result.error, 'error'); return; }
    closeModal('newFolder');
    state.expandedFolders.add(fullPath);
    if (parent) state.expandedFolders.add(parent);
    await refreshFiles();
    toast('Created folder ' + fullPath, 'success');
  } catch (e) {
    toast('Could not create folder', 'error');
  }
}

/* ============ DELETE FILE ============ */
function openDeleteModal(path) {
  $('deleteFileName').textContent = path;
  modals.deleteFile.dataset.target = path;
  openModal('deleteFile');
}

els.deleteFileBtn.addEventListener('click', () => {
  if (state.currentFile) openDeleteModal(state.currentFile);
});

$('deleteFileConfirm').addEventListener('click', async () => {
  const path = modals.deleteFile.dataset.target;
  if (!path) return;
  try {
    const result = await window.inkwell.deleteFile(path);
    if (!result.success) { toast('Could not delete: ' + result.error, 'error'); return; }
    closeModal('deleteFile');
    toast('Deleted ' + path, 'success');
    const pinIdx = state.pinned.indexOf(path);
    if (pinIdx !== -1) { state.pinned.splice(pinIdx, 1); savePreferences(); }
    if (state.dirByFile[path] !== undefined) { delete state.dirByFile[path]; savePreferences(); }
    if (state.commentsByFile[path] !== undefined) { delete state.commentsByFile[path]; savePreferences(); }
    if (state.currentFile === path) {
      state.currentFile = null;
      state.dirty = false;
    }
    await refreshFiles();
    if (state.files.length > 0) {
      await selectFile(state.files[0].path);
    } else {
      showEmptyEditor();
    }
  } catch (e) {
    toast('Could not delete file', 'error');
  }
});

/* ============ DELETE FOLDER ============ */
function openDeleteFolderModal(path) {
  $('deleteFolderName').textContent = path;
  modals.deleteFolder.dataset.target = path;
  openModal('deleteFolder');
}

$('deleteFolderConfirm').addEventListener('click', async () => {
  const path = modals.deleteFolder.dataset.target;
  if (!path) return;
  try {
    const result = await window.inkwell.rmdir(path);
    if (!result.success) { toast('Could not delete folder: ' + result.error, 'error'); return; }
    closeModal('deleteFolder');
    toast('Deleted folder ' + path, 'success');
    const before = state.pinned.length;
    state.pinned = state.pinned.filter((p) => p !== path && !p.startsWith(path + '/'));
    if (state.pinned.length !== before) savePreferences();
    let dirChanged = false;
    for (const k of Object.keys(state.dirByFile)) {
      if (k === path || k.startsWith(path + '/')) { delete state.dirByFile[k]; dirChanged = true; }
    }
    if (dirChanged) savePreferences();
    let cmtChanged = false;
    for (const k of Object.keys(state.commentsByFile)) {
      if (k === path || k.startsWith(path + '/')) { delete state.commentsByFile[k]; cmtChanged = true; }
    }
    if (cmtChanged) savePreferences();
    if (state.currentFile && (state.currentFile === path || state.currentFile.startsWith(path + '/'))) {
      state.currentFile = null;
      state.dirty = false;
    }
    if (state.newFileFolder && (state.newFileFolder === path || state.newFileFolder.startsWith(path + '/'))) {
      state.newFileFolder = '';
    }
    for (const p of [...state.expandedFolders]) {
      if (p === path || p.startsWith(path + '/')) state.expandedFolders.delete(p);
    }
    await refreshFiles();
    if (state.files.length > 0) {
      await selectFile(state.files[0].path);
    } else {
      showEmptyEditor();
    }
  } catch (e) {
    toast('Could not delete folder', 'error');
  }
});

/* ============ RENAME FILE ============ */
function openRenameModal(path) {
  $('renameInput').value = path.replace(/\.md$/i, '');
  modals.rename.dataset.target = path;
  openModal('rename');
  setTimeout(() => { const i = $('renameInput'); i.focus(); i.select(); }, 50);
}

$('renameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); doRename(); }
});

$('renameConfirm').addEventListener('click', doRename);

async function doRename() {
  const oldPath = modals.rename.dataset.target;
  const raw = $('renameInput').value.trim();
  if (!oldPath || !raw) { toast('Please enter a name', 'error'); return; }

  let newPath = sanitizePath(raw.replace(/\.md$/i, ''));
  if (!newPath) { toast('Please enter a valid name', 'error'); return; }
  newPath += '.md';

  if (newPath === oldPath) { closeModal('rename'); return; }
  if (state.files.some(f => f.path.toLowerCase() === newPath.toLowerCase())) {
    toast('A file with that name already exists', 'error');
    return;
  }

  try {
    const wasCurrent = state.currentFile === oldPath;
    const result = await window.inkwell.renameFile(oldPath, newPath);
    if (!result.success) { toast('Could not rename: ' + result.error, 'error'); return; }
    closeModal('rename');
    toast(`Renamed to ${newPath}`, 'success');
    const pinIdx = state.pinned.indexOf(oldPath);
    if (pinIdx !== -1) { state.pinned[pinIdx] = newPath; savePreferences(); }
    if (state.dirByFile[oldPath] !== undefined) {
      state.dirByFile[newPath] = state.dirByFile[oldPath];
      delete state.dirByFile[oldPath];
      savePreferences();
    }
    if (state.commentsByFile[oldPath] !== undefined) {
      state.commentsByFile[newPath] = state.commentsByFile[oldPath];
      delete state.commentsByFile[oldPath];
      savePreferences();
    }
    await refreshFiles();
    if (wasCurrent) await selectFile(newPath);
  } catch (e) {
    toast('Could not rename file', 'error');
  }
}

/* ============ RENAME FOLDER ============ */
function openRenameFolderModal(path) {
  $('renameFolderInput').value = path.split('/').pop();
  modals.renameFolder.dataset.target = path;
  openModal('renameFolder');
  setTimeout(() => { const i = $('renameFolderInput'); i.focus(); i.select(); }, 50);
}

$('renameFolderInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); doRenameFolder(); }
});

$('renameFolderConfirm').addEventListener('click', doRenameFolder);

async function doRenameFolder() {
  const oldPath = modals.renameFolder.dataset.target;
  const name = sanitizeName($('renameFolderInput').value.trim());
  if (!oldPath || !name) { toast('Please enter a folder name', 'error'); return; }

  const parent = oldPath.split('/').slice(0, -1).join('/');
  const newPath = joinPath(parent, name);
  if (newPath === oldPath) { closeModal('renameFolder'); return; }
  if (state.folders.some(f => f.path.toLowerCase() === newPath.toLowerCase())) {
    toast('A folder with that name already exists', 'error');
    return;
  }

  try {
    const result = await window.inkwell.renameFolder(oldPath, newPath);
    if (!result.success) { toast('Could not rename folder: ' + result.error, 'error'); return; }
    closeModal('renameFolder');
    toast(`Renamed to ${newPath}`, 'success');

    if (state.currentFile && state.currentFile.startsWith(oldPath + '/')) {
      state.currentFile = newPath + state.currentFile.slice(oldPath.length);
    }
    state.pinned = state.pinned.map((p) =>
      (p === oldPath || p.startsWith(oldPath + '/')) ? newPath + p.slice(oldPath.length) : p);
    const newDirByFile = {};
    for (const k of Object.keys(state.dirByFile)) {
      newDirByFile[k === oldPath || k.startsWith(oldPath + '/')
        ? newPath + k.slice(oldPath.length) : k] = state.dirByFile[k];
    }
    state.dirByFile = newDirByFile;
    const newComments = {};
    for (const k of Object.keys(state.commentsByFile)) {
      newComments[k === oldPath || k.startsWith(oldPath + '/')
        ? newPath + k.slice(oldPath.length) : k] = state.commentsByFile[k];
    }
    state.commentsByFile = newComments;
    savePreferences();
    if (state.currentFile) {
      state.direction = state.dirByFile[state.currentFile] || 'auto';
      syncDirectionButtons();
    }
    for (const p of [...state.expandedFolders]) {
      if (p === oldPath || p.startsWith(oldPath + '/')) {
        state.expandedFolders.delete(p);
        state.expandedFolders.add(newPath + p.slice(oldPath.length));
      }
    }
    await refreshFiles();
    if (state.currentFile) {
      els.currentFileName.textContent = state.currentFile.replace(/\.md$/i, '');
      els.currentFileName.title = state.currentFile.replace(/\.md$/i, '');
      highlightActive();
    }
  } catch (e) {
    toast('Could not rename folder', 'error');
  }
}

/* ============ COMMENTS ============ */
let cmtPending = null;
let cmtModalId = null;

const CMT_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/></svg>';

function commentsFor(path) {
  if (!path) return [];
  const list = state.commentsByFile[path];
  return Array.isArray(list) ? list : [];
}

function genCommentId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function resolveAnchor(comment, text) {
  if (typeof text !== 'string' || !comment || !comment.quote) return null;
  const { quote, start } = comment;
  if (typeof start === 'number' && text.slice(start, start + quote.length) === quote) {
    return { start, end: start + quote.length };
  }
  if (typeof start === 'number') {
    const near = text.indexOf(quote, Math.max(0, start - 300));
    if (near !== -1 && near <= start + 300) return { start: near, end: near + quote.length };
  }
  const idx = text.indexOf(quote);
  if (idx === -1) return null;
  return { start: idx, end: idx + quote.length };
}

function commentRanges(text) {
  const ranges = [];
  for (const c of commentsFor(state.currentFile)) {
    const a = resolveAnchor(c, text);
    if (a) ranges.push({ start: a.start, end: a.end, id: c.id });
  }
  return ranges;
}

function commentLine(comment, text) {
  const a = resolveAnchor(comment, text);
  if (!a) return null;
  return text.slice(0, a.start).split('\n').length;
}

function commentSection(comment, text) {
  const a = resolveAnchor(comment, text);
  if (!a) return null;
  const lines = text.slice(0, a.start).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^\s{0,3}#{1,6}\s+(.*\S)/);
    if (m) return m[1].replace(/\s*#+\s*$/, '').trim();
  }
  return null;
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24);
  if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
  return new Date(ts).toLocaleDateString();
}

function addComment(comment) {
  const path = state.currentFile;
  if (!path) return null;
  if (!state.commentsByFile[path]) state.commentsByFile[path] = [];
  state.commentsByFile[path].push(comment);
  savePreferences();
  return comment;
}

function removeComment(id) {
  const path = state.currentFile;
  const list = commentsFor(path);
  const i = list.findIndex((c) => c.id === id);
  if (i === -1) return;
  list.splice(i, 1);
  if (!list.length) delete state.commentsByFile[path];
  savePreferences();
}

function updateCommentsBadge() {
  const list = commentsFor(state.currentFile);
  if (els.commentsBadge) {
    els.commentsBadge.textContent = String(list.length);
    els.commentsBadge.classList.toggle('hidden', list.length === 0);
  }
  if (els.commentsCount) {
    els.commentsCount.textContent = String(list.length);
  }
  if (els.commentsToolbarBtn) {
    els.commentsToolbarBtn.classList.toggle('has-comments', list.length > 0);
    els.commentsToolbarBtn.classList.toggle('hidden', !state.currentFile);
  }
}

function openCommentComposer(anchor, x, y) {
  if (!state.currentFile) { toast('Open a document first', 'info'); return; }
  cmtPending = { quote: anchor.quote, start: anchor.start == null ? null : anchor.start, end: anchor.end == null ? null : anchor.end };
  hideAIFloat();
  closeAIPanel();
  els.cmtComposerQuote.textContent = anchor.quote;
  els.cmtComposerQuote.setAttribute('dir', detectDirection(anchor.quote));
  els.cmtComposerBody.value = '';
  els.commentComposer.classList.remove('hidden');
  const w = 362;
  const h = els.commentComposer.offsetHeight || 230;
  const px = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  const py = Math.max(8, Math.min(y + 8, window.innerHeight - h - 8));
  els.commentComposer.style.left = px + 'px';
  els.commentComposer.style.top = py + 'px';
  els.cmtComposerBody.focus();
}

function hideCommentComposer() {
  if (!els.commentComposer || els.commentComposer.classList.contains('hidden')) return;
  els.commentComposer.classList.add('hidden');
  cmtPending = null;
}

function saveCommentFromComposer() {
  const body = els.cmtComposerBody.value.trim();
  if (!body) { toast('Write something first', 'info'); els.cmtComposerBody.focus(); return; }
  if (!cmtPending || !state.currentFile) { hideCommentComposer(); return; }
  const now = Date.now();
  addComment({
    id: genCommentId(),
    quote: cmtPending.quote,
    start: cmtPending.start,
    end: cmtPending.end,
    body,
    created: now,
    updated: now,
  });
  hideCommentComposer();
  toast('Comment added', 'success');
  refreshCommentUI();
}

function refreshCommentUI() {
  renderEditorHighlight();
  renderPreview();
  renderComments();
  updateCommentsBadge();
}

function renderComments() {
  if (!els.commentsList) return;
  updateCommentsBadge();
  const list = commentsFor(state.currentFile);
  els.commentsList.innerHTML = '';
  if (!state.currentFile) {
    els.commentsList.innerHTML = '<div class="comments-empty">Open a document to see its comments.</div>';
    return;
  }
  if (!list.length) {
    els.commentsList.innerHTML = '<div class="comments-empty">No comments yet.<br>Select text, then click <strong>Comment</strong>.</div>';
    return;
  }
  const text = els.editor.value;
  const sorted = list.slice().sort((a, b) => {
    const aa = resolveAnchor(a, text);
    const bb = resolveAnchor(b, text);
    return (aa ? aa.start : 1e9) - (bb ? bb.start : 1e9);
  });
  for (const c of sorted) els.commentsList.appendChild(commentCard(c, text));
}

function commentCard(c, text) {
  const card = document.createElement('div');
  card.className = 'cmt-card';
  card.dataset.id = c.id;
  card.title = 'Click to view the full comment';

  const head = document.createElement('div');
  head.className = 'cmt-card-head';

  const line = commentLine(c, text);
  const section = commentSection(c, text);
  const loc = document.createElement('button');
  loc.type = 'button';
  loc.className = 'cmt-loc';
  loc.title = 'Jump to this part';
  let locText = line ? 'Line ' + line : 'Unanchored';
  if (section) locText = '\u00a7 ' + section + ' \u00b7 ' + locText;
  loc.innerHTML = CMT_ICON + '<span>' + escapeHtml(locText) + '</span>';
  loc.addEventListener('click', (e) => { e.stopPropagation(); jumpToComment(c.id); });
  head.appendChild(loc);

  const acts = document.createElement('div');
  acts.className = 'cmt-card-actions';

  const jumpBtn = document.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.className = 'cmt-act jump';
  jumpBtn.title = 'Jump to the commented text';
  jumpBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="2.5"/></svg>';
  jumpBtn.addEventListener('click', (e) => { e.stopPropagation(); jumpToComment(c.id); });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'cmt-act danger';
  delBtn.title = 'Delete comment';
  delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); removeComment(c.id); refreshCommentUI(); toast('Comment deleted', 'success'); });

  acts.appendChild(jumpBtn);
  acts.appendChild(delBtn);
  head.appendChild(acts);
  card.appendChild(head);

  const quote = document.createElement('div');
  quote.className = 'cmt-quote';
  quote.setAttribute('dir', detectDirection(c.quote));
  quote.textContent = c.quote.length > 240 ? c.quote.slice(0, 240) + '\u2026' : c.quote;
  card.appendChild(quote);

  const body = document.createElement('div');
  body.className = 'cmt-body markdown-body';
  body.setAttribute('dir', 'auto');
  body.innerHTML = md.render(c.body || '');
  card.appendChild(body);

  const meta = document.createElement('div');
  meta.className = 'cmt-meta';
  meta.textContent = timeAgo(c.updated || c.created);
  card.appendChild(meta);

  card.addEventListener('click', () => openCommentModal(c.id));

  return card;
}

function renderCommentModalBody(c) {
  const text = els.editor.value;
  if (els.commentModalQuote) {
    els.commentModalQuote.setAttribute('dir', detectDirection(c.quote));
    els.commentModalQuote.textContent = c.quote;
  }
  if (els.commentModalBody) {
    els.commentModalBody.setAttribute('dir', 'auto');
    els.commentModalBody.innerHTML = md.render(c.body || '');
  }
  if (els.commentModalMeta) {
    const line = commentLine(c, text);
    const section = commentSection(c, text);
    let loc = line ? 'Line ' + line : 'Unanchored';
    if (section) loc = '\u00a7 ' + section + ' \u00b7 ' + loc;
    els.commentModalMeta.textContent = loc + ' \u00b7 ' + timeAgo(c.updated || c.created);
  }
}

function setCommentModalEditMode(on) {
  if (els.commentModalEditWrap) els.commentModalEditWrap.classList.toggle('hidden', !on);
  if (els.commentModalBody) els.commentModalBody.classList.toggle('hidden', on);
  if (els.commentModalMeta) els.commentModalMeta.classList.toggle('hidden', on);
  if (els.commentModalEditBtn) els.commentModalEditBtn.classList.toggle('hidden', on);
  if (els.commentModalJump) els.commentModalJump.classList.toggle('hidden', on);
  if (els.commentModalDelete) els.commentModalDelete.classList.toggle('hidden', on);
  if (els.commentModalCloseBtn) els.commentModalCloseBtn.classList.toggle('hidden', on);
  if (els.commentModalCancelBtn) els.commentModalCancelBtn.classList.toggle('hidden', !on);
  if (els.commentModalSaveBtn) els.commentModalSaveBtn.classList.toggle('hidden', !on);
}

function startEditingComment() {
  const c = commentsFor(state.currentFile).find((x) => x.id === cmtModalId);
  if (!c || !els.commentModalEditInput) return;
  els.commentModalEditInput.value = c.body || '';
  setCommentModalEditMode(true);
  els.commentModalEditInput.focus();
}

function exitEditingComment() {
  setCommentModalEditMode(false);
  const c = commentsFor(state.currentFile).find((x) => x.id === cmtModalId);
  if (c) renderCommentModalBody(c);
}

function saveEditedComment() {
  const c = commentsFor(state.currentFile).find((x) => x.id === cmtModalId);
  if (!c) return;
  const body = (els.commentModalEditInput.value || '').trim();
  if (!body) { toast('Comment cannot be empty', 'info'); els.commentModalEditInput.focus(); return; }
  c.body = body;
  c.updated = Date.now();
  savePreferences();
  setCommentModalEditMode(false);
  renderCommentModalBody(c);
  refreshCommentUI();
  toast('Comment updated', 'success');
}

function openCommentModal(id) {
  const c = commentsFor(state.currentFile).find((x) => x.id === id);
  if (!c) return;
  cmtModalId = id;
  setCommentModalEditMode(false);
  renderCommentModalBody(c);
  openModal('comment');
}

function deleteCommentFromModal() {
  if (!cmtModalId) return;
  removeComment(cmtModalId);
  cmtModalId = null;
  closeModal('comment');
  refreshCommentUI();
  toast('Comment deleted', 'success');
}

function jumpFromModal() {
  const id = cmtModalId;
  closeModal('comment');
  if (id) jumpToComment(id);
}

function jumpToComment(id) {
  const c = commentsFor(state.currentFile).find((x) => x.id === id);
  if (!c) return;
  const text = els.editor.value;
  const a = resolveAnchor(c, text);
  if (!a) { toast('The commented text was changed', 'info'); return; }
  hideCommentComposer();
  els.editor.focus();
  els.editor.selectionStart = a.start;
  els.editor.selectionEnd = a.end;
  const el = els.editorHighlight && els.editorHighlight.querySelector('[data-cmt="' + id + '"]');
  if (el) {
    els.editor.scrollTop = Math.max(0, el.offsetTop - els.editor.clientHeight * 0.35);
  } else {
    const line = text.slice(0, a.start).split('\n').length;
    const lh = parseFloat(getComputedStyle(els.editor).lineHeight) || 20;
    els.editor.scrollTop = Math.max(0, (line - 1) * lh - els.editor.clientHeight * 0.35);
  }
  const marks = els.previewContent.querySelectorAll('[data-cmt="' + id + '"]');
  if (els.preview.offsetParent !== null) {
    if (marks.length) marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    else if (text.length) els.preview.scrollTop = Math.max(0, (a.start / text.length) * (els.preview.scrollHeight - els.preview.clientHeight));
  }
  els.commentsList.querySelectorAll('.cmt-card.current').forEach((n) => n.classList.remove('current'));
  const card = els.commentsList.querySelector('.cmt-card[data-id="' + id + '"]');
  if (card) { card.classList.add('current'); card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  flashComment(id);
}

function flashComment(id) {
  const nodes = [];
  const he = els.editorHighlight && els.editorHighlight.querySelector('[data-cmt="' + id + '"]');
  if (he) nodes.push(he);
  els.previewContent.querySelectorAll('[data-cmt="' + id + '"]').forEach((n) => nodes.push(n));
  if (!nodes.length) return;
  nodes.forEach((n) => n.classList.remove('cmt-flash'));
  void els.editor.offsetWidth;
  nodes.forEach((n) => n.classList.add('cmt-flash'));
  setTimeout(() => nodes.forEach((n) => n.classList.remove('cmt-flash')), 2000);
}

function previewTextItems() {
  const items = [];
  let text = '';
  const walker = document.createTreeWalker(els.previewContent, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentNode;
    if (!p) continue;
    if (p.closest && p.closest('.cmt-mark, .code-head')) continue;
    if (!n.nodeValue) continue;
    items.push({ node: n, start: text.length });
    text += n.nodeValue;
  }
  return { text, items };
}

function previewLocate(items, index, isEnd) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const len = it.node.nodeValue.length;
    if (isEnd) {
      if (index > it.start && index <= it.start + len) return { node: it.node, offset: index - it.start };
    } else if (index >= it.start && index < it.start + len) {
      return { node: it.node, offset: index - it.start };
    }
  }
  return null;
}

function mdPlain(s) {
  return (s || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1');
}

function previewFind(text, needle) {
  if (!needle) return null;
  const i = text.indexOf(needle);
  if (i !== -1) return { index: i, length: needle.length };
  const pattern = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const m = new RegExp(pattern).exec(text);
  return m ? { index: m.index, length: m[0].length } : null;
}

function inlineBlock(node) {
  const el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
  return el ? el.closest('p, li, pre, h1, h2, h3, h4, h5, h6, blockquote, td, th') : null;
}

function wrapPreviewRange(id, index, length, items) {
  const a = previewLocate(items, index, false);
  const b = previewLocate(items, index + length, true);
  if (!a || !b) return false;
  if (inlineBlock(a.node) !== inlineBlock(b.node)) return false;
  const range = document.createRange();
  try {
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
  } catch (_) { return false; }
  const mark = document.createElement('mark');
  mark.className = 'cmt-mark';
  mark.dataset.cmt = id;
  try {
    range.surroundContents(mark);
  } catch (_) {
    try {
      const frag = range.extractContents();
      mark.appendChild(frag);
      range.insertNode(mark);
    } catch (_) { return false; }
  }
  return true;
}

function commentSearchParts(quote) {
  const parts = [];
  const whole = (quote || '').trim();
  if (whole) parts.push(whole);
  const seen = new Set(parts);
  for (const raw of (quote || '').split('\n')) {
    const line = raw.trim();
    if (line.length < 2) continue;
    if (/^`{3,}/.test(line)) continue;
    if (/^[-*_]{3,}$/.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    parts.push(line);
  }
  return parts;
}

function decoratePreviewComments() {
  const list = commentsFor(state.currentFile);
  if (!list.length) return;
  for (const c of list) {
    if (!c.quote || !c.quote.trim()) continue;
    const { text, items } = previewTextItems();
    for (const part of commentSearchParts(c.quote)) {
      const plain = mdPlain(part).trim();
      if (plain.length < 2) continue;
      const found = previewFind(text, plain);
      if (found && wrapPreviewRange(c.id, found.index, found.length, items)) break;
    }
  }
}

function positionCommentsPanel() {
  if (!els.commentsPanel || els.commentsPanel.classList.contains('hidden')) return;
  const area = els.editorArea.getBoundingClientRect();
  const p = els.commentsPanel;
  p.style.top = area.top + 'px';
  p.style.height = area.height + 'px';
  p.style.right = (window.innerWidth - area.right) + 'px';
}

function openCommentsPanel() {
  if (!state.currentFile) { toast('Open a document first', 'info'); return; }
  els.commentsPanel.classList.remove('hidden');
  closeAIPanel();
  hideCommentComposer();
  renderComments();
  positionCommentsPanel();
}

function closeCommentsPanel() {
  if (els.commentsPanel) els.commentsPanel.classList.add('hidden');
}

function toggleCommentsPanel() {
  if (els.commentsPanel.classList.contains('hidden')) openCommentsPanel();
  else closeCommentsPanel();
}

function setupComments() {
  if (!els.commentsPanel) return;
  els.commentsToolbarBtn.addEventListener('click', toggleCommentsPanel);
  els.commentsClose.addEventListener('click', closeCommentsPanel);
  els.cmtComposerSave.addEventListener('click', saveCommentFromComposer);
  els.cmtComposerCancel.addEventListener('click', hideCommentComposer);
  els.cmtComposerClose.addEventListener('click', hideCommentComposer);
  els.cmtComposerBody.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); saveCommentFromComposer(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); e.stopPropagation(); cmtToolbarCmd('bold'); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); e.stopPropagation(); cmtToolbarCmd('italic'); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideCommentComposer(); }
  });
  if (els.cmtComposerToolbar) {
    els.cmtComposerToolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cmd]');
      if (btn) cmtToolbarCmd(btn.dataset.cmd);
    });
  }
  if (els.commentModalJump) els.commentModalJump.addEventListener('click', jumpFromModal);
  if (els.commentModalDelete) els.commentModalDelete.addEventListener('click', deleteCommentFromModal);
  if (els.commentModalEditBtn) els.commentModalEditBtn.addEventListener('click', startEditingComment);
  if (els.commentModalCancelBtn) els.commentModalCancelBtn.addEventListener('click', exitEditingComment);
  if (els.commentModalSaveBtn) els.commentModalSaveBtn.addEventListener('click', saveEditedComment);
  if (els.commentModalToolbar) {
    els.commentModalToolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cmd]');
      if (btn) cmtToolbarCmd(btn.dataset.cmd, els.commentModalEditInput);
    });
  }
  if (els.commentModalEditInput) {
    els.commentModalEditInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); saveEditedComment(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); e.stopPropagation(); cmtToolbarCmd('bold', els.commentModalEditInput); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); e.stopPropagation(); cmtToolbarCmd('italic', els.commentModalEditInput); }
      else if (e.key === 'Escape' && !els.commentModalEditWrap.classList.contains('hidden')) { e.preventDefault(); e.stopPropagation(); exitEditingComment(); }
    });
  }
  window.addEventListener('resize', positionCommentsPanel);

  els.previewContent.addEventListener('click', (e) => {
    const mark = e.target.closest('.cmt-mark');
    if (!mark) return;
    openCommentsPanel();
    jumpToComment(mark.dataset.cmt);
  });

  document.addEventListener('mousedown', (e) => {
    if (els.commentComposer.classList.contains('hidden')) return;
    if (els.commentComposer.contains(e.target)) return;
    if (els.cmtFloatBtn.contains(e.target) || els.aiFloatBtn.contains(e.target)) return;
    hideCommentComposer();
  });
}

/* ---- comment composer markdown helpers ---- */
function cmtApplyInline(target, before, after, placeholder) {
  const ta = target || els.cmtComposerBody;
  if (!ta) return;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const val = ta.value;
  const sel = val.slice(s, e);
  const inner = sel || placeholder || '';
  ta.value = val.slice(0, s) + before + inner + after + val.slice(e);
  ta.focus();
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + inner.length;
}

function cmtApplyLink(target) {
  const ta = target || els.cmtComposerBody;
  if (!ta) return;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const val = ta.value;
  const sel = val.slice(s, e) || 'text';
  ta.value = val.slice(0, s) + '[' + sel + '](url)' + val.slice(e);
  ta.focus();
  const urlStart = s + sel.length + 3;
  ta.selectionStart = urlStart;
  ta.selectionEnd = urlStart + 3;
}

function cmtApplyLinePrefix(target, prefix, numbered) {
  const ta = target || els.cmtComposerBody;
  if (!ta) return;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const val = ta.value;
  const lineStart = val.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
  let lineEnd = val.indexOf('\n', e);
  if (lineEnd === -1) lineEnd = val.length;
  const lines = val.slice(lineStart, lineEnd).split('\n');
  const out = lines.map((l, i) => (numbered ? (i + 1) + '. ' : prefix) + l).join('\n');
  ta.value = val.slice(0, lineStart) + out + val.slice(lineEnd);
  ta.focus();
  ta.selectionStart = lineStart;
  ta.selectionEnd = lineStart + out.length;
}

function cmtToolbarCmd(cmd, target) {
  const ta = target || els.cmtComposerBody;
  if (!ta) return;
  switch (cmd) {
    case 'bold': cmtApplyInline(ta, '**', '**', 'bold text'); break;
    case 'italic': cmtApplyInline(ta, '_', '_', 'italic text'); break;
    case 'strike': cmtApplyInline(ta, '~~', '~~', 'strikethrough'); break;
    case 'code': cmtApplyInline(ta, '`', '`', 'code'); break;
    case 'link': cmtApplyLink(ta); break;
    case 'ul': cmtApplyLinePrefix(ta, '- ', false); break;
    case 'ol': cmtApplyLinePrefix(ta, '', true); break;
    case 'quote': cmtApplyLinePrefix(ta, '> ', false); break;
  }
}

/* ============ SETTINGS ============ */
function setSettingsTab(tab) {
  const allowed = ['ai', 'vault', 'telegram'];
  const t = allowed.includes(tab) ? tab : 'ai';
  document.querySelectorAll('.settings-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.settingsTab === t);
  });
  document.querySelectorAll('.settings-pane').forEach((pane) => {
    pane.classList.toggle('hidden', pane.dataset.settingsPane !== t);
  });
  if (t === 'vault') loadVaultSettings();
}

function populateSettingsAIProviderSelect(providers) {
  if (!els.settingsAiProvider) return;
  const list = providers || getAIProviders();
  els.settingsAiProvider.innerHTML = '';
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    els.settingsAiProvider.appendChild(opt);
  }
}

function populateAISettings() {
  const providers = getAIProviders();
  populateSettingsAIProviderSelect(providers);
  const provider = providers.some((p) => p.id === state.aiProvider) ? state.aiProvider : (providers[0] ? providers[0].id : 'claude');
  if (els.settingsAiProvider) els.settingsAiProvider.value = provider;
  els.settingsAiModel.value = (state.aiModels || {})[provider] || AI_DEFAULT_MODELS[provider] || '';
  els.settingsAiPrompts.value = (state.aiPrompts || []).join('\n');
}

function settingsTelegramStatus(text, cls) {
  const el = els.settingsTelegramStatus;
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-status' + (cls ? ' ' + cls : '');
}

async function loadTelegramSettings() {
  settingsTelegramStatus('Loading…', 'busy');
  try {
    const cfg = await window.inkwell.getTelegramConfig();
    if (cfg && cfg.success) {
      els.settingsTelegramToken.value = cfg.botToken || '';
      els.settingsTelegramChat.value = cfg.chatId || '';
      if (cfg.botToken && cfg.chatId) {
        const origin = cfg.source === 'env' ? 'from environment' : 'saved settings';
        settingsTelegramStatus('Configured ' + origin + '.', 'ok');
      } else {
        settingsTelegramStatus('Not configured yet.', '');
      }
    } else {
      settingsTelegramStatus((cfg && cfg.error) || 'Could not load Telegram settings.', 'err');
    }
  } catch (_) {
    settingsTelegramStatus('Could not load Telegram settings.', 'err');
  }
}

function renderAIProvidersList() {
  if (!els.aiProvidersList) return;
  els.aiProvidersList.innerHTML = '';
  const list = Array.isArray(state.aiProviders) ? state.aiProviders.filter((p) => p && p.id && p.name && p.command) : [];
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'settings-hint';
    empty.textContent = 'No custom providers.';
    els.aiProvidersList.appendChild(empty);
    return;
  }
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.alignItems = 'center';
    row.style.padding = '4px 0';
    const info = document.createElement('div');
    info.style.flex = '1';
    const typeText = p.type ? ' / ' + p.type : '';
    info.innerHTML = '<div style="font-size:12px;">' + (p.name || p.id) + ' <span style="opacity:.6;">(' + p.command + typeText + ')</span></div>';
    const del = document.createElement('button');
    del.className = 'btn-secondary';
    del.type = 'button';
    del.textContent = 'Remove';
    del.addEventListener('click', () => {
      state.aiProviders.splice(i, 1);
      savePreferences();
      populateAISettings();
      renderAIProvidersList();
      syncAIProvider();
      populateAIProviderSelect();
      if (els.aiProvider) {
        const providers = getAIProviders();
        if (!providers.some((x) => x.id === state.aiProvider)) {
          state.aiProvider = providers[0] ? providers[0].id : 'claude';
          syncAIProvider();
          savePreferences();
        }
      }
      toast('Removed provider', 'success');
    });
    row.appendChild(info);
    row.appendChild(del);
    els.aiProvidersList.appendChild(row);
  }
}

function vaultStatus(text, cls) {
  const el = els.settingsVaultStatus;
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-status' + (cls ? ' ' + cls : '');
}

let pendingVaultPath = null;

async function loadVaultSettings() {
  vaultStatus('Loading…', 'busy');
  try {
    const dir = await window.inkwell.getNotesDir();
    if (els.settingsVaultPath) els.settingsVaultPath.value = dir || '';
    pendingVaultPath = dir || '';
    vaultStatus(dir ? 'Current vault location.' : 'No vault selected. Choose a folder to use as your vault.', dir ? '' : '');
  } catch (e) {
    vaultStatus('Could not load vault location.', 'err');
  }
}

function openSettings(tab) {
  setSettingsTab(tab || 'ai');
  populateAISettings();
  renderAIProvidersList();
  syncAIProvider();
  populateAIProviderSelect();
  openModal('settings');
  loadTelegramSettings();
  if ((tab || 'ai') === 'vault') loadVaultSettings();
}

function saveAISettings() {
  const provider = els.settingsAiProvider ? els.settingsAiProvider.value : state.aiProvider;
  if (!getAIProviderById(provider)) { toast('Unknown AI provider', 'error'); return; }
  const model = els.settingsAiModel.value.trim();
  const prompts = els.settingsAiPrompts.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  state.aiProvider = provider;
  state.aiModels = state.aiModels || {};
  state.aiModels[provider] = model;
  state.aiPrompts = Array.from(new Set(prompts));
  syncAIProvider();
  renderAIPrompts();
  savePreferences();
  toast('AI settings saved', 'success');
}

async function saveTelegramSettings() {
  const botToken = els.settingsTelegramToken.value.trim();
  const chatId = els.settingsTelegramChat.value.trim();
  settingsTelegramStatus('Saving…', 'busy');
  try {
    const res = await window.inkwell.saveTelegramConfig({ botToken, chatId });
    if (res && res.success) {
      settingsTelegramStatus(botToken ? 'Telegram settings saved.' : 'Telegram settings cleared.', 'ok');
      toast('Telegram settings saved', 'success');
      await loadTelegramSettings();
    } else {
      settingsTelegramStatus((res && res.error) || 'Could not save Telegram settings.', 'err');
    }
  } catch (_) {
    settingsTelegramStatus('Could not save Telegram settings.', 'err');
  }
}

async function testTelegram() {
  settingsTelegramStatus('Sending test message…', 'busy');
  try {
    const res = await window.inkwell.testTelegram({
      botToken: els.settingsTelegramToken.value.trim(),
      chatId: els.settingsTelegramChat.value.trim(),
    });
    if (res && res.success) {
      settingsTelegramStatus('Test message sent. Check Telegram.', 'ok');
    } else {
      settingsTelegramStatus((res && res.error) || 'Test failed.', 'err');
    }
  } catch (_) {
    settingsTelegramStatus('Test failed.', 'err');
  }
}

function setupSettings() {
  if (!els.settingsBtn) return;
  els.settingsBtn.addEventListener('click', () => openSettings('ai'));
  document.querySelectorAll('.settings-tab').forEach((btn) => {
    btn.addEventListener('click', () => setSettingsTab(btn.dataset.settingsTab));
  });
  if (els.settingsAiProvider) {
  els.settingsAiProvider.addEventListener('change', () => {
    const provider = els.settingsAiProvider.value;
    els.settingsAiModel.value = (state.aiModels || {})[provider] || AI_DEFAULT_MODELS[provider] || '';
  });
  }
  if (els.settingsAiSave) els.settingsAiSave.addEventListener('click', saveAISettings);
  if (els.settingsVaultChoose) {
    els.settingsVaultChoose.addEventListener('click', async () => {
      try {
        const res = await window.inkwell.chooseNotesDir();
        if (res && res.success && res.path) {
          pendingVaultPath = res.path;
          if (els.settingsVaultPath) els.settingsVaultPath.value = res.path;
          vaultStatus('Folder selected. Click Save to apply.', 'ok');
        } else if (res && res.canceled) {
          vaultStatus('Selection canceled.', '');
        } else {
          vaultStatus((res && res.error) || 'Could not choose folder.', 'err');
        }
      } catch (e) {
        vaultStatus('Could not choose folder.', 'err');
      }
    });
  }
  if (els.settingsVaultSave) {
    els.settingsVaultSave.addEventListener('click', async () => {
      try {
        const target = pendingVaultPath || (els.settingsVaultPath ? els.settingsVaultPath.value : '');
        if (!target) { vaultStatus('No folder selected.', 'err'); return; }
        const res = await window.inkwell.setNotesDir(target);
        if (res && res.success) {
          pendingVaultPath = res.path;
          vaultStatus('Vault updated. Reloading files…', 'ok');
          await refreshFiles();
          await updateVaultDisplay(res.path);
          toast('Vault updated', 'success');
        } else {
          vaultStatus((res && res.error) || 'Could not update vault.', 'err');
        }
      } catch (e) {
        vaultStatus('Could not update vault.', 'err');
      }
    });
  }
  if (els.aiProviderAdd) {
    els.aiProviderAdd.addEventListener('click', () => {
      const id = prompt('Provider ID (short, no spaces)');
      if (!id) return;
      const name = prompt('Display name') || id;
      const command = prompt('Command (e.g. gemini, aichat)') || id;
      const type = prompt('Type (claude/codex/opencode/generic)', 'generic') || 'generic';
      if (!id.trim() || !command.trim()) { toast('ID and command required', 'error'); return; }
      const cleanId = id.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      state.aiProviders = Array.isArray(state.aiProviders) ? state.aiProviders : [];
      if (state.aiProviders.some((p) => p.id === cleanId)) { toast('Provider ID already exists', 'error'); return; }
      state.aiProviders.push({ id: cleanId, name: name.trim(), command: command.trim(), type: type.trim() || 'generic' });
      savePreferences();
      populateAISettings();
      renderAIProvidersList();
      syncAIProvider();
      populateAIProviderSelect();
      state.aiProvider = cleanId;
      syncAIProvider();
      savePreferences();
      toast('Provider added', 'success');
    });
  }
  els.settingsTelegramSave.addEventListener('click', saveTelegramSettings);
  els.settingsTelegramTest.addEventListener('click', testTelegram);
}

/* ============ ASK AI ============ */
const DEFAULT_AI_PROVIDERS_LIST = [
  { id: 'claude', name: 'Claude', command: 'claude', type: 'claude' },
  { id: 'codex', name: 'Codex', command: 'codex', type: 'codex' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', type: 'opencode' },
];

function getAIProviders() {
  const custom = Array.isArray(state.aiProviders) ? state.aiProviders.filter((p) => p && p.id && p.name && p.command) : [];
  const base = DEFAULT_AI_PROVIDERS_LIST.map((p) => ({ ...p }));
  const merged = [];
  for (const c of custom) {
    if (!merged.some((m) => m.id === c.id)) merged.push(c);
  }
  for (const b of base) {
    if (!merged.some((m) => m.id === b.id)) merged.push(b);
  }
  if (merged.length) return merged;
  return base;
}

function getAIProviderById(id) {
  const all = getAIProviders();
  const found = all.find((p) => p.id === id);
  if (found) return found;
  // also check stored custom
  const custom = Array.isArray(state.aiProviders) ? state.aiProviders.find((p) => p && p.id === id) : null;
  return custom || null;
}

function getAIProviderIds() {
  return getAIProviders().map((p) => p.id);
}

const AI_PROVIDER_IDS = ['claude', 'codex', 'opencode']; // keep for compatibility
const AI_DEFAULT_MODELS = { claude: 'claude/claude-haiku-5-5', codex: '', opencode: '' };

let aiContext = { text: '', start: null, end: null };
let aiAnswer = '';
let aiBusy = false;
let aiAnswerKind = 'answer';
let pendingAIEdit = null;
const AI_EDIT_DELETE_TOKEN = '__INKWELL_DELETE_SELECTED_TEXT__';
let answerDocReopenPanel = false;
let aiOpenAnswerWhenDone = false;

function showAIFloat(x, y, ctx) {
  const textChanged = ctx.text !== aiContext.text;
  aiContext = { text: ctx.text, start: ctx.start == null ? null : ctx.start, end: ctx.end == null ? null : ctx.end };
  if (els.aiContextLabel) els.aiContextLabel.textContent = 'Selected text';
  if (textChanged && !aiBusy) resetAIAnswer(true);
  hideCommentComposer();
  const btn = els.selFloat;
  btn.classList.remove('hidden');
  btn.style.visibility = 'hidden';
  btn.style.left = '0px';
  btn.style.top = '0px';
  const w = btn.offsetWidth || 160;
  const h = btn.offsetHeight || 30;
  btn.style.visibility = '';
  const px = Math.max(8, Math.min(x + 6, window.innerWidth - w - 8));
  const py = Math.max(8, Math.min(y + 10, window.innerHeight - h - 8));
  btn.style.left = px + 'px';
  btn.style.top = py + 'px';
  btn.dataset.anchorX = String(px);
  btn.dataset.anchorY = String(py);
}

function hideAIFloat() {
  els.selFloat.classList.add('hidden');
}

function openAIPanel(mode = 'selection') {
  if (mode === 'general') {
    aiContext = { text: '', start: null, end: null };
  } else {
    const s = els.editor.selectionStart;
    const e = els.editor.selectionEnd;
    if (e > s) aiContext = { text: els.editor.value.slice(s, e), start: s, end: e };
    else if (mode === 'code') {
      toast('Select some code first', 'info');
      return;
    }
    if (!aiContext.text || !aiContext.text.trim()) {
      toast('Select some text first', 'info');
      return;
    }
  }
  if (els.aiPanelTitle) {
    els.aiPanelTitle.textContent = mode === 'code' ? 'Ask AI about code' : mode === 'general' ? 'Ask AI' : 'Ask AI about selection';
  }
  els.aiQuestion.placeholder = mode === 'code'
    ? 'Ask something about the selected code…'
    : mode === 'general' ? 'Ask anything…' : 'Ask something about the selected text…';
  els.aiContextBody.textContent = aiContext.text;
  els.aiContextBody.classList.toggle('hidden', !aiContext.text);
  if (els.aiContextLabel) {
    els.aiContextLabel.textContent = mode === 'code' ? 'Selected code' : mode === 'general' ? 'No context' : 'Selected text';
  }
  els.aiReplaceBtn.classList.toggle('hidden', aiContext.start == null);
  els.aiPanel.classList.remove('hidden');
  closeCommentsPanel();
  hideAIFloat();
  aiAnswerKind = 'answer';
  aiOpenAnswerWhenDone = false;
  resetAIAnswer(true);
  applyAIDirection();
  positionAIPanel();
  els.aiQuestion.focus();
}

function closeAIPanel() {
  els.aiPanel.classList.add('hidden');
  if (aiBusy) {
    window.inkwell.cancelAI();
    setAIBusy(false);
  }
}

function applyAIDock() {
  const p = els.aiPanel;
  p.classList.toggle('dock-left', state.aiDock === 'left');
  p.classList.toggle('dock-right', state.aiDock === 'right');
  p.classList.toggle('dock-bottom', state.aiDock === 'bottom');
  if (els.aiDock) {
    els.aiDock.querySelectorAll('.ai-dock-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.dock === state.aiDock);
    });
  }
}

function positionAIPanel() {
  const p = els.aiPanel;
  if (p.classList.contains('hidden')) return;
  applyAIDock();
  const area = els.editorArea.getBoundingClientRect();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  if (state.aiDock === 'bottom') {
    const h = clamp(state.aiDockH, 160, Math.max(200, area.height - 100));
    p.style.top = 'auto';
    p.style.bottom = (window.innerHeight - area.bottom) + 'px';
    p.style.left = area.left + 'px';
    p.style.right = 'auto';
    p.style.width = area.width + 'px';
    p.style.height = h + 'px';
  } else {
    const w = clamp(state.aiDockW, 300, Math.max(340, area.width - 120));
    p.style.top = area.top + 'px';
    p.style.bottom = 'auto';
    p.style.height = area.height + 'px';
    p.style.width = w + 'px';
    if (state.aiDock === 'left') {
      p.style.left = area.left + 'px';
      p.style.right = 'auto';
    } else {
      p.style.right = (window.innerWidth - area.right) + 'px';
      p.style.left = 'auto';
    }
  }
}

function setupAIResizer() {
  const grip = els.aiResizer;
  if (!grip) return;
  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    const area = els.editorArea.getBoundingClientRect();
    if (state.aiDock === 'bottom') {
      state.aiDockH = Math.max(160, Math.min(area.height - 100, e.clientY - area.top));
    } else if (state.aiDock === 'left') {
      state.aiDockW = Math.max(300, Math.min(area.width - 120, e.clientX - area.left));
    } else {
      state.aiDockW = Math.max(300, Math.min(area.width - 120, area.right - e.clientX));
    }
    positionAIPanel();
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    savePreferences();
  };

  grip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = state.aiDock === 'bottom' ? 'row-resize' : 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function applyAIDirection() {
  const ans = els.aiAnswer;
  if (aiAnswer && aiAnswer.trim()) {
    ans.setAttribute('dir', detectDirectionMajority(aiAnswer));
    ans.querySelectorAll(BIDI_BLOCK_SEL).forEach((el) => {
      el.setAttribute('dir', hasRtlChar(el.textContent) ? 'rtl' : 'ltr');
    });
  } else {
    ans.removeAttribute('dir');
    ans.querySelectorAll(BIDI_BLOCK_SEL).forEach((el) => el.removeAttribute('dir'));
  }
  const ctx = els.aiContextBody;
  if (ctx) {
    if (aiContext.text && aiContext.text.trim()) ctx.setAttribute('dir', detectDirection(aiContext.text));
    else ctx.removeAttribute('dir');
  }
}

function resetAIAnswer(clearQuestion = false) {
  aiAnswer = '';
  pendingAIEdit = null;
  els.aiAnswer.className = 'ai-answer empty';
  els.aiAnswer.removeAttribute('dir');
  els.aiAnswer.textContent = 'Select some text, then ask a question.';
  els.aiAnswerActions.classList.add('hidden');
  if (els.aiReviewChangeBtn) els.aiReviewChangeBtn.classList.add('hidden');
  els.aiAnswerActions.querySelectorAll('.ai-answer-standard-action').forEach((button) => button.classList.remove('hidden'));
  if (els.aiAnswerMeta) els.aiAnswerMeta.textContent = 'Ready';
  if (els.aiAnswerBadge) els.aiAnswerBadge.textContent = providerLabel(els.aiProvider.value);
  if (clearQuestion) els.aiQuestion.value = '';
}

function providerLabel(id) {
  const p = getAIProviderById(id);
  if (p && p.name) return p.name;
  if (id === 'claude') return 'Claude';
  if (id === 'codex') return 'Codex';
  if (id === 'opencode') return 'OpenCode';
  return id || 'AI';
}

function renderAIPrompts() {
  const wrap = els.aiPrompts;
  if (!wrap) return;
  wrap.innerHTML = '';
  const prompts = state.aiPrompts || [];

  prompts.forEach((text, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ai-chip';
    chip.title = text;
    const label = document.createElement('span');
    label.className = 'ai-chip-label';
    label.textContent = text;
    const x = document.createElement('span');
    x.className = 'ai-chip-x';
    x.textContent = '\u00d7';
    x.title = 'Remove prompt';
    chip.appendChild(label);
    chip.appendChild(x);
    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('ai-chip-x')) {
        state.aiPrompts.splice(i, 1);
        savePreferences();
        renderAIPrompts();
        return;
      }
      els.aiQuestion.value = text;
      els.aiQuestion.focus();
      askAI();
    });
    wrap.appendChild(chip);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ai-chip ai-chip-add';
  add.textContent = '+ Save prompt';
  add.title = 'Save the current question as a reusable prompt';
  add.addEventListener('click', () => {
    const q = els.aiQuestion.value.trim();
    if (!q) { toast('Type a question to save it', 'info'); return; }
    state.aiPrompts = state.aiPrompts || [];
    if (state.aiPrompts.includes(q)) { toast('Prompt already saved', 'info'); return; }
    state.aiPrompts.push(q);
    savePreferences();
    renderAIPrompts();
    toast('Prompt saved', 'success');
  });
  wrap.appendChild(add);
}

function populateAIProviderSelect() {
  if (!els.aiProvider) return;
  const providers = getAIProviders();
  els.aiProvider.innerHTML = '';
  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    els.aiProvider.appendChild(opt);
  }
}

function syncAIProvider() {
  populateAIProviderSelect();
  const providers = getAIProviders();
  const p = providers.some((x) => x.id === state.aiProvider) ? state.aiProvider : (providers[0] ? providers[0].id : 'claude');
  state.aiProvider = p;
  if (els.aiProvider) els.aiProvider.value = p;
  const models = state.aiModels || {};
  const saved = typeof models[p] === 'string' ? models[p].trim() : '';
  if (els.aiModel) {
    els.aiModel.value = saved || AI_DEFAULT_MODELS[p] || '';
    els.aiModel.placeholder = AI_DEFAULT_MODELS[p] ? 'model: ' + AI_DEFAULT_MODELS[p] : 'model (optional)';
  }
}

function setAIBusy(busy) {
  aiBusy = busy;
  els.aiAskBtn.classList.toggle('hidden', busy);
  if (els.aiSuggestChangeBtn) els.aiSuggestChangeBtn.classList.toggle('hidden', busy);
  els.aiStopBtn.classList.toggle('hidden', !busy);
}

const AI_MAX_SELECTION = 12000;

const AI_DOC_PROMPTS = {
  summary: 'Summarize the whole document. Write a clear, well-structured Markdown summary.',
  explain: 'Explain the whole document in simple, plain language that a beginner can easily understand.',
  translate: 'Translate the whole document to English while preserving the Markdown structure, headings, lists, code blocks and links. Output only the translated Markdown.',
  notes: 'Extract the important notes and key takeaways from the whole document and write them as a Markdown bullet list.',
};

function askAboutDocument(promptText, kind) {
  if (!state.currentFile) { toast('Open a document first', 'info'); return; }
  const text = els.editor.value || '';
  if (!text.trim()) { toast('This document is empty', 'info'); return; }

  aiContext = { text, start: null, end: null, doc: true };
  if (els.aiPanelTitle) els.aiPanelTitle.textContent = 'Ask AI about document';
  els.aiQuestion.placeholder = 'Ask something about this document…';
  aiAnswerKind = kind || 'answer';
  els.aiContextLabel.textContent = 'Whole document';
  els.aiContextBody.textContent = text.length > 800 ? text.slice(0, 800) + '\n…' : text;
  els.aiContextBody.classList.remove('hidden');
  els.aiReplaceBtn.classList.add('hidden');
  els.aiPanel.classList.remove('hidden');
  hideAIFloat();
  resetAIAnswer();
  applyAIDirection();
  positionAIPanel();
  els.aiQuestion.value = promptText;
  const overridePrompt = [
    promptText,
    '',
    '--- DOCUMENT ---',
    text,
    '--- END DOCUMENT ---',
  ].join('\n');
  askAI(overridePrompt);
}

function updateDocAiBar() {
  if (!els.docActions) return;
  els.docActions.classList.toggle('hidden', !state.currentFile);
}

function setupDocAiBar() {
  if (!els.docActions) return;
  els.docActions.addEventListener('click', (e) => {
    const btn = e.target.closest('.doc-act');
    if (!btn) return;
    const prompt = AI_DOC_PROMPTS[btn.dataset.doc];
    if (prompt) askAboutDocument(prompt, btn.dataset.doc);
  });
}

/* ---- Explain code ---- */
function buildCodeExplainPrompt(code, lang) {
  const lines = [];
  lines.push('You are a programming teacher.');
  lines.push('Explain the following' + (lang ? ' ' + lang : '') + ' code in simple, easy-to-understand Persian (\u0641\u0627\u0631\u0633\u06cc).');
  lines.push('');
  lines.push('- First, in one or two short sentences, say what the code does as a whole.');
  lines.push('- Then explain it line by line: for each line, show the line and say in simple Persian what it does.');
  lines.push('- Write plainly and keep it simple \u2014 no jargon dumps.');
  lines.push('- Keep all code, identifiers and keywords in their original form.');
  lines.push('Reply with Markdown only \u2014 no preamble.');
  lines.push('');
  lines.push('--- CODE ---');
  lines.push(code);
  lines.push('--- END CODE ---');
  return lines.join('\n');
}

function openExplainCodeDialog() {
  if (!els.explainCodeInput) return;
  const s = els.editor.selectionStart;
  const e = els.editor.selectionEnd;
  const sel = (state.currentFile && e > s) ? els.editor.value.slice(s, e).trim() : '';
  els.explainCodeInput.value = sel;
  if (els.explainLang) els.explainLang.value = '';
  openModal('explainCode');
  setTimeout(() => {
    if (!els.explainCodeInput) return;
    els.explainCodeInput.focus();
    const len = els.explainCodeInput.value.length;
    els.explainCodeInput.setSelectionRange(len, len);
  }, 40);
}

function submitExplainCode() {
  let code = (els.explainCodeInput.value || '').trim();
  if (!code) { toast('Paste some code first', 'info'); els.explainCodeInput.focus(); return; }
  const lang = (els.explainLang.value || '').trim();
  if (code.length > AI_MAX_SELECTION) code = code.slice(0, AI_MAX_SELECTION);
  closeModal('explainCode');
  aiContext = { text: code, start: null, end: null, doc: false };
  if (els.aiPanelTitle) els.aiPanelTitle.textContent = 'Explain code';
  els.aiQuestion.placeholder = 'Ask something about the code…';
  aiAnswerKind = 'code';
  els.aiContextLabel.textContent = lang ? 'Code (' + lang + ')' : 'Code';
  els.aiContextBody.textContent = code.length > 800 ? code.slice(0, 800) + '\n…' : code;
  els.aiContextBody.classList.remove('hidden');
  els.aiReplaceBtn.classList.add('hidden');
  els.aiPanel.classList.remove('hidden');
  hideAIFloat();
  resetAIAnswer();
  applyAIDirection();
  positionAIPanel();
  els.aiQuestion.value = '';
  aiOpenAnswerWhenDone = true;
  askAI(buildCodeExplainPrompt(code, lang));
}

function buildAIPrompt(question, selection) {
  const lines = [];
  lines.push('You are a helpful assistant embedded in a Markdown note editor.');
  lines.push('Answer the user request about the selected text. Reply with Markdown only — no preamble.');
  if (selection && selection.trim()) {
    let sel = selection.trim();
    let truncated = false;
    if (sel.length > AI_MAX_SELECTION) { sel = sel.slice(0, AI_MAX_SELECTION); truncated = true; }
    lines.push('');
    lines.push('--- SELECTED TEXT ---');
    lines.push(sel + (truncated ? '\n…[truncated]' : ''));
    lines.push('--- END SELECTED TEXT ---');
  }
  lines.push('');
  lines.push('User request: ' + (question.trim() || 'Explain, summarize, or improve the selected text.'));
  return lines.join('\n');
}

function buildAIEditPrompt(request, instruction) {
  const maxContext = 24000;
  const margin = Math.floor((maxContext - request.target.length) / 2);
  const contextStart = Math.max(0, request.start - margin);
  const contextEnd = Math.min(request.originalContent.length, request.end + margin);
  const prefix = contextStart > 0 ? '...[earlier document text omitted]...\n' : '';
  const suffix = contextEnd < request.originalContent.length ? '\n...[later document text omitted]...' : '';
  const markedContext = request.insertion
    ? request.originalContent.slice(contextStart, request.start) + '[[INSERT HERE]]' + request.originalContent.slice(request.start, contextEnd)
    : request.originalContent.slice(contextStart, request.start) + '[[TARGET START]]' + request.target + '[[TARGET END]]' + request.originalContent.slice(request.end, contextEnd);

  return [
    'You are editing a Markdown document. Follow the user instruction and return ONLY the exact Markdown text that should replace the marked target. Do not explain the change, add a preamble, or wrap the result in a code fence.',
    'Text outside the marked target must remain unchanged.',
    request.insertion
      ? `The marker [[INSERT HERE]] is a cursor position. Return only text to insert at that point. If no text should be inserted, return exactly ${AI_EDIT_DELETE_TOKEN}.`
      : `The text between [[TARGET START]] and [[TARGET END]] is the selected passage. Return its replacement. If the passage should be removed, return exactly ${AI_EDIT_DELETE_TOKEN}.`,
    '',
    'User instruction:',
    instruction.trim(),
    '',
    'Document context (may be partial):',
    prefix + markedContext + suffix,
  ].join('\n');
}

function suggestDocumentChange() {
  if (!state.currentFile) { toast('Open a document first', 'info'); return; }
  const instruction = els.aiQuestion.value.trim();
  if (!instruction) { toast('Describe the change you want first', 'info'); els.aiQuestion.focus(); return; }

  const originalContent = els.editor.value;
  const start = Math.min(els.editor.selectionStart, els.editor.selectionEnd);
  const end = Math.max(els.editor.selectionStart, els.editor.selectionEnd);
  const target = originalContent.slice(start, end);
  if (target.length > AI_MAX_SELECTION) {
    toast('Select a smaller passage (up to 12,000 characters)', 'info');
    return;
  }
  const editRequest = {
    filePath: state.currentFile,
    originalContent,
    start,
    end,
    target,
    insertion: start === end,
  };
  askAI(buildAIEditPrompt(editRequest, instruction), { editRequest });
}

async function askAI(overridePrompt, options = {}) {
  if (aiBusy) return;
  pendingAIEdit = null;
  if (els.aiReviewChangeBtn) els.aiReviewChangeBtn.classList.add('hidden');
  els.aiAnswerActions.querySelectorAll('.ai-answer-standard-action').forEach((button) => button.classList.remove('hidden'));
  const question = els.aiQuestion.value;
  const provider = els.aiProvider ? els.aiProvider.value : state.aiProvider;
  if (!getAIProviderById(provider)) {
    toast('Select a valid AI provider', 'error');
    return;
  }
  const model = els.aiModel ? (els.aiModel.value.trim() || AI_DEFAULT_MODELS[provider] || '') : (state.aiModels && state.aiModels[provider]) || AI_DEFAULT_MODELS[provider] || '';
  if (!overridePrompt && !question.trim() && !(aiContext.text && aiContext.text.trim())) {
    toast('Type a question first', 'info');
    return;
  }
  state.aiProvider = provider;
  state.aiModels = state.aiModels || {};
  state.aiModels[provider] = model;
  if (els.aiProvider) els.aiProvider.value = provider;
  if (els.aiModel) els.aiModel.value = model;
  savePreferences();

  setAIBusy(true);
  els.aiAnswer.className = 'ai-answer';
  els.aiAnswer.removeAttribute('dir');
  els.aiAnswer.innerHTML = '<span class="ai-spinner"></span>Thinking…';
  els.aiAnswerActions.classList.add('hidden');
  if (els.aiAnswerBadge) els.aiAnswerBadge.textContent = providerLabel(provider);
  if (els.aiAnswerMeta) els.aiAnswerMeta.textContent = 'Thinking…';

  const prompt = overridePrompt || buildAIPrompt(question, aiContext.text);
  let res;
  try {
    const provCfg = getAIProviderById(provider);
    res = await window.inkwell.askAI({ provider, prompt, model, providerConfig: provCfg });
  } catch (err) {
    res = { ok: false, error: err && err.message ? err.message : String(err) };
  }

  if (res && res.ok) {
    const responseText = String(res.text || '');
    aiAnswer = options.editRequest && responseText.trim() === AI_EDIT_DELETE_TOKEN ? '' : responseText;
    pendingAIEdit = options.editRequest ? { ...options.editRequest, replacement: aiAnswer } : null;
    els.aiAnswer.className = aiAnswer ? 'ai-answer markdown-body' : 'ai-answer empty';
    els.aiAnswer.innerHTML = aiAnswer
      ? md.render(aiAnswer)
      : pendingAIEdit && pendingAIEdit.target
        ? 'The AI proposed removing the selected text.'
        : pendingAIEdit ? 'The AI proposed an empty insertion.' : '(empty response)';
    els.aiAnswerActions.classList.remove('hidden');
    if (pendingAIEdit) {
      els.aiAnswerActions.querySelectorAll('.ai-answer-standard-action').forEach((button) => button.classList.add('hidden'));
      els.aiReviewChangeBtn.classList.remove('hidden');
    }
    if (els.aiAnswerMeta) els.aiAnswerMeta.textContent = 'Done';
    applyAIDirection();
    if (aiOpenAnswerWhenDone && aiAnswer && aiAnswer.trim()) {
      aiOpenAnswerWhenDone = false;
      openAnswerDoc();
    }
  } else {
    aiAnswer = '';
    pendingAIEdit = null;
    aiOpenAnswerWhenDone = false;
    els.aiAnswer.className = 'ai-answer error';
    els.aiAnswer.removeAttribute('dir');
    els.aiAnswer.textContent = (res && res.error) || 'Request failed';
    if (els.aiAnswerMeta) els.aiAnswerMeta.textContent = 'Error';
  }
  setAIBusy(false);
}

function openAIEditReview() {
  if (!pendingAIEdit) return;
  const edit = pendingAIEdit;
  const startLine = edit.originalContent.slice(0, edit.start).split('\n').length;
  const endLine = edit.originalContent.slice(0, edit.end).split('\n').length;
  els.aiEditReviewLocation.textContent = `${edit.filePath} · ${edit.insertion ? `Insert at line ${startLine}` : startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`}`;
  els.aiEditReviewBefore.textContent = edit.insertion ? '(Insertion point — no text will be removed.)' : (edit.target || '(Empty selection)');
  els.aiEditReviewAfter.textContent = edit.replacement || (edit.target ? '(Remove the selected text)' : '(No text to insert)');
  openModal('aiEditReview');
}

async function acceptAIEdit() {
  const edit = pendingAIEdit;
  if (!edit) return;
  if (state.currentFile !== edit.filePath || els.editor.value !== edit.originalContent) {
    toast('The document changed after this suggestion. Generate a fresh suggestion before accepting.', 'error', 4500);
    closeModal('aiEditReview');
    pendingAIEdit = null;
    els.aiAnswerActions.classList.add('hidden');
    return;
  }

  clearTimeout(autosaveTimer);
  if (edit.replacement) {
    replaceRange(edit.start, edit.end, edit.replacement, edit.start + edit.replacement.length, edit.start + edit.replacement.length);
  } else {
    els.editor.focus();
    els.editor.setRangeText('', edit.start, edit.end, 'start');
    els.editor.setSelectionRange(edit.start, edit.start);
    onEditorChanged();
  }
  clearTimeout(autosaveTimer);
  closeModal('aiEditReview');
  pendingAIEdit = null;
  els.aiAnswerActions.classList.add('hidden');
  const saved = await saveFile(true);
  toast(saved ? 'Document change accepted' : 'Change applied in the editor, but saving failed', saved ? 'success' : 'error', 3500);
}

function rejectAIEdit() {
  closeModal('aiEditReview');
  pendingAIEdit = null;
  els.aiAnswerActions.classList.add('hidden');
  toast('Document change rejected', 'info');
}

function insertAIAnswer() {
  if (!aiAnswer) return;
  replaceRange(els.editor.selectionStart, els.editor.selectionEnd, aiAnswer);
  els.editor.focus();
}

function replaceAISelection() {
  if (!aiAnswer) return;
  if (aiContext.start == null) return insertAIAnswer();
  replaceRange(aiContext.start, aiContext.end, aiAnswer);
  els.editor.focus();
  hideAIFloat();
}

async function copyAIAnswer() {
  if (!aiAnswer) return;
  try {
    await navigator.clipboard.writeText(aiAnswer);
    toast('Copied', 'success');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = aiAnswer;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Copied', 'success'); } catch (_) {}
    ta.remove();
  }
}

/* ============ AI ANSWER AS PAGE ============ */
const AI_KIND_LABEL = {
  summary: 'Summary',
  explain: 'Explanation',
  translate: 'Translation',
  notes: 'Important notes',
  answer: 'Answer',
  code: 'Code explanation',
};

function aiAnswerTitle() {
  const label = AI_KIND_LABEL[aiAnswerKind] || 'Answer';
  const doc = state.currentFile ? state.currentFile.replace(/\.md$/i, '').split('/').pop() : '';
  return doc ? `${label} \u2014 ${doc}` : label;
}

function openAnswerDoc() {
  if (!aiAnswer || !aiAnswer.trim()) { toast('No answer to show yet', 'info'); return; }
  answerDocReopenPanel = els.aiPanel && !els.aiPanel.classList.contains('hidden');
  els.answerDocContent.innerHTML = md.render(aiAnswer);
  els.answerDocContent.setAttribute('dir', detectDirectionMajority(aiAnswer));
  els.answerDocContent.querySelectorAll(BIDI_BLOCK_SEL).forEach((el) => {
    el.setAttribute('dir', hasRtlChar(el.textContent) ? 'rtl' : 'ltr');
  });
  if (els.answerDocSub) els.answerDocSub.textContent = aiAnswerTitle();
  els.answerDocView.classList.remove('hidden');
  els.answerDocView.scrollTop = 0;
  els.answerDocContent.parentElement.scrollTop = 0;
  closeAIPanel();
}

function closeAnswerDoc() {
  els.answerDocView.classList.add('hidden');
}

function backFromAnswerDoc() {
  closeAnswerDoc();
  if (answerDocReopenPanel && els.aiPanel) {
    answerDocReopenPanel = false;
    els.aiPanel.classList.remove('hidden');
    applyAIDirection();
    positionAIPanel();
    if (els.aiQuestion) els.aiQuestion.focus();
  }
}

function saveAIAnswerAsFile() {
  if (!aiAnswer || !aiAnswer.trim()) { toast('No answer to save', 'info'); return; }
  const folder = state.currentFile && state.currentFile.includes('/')
    ? state.currentFile.slice(0, state.currentFile.lastIndexOf('/')) : '';
  state.saveAnswerFolder = folder;
  const base = state.currentFile ? state.currentFile.replace(/\.md$/i, '').split('/').pop() : 'document';
  const kind = (AI_KIND_LABEL[aiAnswerKind] || 'Answer').toLowerCase().replace(/\s+/g, '-');
  els.saveAnswerLocation.textContent = folder || 'Library';
  els.saveAnswerName.value = `${base} ${kind}`;
  openModal('saveAnswer');
  setTimeout(() => { els.saveAnswerName.focus(); els.saveAnswerName.select(); }, 50);
}

async function createAnswerFile() {
  let name = sanitizeName(els.saveAnswerName.value.trim());
  if (!name) { toast('Please enter a valid file name', 'error'); return; }
  if (!name.toLowerCase().endsWith('.md')) name += '.md';

  const folder = state.saveAnswerFolder || '';
  let fullPath = joinPath(folder, name);
  let n = 2;
  while (state.files.some((f) => f.path.toLowerCase() === fullPath.toLowerCase())) {
    const stem = name.replace(/\.md$/i, '');
    fullPath = joinPath(folder, `${stem}-${n}.md`);
    n++;
  }

  try {
    const created = await window.inkwell.createFile(fullPath);
    if (!created.success) { toast('Could not create file: ' + created.error, 'error'); return; }
    const written = await window.inkwell.writeFile(fullPath, aiAnswer);
    if (!written.success) { toast('Could not write file: ' + written.error, 'error'); return; }
    closeModal('saveAnswer');
    if (folder) state.expandedFolders.add(folder);
    await refreshFiles();
    toast('Saved to ' + fullPath, 'success');
    await selectFile(fullPath);
    answerDocReopenPanel = false;
    closeAnswerDoc();
  } catch (e) {
    toast('Could not save file', 'error');
  }
}

function insertAIAnswerIntoDoc() {
  if (!aiAnswer) return;
  answerDocReopenPanel = false;
  closeAnswerDoc();
  els.editor.focus();
  insertAIAnswer();
  toast('Inserted into document', 'success');
}

function setupAI() {
  if (!els.aiPanel) return;
  syncAIProvider();
  renderAIPrompts();

  if (els.aiToolbarBtn) els.aiToolbarBtn.addEventListener('click', () => openAIPanel('selection'));
  if (els.aiHeaderSelectionBtn) els.aiHeaderSelectionBtn.addEventListener('click', () => openAIPanel('general'));
  if (els.askCodeHeaderBtn) els.askCodeHeaderBtn.addEventListener('click', () => openAIPanel('code'));
  els.aiFloatBtn.addEventListener('mousedown', (e) => e.preventDefault());
  els.aiFloatBtn.addEventListener('click', openAIPanel);
  els.cmtFloatBtn.addEventListener('mousedown', (e) => e.preventDefault());
  els.cmtFloatBtn.addEventListener('click', () => {
    if (!state.currentFile) { toast('Open a document first', 'info'); return; }
    if (!aiContext.text || !aiContext.text.trim()) { toast('Select some text first', 'info'); return; }
    const x = parseFloat(els.selFloat.dataset.anchorX || '0');
    const y = parseFloat(els.selFloat.dataset.anchorY || '0');
    openCommentComposer({ quote: aiContext.text, start: aiContext.start, end: aiContext.end }, x, y);
  });
  els.aiClose.addEventListener('click', closeAIPanel);
  els.aiAskBtn.addEventListener('click', () => askAI());
  if (els.aiSuggestChangeBtn) els.aiSuggestChangeBtn.addEventListener('click', suggestDocumentChange);
  if (els.aiReviewChangeBtn) els.aiReviewChangeBtn.addEventListener('click', openAIEditReview);
  if (els.aiEditAcceptBtn) els.aiEditAcceptBtn.addEventListener('click', acceptAIEdit);
  if (els.aiEditRejectBtn) els.aiEditRejectBtn.addEventListener('click', rejectAIEdit);
  els.aiStopBtn.addEventListener('click', () => { window.inkwell.cancelAI(); setAIBusy(false); });
  if (els.aiProvider) {
  els.aiProvider.addEventListener('change', () => {
    const p = els.aiProvider.value;
    if (!getAIProviderById(p)) return;
    state.aiProvider = p;
    syncAIProvider();
    savePreferences();
  });
  }
  if (els.aiModel && els.aiProvider) {
  els.aiModel.addEventListener('change', () => {
    state.aiModels = state.aiModels || {};
    const p = els.aiProvider.value;
    if (!getAIProviderById(p)) return;
    state.aiModels[p] = els.aiModel.value.trim();
    savePreferences();
  });
  }
  els.aiQuestion.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); askAI(); }
  });
  els.aiContextToggle.addEventListener('click', () => {
    els.aiContextBody.classList.toggle('hidden');
  });
  els.aiAnswerActions.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ai]');
    if (!btn) return;
    if (btn.dataset.ai === 'insert') insertAIAnswer();
    else if (btn.dataset.ai === 'replace') replaceAISelection();
    else if (btn.dataset.ai === 'copy') copyAIAnswer();
    else if (btn.dataset.ai === 'page') openAnswerDoc();
    else if (btn.dataset.ai === 'save') saveAIAnswerAsFile();
  });

  if (els.explainCodeToolbarBtn) els.explainCodeToolbarBtn.addEventListener('click', openExplainCodeDialog);
  if (els.explainCodeSubmit) els.explainCodeSubmit.addEventListener('click', submitExplainCode);
  if (els.explainCodeInput) {
    els.explainCodeInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitExplainCode(); }
    });
  }

  if (els.answerDocView) {
    els.answerDocBack.addEventListener('click', backFromAnswerDoc);
    els.answerDocCopy.addEventListener('click', async () => { await copyAIAnswer(); });
    els.answerDocInsert.addEventListener('click', insertAIAnswerIntoDoc);
    els.answerDocSave.addEventListener('click', saveAIAnswerAsFile);
  }

  if (els.aiDock) {
    els.aiDock.addEventListener('click', (e) => {
      const btn = e.target.closest('.ai-dock-btn');
      if (!btn) return;
      state.aiDock = btn.dataset.dock;
      savePreferences();
      positionAIPanel();
    });
  }
  setupAIResizer();
  window.addEventListener('resize', () => positionAIPanel());

  document.addEventListener('mousedown', (e) => {
    if (els.selFloat.classList.contains('hidden')) return;
    if (els.selFloat.contains(e.target) || e.target === els.editor) return;
    hideAIFloat();
  });
}

/* ============ CONTEXT MENU ============ */
function showContextMenu(x, y) {
  const menu = els.contextMenu;
  const isFolder = state.contextIsFolder;
  $('ctxNewFileHere').classList.toggle('hidden', !isFolder);
  $('ctxNewFolderHere').classList.toggle('hidden', !isFolder);
  $('ctxFolderDivider').classList.toggle('hidden', !isFolder);

  $('ctxPin').classList.toggle('hidden', isFolder);
  if (!isFolder) {
    $('ctxPinLabel').textContent = isPinned(state.contextTarget) ? 'Unpin from tabs' : 'Pin to tabs';
  }

  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
}

function hideContextMenu() { els.contextMenu.classList.add('hidden'); }

$('ctxNewFileHere').addEventListener('click', () => {
  if (state.contextTarget) openNewFileModal(state.contextTarget);
  hideContextMenu();
});

$('ctxNewFolderHere').addEventListener('click', () => {
  if (state.contextTarget) openNewFolderModal(state.contextTarget);
  hideContextMenu();
});

$('ctxPin').addEventListener('click', () => {
  if (state.contextTarget && !state.contextIsFolder) togglePin(state.contextTarget);
  hideContextMenu();
});

$('ctxRename').addEventListener('click', () => {
  if (!state.contextTarget) return hideContextMenu();
  if (state.contextIsFolder) openRenameFolderModal(state.contextTarget);
  else openRenameModal(state.contextTarget);
  hideContextMenu();
});

$('ctxDelete').addEventListener('click', () => {
  if (!state.contextTarget) return hideContextMenu();
  if (state.contextIsFolder) openDeleteFolderModal(state.contextTarget);
  else openDeleteModal(state.contextTarget);
  hideContextMenu();
});

document.addEventListener('click', (e) => {
  if (!els.contextMenu.contains(e.target)) hideContextMenu();
});

/* ============ KEYBOARD SHORTCUTS ============ */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'F11') {
    e.preventDefault();
    if (window.inkwell.toggleFullscreen) window.inkwell.toggleFullscreen();
    return;
  }

  if (e.key === 'Escape') {
    const anyModal = Object.values(modals).some((m) => !m.classList.contains('hidden'));
    closeAllModals();
    hideContextMenu();
    hideAIFloat();
    closeImageLightbox();
    if (findState.open) closeFind();
    if (anyModal) return;
    if (els.commentComposer && !els.commentComposer.classList.contains('hidden')) { hideCommentComposer(); return; }
    if (els.commentsPanel && !els.commentsPanel.classList.contains('hidden')) { closeCommentsPanel(); return; }
    if (els.answerDocView && !els.answerDocView.classList.contains('hidden')) { backFromAnswerDoc(); return; }
    if (els.aiPanel && !els.aiPanel.classList.contains('hidden')) closeAIPanel();
    return;
  }

  if (!mod) return;

  const key = e.key.toLowerCase();

  if (key === 'f') { e.preventDefault(); openFind(); return; }
  if (e.shiftKey && key === 'e') { e.preventDefault(); exportHTML(); return; }
  if (e.shiftKey && key === 'k') { e.preventDefault(); openExplainCodeDialog(); return; }

  // zoom works everywhere
  if (key === '=' || key === '+') { e.preventDefault(); setZoom(state.zoom + 10); return; }
  if (key === '-') { e.preventDefault(); setZoom(state.zoom - 10); return; }
  if (key === '0') { e.preventDefault(); setZoom(100); return; }

  if (key === 'j') { e.preventDefault(); openAIPanel(); return; }
  if (key === 's') { e.preventDefault(); saveFile(false); return; }
  if (key === 'n') { e.preventDefault(); els.newFileBtn.click(); return; }
  if (key === 'p') { e.preventDefault(); setViewMode(state.viewMode === 'preview' ? 'edit' : 'preview'); return; }
  if (key === '\\') { e.preventDefault(); setViewMode(state.viewMode === 'split' ? 'edit' : 'split'); return; }
  if (e.shiftKey && key === 'b') { e.preventDefault(); els.sidebar.classList.toggle('collapsed'); return; }

  // skip formatting shortcuts while typing in another field (search, modals)
  const active = document.activeElement;
  const inOtherField = (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) && active !== els.editor;
  if (inOtherField) return;

  if (e.shiftKey && key === 'x') { e.preventDefault(); applyFormat('strike'); return; }
  if (key === 'b') { e.preventDefault(); applyFormat('bold'); return; }
  if (key === 'i') { e.preventDefault(); applyFormat('italic'); return; }
  if (key === 'k') { e.preventDefault(); applyFormat('link'); return; }
  if (key === '`' || key === 'e') { e.preventDefault(); applyFormat('code'); return; }
  if (key === '1') { e.preventDefault(); applyFormat('h1'); return; }
  if (key === '2') { e.preventDefault(); applyFormat('h2'); return; }
  if (key === '3') { e.preventDefault(); applyFormat('h3'); return; }
  if (key === 'z' && e.shiftKey) { e.preventDefault(); applyFormat('redo'); return; }
});

/* ============ UTIL ============ */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

/* prevent data loss on close */
window.addEventListener('beforeunload', () => {
  if (state.dirty && state.currentFile) {
    window.inkwell.writeFile(state.currentFile, els.editor.value);
  }
});

/* ============ BOOT ============ */
initApp();
