const { app, BrowserWindow, ipcMain} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const addon = require('../addon/build/Release/addon.node');

let csAddon = undefined; 
let winrtProxy = undefined;

function getCsAddon() {
  const csAddonPath = '../csAddon/dist/csAddon.node';
  if (csAddon === undefined) {
    csAddon = require(csAddonPath);
  }
  return csAddon;
}

function getWinrtProxy() {
  if (winrtProxy === undefined) {
    try {
      winrtProxy = require('../winrt-projection/src/winrtProxy');
      console.log('[main] WinRT proxy loaded successfully');
    } catch (error) {
      console.error('[main] Failed to load WinRT proxy:', error.message);
      winrtProxy = null;
    }
  }
  return winrtProxy;
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Check AI availability after window loads
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      const proxy = getWinrtProxy();
      if (proxy?.Windows?.Media?.Ocr?.checkAIAvailability) {
        const status = proxy.Windows.Media.Ocr.checkAIAvailability();
        mainWindow.webContents.send('ai-status-update', status);
      } else {
        mainWindow.webContents.send('ai-status-update', { 
          state: 'NotSupported', 
          message: 'WinRT OCR module not loaded' 
        });
      }
    } catch (err) {
      mainWindow.webContents.send('ai-status-update', { 
        state: 'NotSupported', 
        message: err.message 
      });
    }
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Create test file in user's Documents folder
  const testFilePath = path.join(app.getPath('documents'), 'winrt-test.txt');
  try {
    fs.writeFileSync(testFilePath, 'Hello from WinRT FileIO!\nThis file was created by the Electron app.', 'utf8');
    console.log('[main] Test file created at:', testFilePath);
  } catch (error) {
    console.error('[main] Failed to create test file:', error.message);
  }

  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('show-notification', async (event, title, body) => {
  addon.showNotification(title, body);
});

ipcMain.handle('get-windows-app-runtime-version', async () => {
  return getCsAddon().Addon.getWindowsAppRuntimeVersion();
}); 

ipcMain.handle('winrt-read-text-async', async (_event, filePath) => {
  const proxy = getWinrtProxy();
  if (!proxy?.Windows?.Storage?.FileIO?.ReadTextAsync) {
    throw new Error('WinRT FileIO.ReadTextAsync is not available');
  }
  return proxy.Windows.Storage.FileIO.ReadTextAsync(filePath);
});

ipcMain.handle('get-test-file-path', async () => {
  return path.join(app.getPath('documents'), 'winrt-test.txt');
});

ipcMain.handle('check-file-access', async (_event, filePath) => {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return { accessible: true, exists: true };
  } catch (error) {
    return { 
      accessible: false, 
      exists: fs.existsSync(filePath),
      error: error.message 
    };
  }
});

ipcMain.handle('ocr-recognize-text', async (_event, imagePath) => {
  const proxy = getWinrtProxy();
  if (!proxy?.Windows?.Media?.Ocr?.recognizeText) {
    throw new Error('WinRT OCR is not available');
  }
  return proxy.Windows.Media.Ocr.recognizeText(imagePath);
});

ipcMain.handle('ocr-check-availability', async () => {
  const proxy = getWinrtProxy();
  if (!proxy?.Windows?.Media?.Ocr?.checkAIAvailability) {
    throw new Error('WinRT OCR is not available');
  }
  return proxy.Windows.Media.Ocr.checkAIAvailability();
}); 

const getPreloadLogPath = () => {
  const dir = app.getPath('userData');
  const logPath = path.join(dir, 'winrt-preload.log');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    // Directory already exists or cannot be created; ignore and rely on console-only logging.
  }
  return logPath;
};

ipcMain.on('winrt-preload-log', (_event, payload) => {
  const level = payload?.level && typeof console[payload.level] === 'function'
    ? payload.level
    : 'log';
  const extras = payload?.extra ? JSON.stringify(payload.extra, null, 2) : '';
  const message = payload?.message ?? 'WinRT preload log';
  console[level]('[preload]', message, extras);

  try {
    const serialized = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${extras ? ` ${extras}` : ''}\n`;
    fs.appendFileSync(getPreloadLogPath(), serialized, 'utf8');
  } catch (error) {
    // Logging should never block main-thread work; swallow errors.
  }
});
