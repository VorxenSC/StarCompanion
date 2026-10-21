const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  loadDb: () => ipcRenderer.invoke('db:load'),
  config: () => ipcRenderer.invoke('app:config'),
  hide: () => ipcRenderer.send('overlay:hide'),
  closed: () => ipcRenderer.send('overlay:closed'),
  fit: (height, beyondMax) => ipcRenderer.send('overlay:fit', height, beyondMax),
  geometry: (g) => ipcRenderer.send('overlay:geometry', g),
  grip: (phase) => ipcRenderer.send('overlay:grip', phase),
  zoom: (direction) => ipcRenderer.send('overlay:zoom', direction),
  dockPointer: (phase) => ipcRenderer.send('dock:pointer', phase),
  openLink: (url) => ipcRenderer.send('link:open', url),
  noticeDone: (dontShowAgain) => ipcRenderer.send('notice:done', dontShowAgain),
  hotkeyRecording: (active) => ipcRenderer.send('hotkey:recording', active),
  setHotkey: (accelerator) => ipcRenderer.invoke('hotkey:set', accelerator),
  onHotkeyRecorder: (fn) => ipcRenderer.on('overlay:hotkey', (_e, current) => fn(current)),
  onNotice: (fn) => ipcRenderer.on('overlay:notice', () => fn()),
  onOpen: (fn) => ipcRenderer.on('overlay:open', (_e, info) => fn(info)),
  onClose: (fn) => ipcRenderer.on('overlay:close', () => fn()),
  onDocked: (fn) => ipcRenderer.on('overlay:docked', (_e, info) => fn(info)),
  onLayout: (fn) => ipcRenderer.on('overlay:layout', (_e, layout) => fn(layout)),
  onDbUpdated: (fn) => ipcRenderer.on('db:updated', (_e, info) => fn(info)),
});
