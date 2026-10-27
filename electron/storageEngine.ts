import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const CURRENT_SCHEMA_VERSION = 2;

export interface BackupFileInfo {
  name: string;
  createdAt: number;
  sizeBytes: number;
  operationsCount: number;
  schemaVersion: number;
}

export interface SecurityConfig {
  enabled: boolean;
  passwordHash?: string;
  salt?: string;
  idleMinutes: number;
  updatedAt: number;
}

/**
 * Prevents path traversal attacks by allowing only safe date/backup filenames.
 */
export function sanitizeSafeFilename(name: string): string {
  const base = path.basename(String(name || '')).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!base || base.includes('..')) {
    throw new Error('اسم ملف غير صالح.');
  }
  return base;
}

export function sanitizeDateKey(date: string): string {
  const cleaned = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error('صيغة التاريخ غير صالحة لحفظ الصورة.');
  }
  return cleaned;
}

/**
 * Atomic file write: writes to .tmp, flushes to disk with fsyncSync,
 * copies existing target to .bak if valid, and renames .tmp -> target.
 */
export function writeJsonAtomically(targetPath: string, data: any, keepBak = true): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${targetPath}.tmp`;
  const bakPath = `${targetPath}.bak`;
  const serialized = JSON.stringify(data, null, 2);

  // If current target exists and is valid JSON, preserve it as .bak before overwriting
  if (keepBak && fs.existsSync(targetPath)) {
    try {
      const existingRaw = fs.readFileSync(targetPath, 'utf-8');
      JSON.parse(existingRaw); // verify valid JSON before overwriting .bak
      fs.copyFileSync(targetPath, bakPath);
    } catch {
      // Do not overwrite .bak with a corrupted file
    }
  }

  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, serialized, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, targetPath);
}

/**
 * Migrates older schema states to CURRENT_SCHEMA_VERSION (v2).
 */
export function migrateState(rawState: any): { migrated: any; wasMigrated: boolean } {
  if (!rawState || typeof rawState !== 'object') {
    return { migrated: rawState, wasMigrated: false };
  }

  const version = typeof rawState.schemaVersion === 'number' ? rawState.schemaVersion : 1;
  if (version >= CURRENT_SCHEMA_VERSION) {
    return { migrated: rawState, wasMigrated: false };
  }

  const migrated = { ...rawState };

  // Ensure operations have default karat = 21 for buy/sell
  if (Array.isArray(migrated.operations)) {
    migrated.operations = migrated.operations.map((op: any) => ({
      ...op,
      karat: op.karat ?? (op.kind === 'buy' || op.kind === 'sell' ? 21 : undefined),
    }));
  }

  // Ensure closedSalaryMonths array exists
  if (!Array.isArray(migrated.closedSalaryMonths)) {
    migrated.closedSalaryMonths = [];
  }

  // Ensure pricePresets & showItemColumn exist
  if (!Array.isArray(migrated.pricePresets)) {
    migrated.pricePresets = [];
  }
  if (!Array.isArray(migrated.deletedOperations)) {
    migrated.deletedOperations = [];
  }
  if (!Array.isArray(migrated.auditVisits)) {
    migrated.auditVisits = [];
  }
  if (typeof migrated.showItemColumn !== 'boolean') {
    migrated.showItemColumn = false;
  }

  // Ensure settings have v2 desktop fields
  migrated.settings = {
    ...(migrated.settings || {}),
    shopName: migrated.settings?.shopName === 'مجوهرات الأمانة' ? '' : (migrated.settings?.shopName ?? ''),
    allowedPriceRange: migrated.settings?.allowedPriceRange || {
      sellMinBelowDaily: 0,
      sellMaxMakingCharge: 250,
      buyMaxDiscount: 200,
    },
    karatToleranceG: migrated.settings?.karatToleranceG || {
      '18': 0.5,
      '21': 0.5,
      '24': 0.5,
      other: 0.5,
    },
    combinedGoldInventory: Boolean(migrated.settings?.combinedGoldInventory),
    shortSpaceWeightMode: migrated.settings?.shortSpaceWeightMode || 'ask',
    geminiModel: migrated.settings?.geminiModel || 'gemini-3.8-flash',
    disablePhotoUpload: Boolean(migrated.settings?.disablePhotoUpload),
    externalBackupPath: migrated.settings?.externalBackupPath || '',
    lastExternalBackupAt: migrated.settings?.lastExternalBackupAt,
    onboardingCompleted: Boolean(
      migrated.settings?.onboardingCompleted ||
        (Array.isArray(migrated.operations) && migrated.operations.length > 0)
    ),
  };

  migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
  return { migrated, wasMigrated: true };
}

export class GoldStorageEngine {
  public readonly rootDir: string;
  public readonly dataDir: string;
  public readonly imagesDir: string;
  public readonly backupsDir: string;
  public readonly visitsDir: string;
  public readonly stateFilePath: string;
  public readonly securityFilePath: string;
  private lastDailyBackupDate: string | null = null;
  private failedAttempts = 0;
  private lockedUntil = 0;

  constructor(baseDir: string) {
    this.rootDir = baseDir;
    this.dataDir = path.join(baseDir, 'data');
    this.imagesDir = path.join(this.dataDir, 'images');
    this.backupsDir = path.join(baseDir, 'backups');
    this.visitsDir = path.join(baseDir, 'visits');
    this.stateFilePath = path.join(this.dataDir, 'state.json');
    this.securityFilePath = path.join(this.dataDir, 'security.json');

    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.imagesDir, { recursive: true });
    fs.mkdirSync(this.backupsDir, { recursive: true });
    fs.mkdirSync(this.visitsDir, { recursive: true });
  }

  private formatTimestampForBackup(d = new Date()): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}-${hh}${min}${ss}`;
  }

  /**
   * Rotates backups in backups/: keeps last 30 daily backups and last 12 monthly backups.
   */
  public rotateBackups(): void {
    try {
      const files = fs
        .readdirSync(this.backupsDir)
        .filter((f) => f.startsWith('state-') && f.endsWith('.json'))
        .map((f) => {
          const full = path.join(this.backupsDir, f);
          const stat = fs.statSync(full);
          return { name: f, full, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length <= 30) return;

      const keepSet = new Set<string>();
      // Keep newest 30 backups
      for (const f of files.slice(0, 30)) {
        keepSet.add(f.name);
      }

      // Also keep 1 backup per month for up to 12 months
      const seenMonths = new Set<string>();
      for (const f of files) {
        const match = f.name.match(/^state-(\d{4}-\d{2})-/);
        if (match) {
          const ym = match[1];
          if (!seenMonths.has(ym) && seenMonths.size < 12) {
            seenMonths.add(ym);
            keepSet.add(f.name);
          }
        }
      }

      for (const f of files) {
        if (!keepSet.has(f.name)) {
          try {
            fs.unlinkSync(f.full);
          } catch {
            // ignore deletion error
          }
        }
      }
    } catch {
      // ignore rotation errors
    }
  }

  public createSnapshotBackup(customLabel?: string): { ok: boolean; filename?: string; error?: string } {
    try {
      if (!fs.existsSync(this.stateFilePath)) {
        return { ok: true };
      }
      const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
      JSON.parse(raw); // Ensure valid JSON before backing up

      // Skip creating a duplicate backup if content is identical to the newest backup (unless pre-migrate / pre-restore)
      if (customLabel !== 'pre-migrate' && customLabel !== 'pre-restore') {
        const existing = fs
          .readdirSync(this.backupsDir)
          .filter((f) => f.startsWith('state-') && f.endsWith('.json'))
          .map((f) => {
            const full = path.join(this.backupsDir, f);
            return { name: f, full, mtime: fs.statSync(full).mtimeMs };
          })
          .sort((a, b) => b.mtime - a.mtime);

        if (existing.length > 0) {
          try {
            const latestRaw = fs.readFileSync(existing[0].full, 'utf-8');
            if (latestRaw === raw) {
              return { ok: true, filename: existing[0].name };
            }
          } catch {
            // proceed with creating backup
          }
        }
      }

      const stamp = this.formatTimestampForBackup();
      const suffix = customLabel ? `-${customLabel.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
      const filename = `state-${stamp}${suffix}.json`;
      const dest = path.join(this.backupsDir, filename);
      fs.writeFileSync(dest, raw, 'utf-8');
      this.rotateBackups();
      return { ok: true, filename };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر إنشاء نسخة احتياطية تلقائية.' };
    }
  }

  /**
   * Loads state.json; if corrupted, recovers from state.json.bak or newest backup in backups/.
   */
  public loadState(): {
    ok: boolean;
    state?: any;
    isFirstRun?: boolean;
    recoveredFromBackup?: boolean;
    recoverySource?: string;
    migratedFromOldSchema?: boolean;
    error?: string;
  } {
    const bakPath = `${this.stateFilePath}.bak`;

    const tryParseFile = (filePath: string): any | null => {
      if (!fs.existsSync(filePath)) return null;
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object') return parsed;
        return null;
      } catch {
        return null;
      }
    };

    try {
      const mainExist = fs.existsSync(this.stateFilePath);
      let loaded = tryParseFile(this.stateFilePath);
      let recoveredFromBackup = false;
      let recoverySource = '';

      if (!loaded) {
        // state.json is missing or corrupted — try .bak first, then newest backup in backups/
        loaded = tryParseFile(bakPath);
        if (loaded) {
          recoveredFromBackup = true;
          recoverySource = 'state.json.bak';
        } else {
          // Try newest valid backup in backups/
          const backupFiles = fs
            .readdirSync(this.backupsDir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => ({
              name: f,
              full: path.join(this.backupsDir, f),
              mtime: fs.statSync(path.join(this.backupsDir, f)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);

          for (const bf of backupFiles) {
            const candidate = tryParseFile(bf.full);
            if (candidate) {
              loaded = candidate;
              recoveredFromBackup = true;
              recoverySource = bf.name;
              break;
            }
          }
        }

        if (loaded && recoveredFromBackup) {
          // Restore healthy state.json immediately
          writeJsonAtomically(this.stateFilePath, loaded, false);
        } else if (mainExist) {
          return {
            ok: false,
            error: 'ملف البيانات الأساسي (state.json) تالف ولم يتم العثور على نسخة احتياطية صالحة.',
          };
        }
      }

      if (!loaded) {
        return { ok: true, state: null, isFirstRun: true };
      }

      // Check if schema migration is needed
      const { migrated, wasMigrated } = migrateState(loaded);
      if (wasMigrated) {
        this.createSnapshotBackup('pre-migrate');
        writeJsonAtomically(this.stateFilePath, migrated, true);
      }

      // Create daily backup on first load of the day
      const todayStr = new Date().toISOString().slice(0, 10);
      if (this.lastDailyBackupDate !== todayStr) {
        this.lastDailyBackupDate = todayStr;
        this.createSnapshotBackup();
      }

      return {
        ok: true,
        state: migrated,
        isFirstRun: false,
        recoveredFromBackup,
        recoverySource,
        migratedFromOldSchema: wasMigrated,
      };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'حدث خطأ أثناء قراءة ملف البيانات.' };
    }
  }

  public saveState(state: any): { ok: boolean; savedAt?: number; error?: string } {
    try {
      if (!state || typeof state !== 'object') {
        return { ok: false, error: 'بيانات الحالة غير صالحة للحفظ.' };
      }

      // Strip inline base64 images from daysMap before writing state.json
      // (images are stored separately in data/images/<date>.jpg)
      const cleanedDaysMap: Record<string, any> = {};
      if (state.daysMap && typeof state.daysMap === 'object') {
        for (const [dateKey, dayVal] of Object.entries<any>(state.daysMap)) {
          if (!dayVal) continue;
          const copy = { ...dayVal };
          if (copy.ledgerImageDataUrl && copy.ledgerImageDataUrl.startsWith('data:image')) {
            // Save to images/<date>.jpg automatically if not yet saved
            try {
              this.saveImage(dateKey, copy.ledgerImageDataUrl);
              copy.ledgerImageFile = `${sanitizeDateKey(dateKey)}.jpg`;
            } catch {
              // ignore image save error
            }
            delete copy.ledgerImageDataUrl;
          }
          cleanedDaysMap[dateKey] = copy;
        }
      }

      const payload = {
        ...state,
        daysMap: cleanedDaysMap,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        updatedAt: Date.now(),
      };

      writeJsonAtomically(this.stateFilePath, payload, true);
      return { ok: true, savedAt: payload.updatedAt };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'فشل حفظ البيانات على القرص.' };
    }
  }

  public saveImage(date: string, dataUrl: string): { ok: boolean; filename?: string; error?: string } {
    try {
      const safeDate = sanitizeDateKey(date);
      const filename = `${safeDate}.jpg`;
      const targetPath = path.join(this.imagesDir, filename);

      const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const buf = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(targetPath, buf);
      return { ok: true, filename };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر حفظ صورة الدفتر.' };
    }
  }

  public loadImage(date: string): { ok: boolean; dataUrl?: string | null; error?: string } {
    try {
      const safeDate = sanitizeDateKey(date);
      const targetPath = path.join(this.imagesDir, `${safeDate}.jpg`);
      if (!fs.existsSync(targetPath)) {
        return { ok: true, dataUrl: null };
      }
      const buf = fs.readFileSync(targetPath);
      return { ok: true, dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر تحميل صورة الدفتر.' };
    }
  }

  public deleteImage(date: string): { ok: boolean; error?: string } {
    try {
      const safeDate = sanitizeDateKey(date);
      const targetPath = path.join(this.imagesDir, `${safeDate}.jpg`);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر حذف صورة الدفتر.' };
    }
  }

  public listBackups(): { ok: boolean; backups?: BackupFileInfo[]; dataDir?: string; error?: string } {
    try {
      const files = fs
        .readdirSync(this.backupsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const full = path.join(this.backupsDir, f);
          const stat = fs.statSync(full);
          let operationsCount = 0;
          let schemaVersion = 1;
          try {
            const parsed = JSON.parse(fs.readFileSync(full, 'utf-8'));
            operationsCount = Array.isArray(parsed.operations) ? parsed.operations.length : 0;
            schemaVersion = parsed.schemaVersion || 1;
          } catch {
            // ignore parse error
          }
          return {
            name: f,
            createdAt: stat.mtimeMs,
            sizeBytes: stat.size,
            operationsCount,
            schemaVersion,
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);

      return { ok: true, backups: files, dataDir: this.rootDir };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر قراءة قائمة النسخ الاحتياطية.' };
    }
  }

  public restoreBackup(name: string): { ok: boolean; state?: any; error?: string } {
    try {
      const safeName = sanitizeSafeFilename(name);
      const fullPath = path.join(this.backupsDir, safeName);
      if (!fs.existsSync(fullPath)) {
        return { ok: false, error: 'ملف النسخة الاحتياطية غير موجود.' };
      }

      const raw = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.operations)) {
        return { ok: false, error: 'ملف النسخة الاحتياطية غير صالح.' };
      }

      // Save current state before replacing
      this.createSnapshotBackup('pre-restore');

      const { migrated } = migrateState(parsed);
      writeJsonAtomically(this.stateFilePath, migrated, true);
      return { ok: true, state: migrated };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر استعادة النسخة الاحتياطية.' };
    }
  }

  public syncExternalBackup(externalDirPath: string): {
    ok: boolean;
    disconnected?: boolean;
    targetFile?: string;
    timestamp?: number;
    error?: string;
  } {
    try {
      const trimmed = String(externalDirPath || '').trim();
      if (!trimmed) {
        return { ok: false, error: 'لم يتم تحديد مسار مجلد النسخ الخارجي.' };
      }
      if (!fs.existsSync(trimmed)) {
        return {
          ok: false,
          disconnected: true,
          error: 'الفلاشة أو المجلد الخارجي غير موصول حالياً.',
        };
      }
      if (!fs.existsSync(this.stateFilePath)) {
        return { ok: false, error: 'لا يوجد ملف بيانات محفوظ لنسخه.' };
      }

      const stamp = this.formatTimestampForBackup();
      const latestFile = path.join(trimmed, 'gold-audit-state-latest.json');
      const datedFile = path.join(trimmed, `gold-audit-state-${stamp}.json`);

      fs.copyFileSync(this.stateFilePath, latestFile);
      fs.copyFileSync(this.stateFilePath, datedFile);

      if (fs.existsSync(this.imagesDir)) {
        const extImagesDir = path.join(trimmed, 'images');
        fs.cpSync(this.imagesDir, extImagesDir, {
          recursive: true,
          force: false,
          errorOnExist: false,
        });
      }

      return { ok: true, targetFile: latestFile, timestamp: Date.now() };
    } catch (err: any) {
      return {
        ok: false,
        disconnected: true,
        error: err?.message || 'تعذر النسخ إلى المجلد الخارجي (تأكد من توصيل الفلاشة وصلاحية الكتابة).',
      };
    }
  }

  public saveVisitSnapshot(visitId: string, visitData: any): {
    ok: boolean;
    filePath?: string;
    error?: string;
  } {
    try {
      const safeId = sanitizeSafeFilename(`${visitId}.json`);
      const targetPath = path.join(this.visitsDir, safeId);
      writeJsonAtomically(targetPath, visitData, false);
      return { ok: true, filePath: targetPath };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر حفظ لقطة الزيارة في مجلد الزيارات.' };
    }
  }

  public checkImagesExist(dates: string[]): {
    ok: boolean;
    missingDates: string[];
  } {
    const missingDates: string[] = [];
    for (const d of dates || []) {
      try {
        const safeDate = sanitizeDateKey(d);
        const imgPath = path.join(this.imagesDir, `${safeDate}.jpg`);
        if (!fs.existsSync(imgPath)) {
          missingDates.push(d);
        }
      } catch {
        missingDates.push(d);
      }
    }
    return { ok: true, missingDates };
  }

  // --- App Lock Security (Prompt 7.1: scrypt + salt in userData) ---

  private readSecurityFile(): SecurityConfig {
    try {
      if (fs.existsSync(this.securityFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.securityFilePath, 'utf-8'));
        return {
          enabled: Boolean(parsed.enabled && parsed.passwordHash && parsed.salt),
          passwordHash: parsed.passwordHash,
          salt: parsed.salt,
          idleMinutes: typeof parsed.idleMinutes === 'number' ? parsed.idleMinutes : 15,
          updatedAt: parsed.updatedAt || Date.now(),
        };
      }
    } catch {
      // ignore
    }
    return { enabled: false, idleMinutes: 15, updatedAt: Date.now() };
  }

  public getLockStatus(): {
    ok: boolean;
    enabled: boolean;
    idleMinutes: number;
    securityFilePath: string;
  } {
    const cfg = this.readSecurityFile();
    return {
      ok: true,
      enabled: cfg.enabled,
      idleMinutes: cfg.idleMinutes,
      securityFilePath: this.securityFilePath,
    };
  }

  public verifyPassword(password: string): { ok: boolean; valid: boolean; error?: string } {
    try {
      const now = Date.now();
      if (now < this.lockedUntil) {
        const secs = Math.ceil((this.lockedUntil - now) / 1000);
        return {
          ok: false,
          valid: false,
          error: `محاولات كثيرة خاطئة. انتظر ${secs} ثانية ثم أعد المحاولة.`,
        };
      }

      const cfg = this.readSecurityFile();
      if (!cfg.enabled || !cfg.passwordHash || !cfg.salt) {
        return { ok: true, valid: true };
      }
      const derived = crypto.scryptSync(String(password || ''), cfg.salt, 64).toString('hex');
      const a = Buffer.from(derived, 'hex');
      const b = Buffer.from(cfg.passwordHash, 'hex');
      const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!valid) {
        this.failedAttempts += 1;
        if (this.failedAttempts >= 5) {
          const lockSec = Math.min(300, 5 * 2 ** (this.failedAttempts - 5));
          this.lockedUntil = Date.now() + lockSec * 1000;
        }
      } else {
        this.failedAttempts = 0;
        this.lockedUntil = 0;
      }
      return { ok: true, valid };
    } catch (err: any) {
      return { ok: false, valid: false, error: err?.message || 'تعذر التحقق من كلمة المرور.' };
    }
  }

  public configureAppLock(params: {
    currentPassword?: string;
    newPassword?: string;
    enabled: boolean;
    idleMinutes: number;
  }): { ok: boolean; error?: string } {
    try {
      const currentCfg = this.readSecurityFile();
      if (currentCfg.enabled && currentCfg.passwordHash && currentCfg.salt) {
        const check = this.verifyPassword(params.currentPassword || '');
        if (!check.valid) {
          return { ok: false, error: check.error || 'كلمة المرور الحالية غير صحيحة.' };
        }
      }

      if (!params.enabled) {
        const disabledCfg: SecurityConfig = {
          enabled: false,
          idleMinutes: params.idleMinutes || 15,
          updatedAt: Date.now(),
        };
        writeJsonAtomically(this.securityFilePath, disabledCfg, false);
        return { ok: true };
      }

      const passToUse = params.newPassword?.trim();
      if (!passToUse && !currentCfg.passwordHash) {
        return { ok: false, error: 'يرجى إدخال كلمة مرور جديدة لتفعيل قفل البرنامج.' };
      }

      let salt = currentCfg.salt || crypto.randomBytes(16).toString('hex');
      let passwordHash = currentCfg.passwordHash;
      if (passToUse) {
        salt = crypto.randomBytes(16).toString('hex');
        passwordHash = crypto.scryptSync(passToUse, salt, 64).toString('hex');
      }

      const nextCfg: SecurityConfig = {
        enabled: true,
        salt,
        passwordHash,
        idleMinutes: Math.max(1, Math.min(240, Number(params.idleMinutes) || 15)),
        updatedAt: Date.now(),
      };
      writeJsonAtomically(this.securityFilePath, nextCfg, false);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر حفظ إعدادات قفل البرنامج.' };
    }
  }
}
