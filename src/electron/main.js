import { app, BrowserWindow, ipcMain, dialog, protocol, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';
import Store from 'electron-store';
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import { registerGeM_IpcHandlers } from './gemIpcHandlers.js';

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register protocol before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// Initialize store correctly for ESM
const store = new Store();

let mainWindow;
let splash;

function createSplashScreen() {
  splash = new BrowserWindow({
    width: 600,
    height: 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    center: true,
    icon: path.join(__dirname, '../../src/assets/logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const splashPath = path.join(__dirname, 'splash.html');
  const displayName = String(store.get('displayName') || 'Aarathi').trim() || 'Aarathi';
  const splashUrl = `file://${splashPath}?displayName=${encodeURIComponent(displayName)}`;
  
  splash.loadURL(splashUrl);
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      const filePath = commandLine.find(arg => 
        arg.endsWith('.json') || 
        arg.endsWith('.peibill') || 
        arg.endsWith('.peiinvoice') || 
        arg.endsWith('.peiplbill')
      );
      if (filePath) {
        openFile(filePath);
      }
    }
  });

  app.whenReady().then(() => {
    // Register custom protocol for loading local files securely
    protocol.handle('app', (request) => {
      let url = request.url.replace('app://', '');
      // Handle the case where the URL might have a hash or query parameters
      url = url.split('#')[0].split('?')[0];
      // Normalize path for Windows/Unix
      const filePath = path.join(__dirname, '../../dist', url === '' || url === './' ? 'index.html' : url);
      return session.defaultSession.fetch(`file://${filePath}`);
    });

    // Register GeM IPC handlers, provide a getter for the main window
    registerGeM_IpcHandlers(() => mainWindow);

    createSplashScreen();
    setTimeout(() => {
      createWindow();
    }, 2000);

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    const filePath = process.argv.find(arg => 
      arg.endsWith('.json') || 
      arg.endsWith('.peibill') || 
      arg.endsWith('.peiinvoice') || 
      arg.endsWith('.peiplbill')
    );
    if (filePath) {
      openFile(filePath);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    icon: path.join(__dirname, '../../src/assets/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
      webSecurity: true,
    },
    frame: false,
    transparent: false,
    backgroundColor: '#ffffff',
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // In production, load using the custom app:// protocol
    mainWindow.loadURL('app://./index.html').catch(err => {
      console.error('Failed to load UI');
    });
  }

  mainWindow.once('ready-to-show', () => {
    if (splash) {
      splash.close();
    }
    mainWindow.show();
  });

  // Don't open DevTools in production for better performance
  if (isDev && process.env.OPEN_DEVTOOLS !== 'false') {
    mainWindow.webContents.openDevTools();
  }
}

const openFile = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      
      if (mainWindow) {
        if (mainWindow.webContents.isLoading()) {
          mainWindow.webContents.once('did-finish-load', () => {
            mainWindow.webContents.send('open-file', {
              path: filePath,
              content: data
            });
          });
        } else {
          mainWindow.webContents.send('open-file', {
            path: filePath,
            content: data
          });
        }
      }
    } catch (err) {
      // Silently fail for invalid files
    }
  }
};

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return (result.canceled || result.filePaths.length === 0) ? null : result.filePaths[0];
});

