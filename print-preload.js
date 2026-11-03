const { contextBridge, ipcRenderer } = require('electron');

// The print preview is a sandboxed page with no app APIs. These two calls are
// all it needs: ask the main process to open the printer, or close the window.
contextBridge.exposeInMainWorld('inkwellPrint', {
  print: () => ipcRenderer.invoke('print:run'),
  close: () => ipcRenderer.send('print:close'),
});
