// @ts-nocheck
import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { GeminiService } from './gemini';
import { GoldStorageEngine, migrateState, writeJsonAtomically } from './storageEngine';

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let storageEngine: GoldStorageEngine;
let geminiService: GeminiService;
let isQuittingAfterFlush = false;
let isFlushingForQuit = false;

function beginGracefulQuit() {
  if (isQuittingAfterFlush || isFlushingForQuit) return;
  isFlushingForQuit = true;

  let completed = false;
  const finishQuit = () => {
    if (completed) return;
    completed = true;
    finalizeOnCloseBackups();
    isQuittingAfterFlush = true;
    app.quit();
  };

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    ipcMain.once('app:flush-complete', finishQuit);
    try {
      mainWindow.webContents.send('app:flush-before-quit');
    } catch {
      finishQuit();
      return;
    }
    // Safety fallback timeout (3s) in case renderer is busy/unresponsive
    setTimeout(finishQuit, 3000);
  } else {
    finishQuit();
  }
}

// Prompt 1.4: Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createMainWindow() {
  const iconPath = path.join(__dirname, '../build/icon.png');

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    title: 'مراجع الذهب',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Prompt 1.2: Open maximized
  mainWindow.maximize();

  // Prompt 1.3 & Patch 5: Prevent opening new windows or external navigation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (isDev && parsedUrl.origin === 'http://localhost:3000') {
      return;
    }
    if (parsedUrl.protocol === 'file:') {
      return;
    }
    event.preventDefault();
  });

  // Prompt 1.2: Keyboard shortcuts (F11 fullscreen, Ctrl+P print, Ctrl+Shift+I DevTools in dev only)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F11') {
        event.preventDefault();
        mainWindow?.setFullScreen(!mainWindow.isFullScreen());
      } else if ((input.control || input.meta) && input.key.toLowerCase() === 'p') {
        event.preventDefault();
        mainWindow?.webContents.print({ silent: false, printBackground: true });
      } else if (
        isDev &&
        (input.control || input.meta) &&
        input.shift &&
        input.key.toLowerCase() === 'i'
      ) {
        event.preventDefault();
        mainWindow?.webContents.toggleDevTools();
      }
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL || 'http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (event) => {
    if (!isQuittingAfterFlush) {
      event.preventDefault();
      beginGracefulQuit();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  // --- Storage IPC ---
  ipcMain.handle('storage:load', async () => {
    return storageEngine.loadState();
  });

  ipcMain.handle('storage:save', async (_event, state) => {
    return storageEngine.saveState(state);
  });

  ipcMain.handle('storage:createSnapshotBackup', async (_event, label) => {
    return storageEngine.createSnapshotBackup(label);
  });

  ipcMain.handle('storage:saveImage', async (_event, date: string, dataUrl: string) => {
    return storageEngine.saveImage(date, dataUrl);
  });

  ipcMain.handle('storage:loadImage', async (_event, date: string) => {
    return storageEngine.loadImage(date);
  });

  ipcMain.handle('storage:deleteImage', async (_event, date: string) => {
    return storageEngine.deleteImage(date);
  });

  ipcMain.handle('storage:listBackups', async () => {
    return storageEngine.listBackups();
  });

  ipcMain.handle('storage:restoreBackup', async (_event, name: string) => {
    return storageEngine.restoreBackup(name);
  });

  ipcMain.handle('storage:openDataFolder', async () => {
    try {
      shell.showItemInFolder(storageEngine.stateFilePath);
      return { ok: true, dataDir: storageEngine.rootDir };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر فتح مجلد البيانات.' };
    }
  });

  ipcMain.handle('storage:chooseExternalFolder', async () => {
    if (!mainWindow) return { ok: false };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'اختر مجلد النسخ الاحتياطي الخارجي (فلاشة أو مجلد سحابي)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    return { ok: true, folderPath: result.filePaths[0] };
  });

  ipcMain.handle('storage:syncExternalBackup', async (_event, folderPath: string) => {
    return storageEngine.syncExternalBackup(folderPath);
  });

  ipcMain.handle('storage:saveVisitSnapshot', async (_event, visitId: string, visitData: any) => {
    return storageEngine.saveVisitSnapshot(visitId, visitData);
  });

  ipcMain.handle('storage:checkImagesExist', async (_event, dates: string[]) => {
    return storageEngine.checkImagesExist(dates);
  });

  ipcMain.handle('storage:getImagesStorageInfo', async () => {
    return storageEngine.getImagesStorageInfo();
  });

  ipcMain.handle('storage:cleanupImagesForDates', async (_event, dates: string[]) => {
    return storageEngine.cleanupImagesForDates(dates);
  });

  ipcMain.handle('storage:exportJson', async (_event, payload: any) => {
    if (!mainWindow) return { ok: false, error: 'النافذة غير متاحة.' };
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'حفظ نسخة احتياطية JSON',
      defaultPath: `نسخة_مراجع_الذهب_${stamp}.json`,
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    try {
      writeJsonAtomically(result.filePath, payload, false);
      return { ok: true, filePath: result.filePath };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر حفظ ملف النسخة الاحتياطية.' };
    }
  });

  ipcMain.handle('storage:importJson', async () => {
    if (!mainWindow) return { ok: false, error: 'النافذة غير متاحة.' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'استيراد نسخة احتياطية JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const parsed = JSON.parse(raw);
      const { migrated } = migrateState(parsed);
      return { ok: true, data: migrated };
    } catch (err: any) {
      return { ok: false, error: 'ملف JSON غير صالح أو تالف.' };
    }
  });

  // --- Gemini OCR & Summarize IPC ---
  ipcMain.handle('ocr:readLedger', async (_event, params) => {
    return geminiService.readLedger(params);
  });

  ipcMain.handle('ocr:detectOrientation', async (_event, params) => {
    return geminiService.detectPageOrientationAndRegions(params);
  });

  ipcMain.handle('ocr:verifyWeakCells', async (_event, params) => {
    return geminiService.verifyWeakCells(params);
  });

  ipcMain.handle('ai:summarize', async (_event, params) => {
    return geminiService.summarizeAudit(params);
  });

  ipcMain.handle('ai:setApiKey', async (_event, key: string) => {
    return geminiService.setApiKey(key);
  });

  ipcMain.handle('ai:getApiKeyStatus', async () => {
    return { ok: true, ...geminiService.getStatus() };
  });

  ipcMain.handle('ai:testApiKey', async (_event, customKey?: string, modelName?: string) => {
    return geminiService.testApiKey(customKey, modelName);
  });

  // --- App Lock Security IPC ---
  ipcMain.handle('security:getStatus', async () => {
    return storageEngine.getLockStatus();
  });

  ipcMain.handle('security:verifyPassword', async (_event, password: string) => {
    return storageEngine.verifyPassword(password);
  });

  ipcMain.handle('security:configure', async (_event, params) => {
    return storageEngine.configureAppLock(params);
  });

  // --- Print to PDF IPC (Prompt 7.3) ---
  ipcMain.handle('print:saveToPdf', async (_event, defaultFilename?: string) => {
    if (!mainWindow) return { ok: false, error: 'النافذة غير متاحة.' };
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const saveRes = await dialog.showSaveDialog(mainWindow, {
        title: 'حفظ التقرير كملف PDF',
        defaultPath: defaultFilename || `تقرير_مراجع_الذهب_${stamp}.pdf`,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });
      if (saveRes.canceled || !saveRes.filePath) {
        return { ok: false, canceled: true };
      }
      const pdfBuffer = await mainWindow.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0.47, bottom: 0.47, left: 0.47, right: 0.47 }, // ~12mm
      });
      fs.writeFileSync(saveRes.filePath, pdfBuffer);
      return { ok: true, filePath: saveRes.filePath };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر حفظ ملف PDF.' };
    }
  });
}

function finalizeOnCloseBackups() {
  try {
    if (storageEngine) {
      storageEngine.createSnapshotBackup('on-close');
      const loaded = storageEngine.loadState();
      const extPath = loaded.state?.settings?.externalBackupPath;
      if (extPath) {
        storageEngine.syncExternalBackup(extPath);
      }
    }
  } catch {
    // ignore close backup errors
  }
}

app.whenReady().then(() => {
  const goldDataRoot = path.join(app.getPath('userData'), 'GoldAudit');
  storageEngine = new GoldStorageEngine(goldDataRoot);
  geminiService = new GeminiService({
    dataDir: storageEngine.dataDir,
    safeStorage,
  });

  // Prompt 1.3: Content-Security-Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';",
        ],
      },
    });
  });

  registerIpcHandlers();
  createMainWindow();
});

// Requirement 6: Request final flush from renderer via IPC before taking on-close backup
app.on('before-quit', (event) => {
  if (isQuittingAfterFlush) {
    return;
  }
  event.preventDefault();
  beginGracefulQuit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