const extractFyFromPath = (filePath) => {
  const normalizedPath = filePath.toUpperCase().replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/');
  for (let i = pathParts.length - 1; i >= 0; i--) {
    const part = pathParts[i];
    const aprilMatch = part.match(/APRIL\s+(20)?(\d{2})/);
    if (aprilMatch) {
      const yearShort = parseInt(aprilMatch[2]);
      return `${(yearShort - 1).toString().padStart(2, '0')}${yearShort.toString().padStart(2, '0')}`;
    }
    const earlyMonthsMatch = part.match(/(JANUARY|FEBRUARY|MARCH|JAN|FEB|MAR)\s+(20)?(\d{2})/);
    if (earlyMonthsMatch) {
      const yearShort = parseInt(earlyMonthsMatch[3]);
      return `${(yearShort - 1).toString().padStart(2, '0')}${yearShort.toString().padStart(2, '0')}`;
    }
    const lateMonthsMatch = part.match(/(MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(20)?(\d{2})/);
    if (lateMonthsMatch) {
      const yearShort = parseInt(lateMonthsMatch[3]);
      return `${yearShort.toString().padStart(2, '0')}${(yearShort + 1).toString().padStart(2, '0')}`;
    }
    const fyMatch = part.match(/(\d{2})?(\d{2})-(\d{2})/);
    if (fyMatch) return `${fyMatch[2]}${fyMatch[3]}`;
  }
  return 'Unknown';
};

const scanDirectoryRecursive = (dirPath, fileList = []) => {
  const files = fs.readdirSync(dirPath);
  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      scanDirectoryRecursive(filePath, fileList);
    } else if (file.endsWith('.json') || file.endsWith('.peibill') || file.endsWith('.peiinvoice')) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data.billNumber && data.customerName) {
          // Keep invoice and GeM PDF scans on the same folder-derived FY key.
          // A bill number's first four digits are the invoice year, not the
          // financial-year key used by extractFyFromPath.
          const fy = extractFyFromPath(filePath);
          fileList.push({ path: filePath, folder: path.dirname(filePath), fileName: file, content: data, mtime: stat.mtime, fy });
        }
      } catch (err) {}
    }
  });
  return fileList;
};

ipcMain.handle('scan-invoices', async (event, paths) => {
  const allInvoices = [];
  (Array.isArray(paths) ? paths : []).forEach(dirPath => {
    if (fs.existsSync(dirPath)) scanDirectoryRecursive(dirPath, allInvoices);
  });
  return allInvoices;
});

const scanGemPdfsRecursive = (dirPath, gemList = []) => {
  const files = fs.readdirSync(dirPath);
  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      scanGemPdfsRecursive(filePath, gemList);
    } else if (file.toLowerCase().endsWith('.pdf')) {
      const fileName = file.toUpperCase();
      if (fileName.includes('SUPPORT')) return;
      const match = fileName.match(/(\d+)/);
      if (match) {
        gemList.push({ path: filePath, fileName: file, billNumber: match[1], fy: extractFyFromPath(filePath), mtime: stat.mtime });
      }
    }
  });
  return gemList;
};

ipcMain.handle('scan-gem-pdfs', async (event, paths) => {
  const allGemPdfs = [];
  (Array.isArray(paths) ? paths : []).forEach(dirPath => {
    if (fs.existsSync(dirPath)) scanGemPdfsRecursive(dirPath, allGemPdfs);
  });
  return allGemPdfs;
});

ipcMain.handle('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.handle('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});

