import React, { useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  Upload,
  ClipboardPaste,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Trash2,
  RotateCcw,
  BookmarkPlus,
  Sparkles,
  History,
  FileArchive,
  Lock,
} from 'lucide-react';
import { useAuditStore, findSuggestedGoldPrice } from '../store/useAuditStore';
import { GoldKarat, OperationKind } from '../types';
import {
  detectImportFileType,
  extractRawTablesFromFile,
  parseDelimitedTextToRows,
  ExtractedSheetTable,
  detectTableStructure,
  autoGuessColumnMapping,
  ImportColumnMapping,
  normalizeDataRows,
  validateNormalizedRows,
  ValidatedImportRow,
  detectDuplicatesInImport,
  checkImportDayConditions,
} from '../import/pipeline';
import {
  formatNumber,
  formatWeight,
  getTodayIso,
  normalizeArabicName,
  parseAmountInput,
  parseWeightInput,
} from '../utils/numerals';
import { reportAppError } from '../errors/catalog';

interface UniversalImportPanelProps {
  onAddedSuccess: () => void;
  onForwardFileToPhotoOcr: (file: File) => void;
}

const COLUMN_FIELDS: { key: keyof ImportColumnMapping; label: string }[] = [
  { key: 'dateCol', label: 'التاريخ' },
  { key: 'kindCol', label: 'النوع (بيع/شراء/مصروف...)' },
  { key: 'karatCol', label: 'العيار' },
  { key: 'weightCol', label: 'الوزن (جرام)' },
  { key: 'milliCol', label: 'الملي (منفصل)' },
  { key: 'totalCol', label: 'إجمالي المبلغ (ج.م)' },
  { key: 'gramPriceCol', label: 'سعر الجرام' },
  { key: 'itemCol', label: 'الصنف / البيان' },
  { key: 'personCol', label: 'الشخص / العامل' },
  { key: 'paymentCol', label: 'طريقة الدفع (نقدي/آجل)' },
  { key: 'dailyGoldPriceCol', label: 'سعر ذهب اليوم' },
  { key: 'noteCol', label: 'ملاحظات' },
];

