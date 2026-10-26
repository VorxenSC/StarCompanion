const { contextBridge, ipcRenderer } = require('electron');

// The splash window's only channel: its language, and when to leave.
contextBridge.exposeInMainWorld('splash', {
  onInfo: (fn) => ipcRenderer.on('splash:info', (_e, info) => fn(info)),
  onLeave: (fn) => ipcRenderer.on('splash:leave', () => fn()),
  done: () => ipcRenderer.send('splash:done'),
});
