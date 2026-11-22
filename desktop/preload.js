const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ElectronBridge', {
  pickAudio: () => ipcRenderer.invoke('pick-audio'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url)
});
