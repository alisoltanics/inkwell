const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('inkwell', {
  setUIScale: (factor) => webFrame.setZoomFactor(factor),
  listFiles: () => ipcRenderer.invoke('fs:list'),
  readFile: (filename) => ipcRenderer.invoke('fs:read', filename),
  writeFile: (filename, content) => ipcRenderer.invoke('fs:write', filename, content),
  createFile: (filename) => ipcRenderer.invoke('fs:create', filename),
  deleteFile: (filename) => ipcRenderer.invoke('fs:delete', filename),
  renameFile: (oldName, newName) => ipcRenderer.invoke('fs:rename', oldName, newName),
  mkdir: (folderPath) => ipcRenderer.invoke('fs:mkdir', folderPath),
  rmdir: (folderPath) => ipcRenderer.invoke('fs:rmdir', folderPath),
  renameFolder: (oldPath, newPath) => ipcRenderer.invoke('fs:renameFolder', oldPath, newPath),
  duplicateFile: (logicalPath) => ipcRenderer.invoke('fs:duplicate', logicalPath),
  pasteFiles: (dirPath) => ipcRenderer.invoke('fs:paste', dirPath),

  // archive (hidden .inkwell/archive folder inside the vault)
  listArchive: () => ipcRenderer.invoke('archive:list'),
  archiveItem: (logicalPath) => ipcRenderer.invoke('archive:add', logicalPath),
  restoreArchived: (archivedPath) => ipcRenderer.invoke('archive:restore', archivedPath),
  deleteArchived: (archivedPath) => ipcRenderer.invoke('archive:delete', archivedPath),
  readBinary: (logicalPath) => ipcRenderer.invoke('fs:readBinary', logicalPath),
  writeBinary: (logicalPath, base64) => ipcRenderer.invoke('fs:writeBinary', logicalPath, base64),
  getNotesDir: () => ipcRenderer.invoke('fs:getNotesDir'),
  setNotesDir: (dirPath) => ipcRenderer.invoke('fs:setNotesDir', dirPath),
  chooseNotesDir: () => ipcRenderer.invoke('fs:chooseNotesDir'),
  // documents opened from outside the vault (absolute paths, never copied in)
  openExternalFile: () => ipcRenderer.invoke('file:openExternal'),
  readExternal: (absPath) => ipcRenderer.invoke('file:readExternal', absPath),
  writeExternal: (absPath, content) => ipcRenderer.invoke('file:writeExternal', absPath, content),
  // show a note or folder in the OS file manager
  revealItem: (payload) => ipcRenderer.invoke('shell:reveal', payload),
  // open a web link in the system browser (the app window never navigates)
  openExternalLink: (url) => ipcRenderer.invoke('shell:openExternal', url),
  // read aloud: build (or reuse) the note's audio file and stream it back
  ttsGenerate: (payload) => ipcRenderer.invoke('tts:generate', payload),
  ttsRead: (payload) => ipcRenderer.invoke('tts:read', payload),
  ttsStatus: () => ipcRenderer.invoke('tts:status'),
  // offline translation (Argos Translate) for a selected passage
  translateStatus: () => ipcRenderer.invoke('translate:status'),
  translateText: (payload) => ipcRenderer.invoke('translate:text', payload),
  // speak through the system speaker when no audio file can be produced
  ttsSpeak: (payload) => ipcRenderer.invoke('tts:speak', payload),
  ttsCancel: () => ipcRenderer.invoke('tts:cancel'),
  // window chrome (frameless) controls
  minimize: () => ipcRenderer.invoke('win:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  closeWindow: () => ipcRenderer.invoke('win:close'),
  onWindowState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on('win:state', handler);
    return () => ipcRenderer.removeListener('win:state', handler);
  },
  // notes that appeared, changed or disappeared outside the app
  onVaultChanged: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('vault:changed', handler);
    return () => ipcRenderer.removeListener('vault:changed', handler);
  },

  // export / share (self-contained HTML)
  exportHTML: (sourcePath, payload) => ipcRenderer.invoke('dialog:exportHTML', sourcePath, payload),
  sendDocToTelegram: (suggestedName, payload) => ipcRenderer.invoke('telegram:sendHTML', suggestedName, payload),
  sendDocMarkdown: (suggestedName, text) => ipcRenderer.invoke('telegram:sendMarkdown', suggestedName, text),
  printDoc: (payload) => ipcRenderer.invoke('print:html', payload),

  // settings
  getTelegramConfig: () => ipcRenderer.invoke('settings:getTelegram'),
  saveTelegramConfig: (config) => ipcRenderer.invoke('settings:setTelegram', config),
  testTelegram: (config) => ipcRenderer.invoke('telegram:test', config),
  getTelegramInbox: () => ipcRenderer.invoke('telegram:inboxGet'),
  setTelegramInbox: (config) => ipcRenderer.invoke('telegram:inboxSet', config),
  onTelegramInboxChanged: (cb) => {
    const handler = (_event, status) => cb(status);
    ipcRenderer.on('telegram:inbox-changed', handler);
    return () => ipcRenderer.removeListener('telegram:inbox-changed', handler);
  },

  // ask an AI CLI (or an HTTP API provider) about a selection
  askAI: (payload) => ipcRenderer.invoke('ai:ask', payload),
  listAIModels: (payload) => ipcRenderer.invoke('ai:listModels', payload),
  cancelAI: () => ipcRenderer.invoke('ai:cancel'),
  getAIKeyStatus: (payload) => ipcRenderer.invoke('ai:keyStatus', payload),
  saveAIKey: (payload) => ipcRenderer.invoke('ai:saveKey', payload),
  testAIProvider: (payload) => ipcRenderer.invoke('ai:testProvider', payload),
});
