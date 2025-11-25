const { contextBridge, ipcRenderer } = require('electron');

const logFromPreload = (level, message, extra) => {
  try {
    const payload = { level, message, extra };
    console[level](message, extra ?? '');
    ipcRenderer.send('winrt-preload-log', payload);
  } catch (_) {
    // IPC isn't always available during teardown; ignore.
  }
};

logFromPreload('info', 'WinRT preload starting - using IPC bridge');

contextBridge.exposeInMainWorld('electronAPI', {
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  getWindowsAppRuntimeVersion: () => ipcRenderer.invoke('get-windows-app-runtime-version'),
  getTestFilePath: () => ipcRenderer.invoke('get-test-file-path'),
  onAIStatusUpdate: (callback) => ipcRenderer.on('ai-status-update', (_event, status) => callback(status))
});

contextBridge.exposeInMainWorld('WinRT', {
  readTextAsync: (filePath) => ipcRenderer.invoke('winrt-read-text-async', filePath),
  recognizeText: (imagePath) => ipcRenderer.invoke('ocr-recognize-text', imagePath),
  checkAIAvailability: () => ipcRenderer.invoke('ocr-check-availability')
});

logFromPreload('info', 'WinRT bridge exposed via IPC');