ipcMain.handle('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.handle('get-store-value', (event, key) => store.get(key));
ipcMain.handle('set-store-value', (event, key, value) => store.set(key, value));

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'JSON Invoice', extensions: ['json'] }, { name: 'PEI Bill Files', extensions: ['peibill', 'peiinvoice', 'peiplbill'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return { path: result.filePaths[0], content: JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')) };
});

ipcMain.handle('save-file', async (event, { content, filePath }) => {
  let targetPath = filePath;
  try {
    if (!targetPath) {
      const result = await dialog.showSaveDialog({
        filters: [{ name: 'JSON Invoice', extensions: ['json'] }, { name: 'PEI Bill File', extensions: ['peibill', 'peiinvoice'] }],
        defaultPath: `Invoice_${content.billNumber || 'New'}.json`
      });
      if (result.canceled || !result.filePath) return null;
      targetPath = result.filePath;
    }
    
    if (!content || typeof content !== 'object') {
      throw new Error('Invalid invoice content: must be a valid object');
    }
    if (!content.billNumber) {
      throw new Error('Invalid invoice: billNumber is required');
    }
    
    const normalizedPath = path.normalize(targetPath);
    if (normalizedPath.includes('..')) {
      throw new Error('Invalid file path: path traversal not allowed');
    }
    
    if (fs.existsSync(normalizedPath)) {
      const backupPath = `${normalizedPath}.bak`;
      fs.copyFileSync(normalizedPath, backupPath);
    }
    
    fs.writeFileSync(normalizedPath, JSON.stringify(content, null, 2));
    return normalizedPath;
  } catch (err) {
    console.error('Save file error:', err.message);
    throw new Error(`Failed to save file: ${err.message}`);
  }
});

const printDataBufferMap = new Map();
let printDataBuffer = null;
const PRINT_TIMEOUT = 10000;

ipcMain.handle('print-to-pdf', async (event, data) => {
  const parentWin = BrowserWindow.fromWebContents(event.sender);
  const sessionId = `print-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  printDataBufferMap.set(sessionId, data);
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, webSecurity: true }
  });
  isDev ? printWin.loadURL('http://localhost:5173/#/print-export') : printWin.loadURL('app://./index.html#/print-export');

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        printWin.close();
        printDataBufferMap.delete(sessionId);
        reject(new Error('PDF generation timeout'));
      }
    }, PRINT_TIMEOUT);

    printWin.webContents.once('did-finish-load', async () => {
      try {
        await printWin.webContents.executeJavaScript(`
          new Promise(async (resolve) => {
            await document.fonts.ready;
            await Promise.all(Array.from(document.images).map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })));
            setTimeout(resolve, 500);
          });
        `);
        const result = await dialog.showSaveDialog(parentWin, {
          title: 'Save Invoice as PDF',
          defaultPath: `Invoice_${data.invoice.billNumber.replace(/[\\/]/g, '_')}.pdf`,
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
        });
        if (result.canceled || !result.filePath) { 
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            printWin.close(); 
            printDataBufferMap.delete(sessionId); 
            resolve(null); 
          }
          return; 
        }
        const pdfData = await printWin.webContents.printToPDF({ margins: { top: 0, bottom: 0, left: 0, right: 0 }, pageSize: 'A4', printBackground: true, displayHeaderFooter: false });
        fs.writeFileSync(result.filePath, pdfData);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          printWin.close(); 
          printDataBufferMap.delete(sessionId); 
          resolve(result.filePath);
        }
      } catch (err) { 
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          printWin.close(); 
          printDataBufferMap.delete(sessionId); 
          reject(err); 
        }
      }
    });

    printWin.webContents.once('crashed', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        printDataBufferMap.delete(sessionId);
        reject(new Error('PDF generation window crashed'));
      }
    });
  });
});

ipcMain.handle('print-window', async (event, data) => {
  printDataBuffer = data;
  const printWin = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    width: 1100,
    height: 900,
    backgroundColor: '#ffffff',
    resizable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, webSecurity: true }
  });
  printWin.setMenuBarVisibility(false);
  isDev ? printWin.loadURL('http://localhost:5173/#/print-export') : printWin.loadURL('app://./index.html#/print-export');

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        printWin.close();
        printDataBuffer = null;
        resolve(true);
      }
    }, 10000); // 10 second timeout

    printWin.once('ready-to-show', () => {
      printWin.show();
    });

    printWin.webContents.once('did-finish-load', async () => {
      try {
        await printWin.webContents.executeJavaScript(`
          new Promise(async (resolve) => {
            await document.fonts.ready;
            await Promise.all(Array.from(document.images).map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })));
            setTimeout(resolve, 500);
          });
        `);
        printWin.focus();
        printWin.webContents.print({ silent: false, printBackground: true, deviceName: '' }, (success, failureReason) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            printWin.close();
            printDataBuffer = null;
            if (success) {
              resolve(true);
            } else {
              reject(new Error(failureReason || 'Print failed'));
            }
          }
        });
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          printWin.close();
          printDataBuffer = null;
          reject(err);
        }
      }
    });

    printWin.webContents.once('crashed', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        printDataBuffer = null;
        reject(new Error('Print window crashed'));
      }
    });
  });
});

ipcMain.on('get-print-data', (event) => { event.returnValue = printDataBuffer; });
