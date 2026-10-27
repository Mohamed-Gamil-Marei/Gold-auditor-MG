import React, { useMemo, useState } from 'react';
import {
  Download,
  Printer,
  FileSpreadsheet,
  FileText,
  Copy,
  Image as ImageIcon,
  CheckCircle2,
  X,
  Layers,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { useAuditStore } from '../../store/useAuditStore';
import {
  buildStandaloneHtmlString,
  copyToClipboardTsv,
  ExportColumnDef,
  exportTableAsPngImage,
  exportToCsvFormat,
  exportToDocxFormat,
  exportToExcelFormat,
  exportToHtmlFormat,
  exportToJsonFormat,
  UnifiedExportOptions,
} from '../../export/exportService';
import { ensureGoldApiBridge } from '../../utils/goldApiBridge';
import { formatNumber, formatWeight } from '../../utils/numerals';
import { computePersonBalancesSummary } from '../../utils/checks/checkPersonBalances';
import { computeDaySafeSummary } from '../../utils/checks/checkDailySafe';
import { runAllAuditChecks } from '../../utils/checks';

interface ExportAndPrintModalProps {
  open: boolean;
  onClose: () => void;
  reportTitle: string;
  filenamePrefix: string;
  columns: ExportColumnDef[];
  filteredRows: Record<string, any>[];
  allRows?: Record<string, any>[];
  activeFilterSummary?: string;
  periodSummary?: string;
  initialTab?: 'export' | 'print_preview' | 'batch_templates';
}

export const ExportAndPrintModal: React.FC<ExportAndPrintModalProps> = ({
  open,
  onClose,
  reportTitle,
  filenamePrefix,
  columns,
  filteredRows,
  allRows,
  activeFilterSummary = 'بدون فلاتر',
  periodSummary = 'الكل',
  initialTab = 'export',
}) => {
  const {
    operations,
    daysMap,
    persons,
    workers,
    auditLogs,
    settings,
    currentDate,
    recordExportOrPrintLog,
  } = useAuditStore();

  const [activeTab, setActiveTab] = useState<'export' | 'print_preview' | 'batch_templates'>(
    initialTab
  );
  const [scope, setScope] = useState<'filtered' | 'all'>('filtered');
  const [includePersonData, setIncludePersonData] = useState<boolean>(
    settings.includePersonDataInExports !== false
  );
  const [csvDelimiter, setCsvDelimiter] = useState<',' | ';'>(',');

  // Column visibility & ordering
  const [orderedCols, setOrderedCols] = useState<(ExportColumnDef & { visible: boolean })[]>(
    () =>
      columns.map((c) => ({
        ...c,
        visible: c.defaultVisible !== false,
      }))
  );

  // Print preview settings
  const [paperSize, setPaperSize] = useState<'A4' | 'A5'>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium');

  // Batch templates selection
  const [selectedBatchTemplates, setSelectedBatchTemplates] = useState<string[]>([
    'daily_journal',
    'high_issues',
    'safe_inventory',
  ]);

  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState<number | null>(null);

  const activeRows = scope === 'all' && allRows ? allRows : filteredRows;
  const visibleColumns = useMemo(
    () => orderedCols.filter((c) => c.visible),
    [orderedCols]
  );

  if (!open) return null;

  const buildOptions = (): UnifiedExportOptions => ({
    reportTitle,
    filenamePrefix,
    columns: visibleColumns.length > 0 ? visibleColumns : columns,
    rows: activeRows,
    activeFilterSummary,
    periodSummary,
    shopName: settings.shopName,
    auditorName: settings.auditorName,
    includePersonData,
    csvDelimiter,
    onProgress: (p) => setProgressPct(p),
  });

  const moveCol = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= orderedCols.length) return;
    const copy = [...orderedCols];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    setOrderedCols(copy);
  };

  const handleRunExport = async (
    fmt: 'xlsx' | 'csv' | 'docx' | 'html' | 'json' | 'tsv' | 'png' | 'pdf'
  ) => {
    setStatusBanner(null);
    const opts = buildOptions();

    if (fmt === 'xlsx') {
      const res = await exportToExcelFormat(opts);
      setProgressPct(null);
      if (res.ok) {
        recordExportOrPrintLog('export', `تصدير Excel (${res.filename}) — ${activeRows.length} صف`);
        setStatusBanner(`تم تصدير ملف إكسل (${res.filename}) بنجاح ✓`);
      }
    } else if (fmt === 'csv') {
      const res = exportToCsvFormat(opts);
      if (res.ok) {
        recordExportOrPrintLog('export', `تصدير CSV (${res.filename}) — ${activeRows.length} صف`);
        setStatusBanner(`تم تصدير ملف CSV بترميز UTF-8 BOM (${res.filename}) ✓`);
      }
    } else if (fmt === 'docx') {
      const res = await exportToDocxFormat(opts);
      if (res.ok) {
        recordExportOrPrintLog('export', `تصدير Word (${res.filename}) — ${activeRows.length} صف`);
        setStatusBanner(`تم تصدير ملف Word (${res.filename}) بنجاح ✓`);
      }
    } else if (fmt === 'html') {
      const res = exportToHtmlFormat(opts);
      if (res.ok) {
        recordExportOrPrintLog('export', `تصدير HTML (${res.filename}) — ${activeRows.length} صف`);
        setStatusBanner(`تم تصدير ملف HTML المستقل (${res.filename}) ✓`);
      }
    } else if (fmt === 'json') {
      const res = exportToJsonFormat(opts);
      if (res.ok) {
        recordExportOrPrintLog('export', `تصدير JSON (${res.filename}) — ${activeRows.length} صف`);
        setStatusBanner(`تم تصدير ملف JSON (${res.filename}) ✓`);
      }
    } else if (fmt === 'tsv') {
      const ok = await copyToClipboardTsv(opts);
      if (ok) {
        recordExportOrPrintLog('export', `نسخ للحافظة TSV (${reportTitle}) — ${activeRows.length} صف`);
        setStatusBanner('تم نسخ الجدول للحافظة بنجاح — يمكنك لصقه مباشرة في إكسل أو واتساب ✓');
      }
    } else if (fmt === 'png') {
      const res = await exportTableAsPngImage(opts);
      if (res.ok) {
        recordExportOrPrintLog('export', `حفظ صورة جدول PNG (${res.filename})`);
        setStatusBanner(
          res.copiedToClipboard
            ? `تم نسخ صورة الجدول للحافظة وتحميل (${res.filename}) للمشاركة عبر واتساب ✓`
            : `تم تحميل صورة الجدول (${res.filename}) جاهزة للمشاركة ✓`
        );
      }
    } else if (fmt === 'pdf') {
      recordExportOrPrintLog('print', `طباعة / حفظ PDF (${reportTitle}) — ${activeRows.length} صف`);
      const api = ensureGoldApiBridge();
      await api.print.saveToPdf(`${filenamePrefix}_${currentDate}.pdf`);
      setStatusBanner('تم إرسال التقرير للطباعة / حفظ PDF ✓');
    }
  };

  // Batch Multi-Report Generator
  const handleExportBatchTemplatesExcel = () => {
    const wb = (window as any).XLSX || null;
    // Build a multi-sheet or standalone HTML batch report
    const batchSectionsHtml: string[] = [];

    if (selectedBatchTemplates.includes('daily_journal')) {
      const dayOps = operations.filter((o) => o.date === currentDate);
      batchSectionsHtml.push(
        buildStandaloneHtmlString({
          reportTitle: `1) يومية اليوم (${currentDate})`,
          filenamePrefix: 'daily',
          shopName: settings.shopName,
          auditorName: settings.auditorName,
          periodSummary: currentDate,
          columns: [
            { key: 'kind', label: 'النوع' },
            { key: 'karat', label: 'العيار' },
            { key: 'weightG', label: 'الوزن (جرام)', isWeight: true },
            { key: 'total', label: 'المبلغ (ج.م)', isNumeric: true },
            { key: 'item', label: 'البيان' },
          ],
          rows: dayOps.map((o) => ({
            kind:
              o.kind === 'sell'
                ? 'بيع'
                : o.kind === 'buy'
                ? 'شراء'
                : o.kind === 'expense'
                ? 'مصروف'
                : o.kind === 'advance'
                ? 'سلفة'
                : 'شخص',
            karat: o.karat || 21,
            weightG: o.weightG,
            total: o.total,
            item: o.item || o.category || '',
          })),
        })
      );
    }

    if (selectedBatchTemplates.includes('debt_statement')) {
      const bal = computePersonBalancesSummary(operations, persons);
      batchSectionsHtml.push(
        buildStandaloneHtmlString({
          reportTitle: '2) كشف المديونيات المتأخرة والأرصدة',
          filenamePrefix: 'debts',
          shopName: settings.shopName,
          auditorName: settings.auditorName,
          columns: [
            { key: 'name', label: 'اسم الشخص' },
            { key: 'cashBalance', label: 'الرصيد النقدي (عليه ج.م)', isNumeric: true },
            { key: 'goldBalanceG', label: 'رصيد الذهب (ج)', isWeight: true },
            { key: 'debtAgeDays', label: 'عمر الدين (يوم)', isNumeric: true },
          ],
          rows: Array.from(bal.map.values())
            .filter((d) => d.cashBalance > 0 || d.goldBalanceG > 0)
            .map((d) => ({
              name: d.person?.name || '',
              cashBalance: d.cashBalance,
              goldBalanceG: d.goldBalanceG,
              debtAgeDays: d.debtAgeDays,
            })),
        })
      );
    }

    if (selectedBatchTemplates.includes('high_issues')) {
      const auditRes = runAllAuditChecks(
        operations,
        daysMap,
        persons,
        workers,
        auditLogs,
        settings
      );
      const highOnly = auditRes.issues.filter((i) => i.severity === 'high');
      batchSectionsHtml.push(
        buildStandaloneHtmlString({
          reportTitle: '3) اشتباهات الخطورة العالية',
          filenamePrefix: 'high_issues',
          shopName: settings.shopName,
          auditorName: settings.auditorName,
          columns: [
            { key: 'date', label: 'التاريخ' },
            { key: 'checkTitle', label: 'نوع الفحص' },
            { key: 'message', label: 'التفاصيل' },
            { key: 'difference', label: 'الفرق' },
          ],
          rows: highOnly,
        })
      );
    }

    if (selectedBatchTemplates.includes('safe_inventory')) {
      const dInfo = daysMap[currentDate] || {
        date: currentDate,
        goldPricePerGram: 0,
        locked: false,
      };
      const safe = computeDaySafeSummary(currentDate, operations, dInfo);
      batchSectionsHtml.push(
        buildStandaloneHtmlString({
          reportTitle: `4) مطابقة خزنة وجرد يوم (${currentDate})`,
          filenamePrefix: 'safe_inv',
          shopName: settings.shopName,
          auditorName: settings.auditorName,
          columns: [
            { key: 'metric', label: 'البند' },
            { key: 'value', label: 'القيمة' },
          ],
          rows: [
            { metric: 'نقدية أول اليوم', value: formatNumber(safe.openingCash) },
            { metric: 'المبيعات النقدية (+)', value: formatNumber(safe.cashSales) },
            { metric: 'المشتريات النقدية (-)', value: formatNumber(safe.cashPurchases) },
            { metric: 'المصاريف والسلف (-)', value: formatNumber(safe.expenses + safe.advances) },
            { metric: 'الرصيد المتوقع بالخزنة', value: formatNumber(safe.expectedCash) },
            {
              metric: 'الجرد الفعلي بالخزنة',
              value: safe.hasActual ? formatNumber(safe.actualCash) : 'غير مسجل',
            },
            {
              metric: 'فرق الخزنة',
              value: safe.hasActual ? formatNumber(safe.difference) : '—',
            },
          ],
        })
      );
    }

    const combinedHtml = batchSectionsHtml.join(
      '<div style="page-break-before: always; margin-top: 32px;"></div>'
    );
    const blob = new Blob([combinedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `تقارير_المراجعة_المجمعة_${currentDate}.html`;
    a.click();
    URL.revokeObjectURL(url);
    recordExportOrPrintLog(
      'print',
      `تصدير حزمة التقارير المجمعة (${selectedBatchTemplates.length} تقارير)`
    );
    setStatusBanner(
      `تم تجهيز وتصدير حزمة التقارير المجمعة (${selectedBatchTemplates.length} تقارير في ملف واحد جاهز للطباعة) ✓`
    );
  };

  const previewHtml = useMemo(
    () =>
      buildStandaloneHtmlString({
        ...buildOptions(),
        paperSize,
        orientation,
        fontSize,
      }),
    [
      reportTitle,
      visibleColumns,
      activeRows,
      activeFilterSummary,
      periodSummary,
      settings.shopName,
      settings.auditorName,
      includePersonData,
      paperSize,
      orientation,
      fontSize,
    ]
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
        {/* Top Bar */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base font-extrabold">
                تصدير وطباعة: {reportTitle}
              </h2>
              <p className="text-xs text-slate-300">
                اختر الصيغة، الأعمدة، نطاق البيانات، أو عاين شكل الصفحة قبل الطباعة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-white/10 p-1 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('export')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                activeTab === 'export' ? 'bg-amber-500 text-slate-950' : 'text-white'
              }`}
            >
              التصدير المتعدد
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('print_preview')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                activeTab === 'print_preview' ? 'bg-amber-500 text-slate-950' : 'text-white'
              }`}
            >
              معاينة الطباعة (Ctrl+P)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('batch_templates')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                activeTab === 'batch_templates' ? 'bg-amber-500 text-slate-950' : 'text-white'
              }`}
            >
              الطباعة المجمّعة والقوالب
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {statusBanner && (
          <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 text-emerald-900 text-xs font-bold flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {statusBanner}
            </span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-emerald-700 hover:underline"
            >
              إغلاق
            </button>
          </div>
        )}

        {progressPct !== null && (
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs font-bold text-amber-900">
            جاري تجهيز الملف... ({progressPct}%)
          </div>
        )}

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5 bg-slate-50 text-xs">
          {/* Common Scope & Privacy Controls */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-700">نطاق البيانات:</span>
                <label className="inline-flex items-center gap-1.5 cursor-pointer font-bold">
                  <input
                    type="radio"
                    checked={scope === 'filtered'}
                    onChange={() => setScope('filtered')}
                  />
                  <span>المعروض بعد الفلترة ({filteredRows.length} صف)</span>
                </label>
                {allRows && allRows.length !== filteredRows.length && (
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-bold">
                    <input
                      type="radio"
                      checked={scope === 'all'}
                      onChange={() => setScope('all')}
                    />
                    <span>الكل بدون فلتر ({allRows.length} صف)</span>
                  </label>
                )}
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer font-bold text-slate-800 bg-slate-100 px-3 py-1.5 rounded-lg">
                <input
                  type="checkbox"
                  checked={includePersonData}
                  onChange={(e) => setIncludePersonData(e.target.checked)}
                />
                <span>تضمين بيانات الأشخاص (الاسم/التليفون)</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500">فاصل CSV:</span>
              <select
                value={csvDelimiter}
                onChange={(e) => setCsvDelimiter(e.target.value as ',' | ';')}
                className="px-2 py-1 border border-slate-300 rounded bg-white font-mono font-bold"
              >
                <option value=",">فاصلة (,)</option>
                <option value=";">فاصلة منقوطة (;)</option>
              </select>
            </div>
          </div>

          {activeTab === 'export' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Format Buttons */}
              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-extrabold text-slate-900">
                  اختر صيغة التصدير أو النسخ الفوري:
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleRunExport('xlsx')}
                    className="p-3 rounded-xl border-2 border-emerald-600 bg-emerald-50/70 hover:bg-emerald-100 text-right flex items-center gap-3 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-6 h-6 text-emerald-700 shrink-0" />
                    <div>
                      <div className="font-extrabold text-slate-900">
                        ملف Excel (.xlsx) احترافي
                      </div>
                      <div className="text-[11px] text-slate-600">
                        اتجاه RTL، صف عناوين مثبت، معادلات SUM، وشيت "معلومات"
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunExport('pdf')}
                    className="p-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-right flex items-center gap-3 cursor-pointer"
                  >
                    <Printer className="w-6 h-6 text-rose-700 shrink-0" />
                    <div>
                      <div className="font-extrabold text-slate-900">
                        ملف PDF / طباعة مباشرة
                      </div>
                      <div className="text-[11px] text-slate-600">
                        تنسيق A4 مع ترويسة المحل وتذييل التوقيعات
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunExport('docx')}
                    className="p-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-right flex items-center gap-3 cursor-pointer"
                  >
                    <FileText className="w-6 h-6 text-sky-700 shrink-0" />
                    <div>
                      <div className="font-extrabold text-slate-900">
                        ملف Word (.docx)
                      </div>
                      <div className="text-[11px] text-slate-600">
                        جدول عربي منسق قابل للتعديل في برنامج وورد
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunExport('csv')}
                    className="p-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-right flex items-center gap-3 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-6 h-6 text-teal-700 shrink-0" />
                    <div>
                      <div className="font-extrabold text-slate-900">
                        ملف CSV (UTF-8 مع BOM)
                      </div>
                      <div className="text-[11px] text-slate-600">
                        يفتح بالعربية في إكسل ويندوز بدون تشوه الحروف
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunExport('tsv')}
                    className="p-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-right flex items-center gap-3 cursor-pointer"
                  >
                    <Copy className="w-6 h-6 text-amber-700 shrink-0" />
                    <div>
                      <div className="font-extrabold text-slate-900">
                        نسخ للحافظة (TSV لإكسل وواتساب)
                      </div>
                      <div className="text-[11px] text-slate-600">
                        الصق مباشرة (Ctrl+V) داخل أي شيت إكسل أو محادثة
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunExport('png')}
                    className="p-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-right flex items-center gap-3 cursor-pointer"
                  >
                    <ImageIcon className="w-6 h-6 text-indigo-700 shrink-0" />
                    <div>
                      <div className="font-extrabold text-slate-900">
                        نسخ كصورة (PNG لواتساب)
                      </div>
                      <div className="text-[11px] text-slate-600">
                        لقطة عالية الوضوح للجدول مع الترويسة والإجمالي
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunExport('html')}
                    className="p-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-right flex items-center gap-3 cursor-pointer"
                  >
                    <FileText className="w-6 h-6 text-slate-700 shrink-0" />
                    <div>
                      <div className="font-extrabold text-slate-900">
                        ملف HTML مستقل
                      </div>
                      <div className="text-[11px] text-slate-600">
                        يفتح في أي متصفح بدون إنترنت
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRunExport('json')}
                    className="p-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-right flex items-center gap-3 cursor-pointer"
                  >
                    <Download className="w-6 h-6 text-slate-700 shrink-0" />
                    <div>
                      <div className="font-extrabold text-slate-900">
                        ملف JSON مهيكل
                      </div>
                      <div className="text-[11px] text-slate-600">
                        البيانات الخام مع الإجماليات والوصف
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Column Selector & Reorder */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-extrabold text-slate-900">
                  اختيار وترتيب الأعمدة:
                </h3>
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {orderedCols.map((col, idx) => (
                    <div
                      key={col.key}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200"
                    >
                      <label className="inline-flex items-center gap-2 font-bold text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={col.visible}
                          onChange={(e) => {
                            const copy = [...orderedCols];
                            copy[idx] = { ...col, visible: e.target.checked };
                            setOrderedCols(copy);
                          }}
                        />
                        <span>{col.label}</span>
                      </label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveCol(idx, -1)}
                          className="p-1 hover:bg-slate-200 rounded text-slate-600"
                          title="تحريك لأعلى"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCol(idx, 1)}
                          className="p-1 hover:bg-slate-200 rounded text-slate-600"
                          title="تحريك لأسفل"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'print_preview' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <label className="font-bold text-slate-700 ml-1.5">حجم الورق:</label>
                    <select
                      value={paperSize}
                      onChange={(e) => setPaperSize(e.target.value as 'A4' | 'A5')}
                      className="px-2.5 py-1 border border-slate-300 rounded-lg bg-white font-bold"
                    >
                      <option value="A4">A4 قياسي</option>
                      <option value="A5">A5 نصفي</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 ml-1.5">الاتجاه:</label>
                    <select
                      value={orientation}
                      onChange={(e) =>
                        setOrientation(e.target.value as 'portrait' | 'landscape')
                      }
                      className="px-2.5 py-1 border border-slate-300 rounded-lg bg-white font-bold"
                    >
                      <option value="portrait">طولي (Portrait)</option>
                      <option value="landscape">عرضي (Landscape)</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 ml-1.5">حجم الخط:</label>
                    <select
                      value={fontSize}
                      onChange={(e) =>
                        setFontSize(e.target.value as 'small' | 'medium' | 'large')
                      }
                      className="px-2.5 py-1 border border-slate-300 rounded-lg bg-white font-bold"
                    >
                      <option value="small">صغير (مكثف)</option>
                      <option value="medium">متوسط (افتراضي)</option>
                      <option value="large">كبير (واضح جداً)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRunExport('pdf')}
                    className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>طباعة / حفظ PDF الآن</span>
                  </button>
                </div>
              </div>

              <div className="bg-slate-200 p-4 rounded-xl border border-slate-300 max-h-[52vh] overflow-y-auto">
                <iframe
                  title="معاينة الطباعة"
                  srcDoc={previewHtml}
                  className="w-full h-[460px] bg-white rounded-lg shadow-md border border-slate-300"
                />
              </div>
            </div>
          )}

          {activeTab === 'batch_templates' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-600" />
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    الطباعة المجمّعة وقوالب التقارير الجاهزة
                  </h3>
                  <p className="text-xs text-slate-500">
                    اختر التقارير التي تريد دمجها في ملف مطبوع واحد بترويسة وتوقيعات موحدة:
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { id: 'daily_journal', label: `يومية اليوم بالتفصيل (${currentDate})` },
                  { id: 'debt_statement', label: 'كشف المديونيات المتأخرة وأعمار الديون' },
                  { id: 'high_issues', label: 'تقرير اشتباهات الخطورة العالية' },
                  { id: 'safe_inventory', label: `مطابقة خزنة وجرد اليوم (${currentDate})` },
                ].map((tpl) => {
                  const checked = selectedBatchTemplates.includes(tpl.id);
                  return (
                    <label
                      key={tpl.id}
                      className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer font-bold ${
                        checked
                          ? 'bg-amber-50 border-amber-400 text-slate-900'
                          : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBatchTemplates([...selectedBatchTemplates, tpl.id]);
                          } else {
                            setSelectedBatchTemplates(
                              selectedBatchTemplates.filter((x) => x !== tpl.id)
                            );
                          }
                        }}
                      />
                      <span>{tpl.label}</span>
                    </label>
                  );
                })}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={selectedBatchTemplates.length === 0}
                  onClick={handleExportBatchTemplatesExcel}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-xl inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>
                    تجهيز وتصدير التقارير المختارة ({selectedBatchTemplates.length}) في ملف واحد
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
