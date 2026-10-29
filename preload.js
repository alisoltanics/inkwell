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

  // export / share (self-contained HTML)
  exportHTML: (sourcePath, payload) => ipcRenderer.invoke('dialog:exportHTML', sourcePath, payload),
  sendDocToTelegram: (suggestedName, payload) => ipcRenderer.invoke('telegram:sendHTML', suggestedName, payload),
  printDoc: (payload) => ipcRenderer.invoke('print:html', payload),

  // settings
  getTelegramConfig: () => ipcRenderer.invoke('settings:getTelegram'),
  saveTelegramConfig: (config) => ipcRenderer.invoke('settings:setTelegram', config),
  testTelegram: (config) => ipcRenderer.invoke('telegram:test', config),

  // ask an AI CLI (or an HTTP API provider) about a selection
  askAI: (payload) => ipcRenderer.invoke('ai:ask', payload),
  listAIModels: (payload) => ipcRenderer.invoke('ai:listModels', payload),
  cancelAI: () => ipcRenderer.invoke('ai:cancel'),
  getAIKeyStatus: (payload) => ipcRenderer.invoke('ai:keyStatus', payload),
  saveAIKey: (payload) => ipcRenderer.invoke('ai:saveKey', payload),
});
