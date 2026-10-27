const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  loadDb: () => ipcRenderer.invoke('db:load'),
  config: () => ipcRenderer.invoke('app:config'),
  hide: () => ipcRenderer.send('overlay:hide'),
  ready: () => ipcRenderer.send('app:ready'), // database loaded: the splash can leave
  closed: () => ipcRenderer.send('overlay:closed'),
  fit: (height, beyondMax) => ipcRenderer.send('overlay:fit', height, beyondMax),
  fitWidth: (width) => ipcRenderer.send('overlay:fit-width', width),
  geometry: (g) => ipcRenderer.send('overlay:geometry', g),
  grip: (phase) => ipcRenderer.send('overlay:grip', phase),
  zoom: (direction) => ipcRenderer.send('overlay:zoom', direction),
  dockPointer: (phase) => ipcRenderer.send('dock:pointer', phase),
  openLink: (url) => ipcRenderer.send('link:open', url),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  onCommoditiesLive: (fn) => ipcRenderer.on('commodities:live', (_e, data) => fn(data)),
  commoditiesLive: () => ipcRenderer.invoke('commodities:live'),
  pinRows: (rows) => ipcRenderer.send('pin:rows', rows), // mineral signatures for the pinned list
  hangarAnchor: () => ipcRenderer.invoke('hangar:anchor'), // the Executive Hangar cycle's start (s)
  onPinChanged: (fn) => ipcRenderer.on('pin:changed', () => fn()), // the pinned map was closed with its ×
  onHangarAnchor: (fn) => ipcRenderer.on('hangar:anchor', (_e, anchor) => fn(anchor)),
  noticeDone: (dontShowAgain) => ipcRenderer.send('notice:done', dontShowAgain),
  hotkeyRecording: (active) => ipcRenderer.send('hotkey:recording', active),
  setHotkey: (accelerator) => ipcRenderer.invoke('hotkey:set', accelerator),
  onHotkeyRecorder: (fn) => ipcRenderer.on('overlay:hotkey', (_e, current) => fn(current)),
  onNotice: (fn) => ipcRenderer.on('overlay:notice', () => fn()),
  onGameVersion: (fn) => ipcRenderer.on('game:version', (_e, v) => fn(v)),
  sendFeedback: (f) => ipcRenderer.invoke('feedback:send', f),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  settingsAction: (action) => ipcRenderer.invoke('settings:action', action),
  onSettings: (fn) => ipcRenderer.on('overlay:settings', () => fn()),
  onFeedback: (fn) => ipcRenderer.on('overlay:feedback', () => fn()),
  onAutoClick: (fn) => ipcRenderer.on('overlay:autoclick', () => fn()),
  onOpen: (fn) => ipcRenderer.on('overlay:open', (_e, info) => fn(info)),
  onClose: (fn) => ipcRenderer.on('overlay:close', () => fn()),
  onDocked: (fn) => ipcRenderer.on('overlay:docked', (_e, info) => fn(info)),
  onLayout: (fn) => ipcRenderer.on('overlay:layout', (_e, layout) => fn(layout)),
  onDbUpdated: (fn) => ipcRenderer.on('db:updated', (_e, info) => fn(info)),
});