export const UniversalImportPanel: React.FC<UniversalImportPanelProps> = ({
  onAddedSuccess,
  onForwardFileToPhotoOcr,
}) => {
  const {
    currentDate,
    operations,
    daysMap,
    persons,
    workers,
    settings,
    importBatches,
    importTemplates,
    addOperationsBatch,
    addPerson,
    addWorker,
    importFullBackup,
    saveImportTemplate,
    deleteImportTemplate,
    rollbackImportBatch,
  } = useAuditStore();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pipeline state
  const [sourceFileName, setSourceFileName] = useState<string>('');
  const [sourceFileType, setSourceFileType] = useState<string>('');
  const [sourceFileHash, setSourceFileHash] = useState<string>('');
  const [detectedEncoding, setDetectedEncoding] = useState<string>('');
  const [sheets, setSheets] = useState<ExtractedSheetTable[]>([]);
  const [selectedSheetIdx, setSelectedSheetIdx] = useState<number>(0);
  const [fullJsonBackupCandidate, setFullJsonBackupCandidate] = useState<any | null>(null);

  // Clipboard paste area
  const [showPasteBox, setShowPasteBox] = useState<boolean>(false);
  const [pasteText, setPasteText] = useState<string>('');

  // Defaults for missing fields
  const [defaultDate, setDefaultDate] = useState<string>(currentDate || getTodayIso());
  const [defaultKind, setDefaultKind] = useState<OperationKind>('sell');
  const [defaultKarat, setDefaultKarat] = useState<GoldKarat>(21);
  const [explicitKindOverride, setExplicitKindOverride] = useState<'buy' | 'sell' | ''>('');

  // Column Mapping & Templates
  const [colMap, setColMap] = useState<ImportColumnMapping>({
    dateCol: -1,
    kindCol: -1,
    karatCol: -1,
    weightCol: -1,
    milliCol: -1,
    totalCol: -1,
    gramPriceCol: -1,
    itemCol: -1,
    personCol: -1,
    paymentCol: -1,
    dailyGoldPriceCol: -1,
    noteCol: -1,
  });
  const [templateNameInput, setTemplateNameInput] = useState<string>('');

  // Interactive Preview Rows
  const [previewRows, setPreviewRows] = useState<ValidatedImportRow[]>([]);
  const [extractedTotalsRow, setExtractedTotalsRow] = useState<{
    rawText: string;
    totalWeightG?: number;
    totalAmount?: number;
  } | null>(null);
  const [previewFilterTab, setPreviewFilterTab] = useState<'all' | 'error' | 'warn' | 'duplicate'>(
    'all'
  );

  // Bulk Edit state
  const [bulkKind, setBulkKind] = useState<OperationKind>('sell');
  const [bulkKarat, setBulkKarat] = useState<GoldKarat>(21);
  const [bulkDate, setBulkDate] = useState<string>(currentDate || getTodayIso());

  // Missing daily gold prices map
  const [missingPricesInput, setMissingPricesInput] = useState<Record<string, string>>({});

  // Status & Errors
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [showBatchHistory, setShowBatchHistory] = useState<boolean>(false);

  const activeSheet = sheets[selectedSheetIdx] || null;
  const structure = useMemo(
    () => (activeSheet ? detectTableStructure(activeSheet.rows) : null),
    [activeSheet]
  );

  // Run stages 5, 6, 7 whenever sheet, colMap, or defaults change
  const rebuildPreviewFromStructure = (
    struct: ReturnType<typeof detectTableStructure>,
    mapping: ImportColumnMapping,
    hash?: string
  ) => {
    const normalized = normalizeDataRows(struct.dataRows, mapping, {
      defaultDate,
      defaultKarat,
      defaultKind,
      explicitKind: explicitKindOverride,
      dateFormatOrder: settings.dateFormatOrder,
      shortSpaceWeightMode: settings.shortSpaceWeightMode,
    });
    const validated = validateNormalizedRows(normalized, daysMap);
    const deduped = detectDuplicatesInImport(
      validated,
      operations,
      importBatches,
      hash ?? sourceFileHash
    );
    setExtractedTotalsRow(struct.extractedTotalsRow);
    setPreviewRows(deduped.rows);
  };

  const loadSheetIntoPipeline = (
    sheetList: ExtractedSheetTable[],
    sheetIdx: number,
    hash: string
  ) => {
    const targetSheet = sheetList[sheetIdx];
    if (!targetSheet) return;
    const struct = detectTableStructure(targetSheet.rows);
    const guessed = autoGuessColumnMapping(struct.headers, struct.dataRows.slice(0, 8));
    setColMap(guessed);
    rebuildPreviewFromStructure(struct, guessed, hash);
  };

  const handleFileUpload = async (file: File) => {
    setErrorBanner(null);
    setSuccessBanner(null);
    setFullJsonBackupCandidate(null);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const detected = detectImportFileType(file.name, bytes);

      if (!detected.ok) {
        reportAppError({
          code: detected.errorCode === 'E-IMPORT-011' ? 'E-IMPORT-011' : 'E-IMPORT-010',
          screen: 'UniversalImportPanel',
          customMessage: detected.errorMessage || 'Unsupported or oversized file',
        });
        setErrorBanner(detected.errorMessage || 'نوع الملف غير مدعوم.');
        return;
      }

      if (detected.fileKind === 'image') {
        onForwardFileToPhotoOcr(file);
        return;
      }

      const extracted = await extractRawTablesFromFile(
        file.name,
        bytes,
        detected.fileKind
      );

      if (extracted.requiresOcr) {
        onForwardFileToPhotoOcr(file);
        return;
      }

      if (!extracted.ok || extracted.sheets.length === 0) {
        reportAppError({
          code: 'E-IMPORT-012',
          screen: 'UniversalImportPanel',
          customMessage: extracted.errorMessage || 'No tables found in file',
        });
        setErrorBanner(extracted.errorMessage || 'لم يتم العثور على جدول بيانات قابل للاستيراد.');
        return;
      }

      setSourceFileName(file.name);
      setSourceFileType(detected.fileKind);
      setSourceFileHash(detected.fileHash);
      setDetectedEncoding(extracted.detectedEncoding || 'UTF-8');
      setSheets(extracted.sheets);
      setSelectedSheetIdx(0);

      if (extracted.isFullJsonBackup && extracted.jsonBackupPayload) {
        setFullJsonBackupCandidate(extracted.jsonBackupPayload);
      }

      loadSheetIntoPipeline(extracted.sheets, 0, detected.fileHash);
    } catch (err: any) {
      reportAppError({
        code: 'E-IMPORT-012',
        screen: 'UniversalImportPanel',
        customMessage: err?.message || 'File import exception',
        stack: err?.stack,
      });
      setErrorBanner(err?.message || 'حدث خطأ أثناء قراءة الملف.');
    }
  };

  const handleParseClipboardText = () => {
    setErrorBanner(null);
    setSuccessBanner(null);
    if (!pasteText.trim()) {
      setErrorBanner('الصق نصاً أو جدولاً من إكسل أو واتساب أولاً.');
      return;
    }
    const parsed = parseDelimitedTextToRows(pasteText);
    if (parsed.rows.length === 0) {
      setErrorBanner('لم يتم العثور على صفوف صالحة في النص الملصوق.');
      return;
    }
    const virtualSheets: ExtractedSheetTable[] = [
      { sheetName: 'جدول ملصوق من الحافظة', rows: parsed.rows },
    ];
    const hash = `clipboard-${pasteText.length}`;
    setSourceFileName('لصق مباشر من الحافظة');
    setSourceFileType('clipboard');
    setSourceFileHash(hash);
    setDetectedEncoding('UTF-8');
    setSheets(virtualSheets);
    setSelectedSheetIdx(0);
    setShowPasteBox(false);
    loadSheetIntoPipeline(virtualSheets, 0, hash);
  };

  // Stage 8: Day Conditions (Locked dates & missing gold prices)
  const dayConditions = useMemo(
    () => checkImportDayConditions(previewRows, daysMap),
    [previewRows, daysMap]
  );

  // Previous identical file import warning
  const previousSameFileBatch = useMemo(
    () =>
      sourceFileHash
        ? importBatches.find((b) => !b.rolledBack && b.fileSha === sourceFileHash)
        : undefined,
    [sourceFileHash, importBatches]
  );

  // Filtered rows for display
  const displayedRows = useMemo(() => {
    if (previewFilterTab === 'error') return previewRows.filter((r) => r.health === 'error');
    if (previewFilterTab === 'warn') return previewRows.filter((r) => r.health === 'warn');
    if (previewFilterTab === 'duplicate') return previewRows.filter((r) => r.isDuplicate);
    return previewRows;
  }, [previewRows, previewFilterTab]);

  // Selected valid rows summary
  const selectedValidRows = useMemo(
    () => previewRows.filter((r) => r.selected && r.health !== 'error'),
    [previewRows]
  );

  const selectedTotals = useMemo(() => {
    let weightG = 0;
    let amount = 0;
    for (const r of selectedValidRows) {
      weightG += r.weightG || 0;
      amount += r.total || 0;
    }
    return { weightG, amount };
  }, [selectedValidRows]);

  const updateSinglePreviewRow = (rowId: string, patch: Partial<ValidatedImportRow>) => {
    setPreviewRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const updated = { ...r, ...patch };
        const revalidated = validateNormalizedRows([updated], daysMap)[0];
        return {
          ...revalidated,
          id: r.id,
          selected: patch.selected !== undefined ? patch.selected : revalidated.health !== 'error',
          isDuplicate: r.isDuplicate,
        };
      })
    );
  };

  // Bulk Actions on Selected Rows
  const applyBulkFieldToSelected = (patch: Partial<ValidatedImportRow>) => {
    setPreviewRows((prev) =>
      prev.map((r) => {
        if (!r.selected) return r;
        const next = { ...r, ...patch };
        const reval = validateNormalizedRows([next], daysMap)[0];
        return { ...reval, id: r.id, selected: true, isDuplicate: r.isDuplicate };
      })
    );
  };

  const applyZeroTypoFixOnSelected = () => {
    setPreviewRows((prev) =>
      prev.map((r) => {
        if (!r.selected || (r.kind !== 'buy' && r.kind !== 'sell')) return r;
        const refPrice =
          daysMap[r.date]?.goldPricePerGram ||
          findSuggestedGoldPrice(r.date, daysMap) ||
          3500;
        if (r.weightG <= 0 || r.total <= 0) return r;
        const implied = r.total / r.weightG;
        let nextTotal = r.total;
        if (implied > refPrice * 5 && Math.abs(r.total / 10 / r.weightG - refPrice) / refPrice < 0.25) {
          nextTotal = Math.round(r.total / 10);
        } else if (
          implied < refPrice * 0.2 &&
          Math.abs((r.total * 10) / r.weightG - refPrice) / refPrice < 0.25
        ) {
          nextTotal = Math.round(r.total * 10);
        }
        if (nextTotal === r.total) return r;
        const reval = validateNormalizedRows([{ ...r, total: nextTotal }], daysMap)[0];
        return { ...reval, id: r.id, selected: true, isDuplicate: r.isDuplicate };
      })
    );
  };

  const deleteSelectedPreviewRows = () => {
    setPreviewRows((prev) => prev.filter((r) => !r.selected));
  };

  const executeCommitImport = () => {
    setErrorBanner(null);
    if (selectedValidRows.length === 0) {
      setErrorBanner('لا توجد صفوف محددة وصالحة للاستيراد.');
      return;
    }

    if (dayConditions.lockedDates.length > 0) {
      setErrorBanner(
        `لا يمكن الاستيراد لأن التواريخ التالية مقفولة بعد المراجعة: (${dayConditions.lockedDates.join(
          ' ، '
        )}). افتح القفل أولاً أو غيّر التاريخ.`
      );
      return;
    }

    // Build gold price map from missingPricesInput + row dailyGoldPrice
    const priceMap: Record<string, number> = {};
    for (const r of selectedValidRows) {
      if (r.dailyGoldPrice && r.dailyGoldPrice > 0) {
        priceMap[r.date] = r.dailyGoldPrice;
      }
    }
    for (const [dt, val] of Object.entries(missingPricesInput)) {
      const num = parseAmountInput(val);
      if (num > 0) priceMap[dt] = num;
    }

    // Resolve personId / workerId automatically
    const rowsToSave = selectedValidRows.map((r) => {
      let personId: string | undefined;
      let workerId: string | undefined;
      const pName = r.personName.trim();

      if (pName && (r.kind === 'person' || r.payment === 'credit')) {
        const existingP = persons.find(
          (p) => normalizeArabicName(p.name) === normalizeArabicName(pName)
        );
        if (existingP) {
          personId = existingP.id;
        } else {
          const created = addPerson({
            name: pName,
            type: r.kind === 'buy' ? 'supplier' : 'client',
          });
          personId = created.id;
        }
      } else if (pName && r.kind === 'advance') {
        const existingW = workers.find(
          (w) => normalizeArabicName(w.name) === normalizeArabicName(pName)
        );
        if (existingW) {
          workerId = existingW.id;
        } else {
          const createdW = addWorker({
            name: pName,
            monthlySalary: 0,
            dueDay: 30,
          });
          workerId = createdW.id;
        }
      }

      return {
        date: r.date,
        kind: r.kind,
        karat: r.karat,
        weightG: r.weightG,
        total: r.total,
        item: r.item || (r.kind === 'expense' ? 'مصروف مستورد' : ''),
        category: r.kind === 'expense' ? r.item || 'أخرى' : undefined,
        payment: r.payment,
        personId,
        workerId,
        direction: r.kind === 'person' ? ('gave_him' as const) : undefined,
        note: r.note,
      };
    });

    const res = addOperationsBatch(rowsToSave, priceMap, sourceFileName || 'استيراد شامل', {
      sourceType: sourceFileType || 'table',
      fileSha: sourceFileHash,
    });

    if (!res.ok) {
      setErrorBanner(res.error || 'تعذر حفظ الدفعة المستوردة.');
      return;
    }

    setSuccessBanner(
      `تم استيراد ${res.addedCount} عملية بنجاح وحفظها في سجل الدفعات (يمكنك التراجع عنها في أي وقت).`
    );
    setPreviewRows([]);
    setSheets([]);
    setTimeout(() => {
      onAddedSuccess();
    }, 900);
  };

  return (
    <div className="space-y-5">
      {/* Top Dropzone & Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-amber-600" />
              <span>محرك الاستيراد الشامل الذكي (8 مراحل فحص وتطبيع)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              يقبل ملفات Excel (.xlsx/.xls/.ods)، CSV/TSV (مع كشف ترميز Windows-1256 العربي)، Word (.docx)، PDF النصي، HTML، Markdown، JSON، أرشيف ZIP، أو اللصق المباشر من الحافظة.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt,.docx,.pdf,.html,.htm,.md,.json,.zip,image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileUpload(f);
                e.target.value = '';
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>اختر أي ملف للاستيراد</span>
            </button>

            <button
              type="button"
              onClick={() => setShowPasteBox((p) => !p)}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ClipboardPaste className="w-4 h-4" />
              <span>لصق جدول (Excel / واتساب)</span>
            </button>

            <button
              type="button"
              onClick={() => setShowBatchHistory((p) => !p)}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <History className="w-4 h-4 text-slate-600" />
              <span>سجل الدفعات والتراجع ({importBatches.length})</span>
            </button>
          </div>
        </div>

        {/* Drag & Drop Area */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFileUpload(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-300 hover:border-amber-500 bg-slate-50/70 hover:bg-amber-50/30 rounded-xl p-6 text-center cursor-pointer transition-colors"
        >
          <p className="text-xs font-bold text-slate-700">
            اسحب وأفلت أي ملف هنا (Excel، CSV، PDF، Word، HTML، JSON، ZIP، أو صورة دفتر) — الحد الأقصى 50MB
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            يتم تلقائياً توحيد الأرقام العربية الشرقية (٠-٩)، تفسير الوزن بصيغة (12 350)، وفصل صف الإجمالي للمقارنة
          </p>
        </div>

        {/* Direct Clipboard Paste Box */}
        {showPasteBox && (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <label className="block text-xs font-bold text-slate-800">
              الصق خلايا من Excel أو Google Sheets أو رسالة جدولية (Ctrl+V):
            </label>
            <textarea
              rows={5}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="مثال:&#10;التاريخ	النوع	العيار	الوزن	المبلغ	البيان&#10;2026-10-26	بيع	21	12.350	43500	خاتم لازوردي"
              className="w-full p-3 text-xs font-mono bg-white border border-slate-300 rounded-lg outline-none focus:border-amber-600"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPasteBox(false)}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleParseClipboardText}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-extrabold cursor-pointer"
              >
                تحليل النص الملصوق وعرض المعاينة
              </button>
            </div>
          </div>
        )}

        {errorBanner && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-bold text-red-800 flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
        )}

        {successBanner && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-bold text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successBanner}</span>
          </div>
        )}
      </div>

      {/* G3.5: Import Batch History & 1-Click Rollback Panel */}
      {showBatchHistory && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-amber-600" />
              <span>سجل دفعات الاستيراد السابقة وإمكانية التراجع الكامل</span>
            </h3>
            <button
              type="button"
              onClick={() => setShowBatchHistory(false)}
              className="text-xs font-bold text-slate-500 hover:text-slate-800"
            >
              إغلاق
            </button>
          </div>

          {importBatches.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">لا توجد دفعات استيراد مسجلة بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                    <th className="py-2 px-3">تاريخ الاستيراد</th>
                    <th className="py-2 px-3">المصدر / اسم الملف</th>
                    <th className="py-2 px-3">عدد الصفوف</th>
                    <th className="py-2 px-3">الأيام المتأثرة</th>
                    <th className="py-2 px-3 text-center">الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {importBatches.map((batch) => (
                    <tr key={batch.id} className="border-b border-slate-100">
                      <td className="py-2 px-3 font-mono">
                        {new Date(batch.importedAt).toLocaleString('ar-EG')}
                      </td>
                      <td className="py-2 px-3 font-bold text-slate-800">{batch.sourceName}</td>
                      <td className="py-2 px-3 font-mono font-bold">{batch.operationsCount} صف</td>
                      <td className="py-2 px-3 font-mono text-slate-600">
                        {batch.dates.join(' ، ')}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {batch.rolledBack ? (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded font-bold">
                            تم التراجع عنها ✓
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const res = rollbackImportBatch(batch.id);
                              if (!res.ok) {
                                setErrorBanner(res.error || 'تعذر التراجع عن الدفعة');
                              } else {
                                setSuccessBanner(
                                  `تم التراجع عن دفعة "${batch.sourceName}" وحذف ${res.rolledBackCount} عملية بنجاح.`
                                );
                              }
                            }}
                            className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>التراجع عن الدفعة</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Full JSON Backup Prompt if Detected */}
      {fullJsonBackupCandidate && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="font-bold text-amber-950">
            تم اكتشاف أن ملف JSON المرفوع هو نسخة احتياطية كاملة لنظام مراجع الذهب ({fullJsonBackupCandidate.operations?.length || 0} عملية). هل ترغب في استعادته كنسخة كاملة أم استيراد جدول العمليات فقط؟
          </div>
          <button
            type="button"
            onClick={() => {
              const res = importFullBackup(fullJsonBackupCandidate);
              if (res.ok) {
                setSuccessBanner('تمت استعادة النسخة الاحتياطية الكاملة بنجاح (مع حفظ لقطة أمان للتراجع).');
                setFullJsonBackupCandidate(null);
              } else {
                setErrorBanner(res.error || 'فشل استعادة النسخة الكاملة.');
              }
            }}
            className="px-4 py-1.5 bg-amber-800 hover:bg-amber-900 text-white font-extrabold rounded-lg cursor-pointer"
          >
            استعادة كنسخة احتياطية كاملة
          </button>
        </div>
      )}

      {/* Interactive Pipeline Workspace when a Table is Loaded */}
      {structure && sheets.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-5">
          {/* File Metadata & Sheet Selector */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="px-2.5 py-1 bg-slate-900 text-white rounded-md font-bold">
                الملف: {sourceFileName}
              </span>
              <span className="text-slate-500">
                النوع: <strong className="font-mono uppercase">{sourceFileType}</strong> | الترميز:{' '}
                <strong className="font-mono">{detectedEncoding}</strong>
              </span>
              {structure.ignoredRowCount > 0 && (
                <span className="text-amber-700 font-bold">
                  (تم تجاهل {structure.ignoredRowCount} صف فارغ/مكرر العنوان)
                </span>
              )}
            </div>

            {sheets.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-700">اختر الورقة (Sheet):</span>
                <select
                  value={selectedSheetIdx}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    setSelectedSheetIdx(idx);
                    loadSheetIntoPipeline(sheets, idx, sourceFileHash);
                  }}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                >
                  {sheets.map((sh, i) => (
                    <option key={i} value={i}>
                      {sh.sheetName} ({sh.rows.length} صف)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Duplicate File Warning */}
          {previousSameFileBatch && (
            <div className="p-3 bg-amber-100 border border-amber-300 rounded-lg text-xs font-bold text-amber-950 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                تنبيه: تم استيراد نفس هذا الملف مسبقاً بتاريخ{' '}
                {new Date(previousSameFileBatch.importedAt).toLocaleString('ar-EG')} ({previousSameFileBatch.operationsCount} صف). تم إلغاء تحديد الصفوف المكررة تلقائياً لمنع التكرار.
              </span>
            </div>
          )}

          {/* Column Mapping & Saved Templates */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-extrabold text-slate-900">
                المرحلة 4: ربط أعمدة الملف بحقول مراجع الذهب (تم التخمين الذكي تلقائياً)
              </h3>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                {importTemplates.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const tpl = importTemplates.find((t) => t.id === e.target.value);
                      if (tpl && structure) {
                        setColMap(tpl.colMap);
                        if (tpl.defaultKarat) setDefaultKarat(tpl.defaultKarat);
                        if (tpl.explicitKind) setExplicitKindOverride(tpl.explicitKind);
                        rebuildPreviewFromStructure(structure, tpl.colMap);
                      }
                    }}
                    className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg font-bold"
                  >
                    <option value="">تطبيق قالب محفوظ...</option>
                    {importTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}

                <input
                  type="text"
                  value={templateNameInput}
                  onChange={(e) => setTemplateNameInput(e.target.value)}
                  placeholder="اسم القالب لحفظه..."
                  className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs w-40"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!templateNameInput.trim()) return;
                    saveImportTemplate({
                      name: templateNameInput.trim(),
                      colMap,
                      explicitKind: explicitKindOverride,
                      defaultKarat,
                    });
                    setTemplateNameInput('');
                    setSuccessBanner('تم حفظ قالب ربط الأعمدة بنجاح لاستخدامه بضغطة واحدة لاحقاً.');
                  }}
                  className="px-2.5 py-1 bg-slate-800 text-white rounded-lg font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>حفظ كقالب</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 text-xs">
              {COLUMN_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    {field.label}
                  </label>
                  <select
                    value={colMap[field.key]}
                    onChange={(e) => {
                      const nextMap = { ...colMap, [field.key]: Number(e.target.value) };
                      setColMap(nextMap);
                      rebuildPreviewFromStructure(structure, nextMap);
                    }}
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold text-slate-900"
                  >
                    <option value={-1}>— غير مربوط —</option>
                    {structure.headers.map((h, hIdx) => (
                      <option key={hIdx} value={hIdx}>
                        [{hIdx + 1}] {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Defaults for unmapped columns */}
            <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-700">التاريخ الافتراضي:</span>
                <input
                  type="date"
                  value={defaultDate}
                  onChange={(e) => {
                    setDefaultDate(e.target.value);
                    setTimeout(() => rebuildPreviewFromStructure(structure, colMap), 0);
                  }}
                  className="px-2 py-1 bg-white border border-slate-300 rounded font-mono font-bold"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-700">النوع الافتراضي:</span>
                <select
                  value={defaultKind}
                  onChange={(e) => {
                    setDefaultKind(e.target.value as OperationKind);
                    setTimeout(() => rebuildPreviewFromStructure(structure, colMap), 0);
                  }}
                  className="px-2 py-1 bg-white border border-slate-300 rounded font-bold"
                >
                  <option value="sell">بيع ذهب</option>
                  <option value="buy">شراء ذهب</option>
                  <option value="expense">مصروف</option>
                  <option value="advance">سلفة عامل</option>
                  <option value="person">حركة شخص</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-700">العيار الافتراضي:</span>
                <select
                  value={String(defaultKarat)}
                  onChange={(e) => {
                    const v = e.target.value === 'other' ? 'other' : (Number(e.target.value) as 18 | 21 | 24);
                    setDefaultKarat(v);
                    setTimeout(() => rebuildPreviewFromStructure(structure, colMap), 0);
                  }}
                  className="px-2 py-1 bg-white border border-slate-300 rounded font-mono font-bold"
                >
                  <option value="18">18</option>
                  <option value="21">21</option>
                  <option value="24">24</option>
                  <option value="other">آخر</option>
                </select>
              </div>
            </div>
          </div>

          {/* Stage 8 Prompts: Locked Days & Missing Gold Prices */}
          {dayConditions.lockedDates.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-bold text-red-900 flex items-center gap-2">
              <Lock className="w-4 h-4 text-red-600 shrink-0" />
              <span>
                تنبيه: التواريخ ({dayConditions.lockedDates.join(' ، ')}) مقفولة بعد المراجعة. يرجى تغيير التاريخ من الأدوات الجماعية بالأسفل أو فتح قفل اليوم أولاً.
              </span>
            </div>
          )}

          {dayConditions.datesMissingGoldPrice.length > 0 && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-xs">
              <div className="font-extrabold text-amber-950">
                المرحلة 8: الأيام التالية ليس لها سعر جرام ذهب مسجل — أدخل عيار 21 لتفعيل فحص الأسعار الدقيق:
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {dayConditions.datesMissingGoldPrice.map((dt) => (
                  <div key={dt} className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-amber-300">
                    <span className="font-mono font-bold text-slate-800">{dt}:</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={missingPricesInput[dt] ?? ''}
                      onChange={(e) =>
                        setMissingPricesInput((prev) => ({ ...prev, [dt]: e.target.value }))
                      }
                      placeholder="سعر عيار 21..."
                      className="w-24 px-2 py-0.5 font-mono font-bold border border-slate-300 rounded"
                    />
                    <span className="text-slate-500">ج.م</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Extracted Source Totals Comparison Banner (G3.3) */}
          {extractedTotalsRow && (
            <div className="p-3 bg-slate-100 border border-slate-300 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                <span className="font-bold text-slate-800">
                  صف الإجمالي المكتشف في الملف الأصلي (تم استبعاده من العمليات للمقارنة):
                </span>{' '}
                <span className="font-mono text-slate-600">{extractedTotalsRow.rawText}</span>
              </div>
              <div className="flex items-center gap-4 font-mono font-bold">
                {extractedTotalsRow.totalWeightG !== undefined && (
                  <span
                    className={
                      Math.abs(selectedTotals.weightG - extractedTotalsRow.totalWeightG) <= 0.2
                        ? 'text-emerald-700'
                        : 'text-amber-800'
                    }
                  >
                    مجموع الأوزان المحدد: {formatWeight(selectedTotals.weightG)} جرام (بالملف:{' '}
                    {formatWeight(extractedTotalsRow.totalWeightG)})
                  </span>
                )}
                {extractedTotalsRow.totalAmount !== undefined && (
                  <span
                    className={
                      Math.abs(selectedTotals.amount - extractedTotalsRow.totalAmount) <= 10
                        ? 'text-emerald-700'
                        : 'text-amber-800'
                    }
                  >
                    مجموع المبالغ المحدد: {formatNumber(selectedTotals.amount)} ج.م (بالملف:{' '}
                    {formatNumber(extractedTotalsRow.totalAmount)})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Filter Tabs & Bulk Edit Toolbar (G3.4) */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: `الكل (${previewRows.length})` },
                  {
                    id: 'error',
                    label: `أخطاء (${previewRows.filter((r) => r.health === 'error').length})`,
                  },
                  {
                    id: 'warn',
                    label: `تحذيرات (${previewRows.filter((r) => r.health === 'warn').length})`,
                  },
                  {
                    id: 'duplicate',
                    label: `مكرر (${previewRows.filter((r) => r.isDuplicate).length})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPreviewFilterTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${
                    previewFilterTab === tab.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Bulk Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bulkKind}
                onChange={(e) => setBulkKind(e.target.value as OperationKind)}
                className="px-2 py-1 bg-white border border-slate-300 rounded font-bold"
              >
                <option value="sell">بيع</option>
                <option value="buy">شراء</option>
                <option value="expense">مصروف</option>
                <option value="advance">سلفة</option>
                <option value="person">حركة شخص</option>
              </select>
              <button
                type="button"
                onClick={() => applyBulkFieldToSelected({ kind: bulkKind })}
                className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 rounded font-bold cursor-pointer"
              >
                تطبيق النوع للمحدد
              </button>

              <select
                value={String(bulkKarat)}
                onChange={(e) =>
                  setBulkKarat(
                    e.target.value === 'other' ? 'other' : (Number(e.target.value) as 18 | 21 | 24)
                  )
                }
                className="px-2 py-1 bg-white border border-slate-300 rounded font-mono font-bold"
              >
                <option value="18">18</option>
                <option value="21">21</option>
                <option value="24">24</option>
                <option value="other">آخر</option>
              </select>
              <button
                type="button"
                onClick={() => applyBulkFieldToSelected({ karat: bulkKarat })}
                className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 rounded font-bold cursor-pointer"
              >
                تطبيق العيار للمحدد
              </button>

              <input
                type="date"
                value={bulkDate}
                onChange={(e) => setBulkDate(e.target.value)}
                className="px-2 py-1 bg-white border border-slate-300 rounded font-mono"
              />
              <button
                type="button"
                onClick={() => applyBulkFieldToSelected({ date: bulkDate })}
                className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 rounded font-bold cursor-pointer"
              >
                توحيد التاريخ للمحدد
              </button>

              <button
                type="button"
                onClick={applyZeroTypoFixOnSelected}
                className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-950 rounded font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                <span>إصلاح الأصفار الزائدة/الناقصة</span>
              </button>

              <button
                type="button"
                onClick={deleteSelectedPreviewRows}
                className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف المحدد</span>
              </button>
            </div>
          </div>

          {/* Interactive Editable Preview Table */}
          <div className="overflow-x-auto max-h-[480px] border border-slate-200 rounded-xl">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200 text-slate-700 font-bold">
                <tr>
                  <th className="py-2 px-2 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={
                        displayedRows.length > 0 && displayedRows.every((r) => r.selected)
                      }
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const ids = new Set(displayedRows.map((d) => d.id));
                        setPreviewRows((prev) =>
                          prev.map((r) => (ids.has(r.id) ? { ...r, selected: checked } : r))
                        );
                      }}
                    />
                  </th>
                  <th className="py-2 px-2 w-10 text-center">#</th>
                  <th className="py-2 px-2 w-32">التاريخ</th>
                  <th className="py-2 px-2 w-24">النوع</th>
                  <th className="py-2 px-2 w-20">العيار</th>
                  <th className="py-2 px-2 w-28">الوزن (جم)</th>
                  <th className="py-2 px-2 w-32">المبلغ (ج.م)</th>
                  <th className="py-2 px-2 w-24">سعر الجرام</th>
                  <th className="py-2 px-2 min-w-[140px]">البيان / الصنف</th>
                  <th className="py-2 px-2 min-w-[120px]">الشخص / العامل</th>
                  <th className="py-2 px-2 min-w-[180px]">حالة الصف والتنبيهات</th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((row, idx) => {
                  const gramPrice =
                    row.weightG > 0 && row.total > 0 ? Math.round(row.total / row.weightG) : 0;
                  const rowBg =
                    row.health === 'error'
                      ? 'bg-red-50/70'
                      : row.isDuplicate
                      ? 'bg-amber-50/80'
                      : row.health === 'warn'
                      ? 'bg-yellow-50/60'
                      : 'bg-white';

                  return (
                    <tr key={row.id} className={`border-b border-slate-100 ${rowBg}`}>
                      <td className="py-1.5 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) =>
                            updateSinglePreviewRow(row.id, { selected: e.target.checked })
                          }
                        />
                      </td>
                      <td className="py-1.5 px-2 text-center font-mono text-slate-400">
                        {idx + 1}
                      </td>
                      <td className="py-1.5 px-2">
                        <input
                          type="date"
                          value={row.date}
                          onChange={(e) =>
                            updateSinglePreviewRow(row.id, { date: e.target.value })
                          }
                          className="w-full px-1.5 py-1 font-mono bg-white border border-slate-200 rounded"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <select
                          value={row.kind}
                          onChange={(e) =>
                            updateSinglePreviewRow(row.id, {
                              kind: e.target.value as OperationKind,
                            })
                          }
                          className="w-full px-1.5 py-1 bg-white border border-slate-200 rounded font-bold"
                        >
                          <option value="sell">بيع</option>
                          <option value="buy">شراء</option>
                          <option value="expense">مصروف</option>
                          <option value="advance">سلفة</option>
                          <option value="person">شخص</option>
                        </select>
                      </td>
                      <td className="py-1.5 px-2">
                        <select
                          value={String(row.karat)}
                          onChange={(e) =>
                            updateSinglePreviewRow(row.id, {
                              karat:
                                e.target.value === 'other'
                                  ? 'other'
                                  : (Number(e.target.value) as 18 | 21 | 24),
                            })
                          }
                          className="w-full px-1.5 py-1 font-mono bg-white border border-slate-200 rounded"
                        >
                          <option value="18">18</option>
                          <option value="21">21</option>
                          <option value="24">24</option>
                          <option value="other">آخر</option>
                        </select>
                      </td>
                      <td className="py-1.5 px-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.weightG}
                          onChange={(e) =>
                            updateSinglePreviewRow(row.id, {
                              weightG: parseWeightInput(
                                e.target.value,
                                settings.shortSpaceWeightMode
                              ),
                            })
                          }
                          className="w-full px-2 py-1 font-mono font-bold bg-white border border-slate-200 rounded"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.total}
                          onChange={(e) =>
                            updateSinglePreviewRow(row.id, {
                              total: parseAmountInput(e.target.value),
                            })
                          }
                          className="w-full px-2 py-1 font-mono font-bold bg-white border border-slate-200 rounded"
                        />
                      </td>
                      <td className="py-1.5 px-2 font-mono text-slate-600">
                        {gramPrice > 0 ? `${formatNumber(gramPrice)}` : '—'}
                      </td>
                      <td className="py-1.5 px-2">
                        <input
                          type="text"
                          value={row.item}
                          onChange={(e) =>
                            updateSinglePreviewRow(row.id, { item: e.target.value })
                          }
                          className="w-full px-2 py-1 bg-white border border-slate-200 rounded"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <input
                          type="text"
                          value={row.personName}
                          onChange={(e) =>
                            updateSinglePreviewRow(row.id, { personName: e.target.value })
                          }
                          placeholder="اسم الشخص..."
                          className="w-full px-2 py-1 bg-white border border-slate-200 rounded"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        {row.health === 'ok' && !row.isDuplicate && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>صالح تماماً</span>
                          </span>
                        )}
                        {row.issues.length > 0 && (
                          <div
                            className={`text-[11px] font-bold ${
                              row.health === 'error' ? 'text-red-700' : 'text-amber-800'
                            }`}
                          >
                            {row.issues.join(' | ')}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom Commit Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-200">
            <div className="text-xs font-bold text-slate-700">
              سيتم استيراد{' '}
              <strong className="text-emerald-700 font-mono">{selectedValidRows.length}</strong> صف صالح من أصل{' '}
              <span className="font-mono">{previewRows.length}</span> — إجمالي الوزن:{' '}
              <strong className="font-mono">{formatWeight(selectedTotals.weightG)} جرام</strong> | إجمالي المبالغ:{' '}
              <strong className="font-mono">{formatNumber(selectedTotals.amount)} ج.م</strong>
            </div>

            <button
              type="button"
              disabled={selectedValidRows.length === 0}
              onClick={executeCommitImport}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold rounded-xl inline-flex items-center gap-2 cursor-pointer"
            >
              <FileArchive className="w-4 h-4" />
              <span>اعتماد واستيراد الصفوف المحددة ({selectedValidRows.length} صف)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
