// ASR Studio Electron main process
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let pythonServer = null;

// ── Find Python ──
function findPython() {
  const candidates = ['python', 'python3', 'py'];
  for (const cmd of candidates) {
    try {
      const { execSync } = require('child_process');
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      return cmd;
    } catch {}
  }
  return 'python';
}

// ── Start Python server ──
function startPythonServer() {
  return new Promise((resolve) => {
    const python = findPython();
    const serverPath = path.join(__dirname, '..', 'asr_api_server.py');

    pythonServer = spawn(python, [serverPath], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let output = '';
    pythonServer.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('http://')) setTimeout(resolve, 800);
    });

    pythonServer.stderr.on('data', (data) => {
      if (data.toString().includes('http://')) setTimeout(resolve, 800);
    });

    pythonServer.on('error', () => {
      // Continue anyway
    });

    setTimeout(resolve, 5000);
  });
}

// ── Create frameless window ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ASR Studio',
    icon: path.join(__dirname, 'icon.png'),
    frame: false,                       // ← 去掉系统标题栏
    backgroundColor: '#1a1918',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL('http://localhost:8000');
}

// ── Window controls IPC ──
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

// Expose platform info
ipcMain.handle('app:getPlatform', () => process.platform);

// ── App lifecycle ──
app.whenReady().then(async () => {
  await startPythonServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (pythonServer && !pythonServer.killed) pythonServer.kill();
  app.quit();
});

app.on('before-quit', () => {
  if (pythonServer && !pythonServer.killed) pythonServer.kill();
});
