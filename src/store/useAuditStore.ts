import { create } from 'zustand';
import {
  AuditLogEntry,
  AuditSettings,
  AuditVisit,
  AuditVisitChecklist,
  AuditVisitSummarySnapshot,
  DayChecklist,
  DayInfo,
  DeletedOperationEntry,
  GoldKarat,
  ImportBatchRecord,
  ImportMappingTemplate,
  IssueReviewState,
  KaratBalanceEntry,
  KaratKey,
  Operation,
  OperationKind,
  Person,
  PersonFollowUp,
  PriceStatementPreset,
  QuarantinedRecord,
  SafetySnapshot,
  SavedFilterPreset,
  SensitivityPreset,
  Worker,
} from '../types';
import { formatNumber, formatWeight, getTodayIso } from '../utils/numerals';
import { generateDemoDataset } from '../utils/demoData';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';
import { validateAndQuarantineState } from '../validation/schemas';
import { reportAppError } from '../errors/catalog';
import { FixItSuggestion } from '../utils/fixItEngine';

export const DEFAULT_EXPENSE_CATEGORIES = [
  'كهرباء',
  'إيجار',
  'نظافة',
  'ضيافة',
  'مواصلات',
  'صيانة',
  'أخرى',
];

export const DEFAULT_SETTINGS: AuditSettings = {
  sensitivityPreset: 'medium',
  priceDiffMediumPct: 1.5,
  priceDiffHighPct: 3.0,
  robustZThreshold: 3.5,
  maxReasonableWeightG: 500,
  goldBalanceToleranceG: 0.5,
  karatToleranceG: {
    '18': 0.5,
    '21': 0.5,
    '24': 0.5,
    other: 0.5,
  },
  combinedGoldInventory: false,
  cashDiscrepancyThreshold: 200,
  workerAdvanceMediumPct: 50,
  workerAdvanceHighPct: 100,
  expenseSpikeMultiplier: 3,
  personOverdueMediumDays: 30,
  personOverdueHighDays: 90,
  goldDormantDays: 30,
  excludeFridays: true,
  dateFormatOrder: 'DMY',
  shortSpaceWeightMode: 'ask',
  allowedPriceRange: {
    sellMinBelowDaily: 0,
    sellMaxMakingCharge: 250,
    buyMaxDiscount: 150,
  },
  fixedRules: {
    enabled: true,
    sellBelowDailyByAmount: 30,
    buyAboveDailyByAmount: 50,
  },
  exceptions: {
    items: [],
    personIds: [],
    dates: [],
  },
  enableAiSummaryButton: false,
  shopName: '',
  auditorName: 'المراجع المالي',
  geminiModel: 'gemini-3.8-flash',
  disablePhotoUpload: false,
  externalBackupPath: '',
  onboardingCompleted: false,
  includePersonDataInExports: true,
};

export interface CarryOverConflictInfo {
  targetDate: string;
  fields: ('openingCash' | 'openingBalanceG')[];
  pendingValues: { openingCash?: number; openingBalanceG?: number };
}

export type SaveStatus = 'saved' | 'saving' | 'error';

export interface AuditStoreState {
  initialized: boolean;
  isFirstRun: boolean;
  saveStatus: SaveStatus;
  saveError: string | null;
  lastSavedAt: number | null;
  recoveredFromBackupNotice: string | null;
  externalBackupWarning: string | null;
  currentDate: string;
  currentKind: OperationKind;
  currentKarat: GoldKarat;
  showItemColumn: boolean;
  highlightedOpId: string | null;
  operations: Operation[];
  deletedOperations: DeletedOperationEntry[]; // F7.1: Recycle Bin
  daysMap: Record<string, DayInfo>;
  persons: Person[];
  workers: Worker[];
  auditLogs: AuditLogEntry[];
  issueReviews: Record<string, IssueReviewState>;
  expenseCategories: string[];
  pricePresets: PriceStatementPreset[];
  closedSalaryMonths: string[];
  auditVisits: AuditVisit[]; // F5: Audit Visits
  activeVisitId: string | null;
  lastBackupAt: number | null;
  settings: AuditSettings;
  lastAddedOpId: string | null;
  deletedOpUndo: Operation | null;
  carryOverConflict: CarryOverConflictInfo | null;

  // G1: Quarantine, Safety Snapshot & Safe Mode
  quarantinedRecords: QuarantinedRecord[];
  activeSafetySnapshot: SafetySnapshot | null;
  safeMode: boolean;
  safeModeReason: string | null;

  // G2: Unified Filter Presets
  savedFilterPresets: SavedFilterPreset[];

  // G3: Import Batches & Column Mapping Templates
  importBatches: ImportBatchRecord[];
  importTemplates: ImportMappingTemplate[];

  // Actions
  hydrateFromStorage: () => Promise<void>;
  flushSaveNow: (createBackupSnapshot?: boolean) => Promise<boolean>;
  dismissRecoveryNotice: () => void;
  dismissExternalBackupWarning: () => void;
  setHighlightedOpId: (id: string | null) => void;
  saveDayLedgerImage: (date: string, dataUrl: string | null) => Promise<{ ok: boolean; error?: string }>;
  loadDayLedgerImage: (date: string) => Promise<string | null>;
  setCurrentDate: (date: string) => void;
  setCurrentKind: (kind: OperationKind) => void;
  setCurrentKarat: (karat: GoldKarat) => void;
  setShowItemColumn: (show: boolean) => void;
  setDayGoldPrice: (date: string, price: number, confirmed?: boolean, reason?: string) => boolean;
  setBulkGoldPrices: (
    entries: {
      date: string;
      price21: number;
      price18?: number;
      price24?: number;
      priceOther?: number;
    }[]
  ) => { updatedCount: number; skippedLockedDates: string[] };
  confirmDayGoldPrice: (date: string) => void;
  updateDayInfo: (
    date: string,
    patch: Partial<DayInfo>,
    options?: { isManualOpening?: boolean; forceOverwriteNext?: boolean }
  ) => void;
  updateDayKaratBalance: (
    date: string,
    karatKey: KaratKey,
    patch: Partial<KaratBalanceEntry>
  ) => void;
  resolveCarryOverConflict: (confirmOverwrite: boolean) => void;
  updateDayChecklist: (date: string, patch: Partial<DayChecklist>) => void;
  toggleDayLock: (date: string, lock: boolean, reason?: string) => void;

  addOperation: (
    op: Omit<Operation, 'id' | 'createdAt' | 'updatedAt' | 'reviewedFlag' | 'note'> & {
      note?: string;
      reviewedFlag?: boolean;
    }
  ) => Operation | null;
  addOperationsBatch: (
    rows: Array<
      Omit<Operation, 'id' | 'createdAt' | 'updatedAt' | 'reviewedFlag' | 'note'> & {
        note?: string;
        importBatchId?: string;
        sourceType?: string;
      }
    >,
    dayGoldPriceOrMap?: number | Record<string, number> | null,
    sourceLabel?: string,
    batchMeta?: {
      sourceType?: string;
      fileSha?: string;
      attachedFileRef?: string;
    }
  ) => { ok: boolean; addedCount: number; batchId?: string; error?: string };
  updateOperation: (id: string, patch: Partial<Operation>, reason?: string) => boolean;
  deleteOperation: (id: string, reason?: string) => boolean;
  undoDeleteOperation: () => void;
  undoLastAddedOperation: () => boolean;
  toggleOperationReviewed: (id: string) => void;

  // F7: Recycle Bin
  restoreFromRecycleBin: (deletedEntryId: string) => boolean;
  emptyRecycleBinPermanently: (deletedEntryId?: string) => void;

  // Persons & F2 Debt Management
  addPerson: (person: Omit<Person, 'id' | 'createdAt'>) => Person;
  updatePerson: (id: string, patch: Partial<Person>) => void;
  addPersonFollowUp: (
    personId: string,
    followUp: Omit<PersonFollowUp, 'id' | 'createdAt'>
  ) => void;
  deletePersonFollowUp: (personId: string, followUpId: string) => void;
  mergeDuplicatePersons: (primaryPersonId: string, duplicatePersonId: string) => boolean;

  // Workers
  addWorker: (worker: Omit<Worker, 'id' | 'createdAt'>) => Worker;
  updateWorker: (id: string, patch: Partial<Worker>) => void;
  closeMonthSalaries: (
    month: string,
    closeDate: string,
    carryOverNegatives: boolean,
    forceClose?: boolean
  ) => { ok: boolean; netPaid: number; error?: string };

  // Expenses
  addExpenseCategory: (category: string) => void;

  // Issue Reviews
  setIssueReviewed: (issueId: string, reviewed: boolean, note?: string) => void;

