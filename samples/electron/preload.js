const { contextBridge, ipcRenderer } = require('electron');
const winrt = require('../winrt-projection/src/winrtProxy');

contextBridge.exposeInMainWorld('electronAPI', {
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  getWindowsAppRuntimeVersion: () => ipcRenderer.invoke('get-windows-app-runtime-version'),
});

contextBridge.exposeInMainWorld('WinRT', {
  readTextAsync: (filePath) => winrt.Windows.Storage.FileIO.ReadTextAsync(filePath)
});