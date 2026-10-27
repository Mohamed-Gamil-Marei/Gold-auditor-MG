// @ts-nocheck
import { contextBridge, ipcRenderer } from 'electron';

const goldApi = {
  isElectron: true,
  onFlushBeforeQuit: (callback: () => Promise<void>) => {
    ipcRenderer.removeAllListeners('app:flush-before-quit');
    ipcRenderer.on('app:flush-before-quit', async () => {
      try {
        await callback();
      } catch {
        // ignore flush error on quit
      } finally {
        ipcRenderer.send('app:flush-complete');
      }
    });
  },
  storage: {
    load: () => ipcRenderer.invoke('storage:load'),
    save: (state: any) => ipcRenderer.invoke('storage:save', state),
    createSnapshotBackup: (label?: string) => ipcRenderer.invoke('storage:createSnapshotBackup', label),
    saveImage: (date: string, dataUrl: string) => ipcRenderer.invoke('storage:saveImage', date, dataUrl),
    loadImage: (date: string) => ipcRenderer.invoke('storage:loadImage', date),
    deleteImage: (date: string) => ipcRenderer.invoke('storage:deleteImage', date),
    listBackups: () => ipcRenderer.invoke('storage:listBackups'),
    restoreBackup: (name: string) => ipcRenderer.invoke('storage:restoreBackup', name),
    openDataFolder: () => ipcRenderer.invoke('storage:openDataFolder'),
    chooseExternalFolder: () => ipcRenderer.invoke('storage:chooseExternalFolder'),
    syncExternalBackup: (folderPath: string) => ipcRenderer.invoke('storage:syncExternalBackup', folderPath),
    saveVisitSnapshot: (visitId: string, visitData: any) =>
      ipcRenderer.invoke('storage:saveVisitSnapshot', visitId, visitData),
    checkImagesExist: (dates: string[]) => ipcRenderer.invoke('storage:checkImagesExist', dates),
    exportJson: (payload: any) => ipcRenderer.invoke('storage:exportJson', payload),
    importJson: () => ipcRenderer.invoke('storage:importJson'),
  },
  ocr: {
    readLedger: (params: {
      imageBase64: string;
      mimeType?: string;
      forcedSideType?: 'buy' | 'sell' | 'auto';
      slicePosition?: 'full' | 'top' | 'bottom';
      modelName?: string;
    }) => ipcRenderer.invoke('ocr:readLedger', params),
  },
  ai: {
    summarize: (params: { aggregatedStats: any; modelName?: string }) =>
      ipcRenderer.invoke('ai:summarize', params),
    setApiKey: (key: string) => ipcRenderer.invoke('ai:setApiKey', key),
    getApiKeyStatus: () => ipcRenderer.invoke('ai:getApiKeyStatus'),
    testApiKey: (customKey?: string, modelName?: string) =>
      ipcRenderer.invoke('ai:testApiKey', customKey, modelName),
  },
  security: {
    getStatus: () => ipcRenderer.invoke('security:getStatus'),
    verifyPassword: (password: string) => ipcRenderer.invoke('security:verifyPassword', password),
    configure: (params: {
      currentPassword?: string;
      newPassword?: string;
      enabled: boolean;
      idleMinutes: number;
    }) => ipcRenderer.invoke('security:configure', params),
  },
  print: {
    saveToPdf: (defaultFilename?: string) => ipcRenderer.invoke('print:saveToPdf', defaultFilename),
  },
};

contextBridge.exposeInMainWorld('goldApi', goldApi);
