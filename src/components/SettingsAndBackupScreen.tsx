import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  Sliders,
  Upload,
  Download,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  FlaskConical,
  Plus,
  AlertOctagon,
  AlertTriangle,
  KeyRound,
  Lock,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Info,
} from 'lucide-react';
import {
  useAuditStore,
  findNearestSubsequentActiveDate,
  DEFAULT_SETTINGS,
} from '../store/useAuditStore';
import { BackupFileInfo, DayInfo, Operation, ShortSpaceWeightMode } from '../types';
import {
  formatNumber,
  getTodayIso,
  inspectAmbiguousSpaceWeight,
  parseAmountInput,
  parseFlexibleDate,
  parseWeightInput,
  formatWeight,
  normalizeArabicName,
} from '../utils/numerals';
import { evaluateSingleOpPriceAnomaly } from '../utils/checks/checkDailyGoldPriceDiff';
import { computePersonBalancesSummary } from '../utils/checks/checkPersonBalances';
import { exportJsonBackup } from '../utils/exportImport';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';
import {
  getDiagnosticErrorLogs,
  clearDiagnosticErrorLogs,
  scrubSensitiveText,
  subscribeToDiagnosticLogs,
} from '../errors/catalog';
import { exportProblemReportZip } from '../export/exportService';
import { validateAndQuarantineState } from '../validation/schemas';
import {
  scanForFixItSuggestions,
  detectFastEntryInlineTypo,
} from '../utils/fixItEngine';
import {
  detectTableStructure,
  autoGuessColumnMapping,
  normalizeDataRows,
  validateNormalizedRows,
} from '../import/pipeline';

