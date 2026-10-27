const { contextBridge, ipcRenderer } = require('electron');

// The pinned list's channels: what to show, and for a map the corner that resizes it.
contextBridge.exposeInMainWorld('pin', {
  onData: (fn) => ipcRenderer.on('pin:data', (_e, data) => fn(data)),
  onSide: (fn) => ipcRenderer.on('pin:side', (_e, side) => fn(side)),
  grip: (over) => ipcRenderer.send('pin:grip', !!over), // the pointer is on the resize corner: take the mouse
  resize: (phase, screenX) => ipcRenderer.send('pin:resize', phase, screenX),
  close: () => ipcRenderer.send('pin:close'), // the map's ×: unpin it
  alpha: (value, done) => ipcRenderer.send('pin:alpha', Number(value), !!done), // the map's opacity slider
});
