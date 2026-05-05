// Preload — secure bridge between renderer and main
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onServerError: (callback) => ipcRenderer.on('server:error', (_e, msg) => callback(msg)),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
});