export const SettingsAndBackupScreen: React.FC = () => {
  const {
    operations,
    deletedOperations,
    daysMap,
    persons,
    workers,
    auditLogs,
    issueReviews,
    expenseCategories,
    pricePresets,
    showItemColumn,
    closedSalaryMonths,
    settings,
    updateSettings,
    applySensitivityPreset,
    addOperationsBatch,
    importFullBackup,
    markBackupExported,
    clearAllData,
    restoreFromRecycleBin,
    emptyRecycleBinPermanently,
    mergeDuplicatePersons,
  } = useAuditStore();

  // F7.1: Recycle Bin confirmation state
  const [confirmEmptyRecycleBin, setConfirmEmptyRecycleBin] = useState(false);

  // F7.2: Data Integrity Check state
  const [integrityReport, setIntegrityReport] = useState<{
    ranAt: number;
    orphanOpsCount: number;
    duplicatePersonPairs: { p1Id: string; p1Name: string; p2Id: string; p2Name: string }[];
    daysMissingPrice: string[];
    invalidOpsCount: number;
    missingImages: string[];
    balanceReconciliationOk: boolean;
  } | null>(null);

  // G1.2: Diagnostic Error Logs state
  const [diagnosticLogs, setDiagnosticLogs] = useState(() => getDiagnosticErrorLogs());
  const [diagSeverityFilter, setDiagSeverityFilter] = useState<'all' | 'error' | 'warn' | 'info'>(
    'all'
  );
  const [diagCopiedToast, setDiagCopiedToast] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToDiagnosticLogs(() => {
      setDiagnosticLogs(getDiagnosticErrorLogs());
    });
  }, []);

  const runDataIntegrityCheck = async () => {
    const personIds = new Set(persons.map((p) => p.id));
    const workerIds = new Set(workers.map((w) => w.id));

    let orphanOpsCount = 0;
    let invalidOpsCount = 0;
    const activeTradeDates = new Set<string>();

    for (const op of operations) {
      if (op.personId && !personIds.has(op.personId)) orphanOpsCount++;
      if (op.workerId && !workerIds.has(op.workerId)) orphanOpsCount++;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(op.date) ||
        Number.isNaN(op.weightG) ||
        Number.isNaN(op.total) ||
        op.weightG < 0 ||
        op.total < 0
      ) {
        invalidOpsCount++;
      }
      if (op.kind === 'buy' || op.kind === 'sell') {
        activeTradeDates.add(op.date);
      }
    }

    const daysMissingPrice: string[] = [];
    for (const dt of Array.from(activeTradeDates).sort()) {
      const info = daysMap[dt];
      if (!info || !info.goldPricePerGram || info.goldPricePerGram <= 0 || info.priceConfirmed === false) {
        daysMissingPrice.push(dt);
      }
    }

    const duplicatePersonPairs: { p1Id: string; p1Name: string; p2Id: string; p2Name: string }[] = [];
    for (let i = 0; i < persons.length; i++) {
      for (let j = i + 1; j < persons.length; j++) {
        const n1 = normalizeArabicName(persons[i].name);
        const n2 = normalizeArabicName(persons[j].name);
        if (n1 && n2 && (n1 === n2 || (n1.length >= 5 && n2.length >= 5 && (n1.includes(n2) || n2.includes(n1))))) {
          duplicatePersonPairs.push({
            p1Id: persons[i].id,
            p1Name: persons[i].name,
            p2Id: persons[j].id,
            p2Name: persons[j].name,
          });
        }
      }
    }

    // Check attached ledger images
    const datesWithFileImages = Object.values(daysMap)
      .filter((d) => Boolean(d.ledgerImageFile))
      .map((d) => d.date);
    let missingImages: string[] = [];
    if (datesWithFileImages.length > 0) {
      const api = ensureGoldApiBridge();
      if (api.storage.checkImagesExist) {
        const imgRes = await api.storage.checkImagesExist(datesWithFileImages);
        if (imgRes.ok && imgRes.missingDates) {
          missingImages = imgRes.missingDates;
        }
      }
    }

    // Person balance reconciliation check
    const recon = computePersonBalancesSummary(operations, persons);
    const balanceReconciliationOk =
      Math.abs(recon.reconciliationDiffCash) < 0.01 &&
      Math.abs(recon.reconciliationDiffGoldG) < 0.005;

    setIntegrityReport({
      ranAt: Date.now(),
      orphanOpsCount,
      duplicatePersonPairs,
      daysMissingPrice,
      invalidOpsCount,
      missingImages,
      balanceReconciliationOk,
    });
  };

  // Exceptions inputs
  const [newExcItem, setNewExcItem] = useState('');
  const [newExcDate, setNewExcDate] = useState('');
  const [newExcPersonId, setNewExcPersonId] = useState('');

  // Excel/CSV Import & Column Mapping state (Fix C.7 & C.8)
  const [rawSheetRows, setRawSheetRows] = useState<any[][]>([]);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<{
    dateCol: number;
    kindCol: number;
    weightCol: number;
    totalCol: number;
    itemCol: number;
    goldPriceCol: number;
  }>({
    dateCol: -1,
    kindCol: -1,
    weightCol: -1,
    totalCol: -1,
    itemCol: -1,
    goldPriceCol: -1,
  });
  // Fix C.8: Explicit kind choice required if no kind column exists
  const [explicitImportKind, setExplicitImportKind] = useState<'' | 'sell' | 'buy'>('');
  const [fallbackImportDate, setFallbackImportDate] = useState(getTodayIso());
  const [manualDayBreakRowMap, setManualDayBreakRowMap] = useState<Record<number, string>>({});
  const [ignoredRowsReport, setIgnoredRowsReport] = useState<string | null>(null);
  const [importErrorMsg, setImportErrorMsg] = useState<string | null>(null);

  // Fix C.7: Pending imported operations waiting for missing daily gold prices
  const [pendingImportOps, setPendingImportOps] = useState<any[] | null>(null);
  const [pendingIgnoredCount, setPendingIgnoredCount] = useState<number>(0);
  const [missingPriceDatesMap, setMissingPriceDatesMap] = useState<Record<string, string>>({});
  const [extractedPricesMap, setExtractedPricesMap] = useState<Record<string, number>>({});

  // Fix C.10: JSON Backup Restore confirmation & error state
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [pendingRestoreData, setPendingRestoreData] = useState<any | null>(null);
  const [restoreSuccessBanner, setRestoreSuccessBanner] = useState<string | null>(null);

  // Built-in Self-Test Results (Fix A.6 & Fix B.6 & Prompt 2)
  const [testResults, setTestResults] = useState<
    { name: string; passed: boolean; detail: string }[]
  >([]);

  // Desktop: Gemini API Key & Model state (Prompt 3)
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [geminiHasKey, setGeminiHasKey] = useState(false);
  const [geminiEncAvailable, setGeminiEncAvailable] = useState(true);
  const [geminiTestStatus, setGeminiTestStatus] = useState<{
    loading: boolean;
    ok?: boolean;
    msg?: string;
  }>({ loading: false });

  // Desktop: Automatic Backups & Data Directory (Prompt 2 & Prompt 7.2)
  const [autoBackups, setAutoBackups] = useState<BackupFileInfo[]>([]);
  const [dataDirPath, setDataDirPath] = useState<string>('GoldAudit/');
  const [pendingAutoBackupRestore, setPendingAutoBackupRestore] = useState<BackupFileInfo | null>(
    null
  );
  const [externalSyncStatus, setExternalSyncStatus] = useState<{
    loading: boolean;
    ok?: boolean;
    msg?: string;
  }>({ loading: false });

  // Desktop: App Lock Security (Prompt 7.1)
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [appLockIdleMins, setAppLockIdleMins] = useState(15);
  const [appLockCurrentPass, setAppLockCurrentPass] = useState('');
  const [appLockNewPass, setAppLockNewPass] = useState('');
  const [appLockMsg, setAppLockMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refreshDesktopStatuses = async () => {
    const api = ensureGoldApiBridge();
    const [keyStat, backupsRes, lockStat] = await Promise.all([
      api.ai.getApiKeyStatus(),
      api.storage.listBackups(),
      api.security.getStatus(),
    ]);
    if (keyStat.ok) {
      setGeminiHasKey(keyStat.hasKey);
      setGeminiEncAvailable(keyStat.encryptionAvailable);
    }
    if (backupsRes.ok) {
      setAutoBackups(backupsRes.backups || []);
      if (backupsRes.dataDir) setDataDirPath(backupsRes.dataDir);
    }
    if (lockStat.ok) {
      setAppLockEnabled(lockStat.enabled);
      setAppLockIdleMins(lockStat.idleMinutes || 15);
    }
  };

  useEffect(() => {
    refreshDesktopStatuses();
  }, []);

  const handleSaveGeminiKey = async () => {
    const api = ensureGoldApiBridge();
    const res = await api.ai.setApiKey(geminiKeyInput);
    if (res.ok) {
      setGeminiKeyInput('');
      setGeminiTestStatus({
        loading: false,
        ok: true,
        msg: res.warning || 'تم حفظ مفتاح Gemini بنجاح في العملية الرئيسية ✓',
      });
      refreshDesktopStatuses();
    } else {
      setGeminiTestStatus({
        loading: false,
        ok: false,
        msg: res.error || 'تعذر حفظ المفتاح',
      });
    }
  };

  const handleTestGeminiKey = async () => {
    setGeminiTestStatus({ loading: true });
    const api = ensureGoldApiBridge();
    const res = await api.ai.testApiKey(
      geminiKeyInput.trim() || undefined,
      settings.geminiModel || 'gemini-3.8-flash'
    );
    setGeminiTestStatus({
      loading: false,
      ok: res.ok,
      msg: res.ok ? res.message || 'المفتاح يعمل بنجاح ✓' : res.error || 'فشل اختبار المفتاح',
    });
  };

  const handleSaveAppLock = async () => {
    setAppLockMsg(null);
    const api = ensureGoldApiBridge();
    const res = await api.security.configure({
      currentPassword: appLockCurrentPass,
      newPassword: appLockNewPass,
      enabled: appLockEnabled,
      idleMinutes: appLockIdleMins,
    });
    if (res.ok) {
      setAppLockCurrentPass('');
      setAppLockNewPass('');
      setAppLockMsg({
        ok: true,
        text: appLockEnabled
          ? 'تم تفعيل وحفظ كلمة مرور قفل البرنامج بنجاح (مشفرة بـ scrypt + salt) ✓'
          : 'تم إيقاف قفل البرنامج بكلمة مرور ✓',
      });
      window.dispatchEvent(new Event('gold-security-updated'));
      refreshDesktopStatuses();
    } else {
      setAppLockMsg({ ok: false, text: res.error || 'تعذر حفظ إعدادات القفل' });
    }
  };

  const handleSyncExternalNow = async () => {
    const folder = settings.externalBackupPath?.trim();
    if (!folder) {
      setExternalSyncStatus({
        loading: false,
        ok: false,
        msg: 'أدخل مسار المجلد الخارجي أو الفلاشة أولاً.',
      });
      return;
    }
    setExternalSyncStatus({ loading: true });
    await useAuditStore.getState().flushSaveNow();
    const api = ensureGoldApiBridge();
    const res = await api.storage.syncExternalBackup(folder);
    if (res.ok) {
      updateSettings({ lastExternalBackupAt: res.timestamp || Date.now() });
      setExternalSyncStatus({
        loading: false,
        ok: true,
        msg: `تم نسخ ملف البيانات إلى المجلد الخارجي بنجاح (${res.targetFile}) ✓`,
      });
    } else {
      setExternalSyncStatus({
        loading: false,
        ok: false,
        msg: res.error || 'الفلاشة غير موصولة أو المسار غير متاح.',
      });
    }
  };

  // Guess Arabic column headers automatically
  const handleExcelFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const firstSheetName = wb.SheetNames[0];
      const ws = wb.Sheets[firstSheetName];
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (aoa.length < 2) return;

      let headerIdx = 0;
      for (let i = 0; i < Math.min(10, aoa.length); i++) {
        const nonEmpty = aoa[i].filter((c) => String(c).trim() !== '').length;
        if (nonEmpty >= 2) {
          headerIdx = i;
          break;
        }
      }

      const headers = aoa[headerIdx].map((h, i) => String(h || `عمود ${i + 1}`).trim());
      const bodyRows = aoa.slice(headerIdx + 1);

      let dateCol = -1,
        kindCol = -1,
        weightCol = -1,
        totalCol = -1,
        itemCol = -1,
        goldPriceCol = -1;

      headers.forEach((h, idx) => {
        const norm = h.toLowerCase();
        if (norm.includes('تاريخ') || norm.includes('يوم') || norm.includes('date')) dateCol = idx;
        else if (norm.includes('نوع') || norm.includes('حركة') || norm.includes('type'))
          kindCol = idx;
        else if (norm.includes('وزن') || norm.includes('جرام') || norm.includes('weight'))
          weightCol = idx;
        else if (
          norm.includes('سعر الذهب') ||
          norm.includes('سعر اليوم') ||
          norm.includes('عيار 21')
        ) {
          goldPriceCol = idx;
        } else if (
          norm.includes('اجمال') ||
          norm.includes('إجمال') ||
          norm.includes('سعر') ||
          norm.includes('مبلغ') ||
          norm.includes('total')
        ) {
          totalCol = idx;
        } else if (norm.includes('بيان') || norm.includes('صنف') || norm.includes('item')) {
          itemCol = idx;
        }
      });

      setSheetHeaders(headers);
      setRawSheetRows(bodyRows);
      setColMap({
        dateCol,
        kindCol,
        weightCol: weightCol !== -1 ? weightCol : 0,
        totalCol: totalCol !== -1 ? totalCol : 1,
        itemCol,
        goldPriceCol,
      });
      setExplicitImportKind('');
      setIgnoredRowsReport(null);
      setImportErrorMsg(null);
      setPendingImportOps(null);
      setManualDayBreakRowMap({});
    };
    reader.readAsArrayBuffer(file);
  };

  // Fix C.7 & C.8: Parse Excel rows, require explicit kind if kindCol is -1, and prompt for any dates without a gold price
  const prepareExcelImport = () => {
    setImportErrorMsg(null);

    if (colMap.kindCol === -1 && !explicitImportKind) {
      setImportErrorMsg(
        'بما أن الملف لا يحتوي على عمود "نوع العملية"، يرجى اختيار النوع صراحةً (بيع أو شراء) قبل الاستيراد.'
      );
      return;
    }

    let ignoredCount = 0;
    let activeDate = fallbackImportDate;
    const validOpsToImport: any[] = [];
    const sheetPricesByDate: Record<string, number> = {};

    for (let rIdx = 0; rIdx < rawSheetRows.length; rIdx++) {
      if (manualDayBreakRowMap[rIdx]) {
        activeDate = manualDayBreakRowMap[rIdx];
      }

      const row = rawSheetRows[rIdx];
      const joinedText = row.map((c) => String(c || '').trim()).join(' ');
      if (!joinedText) {
        ignoredCount++;
        continue;
      }

      if (
        joinedText.includes('الإجمالي') ||
        joinedText.includes('الاجمالي') ||
        joinedText.includes('المجموع') ||
        joinedText.includes('الرصيد المرحل') ||
        (joinedText.includes('الوزن') && joinedText.includes('السعر'))
      ) {
        ignoredCount++;
        continue;
      }

      const rawW = colMap.weightCol >= 0 ? String(row[colMap.weightCol] ?? '') : '';
      const rawT = colMap.totalCol >= 0 ? String(row[colMap.totalCol] ?? '') : '';
      const weightG = parseWeightInput(rawW, settings.shortSpaceWeightMode);
      const total = parseAmountInput(rawT);

      if (weightG <= 0 || total <= 0) {
        ignoredCount++;
        continue;
      }

      if (colMap.dateCol >= 0 && row[colMap.dateCol]) {
        const parsedDate = parseFlexibleDate(row[colMap.dateCol], settings.dateFormatOrder);
        if (parsedDate) activeDate = parsedDate;
      }

      if (colMap.goldPriceCol >= 0 && row[colMap.goldPriceCol]) {
        const gp = parseAmountInput(String(row[colMap.goldPriceCol]));
        if (gp > 100) {
          sheetPricesByDate[activeDate] = gp;
        }
      }

      let kind: 'buy' | 'sell' = explicitImportKind === 'buy' ? 'buy' : 'sell';
      if (colMap.kindCol >= 0 && row[colMap.kindCol]) {
        const kStr = String(row[colMap.kindCol]);
        if (kStr.includes('شراء') || kStr.toLowerCase().includes('buy')) {
          kind = 'buy';
        } else {
          kind = 'sell';
        }
      }

      const item = colMap.itemCol >= 0 ? String(row[colMap.itemCol] ?? '').trim() : '';

      validOpsToImport.push({
        date: activeDate,
        kind,
        karat: 21,
        weightG,
        total,
        item,
        payment: 'cash' as const,
      });
    }

    if (validOpsToImport.length === 0) {
      setImportErrorMsg('لم يتم العثور على أي صفوف صالحة للاستيراد في هذا الملف.');
      return;
    }

    // Check if any date in validOpsToImport is missing a gold price
    const uniqueDates = Array.from(new Set(validOpsToImport.map((o) => o.date))).sort();
    const missingDates: Record<string, string> = {};

    for (const dt of uniqueDates) {
      const existingPrice =
        sheetPricesByDate[dt] ||
        (daysMap[dt]?.goldPricePerGram > 0 && daysMap[dt]?.priceConfirmed !== false
          ? daysMap[dt].goldPricePerGram
          : 0);
      if (!existingPrice || existingPrice <= 0) {
        missingDates[dt] = '';
      }
    }

    if (Object.keys(missingDates).length > 0) {
      setPendingImportOps(validOpsToImport);
      setPendingIgnoredCount(ignoredCount);
      setExtractedPricesMap(sheetPricesByDate);
      setMissingPriceDatesMap(missingDates);
      return;
    }

    finalizeExcelImport(validOpsToImport, ignoredCount, sheetPricesByDate);
  };

  const finalizeExcelImport = (
    opsToImport: any[],
    ignoredCount: number,
    pricesByDate: Record<string, number>
  ) => {
    const res = addOperationsBatch(opsToImport, pricesByDate, 'ملف إكسل');
    if (!res.ok) {
      setImportErrorMsg(res.error || 'تعذر استيراد الملف');
      return;
    }
    setIgnoredRowsReport(
      `تم استيراد ${opsToImport.length} عملية بنجاح مع تسجيل أسعار الذهب لكل التواريخ، وتم تجاهل ${ignoredCount} صف (صفوف إجماليات أو عناوين مكررة أو خلايا فارغة).`
    );
    setRawSheetRows([]);
    setPendingImportOps(null);
    setMissingPriceDatesMap({});
  };

  const handleConfirmMissingDatesPrices = () => {
    if (!pendingImportOps) return;
    const combinedPrices: Record<string, number> = { ...extractedPricesMap };
    for (const [dt, rawVal] of Object.entries(missingPriceDatesMap)) {
      const num = parseAmountInput(rawVal);
      if (num <= 0) {
        setImportErrorMsg(`يرجى إدخال سعر الذهب اليومي لتاريخ ${dt} قبل إتمام الاستيراد.`);
        return;
      }
      combinedPrices[dt] = num;
    }
    finalizeExcelImport(pendingImportOps, pendingIgnoredCount, combinedPrices);
  };

  // Fix C.10: JSON Restore with validation and confirmation modal
  const handleJsonRestoreFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreError(null);
    setRestoreSuccessBanner(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.operations)) {
          setRestoreError(
            'ملف النسخة الاحتياطية غير صالح: لا يحتوي الملف على بيانات عمليات (operations) صحيحة.'
          );
          return;
        }
        setPendingRestoreData(parsed);
      } catch {
        setRestoreError(
          'تعذر قراءة الملف: صيغة JSON غير صالحة أو الملف تالف. تأكد من اختيار ملف نسخة احتياطية صحيح.'
        );
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDownloadBackupNow = () => {
    exportJsonBackup({
      operations,
      daysMap,
      persons,
      workers,
      auditLogs,
      issueReviews,
      settings,
      expenseCategories,
      pricePresets,
      showItemColumn,
      closedSalaryMonths,
    });
    markBackupExported();
  };

  // Fix A.6 & Fix B.6: Comprehensive Self-Tests
  const runSelfTests = async () => {
    const results: { name: string; passed: boolean; detail: string }[] = [];

    // 1. Hindi numerals & space-separated weights
    const w1 = parseWeightInput('١٢ ٣٥٠');
    const amb1 = inspectAmbiguousSpaceWeight('12 5');
    results.push({
      name: 'تحويل الأرقام الهندية ("١٢ ٣٥٠" ← 12.350) واكتشاف الوزن الملتبس ("12 5")',
      passed: Math.abs(w1 - 12.35) < 0.0001 && amb1 !== null && amb1.decimalVal === 12.5,
      detail: `12 350 → ${w1} | 12 5 → عشري ${amb1?.decimalVal} / ملي ${amb1?.milliVal}`,
    });

    // 2. Flexible Date Parser
    const d1 = parseFlexibleDate('٦/٣/٢٠٢٦', 'DMY');
    const d2 = parseFlexibleDate(46080, 'DMY');
    results.push({
      name: 'تحويل التواريخ العربية ("٦/٣/٢٠٢٦") والأرقام التسلسلية لإكسل',
      passed: d1 === '2026-03-06' && Boolean(d2),
      detail: `العربي: ${d1} | التسلسلي: ${d2}`,
    });

    // 3. Fix A.6: Price Logic Tests (Making charge, Scrap discount, Below market, Above market, 18K)
    const mockDay: DayInfo = {
      date: '2026-10-26',
      goldPricePerGram: 7450,
      priceConfirmed: true,
      locked: false,
    };
    const testSettings = { ...DEFAULT_SETTINGS, ...settings };

    // 3a. Sell with normal making charge (7600 EGP/g vs 7450 daily + 250 max making charge) -> should NOT flag
    const normalSellWithMaking: Operation = {
      id: 't-sell-ok',
      date: '2026-10-26',
      kind: 'sell',
      karat: 21,
      weightG: 10,
      total: 76000, // 7600/g
      item: 'خاتم عيار 21',
      payment: 'cash',
      reviewedFlag: false,
      note: '',
      createdAt: 1,
      updatedAt: 1,
    };
    const resNormalSell = evaluateSingleOpPriceAnomaly(normalSellWithMaking, mockDay, testSettings);

    // 3b. Sell below market (7120 EGP/g vs 7450 daily) -> MUST flag
    const lowSellOp: Operation = {
      ...normalSellWithMaking,
      id: 't-sell-low',
      total: 71200, // 7120/g
    };
    const resLowSell = evaluateSingleOpPriceAnomaly(lowSellOp, mockDay, testSettings);

    // 3c. Scrap buy with normal discount (7350 EGP/g vs 7450 daily - 150 max discount) -> should NOT flag
    const normalScrapBuy: Operation = {
      ...normalSellWithMaking,
      id: 't-buy-ok',
      kind: 'buy',
      total: 73500, // 7350/g
    };
    const resNormalBuy = evaluateSingleOpPriceAnomaly(normalScrapBuy, mockDay, testSettings);

    // 3d. Buy above market (7620 EGP/g vs 7450 daily) -> MUST flag
    const highBuyOp: Operation = {
      ...normalScrapBuy,
      id: 't-buy-high',
      total: 76200, // 7620/g
    };
    const resHighBuy = evaluateSingleOpPriceAnomaly(highBuyOp, mockDay, testSettings);

    // 3e. Karat 18 sell at proper 18K price (~6386 + 114 making charge = 6500 EGP/g) -> should NOT flag
    const karat18SellOp: Operation = {
      ...normalSellWithMaking,
      id: 't-k18-ok',
      karat: 18,
      total: 65000, // 6500/g
    };
    const resKarat18 = evaluateSingleOpPriceAnomaly(karat18SellOp, mockDay, testSettings);

    results.push({
      name: 'منطق السعر (إصلاح أ): بيع بمصنعية عادية وشراء كسر بخصم عادي وعيار 18 لا يظهرون كأخطاء',
      passed: resNormalSell === null && resNormalBuy === null && resKarat18 === null,
      detail: `بيع بمصنعية: ${resNormalSell ? 'خطأ' : 'سليم ✓'} | شراء بخصم: ${
        resNormalBuy ? 'خطأ' : 'سليم ✓'
      } | عيار 18: ${resKarat18 ? 'خطأ' : 'سليم ✓'}`,
    });

    results.push({
      name: 'منطق السعر (إصلاح أ): بيع أقل من السوق (7,120) وشراء أعلى من السوق (7,620) يظهران بوضوح',
      passed: resLowSell !== null && resHighBuy !== null,
      detail: `بيع منخفض: ${resLowSell?.severity || 'لم يظهر'} | شراء مرتفع: ${
        resHighBuy?.severity || 'لم يظهر'
      }`,
    });

    // 4. Fix B.6: Store & Accounting Self-Tests (isolated state verification)
    const snapshotBefore = {
      operations: useAuditStore.getState().operations,
      daysMap: useAuditStore.getState().daysMap,
      auditLogs: useAuditStore.getState().auditLogs,
      workers: useAuditStore.getState().workers,
      closedSalaryMonths: useAuditStore.getState().closedSalaryMonths,
      lastAddedOpId: useAuditStore.getState().lastAddedOpId,
    };

    try {
      // Test B.6.1: Editing operation date is logged in auditLogs
      const tempOp = useAuditStore.getState().addOperation({
        date: '2099-01-01',
        kind: 'sell',
        karat: 21,
        weightG: 5,
        total: 37500,
        item: 'اختبار ذاتي',
        payment: 'cash',
      });
      let dateEditLogged = false;
      if (tempOp) {
        useAuditStore
          .getState()
          .updateOperation(tempOp.id, { date: '2099-01-02' }, 'اختبار نقل تاريخ');
        const latestLog = useAuditStore.getState().auditLogs[0];
        dateEditLogged =
          latestLog?.action === 'edit' &&
          Boolean(latestLog.oldValue?.includes('2099-01-01')) &&
          Boolean(latestLog.newValue?.includes('2099-01-02'));
      }
      results.push({
        name: 'سجل التعديلات (إصلاح ب): تعديل تاريخ العملية يُسجل في السجل بالقيمة القديمة والجديدة',
        passed: dateEditLogged,
        detail: dateEditLogged ? 'تم تسجيل نقل التاريخ بنجاح ✓' : 'لم يُسجل',
      });

      // Test B.6.2: Adding to a locked day is rejected
      useAuditStore.getState().toggleDayLock('2099-01-05', true, 'قفل اختباري');
      const rejectedSingle = useAuditStore.getState().addOperation({
        date: '2099-01-05',
        kind: 'sell',
        weightG: 2,
        total: 15000,
        item: '',
        payment: 'cash',
      });
      const rejectedBatch = useAuditStore.getState().addOperationsBatch(
        [
          {
            date: '2099-01-05',
            kind: 'sell',
            weightG: 2,
            total: 15000,
            item: '',
            payment: 'cash',
          },
        ],
        7450,
        'اختبار'
      );
      results.push({
        name: 'حماية القفل (إصلاح ب): رفض الإضافة الفردية والمجمعة ليوم مقفول',
        passed: rejectedSingle === null && !rejectedBatch.ok,
        detail:
          rejectedSingle === null && !rejectedBatch.ok
            ? 'تم رفض الإضافة لليوم المقفول ✓'
            : 'فشل المنع',
      });

      // Test B.6.3: Friday gap doesn't break safe carryover
      const nearestAfterThursday = findNearestSubsequentActiveDate(
        '2026-10-22', // Thursday
        [
          {
            id: 'sat-op',
            date: '2026-10-24', // Saturday (Friday 2026-10-23 has no ops)
            kind: 'sell',
            weightG: 3,
            total: 22000,
            item: '',
            payment: 'cash',
            reviewedFlag: false,
            note: '',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        {}
      );
      results.push({
        name: 'ترحيل الخزنة والجرد (إصلاح ب): إجازة الجمعة لا تكسر الترحيل من الخميس للسبت',
        passed: nearestAfterThursday === '2026-10-24',
        detail: `اليوم اللاحق الفعلي بعد الخميس 22-10: ${nearestAfterThursday}`,
      });

      // Test B.6.4: Closing salary month twice is rejected
      const close1 = useAuditStore
        .getState()
        .closeMonthSalaries('2099-12', '2099-12-30', true);
      const close2 = useAuditStore
        .getState()
        .closeMonthSalaries('2099-12', '2099-12-30', true);
      results.push({
        name: 'إقفال المرتبات (إصلاح ب): منع إقفال نفس الشهر مرتين',
        passed: close1.ok && !close2.ok,
        detail:
          close1.ok && !close2.ok
            ? 'الإقفال الأول نجح والثاني رُفض ✓'
            : 'فشل منع التكرار',
      });
    } finally {
      // Restore clean state after self-tests
      useAuditStore.setState(snapshotBefore);
    }

    // Prompt 2 & Prompt 8.4: Test atomic file save & load roundtrip + schema migration
    try {
      const api = ensureGoldApiBridge();
      const saveOk = await useAuditStore.getState().flushSaveNow();
      const loadRes = await api.storage.load();
      const roundtripPassed =
        saveOk &&
        loadRes.ok &&
        loadRes.state &&
        Array.isArray(loadRes.state.operations) &&
        loadRes.state.operations.length === snapshotBefore.operations.length;

      results.push({
        name: 'التخزين الذرّي للملفات (state.json.tmp ← fsync ← state.json): حفظ وتحميل متطابقان',
        passed: Boolean(roundtripPassed),
        detail: roundtripPassed
          ? `تطابق ${loadRes.state.operations.length} عملية بنجاح ✓`
          : 'فشل التحقق من الملف',
      });
    } catch {
      results.push({
        name: 'التخزين الذرّي للملفات (state.json.tmp ← fsync ← state.json)',
        passed: false,
        detail: 'خطأ أثناء اختبار التخزين',
      });
    }

    // G1 Self-Tests: Quarantine, Sensitive Scrubber & Fix-It Engine
    const quarantineTest = validateAndQuarantineState({
      operations: [
        {
          id: 'valid-op-1',
          date: '2026-10-26',
          kind: 'sell',
          karat: 21,
          weightG: 10,
          total: 35000,
          item: 'غويشة',
          payment: 'cash',
          reviewedFlag: false,
          note: '',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'corrupt-op-2',
          date: 'bad-date',
          kind: 'invalid_kind',
          weightG: -5,
          total: 'not-a-number',
        },
      ],
    });
    const scrubbedSample = scrubSensitiveText(
      'عميل الحاج محمد دفع 145000.50 ج.م بمفتاح AIzaSyD1234567890123456789012345678'
    );
    const inlineTypo = detectFastEntryInlineTypo({
      kind: 'sell',
      karat: 21,
      weightG: 10,
      total: 350000,
      dayInfo: {
        date: '2026-10-26',
        goldPricePerGram: 3500,
        priceConfirmed: true,
        locked: false,
      },
    });
    const fixItList = scanForFixItSuggestions({
      operations: [
        {
          id: 'fix-op-1',
          date: '2026-10-26',
          kind: 'sell',
          karat: 21,
          weightG: 10,
          total: 350000, // 10x zero typo
          item: 'خاتم',
          payment: 'cash',
          reviewedFlag: false,
          note: '',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      daysMap: {
        '2026-10-26': {
          date: '2026-10-26',
          goldPricePerGram: 3500,
          priceConfirmed: true,
          locked: false,
        },
      },
      persons: [],
      settings: DEFAULT_SETTINGS,
    });

    results.push({
      name: 'عزل السجلات التالفة (G1 Quarantine) وتنقية سجل الأخطاء من الأسماء والمبالغ والمفاتيح',
      passed:
        quarantineTest.operations.length === 1 &&
        quarantineTest.quarantined.length === 1 &&
        !scrubbedSample.includes('AIzaSy') &&
        !scrubbedSample.includes('145000'),
      detail: `سليم: ${quarantineTest.operations.length} | معزول: ${quarantineTest.quarantined.length} ✓`,
    });

    results.push({
      name: 'محرك التصحيح الذكي (G1 Fix-It) واقتراح الإدخال السريع الفوري (صفر زائد / تبديل خانات)',
      passed: Boolean(inlineTypo && inlineTypo.suggestedTotal === 35000) && fixItList.length > 0,
      detail: `اقتراح فوري: ${inlineTypo?.suggestedTotal} ج.م | اقتراحات الفحص: ${fixItList.length} ✓`,
    });

    // G3 Self-Test: 8-Stage Universal Import Pipeline (Hindi digits + totals row separation)
    const sampleImportRows = [
      ['التاريخ', 'النوع', 'العيار', 'الوزن', 'المبلغ', 'البيان'],
      ['٢٦/١٠/٢٠٢٦', 'بيع', '٢١', '١٠.٥٠٠', '٣٦٧٥٠', 'خاتم ذهب'],
      ['الإجمالي', '', '', '10.500', '36750', ''],
    ];
    const struct = detectTableStructure(sampleImportRows);
    const guessedCols = autoGuessColumnMapping(struct.headers, struct.dataRows);
    const normRows = normalizeDataRows(struct.dataRows, guessedCols, {
      defaultDate: '2026-10-26',
      defaultKarat: 21,
      defaultKind: 'sell',
    });
    const valRows = validateNormalizedRows(normRows, {});

    results.push({
      name: 'أنبوب الاستيراد الشامل (G3): فصل صف الإجمالي وتطبيع الأرقام والتواريخ العربية',
      passed:
        struct.dataRows.length === 1 &&
        struct.extractedTotalsRow !== null &&
        valRows.length === 1 &&
        valRows[0].health === 'ok' &&
        Math.abs(valRows[0].weightG - 10.5) < 0.001,
      detail: `صفوف البيانات: ${valRows.length} (وزن ${valRows[0]?.weightG} جم) | فصل الإجمالي: نعم ✓`,
    });

    setTestResults(results);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Section 1: Sensitivity Presets, Allowed Price Range & Thresholds (Fix A.2 + Fix C.13) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-amber-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                إعدادات نطاق السعر المسموح وحدود الفحوصات
              </h2>
              <p className="text-xs text-slate-500">
                اضبط المصنعية المسموحة في البيع وخصم الكسر المسموح في الشراء لتجنب الإنذارات الكاذبة.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs">
            {(
              [
                { id: 'strict', label: 'صارم (1% و Z=3.0)' },
                { id: 'medium', label: 'متوسط (1.5% و Z=3.5)' },
                { id: 'lenient', label: 'متساهل (3% و Z=4.5)' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applySensitivityPreset(p.id)}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                  settings.sensitivityPreset === p.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Fix A.2: Allowed Daily Price Range (Making charge for sell, Scrap discount for buy) */}
        <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-3">
          <h3 className="text-xs font-extrabold text-amber-950">
            نطاق الفرق المسموح عن سعر الذهب اليومي (حسب طبيعة محل الذهب):
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-800 mb-1">
                أقصى مصنعية مسموحة في البيع فوق سعر اليوم (ج.م/جرام):
              </label>
              <input
                type="number"
                value={settings.allowedPriceRange?.sellMaxMakingCharge ?? 250}
                onChange={(e) =>
                  updateSettings({
                    allowedPriceRange: {
                      ...(settings.allowedPriceRange || DEFAULT_SETTINGS.allowedPriceRange),
                      sellMaxMakingCharge: Number(e.target.value),
                    },
                  })
                }
                className="w-full px-3 py-1.5 font-mono font-bold bg-white border border-amber-400 rounded-lg"
              />
              <span className="text-[11px] text-slate-500">
                البيع الأعلى من سعر اليوم ضمن هذه المصنعية يُعتبر طبيعياً ولا يُنذر.
              </span>
            </div>

            <div>
              <label className="block font-bold text-slate-800 mb-1">
                هامش السماح تحت سعر اليوم في البيع (X ج.م/جرام):
              </label>
              <input
                type="number"
                value={settings.allowedPriceRange?.sellMinBelowDaily ?? 0}
                onChange={(e) =>
                  updateSettings({
                    allowedPriceRange: {
                      ...(settings.allowedPriceRange || DEFAULT_SETTINGS.allowedPriceRange),
                      sellMinBelowDaily: Number(e.target.value),
                    },
                  })
                }
                className="w-full px-3 py-1.5 font-mono font-bold bg-white border border-amber-400 rounded-lg"
              />
              <span className="text-[11px] text-slate-500">
                افتراضي 0 (أي بيع أقل من سعر اليوم يُنذر).
              </span>
            </div>

            <div>
              <label className="block font-bold text-slate-800 mb-1">
                أقصى خصم مسموح في الشراء (الكسر) تحت سعر اليوم (Z ج.م/جرام):
              </label>
              <input
                type="number"
                value={settings.allowedPriceRange?.buyMaxDiscount ?? 150}
                onChange={(e) =>
                  updateSettings({
                    allowedPriceRange: {
                      ...(settings.allowedPriceRange || DEFAULT_SETTINGS.allowedPriceRange),
                      buyMaxDiscount: Number(e.target.value),
                    },
                  })
                }
                className="w-full px-3 py-1.5 font-mono font-bold bg-white border border-amber-400 rounded-lg"
              />
              <span className="text-[11px] text-slate-500">
                الشراء الأقل من سعر اليوم ضمن هذا الخصم يُعتبر طبيعياً ولا يُنذر.
              </span>
            </div>
          </div>
        </div>

        {/* Manual Thresholds Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-600 mb-1">
              نسبة تجاوز النطاق المسموح — تنبيه متوسط (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={settings.priceDiffMediumPct}
              onChange={(e) =>
                updateSettings({
                  sensitivityPreset: 'custom',
                  priceDiffMediumPct: Number(e.target.value),
                })
              }
              className="w-full px-3 py-1.5 font-mono font-bold border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-slate-600 mb-1">
              نسبة تجاوز النطاق المسموح — خطورة عالية (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={settings.priceDiffHighPct}
              onChange={(e) =>
                updateSettings({
                  sensitivityPreset: 'custom',
                  priceDiffHighPct: Number(e.target.value),
                })
              }
              className="w-full px-3 py-1.5 font-mono font-bold border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-slate-600 mb-1">
              حد الشذوذ الإحصائي (Robust Z — Median+MAD)
            </label>
            <input
              type="number"
              step="0.1"
              value={settings.robustZThreshold}
              onChange={(e) =>
                updateSettings({
                  sensitivityPreset: 'custom',
                  robustZThreshold: Number(e.target.value),
                })
              }
              className="w-full px-3 py-1.5 font-mono font-bold border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-slate-600 mb-1">
              أقصى وزن معقول للعملية الواحدة (جرام)
            </label>
            <input
              type="number"
              value={settings.maxReasonableWeightG}
              onChange={(e) =>
                updateSettings({ maxReasonableWeightG: Number(e.target.value) })
              }
              className="w-full px-3 py-1.5 font-mono font-bold border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-slate-600 mb-1">
              هامش سماح مطابقة جرد الذهب (جرام)
            </label>
            <input
              type="number"
              step="0.1"
              value={settings.goldBalanceToleranceG}
              onChange={(e) =>
                updateSettings({ goldBalanceToleranceG: Number(e.target.value) })
              }
              className="w-full px-3 py-1.5 font-mono font-bold border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-slate-600 mb-1">
              حد عجز/زيادة الخزنة المسموح (ج.م)
            </label>
            <input
              type="number"
              value={settings.cashDiscrepancyThreshold}
              onChange={(e) =>
                updateSettings({ cashDiscrepancyThreshold: Number(e.target.value) })
              }
              className="w-full px-3 py-1.5 font-mono font-bold border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-slate-600 mb-1">
              ترتيب التاريخ عند استيراد إكسل (اليوم/الشهر)
            </label>
            <select
              value={settings.dateFormatOrder}
              onChange={(e) =>
                updateSettings({ dateFormatOrder: e.target.value as 'DMY' | 'MDY' })
              }
              className="w-full px-3 py-1.5 font-bold border border-slate-300 rounded-lg bg-white"
            >
              <option value="DMY">يوم / شهر / سنة (DMY - افتراضي)</option>
              <option value="MDY">شهر / يوم / سنة (MDY)</option>
            </select>
          </div>

          {/* Fix C.13: Ambiguous space-weight setting */}
          <div>
            <label className="block text-slate-600 mb-1">
              الوزن المفصول بمسافة بأقل من 3 أرقام (مثل "12 5")
            </label>
            <select
              value={settings.shortSpaceWeightMode || 'ask'}
              onChange={(e) =>
                updateSettings({
                  shortSpaceWeightMode: e.target.value as ShortSpaceWeightMode,
                })
              }
              className="w-full px-3 py-1.5 font-bold border border-slate-300 rounded-lg bg-white"
            >
              <option value="ask">اسألني لتأكيد القصد (12.5 أم 12.005)</option>
              <option value="decimal">اعتبره كسراً عشرياً دائماً (12.5)</option>
              <option value="milli">اعتبره مليجرامات دائماً (12.005)</option>
            </select>
          </div>
        </div>

        {/* Fixed Rules during Fast Entry (merged with % deviation in Fix A.3) */}
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.fixedRules.enabled}
                onChange={(e) =>
                  updateSettings({
                    fixedRules: { ...settings.fixedRules, enabled: e.target.checked },
                  })
                }
                className="rounded text-amber-600"
              />
              <span>
                تفعيل "القواعد الثابتة" المدمجة (تُدمج مع فحص النسبة في تنبيه واحد بالأشد خطورة)
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.excludeFridays}
                  onChange={(e) => updateSettings({ excludeFridays: e.target.checked })}
                  className="rounded text-amber-600"
                />
                <span>استثناء يوم الجمعة من فحص "أيام بدون حركة"</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableAiSummaryButton}
                  onChange={(e) =>
                    updateSettings({ enableAiSummaryButton: e.target.checked })
                  }
                  className="rounded text-indigo-600"
                />
                <span>إظهار زر "لخّص النتائج بالكلام" (يرسل إحصائيات مجمعة فقط)</span>
              </label>
            </div>
          </div>

          {settings.fixedRules.enabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  تنبيه أحمر إذا قلّ سعر البيع عن الحد الأدنى المسموح بـ (ج.م/جرام):
                </label>
                <input
                  type="number"
                  value={settings.fixedRules.sellBelowDailyByAmount}
                  onChange={(e) =>
                    updateSettings({
                      fixedRules: {
                        ...settings.fixedRules,
                        sellBelowDailyByAmount: Number(e.target.value),
                      },
                    })
                  }
                  className="w-40 px-3 py-1.5 font-mono font-bold bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  تنبيه أحمر إذا زاد سعر الشراء عن سعر اليوم بـ (ج.م/جرام):
                </label>
                <input
                  type="number"
                  value={settings.fixedRules.buyAboveDailyByAmount}
                  onChange={(e) =>
                    updateSettings({
                      fixedRules: {
                        ...settings.fixedRules,
                        buyAboveDailyByAmount: Number(e.target.value),
                      },
                    })
                  }
                  className="w-40 px-3 py-1.5 font-mono font-bold bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Exceptions List */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900">
          قائمة الاستثناءات (أصناف أو أشخاص أو تواريخ يتم تجاهلها في الفحوصات)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {/* Items Exception */}
          <div className="space-y-2">
            <label className="font-bold text-slate-700 block">أصناف مستثناة</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newExcItem}
                onChange={(e) => setNewExcItem(e.target.value)}
                placeholder="مثال: سبيكة..."
                className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newExcItem.trim()) return;
                  updateSettings({
                    exceptions: {
                      ...settings.exceptions,
                      items: [...settings.exceptions.items, newExcItem.trim()],
                    },
                  });
                  setNewExcItem('');
                }}
                className="px-3 py-1.5 bg-slate-900 text-white font-bold rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {settings.exceptions.items.map((it) => (
                <span
                  key={it}
                  className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200 flex items-center gap-1"
                >
                  {it}
                  <button
                    type="button"
                    onClick={() =>
                      updateSettings({
                        exceptions: {
                          ...settings.exceptions,
                          items: settings.exceptions.items.filter((x) => x !== it),
                        },
                      })
                    }
                    className="text-red-600 font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Dates Exception */}
          <div className="space-y-2">
            <label className="font-bold text-slate-700 block">تواريخ مستثناة</label>
            <div className="flex gap-1.5">
              <input
                type="date"
                value={newExcDate}
                onChange={(e) => setNewExcDate(e.target.value)}
                className="flex-1 px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newExcDate) return;
                  updateSettings({
                    exceptions: {
                      ...settings.exceptions,
                      dates: [...settings.exceptions.dates, newExcDate],
                    },
                  });
                  setNewExcDate('');
                }}
                className="px-3 py-1.5 bg-slate-900 text-white font-bold rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {settings.exceptions.dates.map((dt) => (
                <span
                  key={dt}
                  className="px-2 py-0.5 bg-slate-100 font-mono rounded border border-slate-200 flex items-center gap-1"
                >
                  {dt}
                  <button
                    type="button"
                    onClick={() =>
                      updateSettings({
                        exceptions: {
                          ...settings.exceptions,
                          dates: settings.exceptions.dates.filter((x) => x !== dt),
                        },
                      })
                    }
                    className="text-red-600 font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Persons Exception */}
          <div className="space-y-2">
            <label className="font-bold text-slate-700 block">أشخاص مستثنون</label>
            <div className="flex gap-1.5">
              <select
                value={newExcPersonId}
                onChange={(e) => setNewExcPersonId(e.target.value)}
                className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">اختر شخصاً...</option>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!newExcPersonId) return;
                  updateSettings({
                    exceptions: {
                      ...settings.exceptions,
                      personIds: [...settings.exceptions.personIds, newExcPersonId],
                    },
                  });
                  setNewExcPersonId('');
                }}
                className="px-3 py-1.5 bg-slate-900 text-white font-bold rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {settings.exceptions.personIds.map((pid) => {
                const pName = persons.find((p) => p.id === pid)?.name || pid;
                return (
                  <span
                    key={pid}
                    className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200 flex items-center gap-1"
                  >
                    {pName}
                    <button
                      type="button"
                      onClick={() =>
                        updateSettings({
                          exceptions: {
                            ...settings.exceptions,
                            personIds: settings.exceptions.personIds.filter((x) => x !== pid),
                          },
                        })
                      }
                      className="text-red-600 font-bold"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Smart Excel/CSV Import with Column Mapping & Missing Gold Price Prompt (Fix C.7 & C.8) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              استيراد ملف Excel / CSV مع ربط الأعمدة وضبط سعر الذهب لكل تاريخ
            </h3>
            <p className="text-xs text-slate-500">
              يقرأ عمود سعر الذهب إن وُجد، أو يطلب منك إدخال أسعار التواريخ غير المسجلة قبل إتمام الاستيراد.
            </p>
          </div>
          <label className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg cursor-pointer inline-flex items-center gap-2">
            <Upload className="w-4 h-4" />
            <span>اختر ملف Excel أو CSV</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {ignoredRowsReport && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-xs font-bold text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{ignoredRowsReport}</span>
          </div>
        )}

        {importErrorMsg && (
          <div className="p-3 bg-red-50 border border-red-300 rounded-lg text-xs font-bold text-red-900 flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
            <span>{importErrorMsg}</span>
          </div>
        )}

        {rawSheetRows.length > 0 && !pendingImportOps && (
          <div className="space-y-4 pt-3 border-t border-slate-200 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <label className="block font-bold mb-1">عمود الوزن (إلزامي)</label>
                <select
                  value={colMap.weightCol}
                  onChange={(e) => setColMap({ ...colMap, weightCol: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
                >
                  {sheetHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">عمود الإجمالي (إلزامي)</label>
                <select
                  value={colMap.totalCol}
                  onChange={(e) => setColMap({ ...colMap, totalCol: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
                >
                  {sheetHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">عمود التاريخ (إن وجد)</label>
                <select
                  value={colMap.dateCol}
                  onChange={(e) => setColMap({ ...colMap, dateCol: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
                >
                  <option value={-1}>— بدون عمود تاريخ —</option>
                  {sheetHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">عمود سعر الذهب اليومي (إن وجد)</label>
                <select
                  value={colMap.goldPriceCol}
                  onChange={(e) =>
                    setColMap({ ...colMap, goldPriceCol: Number(e.target.value) })
                  }
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
                >
                  <option value={-1}>— بدون عمود سعر ذهب —</option>
                  {sheetHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">عمود النوع (بيع/شراء)</label>
                <select
                  value={colMap.kindCol}
                  onChange={(e) => setColMap({ ...colMap, kindCol: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
                >
                  <option value={-1}>— لا يوجد عمود نوع في الملف —</option>
                  {sheetHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Fix C.8: Explicit kind selection if no kind column is mapped */}
              {colMap.kindCol === -1 && (
                <div>
                  <label className="block font-bold text-red-800 mb-1">
                    اختر نوع العمليات صراحةً (إجباري):
                  </label>
                  <select
                    value={explicitImportKind}
                    onChange={(e) =>
                      setExplicitImportKind(e.target.value as '' | 'sell' | 'buy')
                    }
                    className="w-full px-2 py-1.5 border-2 border-red-400 rounded bg-red-50 font-bold"
                  >
                    <option value="">— اختر: بيع أم شراء؟ —</option>
                    <option value="sell">كل الصفوف مبيعات (بيع)</option>
                    <option value="buy">كل الصفوف مشتريات (شراء)</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block font-bold mb-1">عمود البيان</label>
                <select
                  value={colMap.itemCol}
                  onChange={(e) => setColMap({ ...colMap, itemCol: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
                >
                  <option value={-1}>— بدون بيان —</option>
                  {sheetHeaders.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">التاريخ الافتراضي لبداية الشيت</label>
                <input
                  type="date"
                  value={fallbackImportDate}
                  onChange={(e) => setFallbackImportDate(e.target.value)}
                  className="w-full px-2 py-1.5 font-mono border border-slate-300 rounded"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-bold text-slate-700">
                معاينة أول 15 صفاً (يمكنك تحديد بداية يوم جديد يدوياً أمام أي صف):
              </div>
              <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-lg">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="py-1.5 px-2 w-40">بداية يوم جديد يدوياً</th>
                      {sheetHeaders.map((h, i) => (
                        <th key={i} className="py-1.5 px-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rawSheetRows.slice(0, 15).map((r, rIdx) => (
                      <tr key={rIdx} className="border-b border-slate-100">
                        <td className="py-1 px-2">
                          <input
                            type="date"
                            value={manualDayBreakRowMap[rIdx] || ''}
                            onChange={(e) =>
                              setManualDayBreakRowMap({
                                ...manualDayBreakRowMap,
                                [rIdx]: e.target.value,
                              })
                            }
                            className="px-1.5 py-0.5 font-mono text-[11px] border border-slate-200 rounded"
                          />
                        </td>
                        {sheetHeaders.map((_, cIdx) => (
                          <td key={cIdx} className="py-1 px-2 font-mono">
                            {String(r[cIdx] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRawSheetRows([])}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 font-bold rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={prepareExcelImport}
                className="px-4 py-1.5 bg-emerald-700 text-white font-bold rounded-lg"
              >
                متابعة استيراد الصفوف ({rawSheetRows.length} صف خام)
              </button>
            </div>
          </div>
        )}

        {/* Fix C.7: Prompt for missing gold prices per date before completing Excel import */}
        {pendingImportOps && (
          <div className="p-4 bg-amber-50 border-2 border-amber-400 rounded-xl space-y-4 text-xs">
            <div className="font-bold text-amber-950 text-sm">
              أدخل سعر الذهب اليومي (عيار 21) للتواريخ التالية قبل إتمام الاستيراد ({pendingImportOps.length} عملية جاهزة):
            </div>
            <p className="text-slate-700">
              لا يُعتبر الاستيراد مكتملاً حتى لا تبقى أيام بلا سعر ذهب مسجل لضمان دقة فحص الأسعار:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.keys(missingPriceDatesMap).map((dt) => (
                <div key={dt} className="bg-white p-2.5 rounded-lg border border-amber-300">
                  <label className="block font-mono font-bold text-slate-800 mb-1">
                    تاريخ {dt}:
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={missingPriceDatesMap[dt]}
                    onChange={(e) =>
                      setMissingPriceDatesMap({
                        ...missingPriceDatesMap,
                        [dt]: e.target.value,
                      })
                    }
                    placeholder="سعر عيار 21 (مثال: 7450)"
                    className="w-full px-2.5 py-1.5 font-mono font-bold border border-slate-300 rounded outline-none focus:border-amber-600"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingImportOps(null)}
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 font-bold rounded-lg"
              >
                رجوع
              </button>
              <button
                type="button"
                onClick={handleConfirmMissingDatesPrices}
                className="px-4 py-1.5 bg-emerald-700 text-white font-bold rounded-lg"
              >
                حفظ الأسعار وإتمام الاستيراد الآن
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Desktop Section: Gemini Key, App Lock & External/Automatic Backups (Prompts 2, 3, 7, 8) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Gemini API Key & OCR Toggle (Prompt 3) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  إعدادات Gemini وقراءة صور الدفتر (محفوظ مشفراً على الجهاز)
                </h3>
                <p className="text-[11px] text-slate-500">
                  يُحفظ المفتاح في العملية الرئيسية فقط ولا يُرسل للواجهة أبداً.
                </p>
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                geminiHasKey
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {geminiHasKey ? 'المفتاح محفوظ ✓' : 'غير مسجل'}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-700 mb-1">
                  مفتاح Gemini API (حقل سري):
                </label>
                <input
                  type="password"
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  placeholder={
                    geminiHasKey
                      ? '•••••••••••••••• (اكتب مفتاحاً جديداً للاستبدال)'
                      : 'AIzaSy...'
                  }
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  اسم الموديل (قابل للتعديل):
                </label>
                <input
                  type="text"
                  value={settings.geminiModel || 'gemini-3.8-flash'}
                  onChange={(e) => updateSettings({ geminiModel: e.target.value })}
                  className="w-full px-3 py-1.5 font-mono font-bold border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSaveGeminiKey}
                className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg cursor-pointer"
              >
                حفظ المفتاح
              </button>
              <button
                type="button"
                disabled={geminiTestStatus.loading}
                onClick={handleTestGeminiKey}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg cursor-pointer"
              >
                {geminiTestStatus.loading ? 'جاري الاختبار...' : 'اختبر المفتاح'}
              </button>
              <label className="inline-flex items-center gap-1.5 font-bold text-slate-700 mr-auto cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(settings.disablePhotoUpload)}
                  onChange={(e) => updateSettings({ disablePhotoUpload: e.target.checked })}
                  className="rounded border-slate-300 text-red-600"
                />
                <span>تعطيل قراءة الصور نهائياً (أوفلاين 100%)</span>
              </label>
            </div>

            {geminiTestStatus.msg && (
              <div
                className={`p-2.5 rounded-lg font-bold ${
                  geminiTestStatus.ok
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                {geminiTestStatus.msg}
              </div>
            )}
          </div>
        </div>

        {/* App Lock Password Settings (Prompt 7.1) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-slate-800" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  قفل البرنامج بكلمة مرور (عند الفتح وبعد الخمول)
                </h3>
                <p className="text-[11px] text-slate-500">
                  تُخزَّن مشفرة بـ scrypt مع salt في مجلد بيانات المستخدم.
                </p>
              </div>
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={appLockEnabled}
                onChange={(e) => setAppLockEnabled(e.target.checked)}
                className="rounded border-slate-300 text-amber-600"
              />
              <span>تفعيل كلمة مرور عند الفتح</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                كلمة المرور الحالية (إن وجدت):
              </label>
              <input
                type="password"
                value={appLockCurrentPass}
                onChange={(e) => setAppLockCurrentPass(e.target.value)}
                placeholder="الحالية..."
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                كلمة المرور الجديدة:
              </label>
              <input
                type="password"
                value={appLockNewPass}
                onChange={(e) => setAppLockNewPass(e.target.value)}
                placeholder="الجديدة..."
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                القفل بعد خمول (دقيقة):
              </label>
              <input
                type="number"
                min={1}
                max={240}
                value={appLockIdleMins}
                onChange={(e) => setAppLockIdleMins(Number(e.target.value) || 15)}
                className="w-full px-2.5 py-1.5 font-mono font-bold border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handleSaveAppLock}
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg cursor-pointer"
            >
              حفظ إعدادات قفل البرنامج
            </button>
            <span className="text-[11px] text-slate-400">
              إصدار البرنامج: v2.0.0 (Schema v2)
            </span>
          </div>

          {appLockMsg && (
            <div
              className={`p-2.5 rounded-lg text-xs font-bold ${
                appLockMsg.ok
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {appLockMsg.text}
            </div>
          )}
        </div>
      </div>

      {/* Automatic Backups & External Flash Drive Backup (Prompt 2 & Prompt 7.2) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Automatic Backups List */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-amber-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  النسخ الاحتياطية التلقائية على الجهاز ({autoBackups.length})
                </h3>
                <p className="text-[11px] text-slate-500 font-mono" dir="ltr">
                  {dataDirPath}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={async () => {
                  await useAuditStore.getState().flushSaveNow(true);
                  refreshDesktopStatuses();
                }}
                className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold rounded-lg inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>نسخة فورية الآن</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  const res = await ensureGoldApiBridge().storage.openDataFolder();
                  if (res.dataDir) {
                    setRestoreSuccessBanner(`مسار مجلد البيانات المحلي: ${res.dataDir}`);
                  }
                }}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg inline-flex items-center gap-1 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>فتح مجلد البيانات</span>
              </button>
            </div>
          </div>

          {autoBackups.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">
              لا توجد نسخ احتياطية تلقائية بعد. تُنشأ النسخ تلقائياً عند الفتح اليومي وعند الإغلاق.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 text-xs">
              {autoBackups.map((bk) => (
                <div
                  key={bk.name}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-mono font-bold text-slate-800">{bk.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {new Date(bk.createdAt).toLocaleString('ar-EG')} ·{' '}
                      {Math.max(1, Math.round(bk.sizeBytes / 1024))} KB ·{' '}
                      <span className="font-bold text-slate-700">
                        {bk.operationsCount} عملية
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingAutoBackupRestore(bk)}
                    className="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold rounded-lg cursor-pointer"
                  >
                    استعادة
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* External Flash Drive / Cloud Folder Backup (Prompt 7.2) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <HardDrive className="w-5 h-5 text-teal-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                النسخة الاحتياطية الخارجية (فلاشة USB أو مجلد Google Drive / OneDrive)
              </h3>
              <p className="text-[11px] text-slate-500">
                يُنسخ إليها ملف البيانات تلقائياً بعد كل قفل يوم وعند إغلاق البرنامج.
              </p>
            </div>
          </div>

          <div className="space-y-2.5 text-xs">
            <label className="block font-bold text-slate-700">
              مسار مجلد النسخ الخارجي (مثال: <code>E:\GoldBackups</code>):
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                dir="ltr"
                value={settings.externalBackupPath || ''}
                onChange={(e) => updateSettings({ externalBackupPath: e.target.value })}
                placeholder="E:\GoldAuditBackups"
                className="flex-1 px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                onClick={async () => {
                  const res = await ensureGoldApiBridge().storage.chooseExternalFolder();
                  if (res.ok && res.folderPath) {
                    updateSettings({ externalBackupPath: res.folderPath });
                  } else if (res.error) {
                    setExternalSyncStatus({ loading: false, ok: false, msg: res.error });
                  }
                }}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-lg cursor-pointer"
              >
                اختيار مجلد...
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                disabled={externalSyncStatus.loading}
                onClick={handleSyncExternalNow}
                className="px-4 py-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg cursor-pointer"
              >
                {externalSyncStatus.loading ? 'جاري النسخ...' : 'نسخ إلى المجلد الخارجي الآن'}
              </button>
              <span className="text-[11px] text-slate-500">
                آخر نسخ خارجي:{' '}
                {settings.lastExternalBackupAt
                  ? new Date(settings.lastExternalBackupAt).toLocaleString('ar-EG')
                  : 'لم يتم بعد'}
              </span>
            </div>

            {externalSyncStatus.msg && (
              <div
                className={`p-2.5 rounded-lg font-bold ${
                  externalSyncStatus.ok
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                {externalSyncStatus.msg}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 4: JSON Full Backup & Self-Tests (Fix C.9, C.10 + Fix A.6, B.6) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">
              تصدير واستيراد ملفات JSON الخارجية
            </h3>
          </div>
          <p className="text-xs text-slate-600">
            تُحفظ بياناتك تلقائياً في ملفات آمنة ضد انقطاع الكهرباء (<code>state.json</code> + <code>state.json.bak</code>)، ويمكنك أيضاً تصدير أو استيراد ملف JSON مستقل.
          </p>

          {restoreError && (
            <div className="p-3 bg-red-50 border border-red-300 rounded-lg text-xs font-bold text-red-900 flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
              <span>{restoreError}</span>
            </div>
          )}

          {restoreSuccessBanner && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-xs font-bold text-emerald-900">
              {restoreSuccessBanner}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleDownloadBackupNow}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تصدير نسخة احتياطية JSON</span>
            </button>

            <label className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg cursor-pointer inline-flex items-center gap-1.5">
              <Upload className="w-4 h-4" />
              <span>استعادة نسخة JSON</span>
              <input
                type="file"
                accept=".json"
                onChange={handleJsonRestoreFileSelect}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={clearAllData}
              className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg inline-flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>مسح كل البيانات</span>
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-900">
                الاختبارات الذاتية الشاملة (9 اختبارات)
              </h3>
            </div>
            <button
              type="button"
              onClick={runSelfTests}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer"
            >
              تشغيل الاختبارات الذاتية (9 اختبارات)
            </button>
          </div>
          {testResults.length > 0 ? (
            <div className="space-y-1.5 pt-1 max-h-72 overflow-y-auto">
              {testResults.map((t, i) => (
                <div
                  key={i}
                  className="p-2 bg-slate-50 rounded border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <span className="font-semibold text-slate-800">{t.name}</span>
                  <span
                    className={`font-mono font-bold ${
                      t.passed ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {t.passed ? 'ناجح ✓' : 'فشل'} ({t.detail})
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              اضغط "تشغيل الاختبارات الذاتية" للتحقق الآلي من منطق السعر والمصنعية وعيار 18 وسجل التعديلات والقفل وترحيل الجمعة وإقفال المرتبات والتخزين الذرّي للملفات.
            </p>
          )}
        </div>
      </div>

      {/* Section 5: Data Integrity Check (F7.2) & Recycle Bin (F7.1) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* F7.2: Data Integrity Check */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-teal-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  فحص سلامة البيانات والربط المحاسبي
                </h3>
                <p className="text-[11px] text-slate-500">
                  يفحص الأرقام التالفة، الأسماء المكررة، الأيام بدون سعر ذهب، والصور المفقودة.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={runDataIntegrityCheck}
              className="px-3.5 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg cursor-pointer"
            >
              تشغيل فحص سلامة البيانات
            </button>
          </div>

          {!integrityReport ? (
            <p className="text-xs text-slate-500 py-3">
              اضغط الزر أعلاه لفحص قاعدة البيانات المحلية والتأكد من تطابق الأرصدة وعدم وجود تكرار أو نقص.
            </p>
          ) : (
            <div className="space-y-2.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <span>عمليات مرتبطة بشخص/عامل غير موجود:</span>
                  <span
                    className={`font-mono font-extrabold ${
                      integrityReport.orphanOpsCount === 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {integrityReport.orphanOpsCount === 0
                      ? '0 (سليم ✓)'
                      : `${integrityReport.orphanOpsCount} عملية`}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <span>تواريخ أو أرقام غير صالحة (NaN/سالب):</span>
                  <span
                    className={`font-mono font-extrabold ${
                      integrityReport.invalidOpsCount === 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {integrityReport.invalidOpsCount === 0
                      ? '0 (سليم ✓)'
                      : `${integrityReport.invalidOpsCount} عملية`}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <span>تطابق أرصدة الأشخاص مع مجموع العمليات:</span>
                  <span
                    className={`font-mono font-extrabold ${
                      integrityReport.balanceReconciliationOk ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {integrityReport.balanceReconciliationOk ? 'متطابق 100% ✓' : 'يوجد فرق!'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <span>صور دفاتر مفقودة من المجلد:</span>
                  <span
                    className={`font-mono font-extrabold ${
                      integrityReport.missingImages.length === 0
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {integrityReport.missingImages.length === 0
                      ? '0 (سليم ✓)'
                      : `${integrityReport.missingImages.length} صورة`}
                  </span>
                </div>
              </div>

              {integrityReport.daysMissingPrice.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-950">
                  <div className="font-bold mb-1">
                    أيام بها عمليات بيع/شراء ولكن بدون سعر ذهب مؤكد ({integrityReport.daysMissingPrice.length}):
                  </div>
                  <div className="font-mono text-[11px]">
                    {integrityReport.daysMissingPrice.join(' ، ')}
                  </div>
                </div>
              )}

              {integrityReport.duplicatePersonPairs.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                  <div className="font-bold text-amber-950">
                    أسماء أشخاص متشابهة جداً يُحتمل تكرارها ({integrityReport.duplicatePersonPairs.length}):
                  </div>
                  {integrityReport.duplicatePersonPairs.map((pair, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between bg-white p-2 rounded border border-amber-200"
                    >
                      <span>
                        <strong>{pair.p1Name}</strong> ↔ <strong>{pair.p2Name}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          mergeDuplicatePersons(pair.p1Id, pair.p2Id);
                          runDataIntegrityCheck();
                        }}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded cursor-pointer"
                      >
                        دمج في ({pair.p1Name})
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* F7.1: Recycle Bin (سلة المحذوفات) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  سلة المحذوفات ({deletedOperations.length})
                </h3>
                <p className="text-[11px] text-slate-500">
                  تُحفظ العمليات المحذوفة هنا مع وقت وسبب الحذف ويمكنك استعادتها في أي وقت.
                </p>
              </div>
            </div>
            {deletedOperations.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmEmptyRecycleBin(true)}
                className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold rounded-lg cursor-pointer"
              >
                تفريغ السلة نهائياً
              </button>
            )}
          </div>

          {deletedOperations.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              سلة المحذوفات فارغة حالياً.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 text-xs">
              {deletedOperations.map((delOp) => (
                <div
                  key={delOp.id}
                  className="py-2.5 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-bold text-slate-900">
                      [{delOp.operation.date}]{' '}
                      {delOp.operation.kind === 'sell'
                        ? 'بيع'
                        : delOp.operation.kind === 'buy'
                        ? 'شراء'
                        : delOp.operation.kind === 'expense'
                        ? 'مصروف'
                        : delOp.operation.kind === 'advance'
                        ? 'سلفة'
                        : 'شخص'}{' '}
                      — {formatNumber(delOp.operation.total)} ج.م
                      {delOp.operation.weightG > 0
                        ? ` (${formatWeight(delOp.operation.weightG)} ج)`
                        : ''}
                      {delOp.operation.item ? ` · ${delOp.operation.item}` : ''}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      حُذفت في: {new Date(delOp.deletedAt).toLocaleString('ar-EG')} · السبب:{' '}
                      <span className="font-semibold text-rose-800">{delOp.reason}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => restoreFromRecycleBin(delOp.id)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shrink-0 cursor-pointer"
                  >
                    استعادة
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* G1.2: Diagnostics & Error Log Section (14-Day Rotation, Scrubbed of Sensitive Data) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-600" />
              <span>التشخيص وسجل الأخطاء المحلي (احتفاظ لـ 14 يوماً — منقّى من البيانات الحساسة)</span>
            </h3>
            <p className="text-xs text-slate-500">
              لا يحتوي السجل إطلاقاً على أسماء أشخاص أو مبالغ مالية أو مفاتيح سرية. يمكنك تصدير تقرير مشكلة مضغوط (.zip) للدعم الفني.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={diagSeverityFilter}
              onChange={(e) => setDiagSeverityFilter(e.target.value as any)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-bold"
            >
              <option value="all">كل المستويات ({diagnosticLogs.length})</option>
              <option value="error">أخطاء (Error)</option>
              <option value="warn">تحذيرات (Warn)</option>
              <option value="info">معلومات (Info)</option>
            </select>

            <button
              type="button"
              onClick={async () => {
                await exportProblemReportZip(settings);
                setDiagCopiedToast('تم تصدير ملف تقرير المشكلة (.zip) بنجاح ✓');
                setTimeout(() => setDiagCopiedToast(null), 3000);
              }}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير تقرير مشكلة (.zip)</span>
            </button>

            {diagnosticLogs.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearDiagnosticErrorLogs();
                  setDiagnosticLogs([]);
                }}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer"
              >
                مسح السجل
              </button>
            )}
          </div>
        </div>

        {diagCopiedToast && (
          <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg text-xs font-bold">
            {diagCopiedToast}
          </div>
        )}

        {diagnosticLogs.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            سجل الأخطاء التشخيصي نظيف تماماً — لم تُسجل أي أخطاء خلال آخر 14 يوماً.
          </p>
        ) : (
          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 text-xs">
            {diagnosticLogs
              .filter((l) => diagSeverityFilter === 'all' || l.severity === diagSeverityFilter)
              .map((log) => (
                <div key={log.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 font-bold">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[11px] text-slate-800">
                        {log.code}
                      </span>
                      <span className="text-slate-900">{log.title} — {log.message}</span>
                      <span className="text-slate-400 font-mono text-[11px]">
                        {new Date(log.timestamp).toLocaleString('ar-EG')}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      الشاشة: <span className="font-mono">{log.screen}</span>
                      {log.hint ? (
                        <>
                          {' '}· الإجراء المقترح:{' '}
                          <span className="font-semibold text-amber-800">{log.hint}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(JSON.stringify(log, null, 2));
                      setDiagCopiedToast(`تم نسخ تفاصيل الخطأ (${log.code}) إلى الحافظة ✓`);
                      setTimeout(() => setDiagCopiedToast(null), 2500);
                    }}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded shrink-0 cursor-pointer"
                  >
                    نسخ التفاصيل
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Confirmation Modal for Emptying Recycle Bin Permanently */}
      {confirmEmptyRecycleBin && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-red-700 font-bold text-base">
              <AlertOctagon className="w-5 h-5 shrink-0" />
              <span>تأكيد الحذف النهائي لسلة المحذوفات</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              هل أنت متأكد من حذف جميع العمليات في سلة المحذوفات ({deletedOperations.length} عملية) نهائياً؟ لا يمكن التراجع عن هذا الإجراء بعد التأكيد.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmEmptyRecycleBin(false)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  emptyRecycleBinPermanently();
                  setConfirmEmptyRecycleBin(false);
                }}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                نعم، احذفها نهائياً
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal Before Restoring Automatic Backup (Prompt 2) */}
      {pendingAutoBackupRestore && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-base">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>تأكيد استعادة النسخة التلقائية</span>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-600">اسم ملف النسخة:</span>
                <span className="font-mono font-bold text-slate-900">
                  {pendingAutoBackupRestore.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">العمليات الحالية:</span>
                <span className="font-mono font-bold text-slate-900">
                  {operations.length} عملية
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">العمليات في النسخة المختارة:</span>
                <span className="font-mono font-bold text-emerald-700">
                  {pendingAutoBackupRestore.operationsCount} عملية
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-600">
              سيحفظ البرنامج نسخة احتياطية من وضعك الحالي تلقائياً قبل استبداله بهذه النسخة.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingAutoBackupRestore(null)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = pendingAutoBackupRestore;
                  setPendingAutoBackupRestore(null);
                  if (!target) return;
                  const res = await ensureGoldApiBridge().storage.restoreBackup(target.name);
                  if (res.ok && res.state) {
                    importFullBackup(res.state);
                    setRestoreSuccessBanner(
                      `تمت استعادة النسخة التلقائية (${target.name}) بنجاح ✓`
                    );
                    refreshDesktopStatuses();
                  } else {
                    setRestoreError(res.error || 'تعذر استعادة النسخة التلقائية');
                  }
                }}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
              >
                تأكيد الاستعادة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fix C.10: Confirmation Modal Before Restoring JSON Backup */}
      {pendingRestoreData && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-base">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>تأكيد استعادة النسخة الاحتياطية</span>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-600">عدد العمليات الحالية في المتصفح:</span>
                <span className="font-mono font-bold text-slate-900">
                  {operations.length} عملية
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">عدد العمليات في الملف المختار:</span>
                <span className="font-mono font-bold text-emerald-700">
                  {pendingRestoreData.operations?.length || 0} عملية
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              سيؤدي استكمال الاستعادة إلى استبدال البيانات الحالية بالبيانات الموجودة في الملف (شاملة الإعدادات وإعدادات بيان الأسعار المحفوظة).
            </p>

            <button
              type="button"
              onClick={handleDownloadBackupNow}
              className="w-full py-2 px-3 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>نزّل نسخة احتياطية من البيانات الحالية أولاً</span>
            </button>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingRestoreData(null)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  const res = importFullBackup(pendingRestoreData);
                  setPendingRestoreData(null);
                  if (!res.ok) {
                    setRestoreError(res.error || 'فشل استعادة النسخة الاحتياطية');
                  } else {
                    setRestoreSuccessBanner(
                      `تمت استعادة النسخة الاحتياطية بنجاح (${pendingRestoreData.operations.length} عملية).`
                    );
                  }
                }}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
              >
                تأكيد واستعادة النسخة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
