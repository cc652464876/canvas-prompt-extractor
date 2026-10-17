'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browserToolbar', {
  action: (action, value) => ipcRenderer.invoke('browser-toolbar:action', action, value),
  onState: (callback) =>
    ipcRenderer.on('browser-toolbar:state', (_event, state) => callback(state)),
  onFocus: (callback) => ipcRenderer.on('browser-toolbar:focus', () => callback())
});
