const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkwell', {
  listFiles: () => ipcRenderer.invoke('fs:list'),
  readFile: (filename) => ipcRenderer.invoke('fs:read', filename),
  writeFile: (filename, content) => ipcRenderer.invoke('fs:write', filename, content),
  createFile: (filename) => ipcRenderer.invoke('fs:create', filename),
  deleteFile: (filename) => ipcRenderer.invoke('fs:delete', filename),
  renameFile: (oldName, newName) => ipcRenderer.invoke('fs:rename', oldName, newName),
  mkdir: (folderPath) => ipcRenderer.invoke('fs:mkdir', folderPath),
  rmdir: (folderPath) => ipcRenderer.invoke('fs:rmdir', folderPath),
  renameFolder: (oldPath, newPath) => ipcRenderer.invoke('fs:renameFolder', oldPath, newPath),
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

  // settings
  getTelegramConfig: () => ipcRenderer.invoke('settings:getTelegram'),
  saveTelegramConfig: (config) => ipcRenderer.invoke('settings:setTelegram', config),
  testTelegram: (config) => ipcRenderer.invoke('telegram:test', config),

  // ask an AI CLI about a selection
  askAI: (payload) => ipcRenderer.invoke('ai:ask', payload),
  listAIModels: (payload) => ipcRenderer.invoke('ai:listModels', payload),
  cancelAI: () => ipcRenderer.invoke('ai:cancel'),
});
