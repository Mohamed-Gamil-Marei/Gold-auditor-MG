import { get as idbGet, set as idbSet } from 'idb-keyval';
import { BackupFileInfo } from '../types';

export interface GoldApi {
  isElectron: boolean;
  onFlushBeforeQuit?: (callback: () => Promise<void>) => void;
  storage: {
    load: () => Promise<{
      ok: boolean;
      state?: any;
      isFirstRun?: boolean;
      recoveredFromBackup?: boolean;
      recoverySource?: string;
      migratedFromOldSchema?: boolean;
      error?: string;
    }>;
    save: (state: any) => Promise<{ ok: boolean; savedAt?: number; error?: string }>;
    createSnapshotBackup: (label?: string) => Promise<{ ok: boolean; filename?: string; error?: string }>;
    saveImage: (date: string, dataUrl: string) => Promise<{ ok: boolean; filename?: string; error?: string }>;
    loadImage: (date: string) => Promise<{ ok: boolean; dataUrl?: string | null; error?: string }>;
    deleteImage: (date: string) => Promise<{ ok: boolean; error?: string }>;
    listBackups: () => Promise<{
      ok: boolean;
      backups?: BackupFileInfo[];
      dataDir?: string;
      error?: string;
    }>;
    restoreBackup: (name: string) => Promise<{ ok: boolean; state?: any; error?: string }>;
    openDataFolder: () => Promise<{ ok: boolean; dataDir?: string; error?: string }>;
    chooseExternalFolder: () => Promise<{ ok: boolean; folderPath?: string; canceled?: boolean; error?: string }>;
    syncExternalBackup: (folderPath: string) => Promise<{
      ok: boolean;
      disconnected?: boolean;
      targetFile?: string;
      timestamp?: number;
      error?: string;
    }>;
    saveVisitSnapshot?: (
      visitId: string,
      visitData: any
    ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
    checkImagesExist?: (
      dates: string[]
    ) => Promise<{ ok: boolean; missingDates: string[] }>;
    exportJson: (payload: any) => Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }>;
    importJson: () => Promise<{ ok: boolean; data?: any; canceled?: boolean; error?: string }>;
  };
  ocr: {
    readLedger: (params: {
      imageBase64: string;
      mimeType?: string;
      forcedSideType?: 'buy' | 'sell' | 'auto';
      slicePosition?: 'full' | 'top' | 'bottom';
      modelName?: string;
      passcode?: string;
    }) => Promise<{ ok: boolean; data?: any; requirePasscode?: boolean; error?: string }>;
  };
  ai: {
    summarize: (params: {
      aggregatedStats: any;
      modelName?: string;
      passcode?: string;
    }) => Promise<{ ok: boolean; summary?: string; requirePasscode?: boolean; error?: string }>;
    setApiKey: (key: string) => Promise<{ ok: boolean; warning?: string; error?: string }>;
    getApiKeyStatus: () => Promise<{
      ok: boolean;
      hasKey: boolean;
      encryptionAvailable: boolean;
      usingEnvKey?: boolean;
    }>;
    testApiKey: (
      customKey?: string,
      modelName?: string
    ) => Promise<{ ok: boolean; message?: string; error?: string }>;
  };
  security: {
    getStatus: () => Promise<{
      ok: boolean;
      enabled: boolean;
      idleMinutes: number;
      securityFilePath?: string;
    }>;
    verifyPassword: (password: string) => Promise<{ ok: boolean; valid: boolean; error?: string }>;
    configure: (params: {
      currentPassword?: string;
      newPassword?: string;
      enabled: boolean;
      idleMinutes: number;
    }) => Promise<{ ok: boolean; error?: string }>;
  };
  print: {
    saveToPdf: (defaultFilename?: string) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  };
}

declare global {
  interface Window {
    goldApi: GoldApi;
  }
}

const IDB_FALLBACK_STATE_KEY = 'gold_audit_v3_state';
const IDB_FALLBACK_IMAGES_KEY = 'gold_audit_v3_images';

async function safeFetchJson(url: string, options?: RequestInit): Promise<any> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'تعذر الاتصال بالعملية الرئيسية' };
  }
}

