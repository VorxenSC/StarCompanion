const { contextBridge, ipcRenderer } = require('electron');

// The pinned signature list's only channel: the rows to show and their language.
contextBridge.exposeInMainWorld('pin', {
  onData: (fn) => ipcRenderer.on('pin:data', (_e, data) => fn(data)),
});
