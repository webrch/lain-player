const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 460,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    title: 'LAIN',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#F8F2ED',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  win.loadFile(path.join(__dirname, 'web', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('pick-audio', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Выбрать музыку',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'flac', 'opus', 'webm'] }
    ]
  });
  if (result.canceled) return [];
  return result.filePaths.map((file, i) => {
    const name = path.basename(file, path.extname(file));
    return {
      id: 'desktop_' + Date.now() + '_' + i,
      title: name,
      artist: 'Локальный файл',
      duration: 0,
      art: '',
      uri: 'file:///' + file.replace(/\\/g, '/'),
      local: true
    };
  });
});

ipcMain.handle('open-url', async (_event, url) => {
  if (typeof url === 'string' && url.startsWith('https://')) shell.openExternal(url);
});