export function ensureGoldApiBridge(): GoldApi {
  if (typeof window !== 'undefined' && window.goldApi) {
    return window.goldApi;
  }

  const webGoldApi: GoldApi = {
    isElectron: false,
    storage: {
      load: async () => {
        const res = await safeFetchJson('/api/desktop/storage/load');
        if (res && res.ok) {
          if (res.isFirstRun) {
            // Check if legacy IndexedDB has state to migrate seamlessly
            try {
              const idbState = await idbGet<any>(IDB_FALLBACK_STATE_KEY);
              if (idbState && Array.isArray(idbState.operations) && idbState.operations.length > 0) {
                await safeFetchJson('/api/desktop/storage/save', {
                  method: 'POST',
                  body: JSON.stringify({ state: idbState }),
                });
                return { ok: true, state: idbState, isFirstRun: false };
              }
            } catch {
              // ignore IDB read
            }
          }
          return res;
        }
        // Fallback to IndexedDB if backend route is unreachable
        try {
          const idbState = await idbGet<any>(IDB_FALLBACK_STATE_KEY);
          return { ok: true, state: idbState || null, isFirstRun: !idbState };
        } catch (err: any) {
          return { ok: false, error: err?.message || 'فشل تحميل البيانات' };
        }
      },

      save: async (state: any) => {
        // Also mirror to IDB for browser resilience
        try {
          await idbSet(IDB_FALLBACK_STATE_KEY, state);
        } catch {
          // ignore
        }
        return safeFetchJson('/api/desktop/storage/save', {
          method: 'POST',
          body: JSON.stringify({ state }),
        });
      },

      createSnapshotBackup: async (label?: string) => {
        return safeFetchJson('/api/desktop/storage/snapshot', {
          method: 'POST',
          body: JSON.stringify({ label }),
        });
      },

      saveImage: async (date: string, dataUrl: string) => {
        try {
          const existing = (await idbGet<Record<string, string>>(IDB_FALLBACK_IMAGES_KEY)) || {};
          existing[date] = dataUrl;
          await idbSet(IDB_FALLBACK_IMAGES_KEY, existing);
        } catch {
          // ignore
        }
        return safeFetchJson('/api/desktop/storage/image/save', {
          method: 'POST',
          body: JSON.stringify({ date, dataUrl }),
        });
      },

      loadImage: async (date: string) => {
        const res = await safeFetchJson(`/api/desktop/storage/image/${encodeURIComponent(date)}`);
        if (res && res.ok && res.dataUrl) {
          return res;
        }
        try {
          const existing = (await idbGet<Record<string, string>>(IDB_FALLBACK_IMAGES_KEY)) || {};
          return { ok: true, dataUrl: existing[date] || null };
        } catch {
          return { ok: true, dataUrl: null };
        }
      },

      deleteImage: async (date: string) => {
        try {
          const existing = (await idbGet<Record<string, string>>(IDB_FALLBACK_IMAGES_KEY)) || {};
          delete existing[date];
          await idbSet(IDB_FALLBACK_IMAGES_KEY, existing);
        } catch {
          // ignore
        }
        return safeFetchJson(`/api/desktop/storage/image/${encodeURIComponent(date)}`, {
          method: 'DELETE',
        });
      },

      listBackups: async () => {
        return safeFetchJson('/api/desktop/storage/backups');
      },

      restoreBackup: async (name: string) => {
        return safeFetchJson('/api/desktop/storage/backups/restore', {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
      },

      openDataFolder: async () => {
        const info = await safeFetchJson('/api/desktop/storage/backups');
        return {
          ok: true,
          dataDir: info?.dataDir || 'GoldAuditData/GoldAudit',
        };
      },

      chooseExternalFolder: async () => {
        return {
          ok: false,
          error: 'في وضع المتصفح يمكنك كتابة مسار المجلد يدوياً. في نسخة ويندوز (Electron) تفتح نافذة اختيار المجلد تلقائياً.',
        };
      },

      syncExternalBackup: async (folderPath: string) => {
        return safeFetchJson('/api/desktop/storage/external-sync', {
          method: 'POST',
          body: JSON.stringify({ folderPath }),
        });
      },

      saveVisitSnapshot: async (visitId: string, visitData: any) => {
        return safeFetchJson('/api/desktop/storage/visit-snapshot', {
          method: 'POST',
          body: JSON.stringify({ visitId, visitData }),
        });
      },

      checkImagesExist: async (dates: string[]) => {
        const res = await safeFetchJson('/api/desktop/storage/check-images', {
          method: 'POST',
          body: JSON.stringify({ dates }),
        });
        return {
          ok: Boolean(res?.ok),
          missingDates: Array.isArray(res?.missingDates) ? res.missingDates : [],
        };
      },

      exportJson: async (payload: any) => {
        try {
          const str = JSON.stringify(payload, null, 2);
          const blob = new Blob([str], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const stamp = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `نسخة_مراجع_الذهب_${stamp}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return { ok: true };
        } catch (err: any) {
          return { ok: false, error: err?.message || 'تعذر تصدير ملف JSON' };
        }
      },

      importJson: async () => {
        return { ok: false, canceled: true };
      },
    },

    ocr: {
      readLedger: async (params) => {
        const headers: Record<string, string> = {};
        if (params.passcode) {
          headers['x-app-passcode'] = params.passcode;
        }
        return safeFetchJson('/api/desktop/ocr/read-ledger', {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        });
      },
    },

    ai: {
      summarize: async (params) => {
        const headers: Record<string, string> = {};
        if (params.passcode) {
          headers['x-app-passcode'] = params.passcode;
        }
        return safeFetchJson('/api/desktop/ai/summarize', {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        });
      },
      setApiKey: async (key: string) => {
        return safeFetchJson('/api/desktop/ai/set-key', {
          method: 'POST',
          body: JSON.stringify({ key }),
        });
      },
      getApiKeyStatus: async () => {
        const res = await safeFetchJson('/api/desktop/ai/key-status');
        return {
          ok: Boolean(res?.ok),
          hasKey: Boolean(res?.hasKey),
          encryptionAvailable: Boolean(res?.encryptionAvailable),
          usingEnvKey: Boolean(res?.usingEnvKey),
        };
      },
      testApiKey: async (customKey?: string, modelName?: string) => {
        return safeFetchJson('/api/desktop/ai/test-key', {
          method: 'POST',
          body: JSON.stringify({ customKey, modelName }),
        });
      },
    },

    security: {
      getStatus: async () => {
        const res = await safeFetchJson('/api/desktop/security/status');
        return {
          ok: true,
          enabled: Boolean(res?.enabled),
          idleMinutes: typeof res?.idleMinutes === 'number' ? res.idleMinutes : 15,
          securityFilePath: res?.securityFilePath || 'GoldAudit/data/security.json',
        };
      },
      verifyPassword: async (password: string) => {
        return safeFetchJson('/api/desktop/security/verify', {
          method: 'POST',
          body: JSON.stringify({ password }),
        });
      },
      configure: async (params) => {
        return safeFetchJson('/api/desktop/security/configure', {
          method: 'POST',
          body: JSON.stringify(params),
        });
      },
    },

    print: {
      saveToPdf: async () => {
        window.print();
        return { ok: true };
      },
    },
  };

  if (typeof window !== 'undefined') {
    window.goldApi = webGoldApi;
  }
  return webGoldApi;
}