  // F5: Audit Visits
  createAuditVisit: (params: {
    name: string;
    fromDate: string;
    toDate: string;
    notes?: string;
  }) => AuditVisit;
  setActiveVisitId: (id: string | null) => void;
  updateAuditVisit: (id: string, patch: Partial<AuditVisit>) => void;
  updateAuditVisitChecklist: (id: string, patch: Partial<AuditVisitChecklist>) => void;
  completeAuditVisit: (
    id: string,
    summarySnapshot: AuditVisitSummarySnapshot,
    lockDaysInPeriod: boolean
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;

  // Settings & Presets
  updateSettings: (patch: Partial<AuditSettings>) => void;
  applySensitivityPreset: (preset: SensitivityPreset) => void;
  savePricePreset: (preset: Omit<PriceStatementPreset, 'id'>) => void;
  deletePricePreset: (id: string) => void;
  markBackupExported: () => void;

  // Demo & Backup
  loadDemoData: () => void;
  clearAllData: () => void;
  importFullBackup: (data: any) => { ok: boolean; error?: string };

  // G1 Actions: Quarantine, Safety Snapshot, Safe Mode & Fix-It
  restoreQuarantinedRecord: (quarantineId: string, repairedData: any) => boolean;
  deleteQuarantinedRecord: (quarantineId: string) => void;
  createSafetySnapshot: (label: string) => SafetySnapshot;
  undoSafetySnapshot: () => boolean;
  dismissSafetySnapshot: () => void;
  exitSafeMode: () => void;
  applyFixItSuggestion: (suggestion: FixItSuggestion) => boolean;
  applyBulkFixItSuggestions: (suggestions: FixItSuggestion[]) => number;

  // G2 Actions: Export/Print Audit Log & Saved Filter Presets
  recordExportOrPrintLog: (description: string, format: string, isPrint?: boolean) => void;
  saveFilterPreset: (name: string, filter: SavedFilterPreset['filter'], screenId?: string) => void;
  deleteFilterPreset: (id: string) => void;

  // G3 Actions: Import Templates & Batch Rollback
  saveImportTemplate: (template: Omit<ImportMappingTemplate, 'id' | 'createdAt'>) => ImportMappingTemplate;
  deleteImportTemplate: (id: string) => void;
  rollbackImportBatch: (batchId: string) => { ok: boolean; rolledBackCount: number; error?: string };
}

export function findSuggestedGoldPrice(date: string, daysMap: Record<string, DayInfo>): number {
  if (daysMap[date]?.goldPricePerGram > 0) {
    return daysMap[date].goldPricePerGram;
  }
  const sortedDates = Object.keys(daysMap)
    .filter((d) => daysMap[d]?.goldPricePerGram > 0 && daysMap[d]?.priceConfirmed !== false)
    .sort();
  if (sortedDates.length === 0) {
    const anyWithPrice = Object.keys(daysMap)
      .filter((d) => daysMap[d]?.goldPricePerGram > 0)
      .sort();
    if (anyWithPrice.length === 0) return 0;
    const priorAny = anyWithPrice.filter((d) => d <= date);
    const bestAny =
      priorAny.length > 0 ? priorAny[priorAny.length - 1] : anyWithPrice[anyWithPrice.length - 1];
    return daysMap[bestAny].goldPricePerGram;
  }
  const prior = sortedDates.filter((d) => d <= date);
  const bestDate =
    prior.length > 0 ? prior[prior.length - 1] : sortedDates[sortedDates.length - 1];
  return daysMap[bestDate].goldPricePerGram;
}

/**
 * Finds the nearest subsequent date (> date) that already has operations or a day record in daysMap.
 * Never creates empty future calendar days (Fix B.4).
 */
export function findNearestSubsequentActiveDate(
  date: string,
  operations: Operation[],
  daysMap: Record<string, DayInfo>
): string | null {
  const candidates = new Set<string>();
  for (const op of operations) {
    if (op.date > date) candidates.add(op.date);
  }
  for (const d of Object.keys(daysMap)) {
    if (d > date) {
      const info = daysMap[d];
      const hasData =
        operations.some((o) => o.date === d) ||
        info.openingCash !== undefined ||
        info.actualCash !== undefined ||
        info.openingBalanceG !== undefined ||
        info.closingBalanceG !== undefined ||
        info.karatBalances !== undefined ||
        info.priceConfirmed;
      if (hasData) candidates.add(d);
    }
  }
  const sorted = Array.from(candidates).sort();
  return sorted.length > 0 ? sorted[0] : null;
}

// 400ms debounced + immediate flush persistence via window.goldApi.storage (Prompt 2)
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingStateForPersist: AuditStoreState | null = null;
let pendingImageChanged = false;
let storeSetStatusRef: ((partial: Partial<AuditStoreState>) => void) | null = null;

function buildSnapshotFromState(s: AuditStoreState) {
  const cleanDaysMap: Record<string, DayInfo> = {};
  const imagesToSave: Record<string, string> = {};

  for (const [dt, info] of Object.entries(s.daysMap)) {
    if (info.ledgerImageDataUrl && info.ledgerImageDataUrl.startsWith('data:image')) {
      imagesToSave[dt] = info.ledgerImageDataUrl;
    }
    const { ledgerImageDataUrl, ...rest } = info;
    if (imagesToSave[dt] || info.ledgerImageFile) {
      rest.ledgerImageFile = `${dt}.jpg`;
    }
    cleanDaysMap[dt] = rest;
  }

  const snapshot = {
    schemaVersion: 2,
    currentDate: s.currentDate,
    currentKind: s.currentKind,
    currentKarat: s.currentKarat,
    showItemColumn: s.showItemColumn,
    operations: s.operations,
    deletedOperations: s.deletedOperations,
    daysMap: cleanDaysMap,
    persons: s.persons,
    workers: s.workers,
    auditLogs: s.auditLogs,
    issueReviews: s.issueReviews,
    expenseCategories: s.expenseCategories,
    pricePresets: s.pricePresets,
    closedSalaryMonths: s.closedSalaryMonths,
    auditVisits: s.auditVisits,
    activeVisitId: s.activeVisitId,
    lastBackupAt: s.lastBackupAt,
    settings: s.settings,
    quarantinedRecords: s.quarantinedRecords,
    savedFilterPresets: s.savedFilterPresets,
    importBatches: s.importBatches,
    importTemplates: s.importTemplates,
  };

  return { snapshot, imagesToSave };
}

async function executePersistNow(s: AuditStoreState, saveImages: boolean): Promise<boolean> {
  if (s.safeMode) {
    // G1.5: Safe Mode blocks disk writes so corrupt or partial data never overwrites state.json
    return false;
  }
  const api = ensureGoldApiBridge();
  const { snapshot, imagesToSave } = buildSnapshotFromState(s);

  try {
    if (saveImages) {
      for (const [dt, dataUrl] of Object.entries(imagesToSave)) {
        await api.storage.saveImage(dt, dataUrl);
      }
    }
    const res = await api.storage.save(snapshot);
    if (res && res.ok) {
      storeSetStatusRef?.({
        saveStatus: 'saved',
        saveError: null,
        lastSavedAt: res.savedAt || Date.now(),
      });
      return true;
    } else {
      const errMsg = res?.error || 'فشل حفظ البيانات';
      storeSetStatusRef?.({
        saveStatus: 'error',
        saveError: errMsg,
      });
      reportAppError({
        code: 'E-STORE-001',
        screen: 'useAuditStore.executePersistNow',
        customMessage: errMsg,
      });
      return false;
    }
  } catch (err: any) {
    const errMsg = err?.message || 'فشل الحفظ على القرص';
    storeSetStatusRef?.({
      saveStatus: 'error',
      saveError: errMsg,
    });
    reportAppError({
      code: 'E-STORE-001',
      screen: 'useAuditStore.executePersistNow',
      customMessage: errMsg,
      stack: err?.stack,
    });
    return false;
  }
}

function persistStateSnapshot(
  state: AuditStoreState,
  imageModified = false,
  immediate = false
) {
  pendingStateForPersist = state;
  if (imageModified) pendingImageChanged = true;

  storeSetStatusRef?.({ saveStatus: 'saving', saveError: null });

  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  if (immediate) {
    const s = pendingStateForPersist;
    const saveImages = pendingImageChanged;
    pendingStateForPersist = null;
    pendingImageChanged = false;
    if (s) {
      executePersistNow(s, saveImages);
    }
    return;
  }

  persistTimer = setTimeout(() => {
    const s = pendingStateForPersist;
    const saveImages = pendingImageChanged;
    pendingStateForPersist = null;
    pendingImageChanged = false;
    persistTimer = null;
    if (!s) return;
    executePersistNow(s, saveImages);
  }, 400);
}

const KIND_LABELS: Record<OperationKind, string> = {
  buy: 'شراء',
  sell: 'بيع',
  expense: 'مصروف',
  advance: 'سلفة عامل',
  person: 'حركة شخص',
};

export const useAuditStore = create<AuditStoreState>((set, get) => {
  storeSetStatusRef = (partial) => set(partial);

  return {
    initialized: false,
    isFirstRun: false,
    saveStatus: 'saved',
    saveError: null,
    lastSavedAt: null,
    recoveredFromBackupNotice: null,
    externalBackupWarning: null,
    currentDate: getTodayIso(),
    currentKind: 'sell',
    currentKarat: 21,
    showItemColumn: false,
    highlightedOpId: null,
    operations: [],
    deletedOperations: [],
    daysMap: {
      [getTodayIso()]: {
        date: getTodayIso(),
        goldPricePerGram: 0,
        priceConfirmed: false,
        locked: false,
      },
    },
    persons: [],
    workers: [],
    auditLogs: [],
    issueReviews: {},
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
    pricePresets: [],
    closedSalaryMonths: [],
    auditVisits: [],
    activeVisitId: null,
    lastBackupAt: null,
    settings: DEFAULT_SETTINGS,
    lastAddedOpId: null,
    deletedOpUndo: null,
    carryOverConflict: null,
    quarantinedRecords: [],
    activeSafetySnapshot: null,
    safeMode: false,
    safeModeReason: null,
    savedFilterPresets: [],
    importBatches: [],
    importTemplates: [],

    hydrateFromStorage: async () => {
      const BOOT_CRASH_KEY = 'gold_audit_boot_crash_count';
      let priorCrashCount = 0;
      try {
        priorCrashCount = Number(localStorage.getItem(BOOT_CRASH_KEY) || '0') || 0;
        localStorage.setItem(BOOT_CRASH_KEY, String(priorCrashCount + 1));
      } catch {
        // ignore
      }

      try {
        if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
          navigator.storage.persist().catch(() => {});
        }

        const api = ensureGoldApiBridge();
        const res = await api.storage.load();

        if (res.ok && res.state && typeof res.state === 'object') {
          const saved = res.state;
          const validated = validateAndQuarantineState(saved);
          const mergedDaysMap: Record<string, DayInfo> = { ...validated.daysMap };

          // Load current date's ledger image if present
          const activeDate = saved.currentDate || getTodayIso();
          if (
            mergedDaysMap[activeDate]?.ledgerImageFile &&
            !mergedDaysMap[activeDate]?.ledgerImageDataUrl
          ) {
            const imgRes = await api.storage.loadImage(activeDate);
            if (imgRes.ok && imgRes.dataUrl) {
              mergedDaysMap[activeDate] = {
                ...mergedDaysMap[activeDate],
                ledgerImageDataUrl: imgRes.dataUrl,
              };
            }
          }

          const mergedSettings: AuditSettings = {
            ...DEFAULT_SETTINGS,
            ...(saved.settings || {}),
            allowedPriceRange: {
              ...DEFAULT_SETTINGS.allowedPriceRange,
              ...(saved.settings?.allowedPriceRange || {}),
            },
            karatToleranceG: {
              ...(DEFAULT_SETTINGS.karatToleranceG || {
                '18': 0.5,
                '21': 0.5,
                '24': 0.5,
                other: 0.5,
              }),
              ...(saved.settings?.karatToleranceG || {}),
            },
            fixedRules: {
              ...DEFAULT_SETTINGS.fixedRules,
              ...(saved.settings?.fixedRules || {}),
            },
            exceptions: {
              ...DEFAULT_SETTINGS.exceptions,
              ...(saved.settings?.exceptions || {}),
            },
          };

          const recoveryNotice = res.recoveredFromBackup
            ? `تنبيه هام: كان ملف البيانات الأساسي تالفاً وتمت استعادة آخر نسخة احتياطية سليمة تلقائياً (${
                res.recoverySource || 'state.json.bak'
              }).`
            : null;

          const visits: AuditVisit[] = Array.isArray(saved.auditVisits)
            ? saved.auditVisits
            : [];
          const inProg = visits.find((v) => v.status === 'in_progress');

          const existingQuarantined: QuarantinedRecord[] = Array.isArray(saved.quarantinedRecords)
            ? saved.quarantinedRecords
            : [];
          const combinedQuarantine = [...validated.quarantined, ...existingQuarantined];

          if (validated.quarantined.length > 0) {
            reportAppError({
              code: 'E-STORE-003',
              screen: 'hydrateFromStorage',
              customMessage: `تم عزل ${validated.quarantined.length} سجل تالف للمراجعة دون تعطيل النظام.`,
            });
          }

          const enterSafeMode = priorCrashCount >= 2;
          const safeModeReason = enterSafeMode
            ? 'تعذّر بدء التشغيل الطبيعي مرتين متتاليتين — تم تفعيل الوضع الآمن لمنع الكتابة فوق البيانات.'
            : null;

          set({
            initialized: true,
            isFirstRun: false,
            saveStatus: 'saved',
            lastSavedAt: saved.updatedAt || Date.now(),
            recoveredFromBackupNotice: recoveryNotice,
            currentDate: activeDate,
            currentKind: saved.currentKind || 'sell',
            currentKarat: saved.currentKarat || 21,
            showItemColumn: Boolean(saved.showItemColumn),
            operations: validated.operations,
            deletedOperations: Array.isArray(saved.deletedOperations)
              ? saved.deletedOperations
              : [],
            daysMap: mergedDaysMap,
            persons: validated.persons,
            workers: validated.workers,
            auditLogs: saved.auditLogs || [],
            issueReviews: saved.issueReviews || {},
            expenseCategories: saved.expenseCategories || DEFAULT_EXPENSE_CATEGORIES,
            pricePresets: saved.pricePresets || [],
            closedSalaryMonths: saved.closedSalaryMonths || [],
            auditVisits: visits,
            activeVisitId: saved.activeVisitId || inProg?.id || null,
            lastBackupAt: saved.lastBackupAt ?? null,
            settings: mergedSettings,
            quarantinedRecords: combinedQuarantine,
            savedFilterPresets: Array.isArray(saved.savedFilterPresets)
              ? saved.savedFilterPresets
              : [],
            importBatches: Array.isArray(saved.importBatches) ? saved.importBatches : [],
            importTemplates: Array.isArray(saved.importTemplates) ? saved.importTemplates : [],
            safeMode: enterSafeMode,
            safeModeReason,
          });

          try {
            localStorage.setItem(BOOT_CRASH_KEY, '0');
          } catch {
            // ignore
          }
        } else if (!res.ok && !res.isFirstRun) {
          reportAppError({
            code: 'E-STORE-002',
            screen: 'hydrateFromStorage',
          });
          set({
            initialized: true,
            isFirstRun: false,
            safeMode: true,
            safeModeReason:
              'تعذّر قراءة ملف البيانات الأساسي والنسخ الاحتياطية التلقائية. تم تفعيل الوضع الآمن لحماية ملفاتك من الكتابة فوقها.',
          });
        } else {
          try {
            localStorage.setItem(BOOT_CRASH_KEY, '0');
          } catch {
            // ignore
          }
          set({
            initialized: true,
            isFirstRun: Boolean(res.isFirstRun),
          });
        }
      } catch (err: any) {
        reportAppError({
          code: 'E-STORE-002',
          screen: 'hydrateFromStorage',
          customMessage: err?.message,
          stack: err?.stack,
        });
        set({
          initialized: true,
          safeMode: true,
          safeModeReason: 'حدث خطأ غير متوقع أثناء تحميل البيانات. تم تفعيل الوضع الآمن.',
        });
      }
    },

    flushSaveNow: async (createBackupSnapshot = false) => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      const s = pendingStateForPersist || get();
      const saveImgs = pendingImageChanged;
      pendingStateForPersist = null;
      pendingImageChanged = false;

      const ok = await executePersistNow(s, saveImgs);
      if (ok && createBackupSnapshot) {
        const api = ensureGoldApiBridge();
        await api.storage.createSnapshotBackup('manual-shortcut');
        const extPath = s.settings.externalBackupPath?.trim();
        if (extPath) {
          const extRes = await api.storage.syncExternalBackup(extPath);
          if (extRes.ok && extRes.timestamp) {
            get().updateSettings({ lastExternalBackupAt: extRes.timestamp });
          } else if (extRes.disconnected) {
            set({
              externalBackupWarning:
                extRes.error || 'الفلاشة أو المجلد الخارجي غير موصول حالياً.',
            });
          }
        }
      }
      return ok;
    },

    dismissRecoveryNotice: () => set({ recoveredFromBackupNotice: null }),
    dismissExternalBackupWarning: () => set({ externalBackupWarning: null }),
    setHighlightedOpId: (id) => set({ highlightedOpId: id }),

    saveDayLedgerImage: async (date, dataUrl) => {
      const api = ensureGoldApiBridge();
      if (!dataUrl) {
        await api.storage.deleteImage(date);
        get().updateDayInfo(date, { ledgerImageDataUrl: undefined, ledgerImageFile: undefined });
        return { ok: true };
      }
      const res = await api.storage.saveImage(date, dataUrl);
      if (res.ok) {
        get().updateDayInfo(date, {
          ledgerImageDataUrl: dataUrl,
          ledgerImageFile: res.filename || `${date}.jpg`,
        });
      }
      return res;
    },

    loadDayLedgerImage: async (date) => {
      const existing = get().daysMap[date]?.ledgerImageDataUrl;
      if (existing) return existing;
      const api = ensureGoldApiBridge();
      const res = await api.storage.loadImage(date);
      if (res.ok && res.dataUrl) {
        set((s) => ({
          daysMap: {
            ...s.daysMap,
            [date]: {
              ...(s.daysMap[date] || {
                date,
                goldPricePerGram: 0,
                priceConfirmed: false,
                locked: false,
              }),
              ledgerImageDataUrl: res.dataUrl!,
              ledgerImageFile: `${date}.jpg`,
            },
          },
        }));
        return res.dataUrl;
      }
      return null;
    },

    setCurrentDate: (date) => {
      set((state) => {
        const existingDay = state.daysMap[date];
        if (existingDay) {
          const nextState = { ...state, currentDate: date };
          persistStateSnapshot(nextState);
          return { currentDate: date };
        }
        const suggestedPrice = findSuggestedGoldPrice(date, state.daysMap);
        const nextDaysMap: Record<string, DayInfo> = {
          ...state.daysMap,
          [date]: {
            date,
            goldPricePerGram: suggestedPrice,
            priceConfirmed: false,
            locked: false,
          },
        };
        const nextState = { ...state, currentDate: date, daysMap: nextDaysMap };
        persistStateSnapshot(nextState);
        return { currentDate: date, daysMap: nextDaysMap };
      });
    },

    setCurrentKind: (kind) => {
      set((state) => {
        const nextState = { ...state, currentKind: kind };
        persistStateSnapshot(nextState);
        return { currentKind: kind };
      });
    },

    setCurrentKarat: (karat) => {
      set((state) => {
        const nextState = { ...state, currentKarat: karat };
        persistStateSnapshot(nextState);
        return { currentKarat: karat };
      });
    },

    setShowItemColumn: (show) => {
      set((state) => {
        const nextState = { ...state, showItemColumn: show };
        persistStateSnapshot(nextState);
        return { showItemColumn: show };
      });
    },

    // F6: Prevent editing locked day's gold price unless unlocked first, and log price edits
    setDayGoldPrice: (date, price, confirmed = true, reason) => {
      const currentState = get();
      const existingDay = currentState.daysMap[date];
      if (existingDay?.locked) {
        return false;
      }

      set((state) => {
        const existing = state.daysMap[date] || {
          date,
          goldPricePerGram: price,
          locked: false,
        };
        const oldPrice = existing.goldPricePerGram || 0;
        const wasConfirmed = Boolean(existing.priceConfirmed);

        const nextDaysMap: Record<string, DayInfo> = {
          ...state.daysMap,
          [date]: {
            ...existing,
            goldPricePerGram: price,
            priceConfirmed: price > 0 ? confirmed : false,
          },
        };

        let nextLogs = state.auditLogs;
        if (wasConfirmed && oldPrice > 0 && Math.abs(oldPrice - price) > 0.5 && confirmed) {
          const logEntry: AuditLogEntry = {
            id: `log-price-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            action: 'price_edit',
            date,
            wasLocked: Boolean(existing.locked),
            description: `تعديل سعر الذهب اليومي عيار 21 ليوم ${date}`,
            oldValue: `${formatNumber(oldPrice)} ج.م/جرام`,
            newValue: `${formatNumber(price)} ج.م/جرام`,
            reason: reason || '',
          };
          nextLogs = [logEntry, ...state.auditLogs];
        }

        const nextState = { ...state, daysMap: nextDaysMap, auditLogs: nextLogs };
        persistStateSnapshot(nextState);
        return { daysMap: nextDaysMap, auditLogs: nextLogs };
      });
      return true;
    },

    setBulkGoldPrices: (entries) => {
      const state = get();
      const skippedLockedDates: string[] = [];
      let updatedCount = 0;

      const nextDaysMap = { ...state.daysMap };
      const now = Date.now();
      const logsToAdd: AuditLogEntry[] = [];

      for (const item of entries) {
        if (!item.date || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
        if (item.price21 <= 0) continue;

        const existing = nextDaysMap[item.date];
        if (existing?.locked) {
          skippedLockedDates.push(item.date);
          continue;
        }

        const oldPrice = existing?.goldPricePerGram || 0;
        nextDaysMap[item.date] = {
          ...(existing || {
            date: item.date,
            locked: false,
          }),
          goldPricePerGram: item.price21,
          ...(item.price18 !== undefined ? { goldPrice18: item.price18 } : {}),
          ...(item.price24 !== undefined ? { goldPrice24: item.price24 } : {}),
          ...(item.priceOther !== undefined ? { goldPriceOther: item.priceOther } : {}),
          priceConfirmed: true,
        };
        updatedCount += 1;

        if (existing?.priceConfirmed && oldPrice > 0 && Math.abs(oldPrice - item.price21) > 0.5) {
          logsToAdd.push({
            id: `log-price-bulk-${now}-${updatedCount}`,
            timestamp: now,
            action: 'price_edit',
            date: item.date,
            wasLocked: false,
            description: `تحديث جماعي لسعر الذهب عيار 21 ليوم ${item.date}`,
            oldValue: `${formatNumber(oldPrice)} ج.م`,
            newValue: `${formatNumber(item.price21)} ج.م`,
          });
        }
      }

      if (updatedCount > 0) {
        set((s) => {
          const nextLogs = [...logsToAdd, ...s.auditLogs];
          const nextState = { ...s, daysMap: nextDaysMap, auditLogs: nextLogs };
          persistStateSnapshot(nextState);
          return { daysMap: nextDaysMap, auditLogs: nextLogs };
        });
      }

      return { updatedCount, skippedLockedDates };
    },

    confirmDayGoldPrice: (date) => {
      set((state) => {
        const existing = state.daysMap[date];
        if (!existing || existing.goldPricePerGram <= 0) return {};
        const nextDaysMap: Record<string, DayInfo> = {
          ...state.daysMap,
          [date]: {
            ...existing,
            priceConfirmed: true,
          },
        };
        const nextState = { ...state, daysMap: nextDaysMap };
        persistStateSnapshot(nextState);
        return { daysMap: nextDaysMap };
      });
    },

    updateDayInfo: (date, patch, options) => {
      set((state) => {
        const existing = state.daysMap[date] || {
          date,
          goldPricePerGram: findSuggestedGoldPrice(date, state.daysMap),
          priceConfirmed: false,
          locked: false,
        };
        const updatedDay: DayInfo = { ...existing, ...patch };
        if (options?.isManualOpening) {
          if (patch.openingCash !== undefined) updatedDay.openingCashManual = true;
          if (patch.openingBalanceG !== undefined) updatedDay.openingBalanceManual = true;
        }

        const nextDaysMap: Record<string, DayInfo> = {
          ...state.daysMap,
          [date]: updatedDay,
        };

        let nextConflict = state.carryOverConflict;

        const hasActualCashUpdate = patch.actualCash !== undefined && patch.actualCash !== null;
        const hasClosingGoldUpdate =
          patch.closingBalanceG !== undefined && patch.closingBalanceG !== null;

        if (hasActualCashUpdate || hasClosingGoldUpdate) {
          const nearestNextDate = findNearestSubsequentActiveDate(
            date,
            state.operations,
            nextDaysMap
          );

          if (nearestNextDate) {
            const targetDay = nextDaysMap[nearestNextDate] || {
              date: nearestNextDate,
              goldPricePerGram: updatedDay.goldPricePerGram,
              priceConfirmed: false,
              locked: false,
            };

            const conflictFields: ('openingCash' | 'openingBalanceG')[] = [];
            const pendingValues: { openingCash?: number; openingBalanceG?: number } = {};
            const targetClone = { ...targetDay };

            if (hasActualCashUpdate) {
              const alreadyManual =
                targetDay.openingCashManual &&
                targetDay.openingCash !== undefined &&
                Math.abs(targetDay.openingCash - patch.actualCash!) > 0.5;
              if (alreadyManual && !options?.forceOverwriteNext) {
                conflictFields.push('openingCash');
                pendingValues.openingCash = patch.actualCash!;
              } else {
                targetClone.openingCash = patch.actualCash!;
              }
            }

            if (hasClosingGoldUpdate) {
              const alreadyManual =
                targetDay.openingBalanceManual &&
                targetDay.openingBalanceG !== undefined &&
                Math.abs(targetDay.openingBalanceG - patch.closingBalanceG!) > 0.005;
              if (alreadyManual && !options?.forceOverwriteNext) {
                conflictFields.push('openingBalanceG');
                pendingValues.openingBalanceG = patch.closingBalanceG!;
              } else {
                targetClone.openingBalanceG = patch.closingBalanceG!;
              }
            }

            nextDaysMap[nearestNextDate] = targetClone;
            if (conflictFields.length > 0) {
              nextConflict = {
                targetDate: nearestNextDate,
                fields: conflictFields,
                pendingValues,
              };
            }
          }
        }

        const imageChanged = patch.ledgerImageDataUrl !== undefined;
        const nextState = {
          ...state,
          daysMap: nextDaysMap,
          carryOverConflict: nextConflict,
        };
        persistStateSnapshot(nextState, imageChanged);
        return { daysMap: nextDaysMap, carryOverConflict: nextConflict };
      });
    },

    // F4: Update per-karat inventory balance and auto-carryover closingG to nearest subsequent active day
    updateDayKaratBalance: (date, karatKey, patch) => {
      set((state) => {
        const existing = state.daysMap[date] || {
          date,
          goldPricePerGram: findSuggestedGoldPrice(date, state.daysMap),
          priceConfirmed: false,
          locked: false,
        };
        if (existing.locked) return {};

        const currentKarats = existing.karatBalances || {};
        const prevEntry = currentKarats[karatKey] || {};
        const updatedEntry: KaratBalanceEntry = {
          ...prevEntry,
          ...patch,
          ...(patch.openingG !== undefined ? { openingManual: true } : {}),
        };

        const updatedDay: DayInfo = {
          ...existing,
          karatBalances: {
            ...currentKarats,
            [karatKey]: updatedEntry,
          },
        };

        const nextDaysMap: Record<string, DayInfo> = {
          ...state.daysMap,
          [date]: updatedDay,
        };

        // Carry over closingG to nearest subsequent active date if not manually overridden
        if (patch.closingG !== undefined && patch.closingG !== null) {
          const nearestNextDate = findNearestSubsequentActiveDate(
            date,
            state.operations,
            nextDaysMap
          );
          if (nearestNextDate && !nextDaysMap[nearestNextDate]?.locked) {
            const nextDay = nextDaysMap[nearestNextDate] || {
              date: nearestNextDate,
              goldPricePerGram: updatedDay.goldPricePerGram,
              priceConfirmed: false,
              locked: false,
            };
            const nextKarats = nextDay.karatBalances || {};
            const nextEntry = nextKarats[karatKey] || {};
            if (!nextEntry.openingManual || nextEntry.openingG === undefined) {
              nextDaysMap[nearestNextDate] = {
                ...nextDay,
                karatBalances: {
                  ...nextKarats,
                  [karatKey]: {
                    ...nextEntry,
                    openingG: patch.closingG,
                  },
                },
              };
            }
          }
        }

        const nextState = { ...state, daysMap: nextDaysMap };
        persistStateSnapshot(nextState);
        return { daysMap: nextDaysMap };
      });
    },

    resolveCarryOverConflict: (confirmOverwrite) => {
      set((state) => {
        const conflict = state.carryOverConflict;
        if (!conflict) return {};
        if (!confirmOverwrite) {
          return { carryOverConflict: null };
        }
        const existing = state.daysMap[conflict.targetDate];
        if (!existing) return { carryOverConflict: null };
        const updatedTarget: DayInfo = {
          ...existing,
          ...(conflict.pendingValues.openingCash !== undefined
            ? { openingCash: conflict.pendingValues.openingCash, openingCashManual: false }
            : {}),
          ...(conflict.pendingValues.openingBalanceG !== undefined
            ? { openingBalanceG: conflict.pendingValues.openingBalanceG, openingBalanceManual: false }
            : {}),
        };
        const nextDaysMap = {
          ...state.daysMap,
          [conflict.targetDate]: updatedTarget,
        };
        const nextState = { ...state, daysMap: nextDaysMap, carryOverConflict: null };
        persistStateSnapshot(nextState);
        return { daysMap: nextDaysMap, carryOverConflict: null };
      });
    },

    updateDayChecklist: (date, patch) => {
      set((state) => {
        const existing = state.daysMap[date] || {
          date,
          goldPricePerGram: findSuggestedGoldPrice(date, state.daysMap),
          priceConfirmed: false,
          locked: false,
        };
        const currentChecklist: DayChecklist = existing.checklist || {
          cashVerified: false,
          balancesMatched: false,
          advancesChecked: false,
          debtsChecked: false,
          goldInventoryChecked: false,
        };
        const nextDaysMap = {
          ...state.daysMap,
          [date]: {
            ...existing,
            checklist: {
              ...currentChecklist,
              ...patch,
              visitedAt: getTodayIso(),
            },
          },
        };
        const nextState = { ...state, daysMap: nextDaysMap };
        persistStateSnapshot(nextState);
        return { daysMap: nextDaysMap };
      });
    },

    toggleDayLock: (date, lock, reason) => {
      set((state) => {
        const existing = state.daysMap[date] || {
          date,
          goldPricePerGram: findSuggestedGoldPrice(date, state.daysMap),
          priceConfirmed: false,
          locked: false,
        };
        const nextDaysMap = {
          ...state.daysMap,
          [date]: {
            ...existing,
            locked: lock,
            unlockReason: !lock ? reason : existing.unlockReason,
          },
        };
        const logEntry: AuditLogEntry = {
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          action: lock ? 'lock' : 'unlock',
          date,
          wasLocked: Boolean(existing.locked),
          description: lock ? `تم قفل يوم ${date} بعد المراجعة` : `تم فتح قفل يوم ${date}`,
          reason: reason || '',
        };
        const nextLogs = [logEntry, ...state.auditLogs];
        const nextState = { ...state, daysMap: nextDaysMap, auditLogs: nextLogs };
        persistStateSnapshot(nextState, false, true);

        if (lock && state.settings.externalBackupPath?.trim()) {
          const extFolder = state.settings.externalBackupPath.trim();
          setTimeout(async () => {
            const api = ensureGoldApiBridge();
            const res = await api.storage.syncExternalBackup(extFolder);
            if (res.ok && res.timestamp) {
              get().updateSettings({ lastExternalBackupAt: res.timestamp });
            } else if (res.disconnected) {
              set({
                externalBackupWarning:
                  res.error ||
                  'الفلاشة أو المجلد الخارجي غير موصول — لم يتم نسخ النسخة الخارجية بعد قفل اليوم.',
              });
            }
          }, 150);
        }

        return { daysMap: nextDaysMap, auditLogs: nextLogs };
      });
    },

    addOperation: (opInput) => {
      const state = get();
      if (state.daysMap[opInput.date]?.locked) {
        return null;
      }

      const now = Date.now();
      const newOp: Operation = {
        id: `op-${now}-${Math.random().toString(36).slice(2, 7)}`,
        date: opInput.date,
        kind: opInput.kind,
        karat:
          opInput.kind === 'buy' || opInput.kind === 'sell'
            ? opInput.karat || state.currentKarat || 21
            : opInput.karat,
        weightG: opInput.weightG || 0,
        total: opInput.total || 0,
        item: opInput.item || '',
        payment: opInput.payment || 'cash',
        personId: opInput.personId,
        workerId: opInput.workerId,
        direction: opInput.direction,
        category: opInput.category,
        reviewedFlag: opInput.reviewedFlag ?? false,
        note: opInput.note ?? '',
        createdAt: now,
        updatedAt: now,
      };

      set((s) => {
        const wasLocked = Boolean(s.daysMap[newOp.date]?.locked);
        const logEntry: AuditLogEntry = {
          id: `log-${now}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          action: 'add',
          rowId: newOp.id,
          date: newOp.date,
          kind: newOp.kind,
          wasLocked,
          description: `إضافة عملية (${KIND_LABELS[newOp.kind] || newOp.kind}${
            newOp.karat ? ` عيار ${newOp.karat}` : ''
          }) بتاريخ ${newOp.date}`,
          newValue: `${formatWeight(newOp.weightG)} جرام — ${formatNumber(newOp.total)} ج.م ${
            newOp.item ? `(${newOp.item})` : ''
          }`,
        };
        const nextOps = [...s.operations, newOp];
        const nextLogs = [logEntry, ...s.auditLogs];
        const nextState = {
          ...s,
          operations: nextOps,
          auditLogs: nextLogs,
          lastAddedOpId: newOp.id,
        };
        persistStateSnapshot(nextState);
        return {
          operations: nextOps,
          auditLogs: nextLogs,
          lastAddedOpId: newOp.id,
        };
      });

      return newOp;
    },

    addOperationsBatch: (rows, dayGoldPriceOrMap, sourceLabel = 'استيراد جماعي', batchMeta) => {
      const state = get();
      if (!rows || rows.length === 0) {
        return { ok: false, addedCount: 0, error: 'لا توجد صفوف صالحة للإضافة' };
      }

      const lockedDates = Array.from(
        new Set(rows.map((r) => r.date).filter((d) => state.daysMap[d]?.locked))
      );
      if (lockedDates.length > 0) {
        reportAppError({
          code: 'E-IMPORT-012',
          screen: 'useAuditStore.addOperationsBatch',
          customMessage: `Locked dates: ${lockedDates.join(', ')}`,
          silentToast: true,
        });
        return {
          ok: false,
          addedCount: 0,
          error: `لا يمكن الإضافة لأن التاريخ (${lockedDates.join(' ، ')}) مقفول بعد المراجعة. افتح القفل أولاً.`,
        };
      }

      // G1.6: Take safety snapshot before bulk import
      get().createSafetySnapshot(`استيراد جماعي (${rows.length} صف — ${sourceLabel})`);

      const now = Date.now();
      const batchId = `batch-${now}-${Math.random().toString(36).slice(2, 6)}`;
      const createdOps: Operation[] = rows.map((r, i) => ({
        id: `op-batch-${now}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        date: r.date,
        kind: r.kind,
        karat: r.karat || (r.kind === 'buy' || r.kind === 'sell' ? 21 : undefined),
        weightG: r.weightG || 0,
        total: r.total || 0,
        item: r.item || '',
        payment: r.payment || 'cash',
        personId: r.personId,
        workerId: r.workerId,
        direction: r.direction,
        category: r.category,
        reviewedFlag: false,
        note: r.note || '',
        createdAt: now + i,
        updatedAt: now + i,
        importBatchId: r.importBatchId || batchId,
        sourceType: r.sourceType || batchMeta?.sourceType || 'table',
      }));

      set((s) => {
        const nextDaysMap = { ...s.daysMap };
        const uniqueDates = Array.from(new Set(createdOps.map((o) => o.date)));

        for (const dt of uniqueDates) {
          const existingDay = nextDaysMap[dt] || {
            date: dt,
            goldPricePerGram: 0,
            priceConfirmed: false,
            locked: false,
          };
          let resolvedPrice = existingDay.goldPricePerGram;
          let confirmed = existingDay.priceConfirmed;

          if (typeof dayGoldPriceOrMap === 'number' && dayGoldPriceOrMap > 0) {
            resolvedPrice = dayGoldPriceOrMap;
            confirmed = true;
          } else if (
            dayGoldPriceOrMap &&
            typeof dayGoldPriceOrMap === 'object' &&
            dayGoldPriceOrMap[dt] > 0
          ) {
            resolvedPrice = dayGoldPriceOrMap[dt];
            confirmed = true;
          }

          nextDaysMap[dt] = {
            ...existingDay,
            goldPricePerGram: resolvedPrice,
            priceConfirmed: resolvedPrice > 0 ? confirmed : false,
          };
        }

        const primaryDate = uniqueDates[0] || s.currentDate;
        const batchLog: AuditLogEntry = {
          id: `log-batch-${now}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          action: 'import_batch',
          date: primaryDate,
          wasLocked: false,
          description: `إضافة مجمّعة (${createdOps.length} صف) — المصدر: ${sourceLabel}`,
          newValue: `${createdOps.length} عملية في التواريخ: ${uniqueDates.join(' ، ')}`,
        };

        const batchTotalWeightG = createdOps.reduce((sum, o) => sum + (o.weightG || 0), 0);
        const batchTotalAmount = createdOps.reduce((sum, o) => sum + (o.total || 0), 0);

        const batchRecord: ImportBatchRecord = {
          id: batchId,
          importedAt: now,
          sourceName: sourceLabel,
          sourceType: batchMeta?.sourceType || 'table',
          fileSha: batchMeta?.fileSha,
          operationsCount: createdOps.length,
          totalWeightG: batchTotalWeightG,
          totalAmount: batchTotalAmount,
          dates: uniqueDates,
          attachedFileRef: batchMeta?.attachedFileRef,
          rolledBack: false,
        };

        const nextOps = [...s.operations, ...createdOps];
        const nextLogs = [batchLog, ...s.auditLogs];
        const nextBatches = [batchRecord, ...s.importBatches].slice(0, 100);
        const nextState = {
          ...s,
          operations: nextOps,
          daysMap: nextDaysMap,
          auditLogs: nextLogs,
          importBatches: nextBatches,
        };
        persistStateSnapshot(nextState);
        return {
          operations: nextOps,
          daysMap: nextDaysMap,
          auditLogs: nextLogs,
          importBatches: nextBatches,
        };
      });

      return { ok: true, addedCount: createdOps.length, batchId };
    },

    updateOperation: (id, patch, reason) => {
      const state = get();
      const existing = state.operations.find((o) => o.id === id);
      if (!existing) return false;

      if (state.daysMap[existing.date]?.locked) {
        return false;
      }
      if (patch.date && state.daysMap[patch.date]?.locked) {
        return false;
      }

      const now = Date.now();
      const updated: Operation = { ...existing, ...patch, updatedAt: now };

      const oldParts: string[] = [];
      const newParts: string[] = [];
      const changedLabels: string[] = [];

      const checkField = (
        fieldKey: keyof Operation,
        label: string,
        formatter: (val: any) => string = (v) => String(v ?? '—')
      ) => {
        if (patch[fieldKey] !== undefined && patch[fieldKey] !== existing[fieldKey]) {
          changedLabels.push(label);
          oldParts.push(`${label}: ${formatter(existing[fieldKey])}`);
          newParts.push(`${label}: ${formatter(updated[fieldKey])}`);
        }
      };

      checkField('date', 'التاريخ');
      checkField('kind', 'النوع', (v) => KIND_LABELS[v as OperationKind] || v);
      checkField('karat', 'العيار', (v) => (v ? `عيار ${v}` : '21'));
      checkField('weightG', 'الوزن', (v) => `${formatWeight(Number(v) || 0)} ج`);
      checkField('total', 'المبلغ', (v) => `${formatNumber(Number(v) || 0)} ج.م`);
      checkField('item', 'البيان', (v) => v || 'بدون بيان');
      checkField('payment', 'الدفع', (v) => (v === 'credit' ? 'آجل' : 'نقدي'));
      checkField('personId', 'الشخص', (v) => state.persons.find((p) => p.id === v)?.name || v || '—');
      checkField('workerId', 'العامل', (v) => state.workers.find((w) => w.id === v)?.name || v || '—');
      checkField('direction', 'الاتجاه', (v) =>
        v === 'received_from_him' ? 'استلمنا منه' : 'أعطيناه'
      );
      checkField('category', 'البند');

      const isMaterialChange = changedLabels.length > 0;
      const isReviewOrNoteChange =
        (patch.reviewedFlag !== undefined && patch.reviewedFlag !== existing.reviewedFlag) ||
        (patch.note !== undefined && patch.note !== existing.note);

      set((s) => {
        const nextOps = s.operations.map((o) => (o.id === id ? updated : o));
        let nextLogs = s.auditLogs;
        const wasLocked = Boolean(
          s.daysMap[existing.date]?.locked || (patch.date && s.daysMap[patch.date]?.locked)
        );

        if (isMaterialChange) {
          const logEntry: AuditLogEntry = {
            id: `log-${now}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: now,
            action: 'edit',
            rowId: id,
            date: updated.date,
            kind: updated.kind,
            wasLocked,
            description: `تعديل (${changedLabels.join('، ')}) في عملية بتاريخ ${existing.date}`,
            oldValue: oldParts.join(' | '),
            newValue: newParts.join(' | '),
            reason: reason || '',
          };
          nextLogs = [logEntry, ...nextLogs];
        } else if (isReviewOrNoteChange) {
          const reviewLog: AuditLogEntry = {
            id: `log-rev-${now}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: now,
            action: 'review_note',
            rowId: id,
            date: existing.date,
            kind: existing.kind,
            wasLocked,
            description: `ملاحظة / علامة مراجعة لعملية بتاريخ ${existing.date}`,
            oldValue: `مراجع: ${existing.reviewedFlag ? 'نعم' : 'لا'}${
              existing.note ? ` (${existing.note})` : ''
            }`,
            newValue: `مراجع: ${updated.reviewedFlag ? 'نعم' : 'لا'}${
              updated.note ? ` (${updated.note})` : ''
            }`,
          };
          nextLogs = [reviewLog, ...nextLogs];
        }

        const nextState = { ...s, operations: nextOps, auditLogs: nextLogs };
        persistStateSnapshot(nextState);
        return { operations: nextOps, auditLogs: nextLogs };
      });

      return true;
    },

    // F7.1: Save every deleted operation into Recycle Bin (deletedOperations)
    deleteOperation: (id, reason) => {
      const state = get();
      const existing = state.operations.find((o) => o.id === id);
      if (!existing) return false;
      if (state.daysMap[existing.date]?.locked) {
        return false;
      }

      const now = Date.now();
      const trashEntry: DeletedOperationEntry = {
        id: `trash-${now}-${Math.random().toString(36).slice(2, 6)}`,
        operation: existing,
        deletedAt: now,
        reason: reason || 'حذف',
      };

      set((s) => {
        const nextOps = s.operations.filter((o) => o.id !== id);
        const nextTrash = [trashEntry, ...s.deletedOperations];
        const wasLocked = Boolean(s.daysMap[existing.date]?.locked);
        const logEntry: AuditLogEntry = {
          id: `log-${now}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          action: 'delete',
          rowId: id,
          date: existing.date,
          kind: existing.kind,
          wasLocked,
          description: `حذف عملية (${KIND_LABELS[existing.kind] || existing.kind}) بتاريخ ${existing.date} (نُقلت لسلة المحذوفات)`,
          oldValue: `${formatWeight(existing.weightG)} جرام — ${formatNumber(existing.total)} ج.م (${
            existing.item || 'بدون بيان'
          })`,
          newValue: 'محذوف (في السلة)',
          reason: reason || '',
        };
        const nextLogs = [logEntry, ...s.auditLogs];
        const nextState = {
          ...s,
          operations: nextOps,
          deletedOperations: nextTrash,
          auditLogs: nextLogs,
          deletedOpUndo: existing,
        };
        persistStateSnapshot(nextState);
        return {
          operations: nextOps,
          deletedOperations: nextTrash,
          auditLogs: nextLogs,
          deletedOpUndo: existing,
        };
      });

      return true;
    },

    undoDeleteOperation: () => {
      set((state) => {
        const restored = state.deletedOpUndo;
        if (!restored) return {};
        if (state.daysMap[restored.date]?.locked) return {};

        const now = Date.now();
        const logEntry: AuditLogEntry = {
          id: `log-undodel-${now}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          action: 'undo_delete',
          rowId: restored.id,
          date: restored.date,
          kind: restored.kind,
          wasLocked: Boolean(state.daysMap[restored.date]?.locked),
          description: `تراجع عن حذف عملية (${KIND_LABELS[restored.kind] || restored.kind}) بتاريخ ${
            restored.date
          }`,
          oldValue: 'محذوف',
          newValue: `${formatWeight(restored.weightG)} جرام — ${formatNumber(restored.total)} ج.م`,
        };

        const nextOps = [...state.operations, restored];
        const nextTrash = state.deletedOperations.filter((t) => t.operation.id !== restored.id);
        const nextLogs = [logEntry, ...state.auditLogs];
        const nextState = {
          ...state,
          operations: nextOps,
          deletedOperations: nextTrash,
          auditLogs: nextLogs,
          deletedOpUndo: null,
        };
        persistStateSnapshot(nextState);
        return {
          operations: nextOps,
          deletedOperations: nextTrash,
          auditLogs: nextLogs,
          deletedOpUndo: null,
        };
      });
    },

    // F7.1: Restore any operation from Recycle Bin
    restoreFromRecycleBin: (deletedEntryId) => {
      const state = get();
      const target = state.deletedOperations.find((t) => t.id === deletedEntryId);
      if (!target) return false;
      if (state.daysMap[target.operation.date]?.locked) return false;

      const now = Date.now();
      set((s) => {
        const restored = target.operation;
        const nextOps = s.operations.some((o) => o.id === restored.id)
          ? s.operations
          : [...s.operations, restored];
        const nextTrash = s.deletedOperations.filter((t) => t.id !== deletedEntryId);
        const logEntry: AuditLogEntry = {
          id: `log-restore-bin-${now}`,
          timestamp: now,
          action: 'undo_delete',
          rowId: restored.id,
          date: restored.date,
          kind: restored.kind,
          wasLocked: false,
          description: `استرجاع عملية من سلة المحذوفات (${
            KIND_LABELS[restored.kind] || restored.kind
          }) بتاريخ ${restored.date}`,
          oldValue: 'سلة المحذوفات',
          newValue: `${formatWeight(restored.weightG)} جرام — ${formatNumber(restored.total)} ج.م`,
        };
        const nextLogs = [logEntry, ...s.auditLogs];
        const nextState = {
          ...s,
          operations: nextOps,
          deletedOperations: nextTrash,
          auditLogs: nextLogs,
        };
        persistStateSnapshot(nextState);
        return {
          operations: nextOps,
          deletedOperations: nextTrash,
          auditLogs: nextLogs,
        };
      });
      return true;
    },

    // F7.1: Permanent deletion from Settings with confirmation
    emptyRecycleBinPermanently: (deletedEntryId) => {
      get().createSafetySnapshot('حذف نهائي من سلة المحذوفات');
      const now = Date.now();
      set((s) => {
        const nextTrash = deletedEntryId
          ? s.deletedOperations.filter((t) => t.id !== deletedEntryId)
          : [];
        const removedCount = s.deletedOperations.length - nextTrash.length;
        if (removedCount <= 0) return {};

        const logEntry: AuditLogEntry = {
          id: `log-perm-del-${now}`,
          timestamp: now,
          action: 'permanent_delete',
          date: s.currentDate,
          wasLocked: false,
          description: `حذف نهائي من سلة المحذوفات (${removedCount} عملية)`,
          oldValue: `${removedCount} عملية في السلة`,
          newValue: 'تم الحذف النهائي بتأكيد المستخدم',
        };
        const nextLogs = [logEntry, ...s.auditLogs];
        const nextState = {
          ...s,
          deletedOperations: nextTrash,
          auditLogs: nextLogs,
        };
        persistStateSnapshot(nextState, false, true);
        return {
          deletedOperations: nextTrash,
          auditLogs: nextLogs,
        };
      });
    },

    undoLastAddedOperation: () => {
      const state = get();
      if (!state.lastAddedOpId) return false;
      const exists = state.operations.find((o) => o.id === state.lastAddedOpId);
      if (!exists) return false;
      if (state.daysMap[exists.date]?.locked) return false;

      const now = Date.now();
      set((s) => {
        const nextOps = s.operations.filter((o) => o.id !== s.lastAddedOpId);
        const logEntry: AuditLogEntry = {
          id: `log-undoadd-${now}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          action: 'undo_add',
          rowId: exists.id,
          date: exists.date,
          kind: exists.kind,
          wasLocked: Boolean(s.daysMap[exists.date]?.locked),
          description: `تراجع (Ctrl+Z) عن آخر إضافة (${KIND_LABELS[exists.kind] || exists.kind}) بتاريخ ${
            exists.date
          }`,
          oldValue: `${formatWeight(exists.weightG)} جرام — ${formatNumber(exists.total)} ج.م`,
          newValue: 'تم التراجع عن الإضافة',
        };
        const nextLogs = [logEntry, ...s.auditLogs];
        const nextState = {
          ...s,
          operations: nextOps,
          auditLogs: nextLogs,
          lastAddedOpId: null,
        };
        persistStateSnapshot(nextState);
        return {
          operations: nextOps,
          auditLogs: nextLogs,
          lastAddedOpId: null,
        };
      });
      return true;
    },

    toggleOperationReviewed: (id) => {
      const state = get();
      const existing = state.operations.find((o) => o.id === id);
      if (!existing) return;
      get().updateOperation(id, { reviewedFlag: !existing.reviewedFlag });
    },

    addPerson: (pInput) => {
      const newPerson: Person = {
        id: `person-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: pInput.name.trim(),
        type: pInput.type,
        phone: pInput.phone || '',
        note: pInput.note || '',
        maxDebtCash: pInput.maxDebtCash,
        maxDebtGoldG: pInput.maxDebtGoldG,
        agreedDueDate: pInput.agreedDueDate,
        followUps: pInput.followUps || [],
        createdAt: Date.now(),
      };
      set((state) => {
        const nextPersons = [...state.persons, newPerson];
        const nextState = { ...state, persons: nextPersons };
        persistStateSnapshot(nextState);
        return { persons: nextPersons };
      });
      return newPerson;
    },

    updatePerson: (id, patch) => {
      set((state) => {
        const nextPersons = state.persons.map((p) => (p.id === id ? { ...p, ...patch } : p));
        const nextState = { ...state, persons: nextPersons };
        persistStateSnapshot(nextState);
        return { persons: nextPersons };
      });
    },

    // F2.2 & F2.3: Add follow-up entry and auto-update agreedDueDate if promisedDate is set
    addPersonFollowUp: (personId, followUpInput) => {
      const now = Date.now();
      const newEntry: PersonFollowUp = {
        id: `fu-${now}-${Math.random().toString(36).slice(2, 6)}`,
        date: followUpInput.date || getTodayIso(),
        note: followUpInput.note.trim(),
        promisedDate: followUpInput.promisedDate,
        promisedAmount: followUpInput.promisedAmount,
        createdAt: now,
      };

      set((state) => {
        const nextPersons = state.persons.map((p) => {
          if (p.id !== personId) return p;
          const nextFollowUps = [newEntry, ...(p.followUps || [])];
          return {
            ...p,
            followUps: nextFollowUps,
            agreedDueDate: newEntry.promisedDate ? newEntry.promisedDate : p.agreedDueDate,
          };
        });
        const nextState = { ...state, persons: nextPersons };
        persistStateSnapshot(nextState);
        return { persons: nextPersons };
      });
    },

    deletePersonFollowUp: (personId, followUpId) => {
      set((state) => {
        const nextPersons = state.persons.map((p) => {
          if (p.id !== personId) return p;
          return {
            ...p,
            followUps: (p.followUps || []).filter((f) => f.id !== followUpId),
          };
        });
        const nextState = { ...state, persons: nextPersons };
        persistStateSnapshot(nextState);
        return { persons: nextPersons };
      });
    },

    // F7.2: Merge duplicate persons and transfer all operations & follow-ups
    mergeDuplicatePersons: (primaryPersonId, duplicatePersonId) => {
      if (primaryPersonId === duplicatePersonId) return false;
      const state = get();
      const primary = state.persons.find((p) => p.id === primaryPersonId);
      const duplicate = state.persons.find((p) => p.id === duplicatePersonId);
      if (!primary || !duplicate) return false;

      get().createSafetySnapshot(`دمج حساب "${duplicate.name}" في "${primary.name}"`);
      const now = Date.now();
      set((s) => {
        let movedCount = 0;
        const nextOps = s.operations.map((op) => {
          if (op.personId === duplicatePersonId) {
            movedCount += 1;
            return { ...op, personId: primaryPersonId, updatedAt: now };
          }
          return op;
        });

        const mergedFollowUps = [
          ...(primary.followUps || []),
          ...(duplicate.followUps || []),
        ].sort((a, b) => b.createdAt - a.createdAt);

        const nextPersons = s.persons
          .filter((p) => p.id !== duplicatePersonId)
          .map((p) =>
            p.id === primaryPersonId
              ? {
                  ...p,
                  phone: p.phone || duplicate.phone,
                  maxDebtCash: p.maxDebtCash || duplicate.maxDebtCash,
                  maxDebtGoldG: p.maxDebtGoldG || duplicate.maxDebtGoldG,
                  agreedDueDate: p.agreedDueDate || duplicate.agreedDueDate,
                  followUps: mergedFollowUps,
                }
              : p
          );

        const logEntry: AuditLogEntry = {
          id: `log-merge-${now}`,
          timestamp: now,
          action: 'person_merge',
          date: s.currentDate,
          wasLocked: false,
          description: `دمج حساب الشخص المكرر "${duplicate.name}" في "${primary.name}" ونقل ${movedCount} عملية`,
          oldValue: duplicate.name,
          newValue: primary.name,
        };
        const nextLogs = [logEntry, ...s.auditLogs];
        const nextState = {
          ...s,
          operations: nextOps,
          persons: nextPersons,
          auditLogs: nextLogs,
        };
        persistStateSnapshot(nextState, false, true);
        return {
          operations: nextOps,
          persons: nextPersons,
          auditLogs: nextLogs,
        };
      });
      return true;
    },

    addWorker: (wInput) => {
      const newWorker: Worker = {
        id: `worker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: wInput.name.trim(),
        monthlySalary: wInput.monthlySalary,
        dueDay: wInput.dueDay || 30,
        note: wInput.note || '',
        carryOverDiff: wInput.carryOverDiff || 0,
        createdAt: Date.now(),
      };
      set((state) => {
        const nextWorkers = [...state.workers, newWorker];
        const nextState = { ...state, workers: nextWorkers };
        persistStateSnapshot(nextState);
        return { workers: nextWorkers };
      });
      return newWorker;
    },

    updateWorker: (id, patch) => {
      set((state) => {
        const nextWorkers = state.workers.map((w) => (w.id === id ? { ...w, ...patch } : w));
        const nextState = { ...state, workers: nextWorkers };
        persistStateSnapshot(nextState);
        return { workers: nextWorkers };
      });
    },

    closeMonthSalaries: (month, closeDate, carryOverNegatives, forceClose = false) => {
      const state = get();
      if (state.closedSalaryMonths.includes(month) && !forceClose) {
        return {
          ok: false,
          netPaid: 0,
          error: `تم إقفال مرتبات شهر ${month} من قبل. لا يمكن إقفال نفس الشهر مرتين لمنع تكرار صرف المرتبات.`,
        };
      }

      get().createSafetySnapshot(`إقفال مرتبات شهر ${month}`);

      let totalNetPaid = 0;
      const nextWorkers = state.workers.map((w) => {
        const workerAdvances = state.operations
          .filter((o) => o.kind === 'advance' && o.workerId === w.id && o.date.startsWith(month))
          .reduce((sum, o) => sum + o.total, 0);
        const priorCarry = w.carryOverDiff || 0;
        const netDue = w.monthlySalary - workerAdvances - priorCarry;
        if (netDue > 0) {
          totalNetPaid += netDue;
          return { ...w, carryOverDiff: 0 };
        } else if (netDue < 0) {
          return { ...w, carryOverDiff: carryOverNegatives ? Math.abs(netDue) : 0 };
        }
        return { ...w, carryOverDiff: 0 };
      });

      const now = Date.now();
      const newOps = [...state.operations];
      if (totalNetPaid > 0) {
        newOps.push({
          id: `op-sal-${now}`,
          date: closeDate,
          kind: 'expense',
          category: 'مرتبات',
          item: `صرف صافي مرتبات شهر ${month} (بعد خصم السلف)`,
          weightG: 0,
          total: totalNetPaid,
          payment: 'cash',
          reviewedFlag: true,
          note: 'قيد إقفال مرتبات آلي',
          createdAt: now,
          updatedAt: now,
        });
      }

      const logEntry: AuditLogEntry = {
        id: `log-sal-${now}`,
        timestamp: now,
        action: 'salary_close',
        date: closeDate,
        wasLocked: Boolean(state.daysMap[closeDate]?.locked),
        description: `إقفال مرتبات شهر ${month} وصرف الصافي (${formatNumber(totalNetPaid)} ج.م)`,
        newValue: `${formatNumber(totalNetPaid)} ج.م`,
      };

      const nextClosedMonths = state.closedSalaryMonths.includes(month)
        ? state.closedSalaryMonths
        : [...state.closedSalaryMonths, month];

      set((s) => {
        const nextLogs = [logEntry, ...s.auditLogs];
        const nextState = {
          ...s,
          workers: nextWorkers,
          operations: newOps,
          auditLogs: nextLogs,
          closedSalaryMonths: nextClosedMonths,
        };
        persistStateSnapshot(nextState, false, true);
        return {
          workers: nextWorkers,
          operations: newOps,
          auditLogs: nextLogs,
          closedSalaryMonths: nextClosedMonths,
        };
      });

      return { ok: true, netPaid: totalNetPaid };
    },

    addExpenseCategory: (category) => {
      const trimmed = category.trim();
      if (!trimmed) return;
      set((state) => {
        if (state.expenseCategories.includes(trimmed)) return {};
        const nextCats = [...state.expenseCategories, trimmed];
        const nextState = { ...state, expenseCategories: nextCats };
        persistStateSnapshot(nextState);
        return { expenseCategories: nextCats };
      });
    },

    setIssueReviewed: (issueId, reviewed, note) => {
      set((state) => {
        const existing = state.issueReviews[issueId] || { reviewed: false, note: '' };
        const nextReviews = {
          ...state.issueReviews,
          [issueId]: {
            reviewed,
            note: note !== undefined ? note : existing.note,
          },
        };
        const nextState = { ...state, issueReviews: nextReviews };
        persistStateSnapshot(nextState);
        return { issueReviews: nextReviews };
      });
    },

    // F5: Audit Visit Actions
    createAuditVisit: ({ name, fromDate, toDate, notes }) => {
      const now = Date.now();
      const newVisit: AuditVisit = {
        id: `visit-${now}`,
        name: name.trim() || `زيارة مراجعة ${toDate}`,
        fromDate,
        toDate,
        notes: notes || '',
        recommendations: '',
        checklist: {
          pricesRecorded: false,
          highIssuesReviewed: false,
          safeVerified: false,
          goldInventoryVerified: false,
          debtsMatched: false,
          advancesReviewed: false,
          expensesReviewed: false,
        },
        status: 'in_progress',
        createdAt: now,
      };
      set((state) => {
        const nextVisits = [newVisit, ...state.auditVisits];
        const nextState = {
          ...state,
          auditVisits: nextVisits,
          activeVisitId: newVisit.id,
        };
        persistStateSnapshot(nextState);
        return {
          auditVisits: nextVisits,
          activeVisitId: newVisit.id,
        };
      });
      return newVisit;
    },

    setActiveVisitId: (id) => {
      set((state) => {
        const nextState = { ...state, activeVisitId: id };
        persistStateSnapshot(nextState);
        return { activeVisitId: id };
      });
    },

    updateAuditVisit: (id, patch) => {
      set((state) => {
        const nextVisits = state.auditVisits.map((v) =>
          v.id === id ? { ...v, ...patch } : v
        );
        const nextState = { ...state, auditVisits: nextVisits };
        persistStateSnapshot(nextState);
        return { auditVisits: nextVisits };
      });
    },

    updateAuditVisitChecklist: (id, patch) => {
      set((state) => {
        const nextVisits = state.auditVisits.map((v) =>
          v.id === id
            ? {
                ...v,
                checklist: {
                  ...v.checklist,
                  ...patch,
                },
              }
            : v
        );
        const nextState = { ...state, auditVisits: nextVisits };
        persistStateSnapshot(nextState);
        return { auditVisits: nextVisits };
      });
    },

    completeAuditVisit: async (id, summarySnapshot, lockDaysInPeriod) => {
      const state = get();
      const visit = state.auditVisits.find((v) => v.id === id);
      if (!visit) {
        return { ok: false, error: 'الزيارة غير موجودة.' };
      }

      const now = Date.now();
      const completedVisit: AuditVisit = {
        ...visit,
        status: 'completed',
        completedAt: now,
        summarySnapshot,
      };

      const nextDaysMap = { ...state.daysMap };
      if (lockDaysInPeriod) {
        get().createSafetySnapshot(`قفل فترة زيارة المراجعة "${visit.name}"`);
        const allDatesInPeriod = new Set<string>();
        for (const op of state.operations) {
          if (op.date >= visit.fromDate && op.date <= visit.toDate) {
            allDatesInPeriod.add(op.date);
          }
        }
        for (const d of Object.keys(nextDaysMap)) {
          if (d >= visit.fromDate && d <= visit.toDate) {
            allDatesInPeriod.add(d);
          }
        }
        for (const dt of allDatesInPeriod) {
          const existing = nextDaysMap[dt] || {
            date: dt,
            goldPricePerGram: findSuggestedGoldPrice(dt, nextDaysMap),
            priceConfirmed: false,
            locked: true,
          };
          nextDaysMap[dt] = {
            ...existing,
            locked: true,
          };
        }
      }

      const logEntry: AuditLogEntry = {
        id: `log-visit-${now}`,
        timestamp: now,
        action: 'visit_complete',
        date: visit.toDate,
        wasLocked: false,
        description: `إنهاء زيارة المراجعة "${visit.name}" للفترة (${visit.fromDate} إلى ${
          visit.toDate
        })${lockDaysInPeriod ? ' مع قفل جميع أيام الفترة' : ''}`,
        newValue: `اشتباهات عالية: ${summarySnapshot.highIssuesCount} | مبيعات: ${formatNumber(
          summarySnapshot.sellTotal
        )} ج.م`,
      };

      const nextVisits = state.auditVisits.map((v) =>
        v.id === id ? completedVisit : v
      );
      const nextLogs = [logEntry, ...state.auditLogs];

      set((s) => {
        const nextState = {
          ...s,
          daysMap: nextDaysMap,
          auditVisits: nextVisits,
          auditLogs: nextLogs,
        };
        persistStateSnapshot(nextState, false, true);
        return {
          daysMap: nextDaysMap,
          auditVisits: nextVisits,
          auditLogs: nextLogs,
        };
      });

      const api = ensureGoldApiBridge();
      const visitPayload = {
        visit: completedVisit,
        shopName: state.settings.shopName,
        auditorName: state.settings.auditorName,
        savedAt: now,
        periodOperationsCount: state.operations.filter(
          (o) => o.date >= visit.fromDate && o.date <= visit.toDate
        ).length,
      };

      if (api.storage.saveVisitSnapshot) {
        const res = await api.storage.saveVisitSnapshot(id, visitPayload);
        return res;
      }
      return { ok: true };
    },

    updateSettings: (patch) => {
      set((state) => {
        const nextSettings = { ...state.settings, ...patch };
        const nextState = { ...state, settings: nextSettings };
        persistStateSnapshot(nextState);
        return { settings: nextSettings };
      });
    },

    applySensitivityPreset: (preset) => {
      set((state) => {
        const nextSettings = { ...state.settings, sensitivityPreset: preset };
        if (preset === 'strict') {
          nextSettings.priceDiffMediumPct = 1.0;
          nextSettings.priceDiffHighPct = 2.0;
          nextSettings.robustZThreshold = 3.0;
        } else if (preset === 'medium') {
          nextSettings.priceDiffMediumPct = 1.5;
          nextSettings.priceDiffHighPct = 3.0;
          nextSettings.robustZThreshold = 3.5;
        } else if (preset === 'lenient') {
          nextSettings.priceDiffMediumPct = 3.0;
          nextSettings.priceDiffHighPct = 5.0;
          nextSettings.robustZThreshold = 4.5;
        }
        const nextState = { ...state, settings: nextSettings };
        persistStateSnapshot(nextState);
        return { settings: nextSettings };
      });
    },

    savePricePreset: (preset) => {
      set((state) => {
        const newPreset: PriceStatementPreset = {
          ...preset,
          id: `preset-${Date.now()}`,
        };
        const nextPresets = [...state.pricePresets, newPreset];
        const nextState = { ...state, pricePresets: nextPresets };
        persistStateSnapshot(nextState);
        return { pricePresets: nextPresets };
      });
    },

    deletePricePreset: (id) => {
      set((state) => {
        const nextPresets = state.pricePresets.filter((p) => p.id !== id);
        const nextState = { ...state, pricePresets: nextPresets };
        persistStateSnapshot(nextState);
        return { pricePresets: nextPresets };
      });
    },

    markBackupExported: () => {
      const now = Date.now();
      set((state) => {
        const nextState = { ...state, lastBackupAt: now };
        persistStateSnapshot(nextState);
        return { lastBackupAt: now };
      });
    },

    loadDemoData: () => {
      const demo = generateDemoDataset();
      const today = getTodayIso();
      set((state) => {
        const nextState: AuditStoreState = {
          ...state,
          currentDate: today,
          operations: demo.operations,
          deletedOperations: [],
          daysMap: demo.daysMap,
          persons: demo.persons,
          workers: demo.workers,
          auditLogs: demo.auditLogs,
          closedSalaryMonths: [],
          issueReviews: {},
        };
        persistStateSnapshot(nextState);
        return {
          currentDate: today,
          operations: demo.operations,
          deletedOperations: [],
          daysMap: demo.daysMap,
          persons: demo.persons,
          workers: demo.workers,
          auditLogs: demo.auditLogs,
          closedSalaryMonths: [],
          issueReviews: {},
        };
      });
    },

    clearAllData: () => {
      get().createSafetySnapshot('مسح كافة البيانات');
      const today = getTodayIso();
      set((state) => {
        const nextState: AuditStoreState = {
          ...state,
          currentDate: today,
          operations: [],
          deletedOperations: [],
          daysMap: {
            [today]: {
              date: today,
              goldPricePerGram: 0,
              priceConfirmed: false,
              locked: false,
            },
          },
          persons: [],
          workers: [],
          auditLogs: [],
          closedSalaryMonths: [],
          auditVisits: [],
          activeVisitId: null,
          issueReviews: {},
        };
        persistStateSnapshot(nextState, true);
        return {
          currentDate: today,
          operations: [],
          deletedOperations: [],
          daysMap: nextState.daysMap,
          persons: [],
          workers: [],
          auditLogs: [],
          closedSalaryMonths: [],
          auditVisits: [],
          activeVisitId: null,
          issueReviews: {},
        };
      });
    },

    importFullBackup: (data) => {
      if (!data || typeof data !== 'object' || !Array.isArray(data.operations)) {
        return { ok: false, error: 'ملف النسخة الاحتياطية غير صالح أو لا يحتوي على مصفوفة العمليات.' };
      }
      get().createSafetySnapshot('استعادة نسخة احتياطية كاملة');
      const validated = validateAndQuarantineState(data);

      set((state) => {
        const mergedSettings: AuditSettings = {
          ...DEFAULT_SETTINGS,
          ...(data.settings || {}),
          allowedPriceRange: {
            ...DEFAULT_SETTINGS.allowedPriceRange,
            ...(data.settings?.allowedPriceRange || {}),
          },
          karatToleranceG: {
            ...(DEFAULT_SETTINGS.karatToleranceG || {
              '18': 0.5,
              '21': 0.5,
              '24': 0.5,
              other: 0.5,
            }),
            ...(data.settings?.karatToleranceG || {}),
          },
          fixedRules: {
            ...DEFAULT_SETTINGS.fixedRules,
            ...(data.settings?.fixedRules || {}),
          },
          exceptions: {
            ...DEFAULT_SETTINGS.exceptions,
            ...(data.settings?.exceptions || {}),
          },
        };

        const nextQuarantined = [...validated.quarantined, ...state.quarantinedRecords];

        const nextState: AuditStoreState = {
          ...state,
          operations: validated.operations,
          deletedOperations: Array.isArray(data.deletedOperations)
            ? data.deletedOperations
            : [],
          daysMap: Object.keys(validated.daysMap).length > 0 ? validated.daysMap : state.daysMap,
          persons: validated.persons,
          workers: validated.workers,
          auditLogs: data.auditLogs || [],
          issueReviews: data.issueReviews || {},
          expenseCategories: data.expenseCategories || DEFAULT_EXPENSE_CATEGORIES,
          pricePresets: Array.isArray(data.pricePresets) ? data.pricePresets : state.pricePresets,
          showItemColumn:
            typeof data.showItemColumn === 'boolean' ? data.showItemColumn : state.showItemColumn,
          closedSalaryMonths: Array.isArray(data.closedSalaryMonths)
            ? data.closedSalaryMonths
            : [],
          auditVisits: Array.isArray(data.auditVisits)
            ? data.auditVisits
            : state.auditVisits,
          settings: mergedSettings,
          quarantinedRecords: nextQuarantined,
          safeMode: false,
          safeModeReason: null,
        };
        persistStateSnapshot(nextState, true, true);
        return {
          isFirstRun: false,
          operations: nextState.operations,
          deletedOperations: nextState.deletedOperations,
          daysMap: nextState.daysMap,
          persons: nextState.persons,
          workers: nextState.workers,
          auditLogs: nextState.auditLogs,
          issueReviews: nextState.issueReviews,
          expenseCategories: nextState.expenseCategories,
          pricePresets: nextState.pricePresets,
          showItemColumn: nextState.showItemColumn,
          closedSalaryMonths: nextState.closedSalaryMonths,
          auditVisits: nextState.auditVisits,
          settings: nextState.settings,
          quarantinedRecords: nextQuarantined,
          safeMode: false,
          safeModeReason: null,
        };
      });
      return { ok: true };
    },

    // G1.4: Quarantine Actions
    restoreQuarantinedRecord: (quarantineId, repairedData) => {
      const state = get();
      const target = state.quarantinedRecords.find((q) => q.id === quarantineId);
      if (!target) return false;

      const validated = validateAndQuarantineState({
        operations: target.entityType === 'operation' ? [repairedData] : [],
        daysMap: target.entityType === 'dayInfo' && repairedData?.date ? { [repairedData.date]: repairedData } : {},
        persons: target.entityType === 'person' ? [repairedData] : [],
        workers: target.entityType === 'worker' ? [repairedData] : [],
      });

      if (validated.quarantined.length > 0) {
        return false;
      }

      const now = Date.now();
      set((s) => {
        const nextQuarantined = s.quarantinedRecords.filter((q) => q.id !== quarantineId);
        let nextOps = s.operations;
        let nextDaysMap = s.daysMap;
        let nextPersons = s.persons;
        let nextWorkers = s.workers;

        if (target.entityType === 'operation' && validated.operations[0]) {
          nextOps = [...s.operations.filter((o) => o.id !== validated.operations[0].id), validated.operations[0]];
        } else if (target.entityType === 'dayInfo' && repairedData?.date && validated.daysMap[repairedData.date]) {
          nextDaysMap = { ...s.daysMap, [repairedData.date]: validated.daysMap[repairedData.date] };
        } else if (target.entityType === 'person' && validated.persons[0]) {
          nextPersons = [...s.persons.filter((p) => p.id !== validated.persons[0].id), validated.persons[0]];
        } else if (target.entityType === 'worker' && validated.workers[0]) {
          nextWorkers = [...s.workers.filter((w) => w.id !== validated.workers[0].id), validated.workers[0]];
        }

        const logEntry: AuditLogEntry = {
          id: `log-qrestore-${now}`,
          timestamp: now,
          action: 'quarantine_restore',
          date: s.currentDate,
          wasLocked: false,
          description: `إصلاح واستعادة سجل معزول (${target.entityType})`,
          newValue: JSON.stringify(repairedData).slice(0, 120),
        };

        const nextLogs = [logEntry, ...s.auditLogs];
        const nextState = {
          ...s,
          quarantinedRecords: nextQuarantined,
          operations: nextOps,
          daysMap: nextDaysMap,
          persons: nextPersons,
          workers: nextWorkers,
          auditLogs: nextLogs,
        };
        persistStateSnapshot(nextState);
        return {
          quarantinedRecords: nextQuarantined,
          operations: nextOps,
          daysMap: nextDaysMap,
          persons: nextPersons,
          workers: nextWorkers,
          auditLogs: nextLogs,
        };
      });
      return true;
    },

    deleteQuarantinedRecord: (quarantineId) => {
      set((s) => {
        const nextQuarantined = s.quarantinedRecords.filter((q) => q.id !== quarantineId);
        const nextState = { ...s, quarantinedRecords: nextQuarantined };
        persistStateSnapshot(nextState);
        return { quarantinedRecords: nextQuarantined };
      });
    },

    // G1.6: Pre-Operation Safety Snapshot (10 minutes undo window)
    createSafetySnapshot: (label) => {
      const s = get();
      const now = Date.now();
      const snap: SafetySnapshot = {
        id: `snap-${now}-${Math.random().toString(36).slice(2, 6)}`,
        label,
        createdAt: now,
        expiresAt: now + 10 * 60 * 1000, // 10 minutes
        statePayload: {
          operations: JSON.parse(JSON.stringify(s.operations)),
          deletedOperations: JSON.parse(JSON.stringify(s.deletedOperations)),
          daysMap: JSON.parse(JSON.stringify(s.daysMap)),
          persons: JSON.parse(JSON.stringify(s.persons)),
          workers: JSON.parse(JSON.stringify(s.workers)),
          closedSalaryMonths: [...s.closedSalaryMonths],
        },
      };
      set({ activeSafetySnapshot: snap });
      return snap;
    },

    undoSafetySnapshot: () => {
      const s = get();
      const snap = s.activeSafetySnapshot;
      if (!snap || Date.now() > snap.expiresAt) {
        set({ activeSafetySnapshot: null });
        return false;
      }
      const now = Date.now();
      const payload = snap.statePayload;
      set((state) => {
        const logEntry: AuditLogEntry = {
          id: `log-snap-undo-${now}`,
          timestamp: now,
          action: 'snapshot_undo',
          date: state.currentDate,
          wasLocked: false,
          description: `تراجع فوري عن عملية حساسة: "${snap.label}" واستعادة اللقطة السابقة`,
          newValue: `${payload.operations.length} عملية`,
        };
        const nextLogs = [logEntry, ...state.auditLogs];
        const nextState: AuditStoreState = {
          ...state,
          operations: payload.operations,
          deletedOperations: payload.deletedOperations,
          daysMap: payload.daysMap,
          persons: payload.persons,
          workers: payload.workers,
          closedSalaryMonths: payload.closedSalaryMonths,
          auditLogs: nextLogs,
          activeSafetySnapshot: null,
        };
        persistStateSnapshot(nextState, false, true);
        return {
          operations: payload.operations,
          deletedOperations: payload.deletedOperations,
          daysMap: payload.daysMap,
          persons: payload.persons,
          workers: payload.workers,
          closedSalaryMonths: payload.closedSalaryMonths,
          auditLogs: nextLogs,
          activeSafetySnapshot: null,
        };
      });
      return true;
    },

    dismissSafetySnapshot: () => set({ activeSafetySnapshot: null }),

    exitSafeMode: () => {
      try {
        localStorage.setItem('gold_audit_boot_crash_count', '0');
      } catch {
        // ignore
      }
      set({ safeMode: false, safeModeReason: null });
    },

    // G1.7: Apply Fix-It Suggestions (Single & Bulk)
    applyFixItSuggestion: (suggestion) => {
      const now = Date.now();

      if (
        suggestion.category === 'duplicate_person' &&
        suggestion.primaryPersonId &&
        suggestion.duplicatePersonId
      ) {
        return get().mergeDuplicatePersons(
          suggestion.primaryPersonId,
          suggestion.duplicatePersonId
        );
      }

      if (suggestion.category === 'missing_day_price' && suggestion.dayPriceToSet) {
        return get().setDayGoldPrice(
          suggestion.date,
          suggestion.dayPriceToSet,
          true,
          'تصحيح تلقائي من أداة Fix-It'
        );
      }

      if (
        (suggestion.category === 'safe_adjustment' || suggestion.category === 'gold_adjustment') &&
        suggestion.adjustmentOperationToCreate
      ) {
        const adj = suggestion.adjustmentOperationToCreate;
        const added = get().addOperation({
          date: adj.date,
          kind: adj.kind,
          weightG: adj.weightG,
          total: adj.total,
          category: adj.category,
          item: adj.item,
          payment: adj.payment,
          note: adj.note,
          reviewedFlag: true,
        });
        return Boolean(added);
      }

      if (suggestion.operationId && suggestion.operationPatch) {
        const ok = get().updateOperation(
          suggestion.operationId,
          suggestion.operationPatch,
          `تصحيح Fix-It: ${suggestion.title}`
        );
        if (ok) {
          set((state) => {
            const logEntry: AuditLogEntry = {
              id: `log-fixit-${now}-${Math.random().toString(36).slice(2, 6)}`,
              timestamp: now,
              action: 'fix_it',
              rowId: suggestion.operationId,
              date: suggestion.date || state.currentDate,
              wasLocked: false,
              description: `تطبيق تصحيح مقترح (${suggestion.title})`,
              oldValue: suggestion.oldValueLabel,
              newValue: suggestion.newValueLabel,
            };
            const nextLogs = [logEntry, ...state.auditLogs];
            const nextState = { ...state, auditLogs: nextLogs };
            persistStateSnapshot(nextState);
            return { auditLogs: nextLogs };
          });
        }
        return ok;
      }

      return false;
    },

    applyBulkFixItSuggestions: (suggestions) => {
      if (!suggestions || suggestions.length === 0) return 0;
      get().createSafetySnapshot(`تطبيق ${suggestions.length} تصحيح مقترح من أداة Fix-It`);
      let count = 0;
      for (const sug of suggestions) {
        if (get().applyFixItSuggestion(sug)) {
          count += 1;
        }
      }
      return count;
    },

    // G2: Record Export or Print Action in Audit Logs
    recordExportOrPrintLog: (description, format, isPrint = false) => {
      const now = Date.now();
      set((s) => {
        const logEntry: AuditLogEntry = {
          id: `log-${isPrint ? 'print' : 'export'}-${now}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          action: isPrint ? 'print' : 'export',
          date: s.currentDate,
          wasLocked: false,
          description,
          newValue: `الصيغة: ${format.toUpperCase()}`,
        };
        const nextLogs = [logEntry, ...s.auditLogs];
        const nextState = { ...s, auditLogs: nextLogs };
        persistStateSnapshot(nextState);
        return { auditLogs: nextLogs };
      });
    },

    // G2: Saved Filter Presets
    saveFilterPreset: (name, filter, screenId = 'all') => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const now = Date.now();
      set((s) => {
        const newPreset: SavedFilterPreset = {
          id: `fpreset-${now}-${Math.random().toString(36).slice(2, 6)}`,
          name: trimmed,
          screenId,
          filter: JSON.parse(JSON.stringify(filter)),
          createdAt: now,
        };
        const nextPresets = [newPreset, ...s.savedFilterPresets];
        const nextState = { ...s, savedFilterPresets: nextPresets };
        persistStateSnapshot(nextState);
        return { savedFilterPresets: nextPresets };
      });
    },

    deleteFilterPreset: (id) => {
      set((s) => {
        const nextPresets = s.savedFilterPresets.filter((p) => p.id !== id);
        const nextState = { ...s, savedFilterPresets: nextPresets };
        persistStateSnapshot(nextState);
        return { savedFilterPresets: nextPresets };
      });
    },

    // G3: Import Mapping Templates & Batch Rollback
    saveImportTemplate: (templateInput) => {
      const now = Date.now();
      const newTemplate: ImportMappingTemplate = {
        ...templateInput,
        id: `imptpl-${now}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
      };
      set((s) => {
        const nextTemplates = [
          newTemplate,
          ...s.importTemplates.filter((t) => t.name !== newTemplate.name),
        ];
        const nextState = { ...s, importTemplates: nextTemplates };
        persistStateSnapshot(nextState);
        return { importTemplates: nextTemplates };
      });
      return newTemplate;
    },

    deleteImportTemplate: (id) => {
      set((s) => {
        const nextTemplates = s.importTemplates.filter((t) => t.id !== id);
        const nextState = { ...s, importTemplates: nextTemplates };
        persistStateSnapshot(nextState);
        return { importTemplates: nextTemplates };
      });
    },

    rollbackImportBatch: (batchId) => {
      const s = get();
      const batch = s.importBatches.find((b) => b.id === batchId);
      if (!batch) {
        return { ok: false, rolledBackCount: 0, error: 'دفعة الاستيراد غير موجودة.' };
      }
      if (batch.rolledBack) {
        return { ok: false, rolledBackCount: 0, error: 'تم التراجع عن هذه الدفعة مسبقاً.' };
      }

      const opsToRemove = s.operations.filter((o) => o.importBatchId === batchId);
      const lockedDates = Array.from(
        new Set(opsToRemove.map((o) => o.date).filter((d) => s.daysMap[d]?.locked))
      );
      if (lockedDates.length > 0) {
        return {
          ok: false,
          rolledBackCount: 0,
          error: `لا يمكن التراجع عن الدفعة لأن التواريخ (${lockedDates.join(' ، ')}) مقفولة حالياً.`,
        };
      }

      get().createSafetySnapshot(`التراجع عن دفعة الاستيراد "${batch.sourceName}"`);
      const now = Date.now();

      set((state) => {
        const nextOps = state.operations.filter((o) => o.importBatchId !== batchId);
        const nextBatches = state.importBatches.map((b) =>
          b.id === batchId ? { ...b, rolledBack: true } : b
        );
        const logEntry: AuditLogEntry = {
          id: `log-rollback-${now}`,
          timestamp: now,
          action: 'rollback_batch',
          date: batch.dates[0] || state.currentDate,
          wasLocked: false,
          description: `التراجع عن دفعة الاستيراد "${batch.sourceName}" وحذف ${opsToRemove.length} عملية`,
          oldValue: `${opsToRemove.length} عملية`,
          newValue: 'تم التراجع بالكامل',
        };
        const nextLogs = [logEntry, ...state.auditLogs];
        const nextState = {
          ...state,
          operations: nextOps,
          importBatches: nextBatches,
          auditLogs: nextLogs,
        };
        persistStateSnapshot(nextState, false, true);
        return {
          operations: nextOps,
          importBatches: nextBatches,
          auditLogs: nextLogs,
        };
      });

      return { ok: true, rolledBackCount: opsToRemove.length };
    },
  };
});
