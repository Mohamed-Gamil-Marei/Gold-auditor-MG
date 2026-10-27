import React, { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  CheckCircle2,
  Printer,
  FileSpreadsheet,
  Search,
  Sparkles,
  ShieldAlert,
  Ban,
  FileDown,
} from 'lucide-react';
import { useAuditStore } from '../store/useAuditStore';
import { runAllAuditChecks } from '../utils/checks';
import { formatNumber, formatWeight } from '../utils/numerals';
import { exportFullWorkbookExcel } from '../utils/exportImport';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';

export const AuditReviewScreen: React.FC = () => {
  const {
    operations,
    daysMap,
    persons,
    workers,
    auditLogs,
    issueReviews,
    settings,
    setIssueReviewed,
    updateSettings,
  } = useAuditStore();

  // Filter states (changing filters NEVER recomputes the audit checks — Patch 3 useMemo)
  const [severityFilter, setSeverityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'buy' | 'sell' | 'both'>('all');
  const [checkTypeFilter, setCheckTypeFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [personWorkerFilter, setPersonWorkerFilter] = useState<string>('all');
  const [onlyUnreviewed, setOnlyUnreviewed] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Optional AI Spoken Summary state (Patch 8)
  const [showAiConfirmModal, setShowAiConfirmModal] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummaryText, setAiSummaryText] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Run all checks in a memoized block (Patch 3)
  const auditResult = useMemo(
    () =>
      runAllAuditChecks(
        operations,
        daysMap,
        persons,
        workers,
        auditLogs,
        settings
      ),
    [operations, daysMap, persons, workers, auditLogs, settings]
  );

  const personsMap = useMemo(
    () => new Map(persons.map((p) => [p.id, p.name])),
    [persons]
  );
  const workersMap = useMemo(
    () => new Map(workers.map((w) => [w.id, w.name])),
    [workers]
  );

  // Overall KPIs & Daily Chart Data
  const kpiAndChart = useMemo(() => {
    let buyG = 0;
    let buyTotal = 0;
    let sellG = 0;
    let sellTotal = 0;
    const byDate: Record<string, { date: string; شراء: number; بيع: number }> = {};

    for (const op of operations) {
      if (op.kind === 'buy' || op.kind === 'sell') {
        if (!byDate[op.date]) {
          byDate[op.date] = { date: op.date, شراء: 0, بيع: 0 };
        }
        if (op.kind === 'buy') {
          buyG += op.weightG;
          buyTotal += op.total;
          byDate[op.date].شراء += Math.round(op.total);
        } else {
          sellG += op.weightG;
          sellTotal += op.total;
          byDate[op.date].بيع += Math.round(op.total);
        }
      }
    }

    const chartData = Object.values(byDate).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const highCount = auditResult.issues.filter((i) => i.severity === 'high').length;
    const medCount = auditResult.issues.filter((i) => i.severity === 'medium').length;
    const lowCount = auditResult.issues.filter((i) => i.severity === 'low').length;

    return {
      buyG,
      buyTotal,
      sellG,
      sellTotal,
      chartData,
      highCount,
      medCount,
      lowCount,
    };
  }, [operations, auditResult.issues]);

  // Filtered Issues (fast client-side filtering without re-running checks)
  const filteredIssues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return auditResult.issues.filter((iss) => {
      if (severityFilter !== 'all' && iss.severity !== severityFilter) return false;
      if (kindFilter === 'buy' && iss.kind !== 'buy') return false;
      if (kindFilter === 'sell' && iss.kind !== 'sell') return false;
      if (kindFilter === 'both' && iss.kind !== 'buy' && iss.kind !== 'sell') return false;
      if (checkTypeFilter !== 'all' && iss.checkType !== checkTypeFilter) return false;
      if (dateFilter && iss.date !== dateFilter) return false;
      if (personWorkerFilter !== 'all') {
        if (iss.personId !== personWorkerFilter && iss.workerId !== personWorkerFilter) {
          return false;
        }
      }
      const rev = issueReviews[iss.id];
      if (onlyUnreviewed && rev?.reviewed) return false;
      if (q) {
        const hay = `${iss.message} ${iss.checkTitle} ${iss.date} ${rev?.note || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    auditResult.issues,
    severityFilter,
    kindFilter,
    checkTypeFilter,
    dateFilter,
    personWorkerFilter,
    onlyUnreviewed,
    searchQuery,
    issueReviews,
  ]);

  // Patch 8: Request safe aggregated summary (no names, no raw rows)
  const handleRunSafeAiSummary = async () => {
    setShowAiConfirmModal(false);
    setAiLoading(true);
    setAiError(null);
    try {
      const aggregatedStats = {
        totalOperationsCount: operations.length,
        totalBuyGrams: Number(kpiAndChart.buyG.toFixed(2)),
        totalBuyEGP: Math.round(kpiAndChart.buyTotal),
        totalSellGrams: Number(kpiAndChart.sellG.toFixed(2)),
        totalSellEGP: Math.round(kpiAndChart.sellTotal),
        issueCountsBySeverity: {
          high: kpiAndChart.highCount,
          medium: kpiAndChart.medCount,
          low: kpiAndChart.lowCount,
        },
        issueCountsByType: auditResult.countsByCheck,
        top5AnonymizedIssues: auditResult.issues.slice(0, 5).map((iss) => ({
          severity: iss.severity,
          checkTitle: iss.checkTitle,
          date: iss.date,
          expected: iss.expected,
          actual: iss.actual,
          difference: iss.difference,
        })),
      };

      const storedPasscode = sessionStorage.getItem('app_passcode') || '';
      const api = ensureGoldApiBridge();
      const res = await api.ai.summarize({
        aggregatedStats,
        modelName: settings.geminiModel || 'gemini-3.8-flash',
        passcode: storedPasscode,
      });
      if (!res.ok) throw new Error(res.error || 'فشل توليد الملخص');
      setAiSummaryText(res.summary || 'لم يتم توليد ملخص.');
    } catch (err: any) {
      setAiError(err?.message || 'تعذر توليد الملخص حالياً');
    } finally {
      setAiLoading(false);
    }
  };

  // Add date to exceptions (Patch 2)
  const ignoreDateException = (date: string) => {
    if (!date || date === '-') return;
    if (!settings.exceptions.dates.includes(date)) {
      updateSettings({
        exceptions: {
          ...settings.exceptions,
          dates: [...settings.exceptions.dates, date],
        },
      });
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Print Header */}
      <div className="hidden print-only border-b-2 border-slate-900 pb-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{settings.shopName} — تقرير المراجعة والتدقيق</h1>
            <p className="text-sm text-slate-600">
              إعداد المراجع: {settings.auditorName} · تاريخ الطباعة:{' '}
              {new Date().toLocaleDateString('ar-EG')}
            </p>
          </div>
          <div className="text-left font-mono text-sm">
            <div>إجمالي الاشتباهات: {filteredIssues.length}</div>
            <div>عالية الخطورة: {kpiAndChart.highCount}</div>
          </div>
        </div>
      </div>

      {/* Top Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">إجمالي المشتريات</div>
          <div className="text-lg font-bold font-mono tabular-nums text-teal-800">
            {formatWeight(kpiAndChart.buyG)} جرام
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-600 mt-0.5">
            {formatNumber(kpiAndChart.buyTotal)} ج.م
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">إجمالي المبيعات</div>
          <div className="text-lg font-bold font-mono tabular-nums text-amber-800">
            {formatWeight(kpiAndChart.sellG)} جرام
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-600 mt-0.5">
            {formatNumber(kpiAndChart.sellTotal)} ج.م
          </div>
        </div>

        <button
          type="button"
          onClick={() => setSeverityFilter(severityFilter === 'high' ? 'all' : 'high')}
          className={`text-right rounded-xl p-4 border transition-all ${
            severityFilter === 'high'
              ? 'bg-red-50 border-red-500 ring-2 ring-red-500/20'
              : 'bg-white border-slate-200 hover:border-red-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-red-700 font-bold mb-1">
            <span>خطورة عالية (أحمر)</span>
            <AlertOctagon className="w-4 h-4 text-red-600" />
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-red-700">
            {kpiAndChart.highCount}
          </div>
          <div className="text-[11px] text-slate-500">تحتاج تحققاً فورياً</div>
        </button>

        <button
          type="button"
          onClick={() => setSeverityFilter(severityFilter === 'medium' ? 'all' : 'medium')}
          className={`text-right rounded-xl p-4 border transition-all ${
            severityFilter === 'medium'
              ? 'bg-orange-50 border-orange-500 ring-2 ring-orange-500/20'
              : 'bg-white border-slate-200 hover:border-orange-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-orange-700 font-bold mb-1">
            <span>خطورة متوسطة (برتقالي)</span>
            <AlertTriangle className="w-4 h-4 text-orange-600" />
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-orange-700">
            {kpiAndChart.medCount}
          </div>
          <div className="text-[11px] text-slate-500">انحرافات وتكرارات</div>
        </button>

        <button
          type="button"
          onClick={() => setSeverityFilter(severityFilter === 'low' ? 'all' : 'low')}
          className={`text-right rounded-xl p-4 border transition-all ${
            severityFilter === 'low'
              ? 'bg-yellow-50 border-yellow-500 ring-2 ring-yellow-500/20'
              : 'bg-white border-slate-200 hover:border-yellow-400'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-amber-800 font-bold mb-1">
            <span>تنبيه منخفض (أصفر)</span>
            <Info className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-amber-800">
            {kpiAndChart.lowCount}
          </div>
          <div className="text-[11px] text-slate-500">
            فحص خلال {auditResult.executionTimeMs}ms
          </div>
        </button>
      </div>

      {/* Breakdown by Check Type (Patch 2: عرض عدد الاشتباهات الناتجة من كل فحص لأعرف أي فحص مزعج) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-bold text-slate-700">
            توزيع الاشتباهات حسب نوع الفحص (اضغط على أي فحص لفلترته):
          </h3>
          {checkTypeFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setCheckTypeFilter('all')}
              className="text-xs text-amber-700 font-bold hover:underline"
            >
              إظهار كل الفحوصات ({auditResult.issues.length})
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(auditResult.countsByCheck).map(([typeKey, info]) => (
            <button
              key={typeKey}
              type="button"
              onClick={() =>
                setCheckTypeFilter(checkTypeFilter === typeKey ? 'all' : typeKey)
              }
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-2 ${
                checkTypeFilter === typeKey
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>{info.title}</span>
              <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-black/10">
                {info.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Daily Chart (Buy vs Sell) & Optional Safe AI Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 no-print">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-slate-900 mb-3">
            حركة الشراء مقابل البيع اليومية (ج.م)
          </h3>
          {kpiAndChart.chartData.length > 0 ? (
            <div className="h-56 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kpiAndChart.chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(val: any) => `${formatNumber(Number(val))} ج.م`}
                  />
                  <Legend />
                  <Bar dataKey="بيع" fill="#d97706" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="شراء" fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 flex items-center justify-center text-sm text-slate-400">
              لا توجد عمليات مسجلة لعرض الرسم البياني
            </div>
          )}
        </div>

        {/* Sensitivity & Optional Spoken Summary Panel */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              حساسية الفحص وأدوات التقرير
            </h3>
            <p className="text-xs text-slate-600">
              تحكم سريع في حساسية الإنذارات لتقليل التنبيهات غير الضرورية:
            </p>
            <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-lg">
              {(
                [
                  { id: 'strict', label: 'صارم (1%)' },
                  { id: 'medium', label: 'متوسط (1.5%)' },
                  { id: 'lenient', label: 'متساهل (3%)' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => useAuditStore.getState().applySensitivityPreset(p.id)}
                  className={`py-1.5 text-xs font-bold rounded-md transition-colors ${
                    settings.sensitivityPreset === p.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Patch 8: Optional Safe AI Summary */}
            {settings.enableAiSummaryButton ? (
              <div className="pt-2">
                <button
                  type="button"
                  disabled={aiLoading}
                  onClick={() => setShowAiConfirmModal(true)}
                  className="w-full py-2 px-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-900 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span>
                    {aiLoading ? 'جاري التلخيص...' : 'لخّص النتائج بالكلام (آمن ومجمّع)'}
                  </span>
                </button>
                {aiSummaryText && (
                  <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 whitespace-pre-line leading-relaxed">
                    {aiSummaryText}
                  </div>
                )}
                {aiError && (
                  <div className="mt-2 text-xs text-red-600 font-semibold">{aiError}</div>
                )}
              </div>
            ) : (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600">
                جميع الفحوصات (13 فحصاً إحصائياً ومحاسبياً) تعمل محلياً 100% داخل متصفحك بدون إرسال أي بيانات لأي خادم.
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() =>
                exportFullWorkbookExcel({
                  operations,
                  daysMap,
                  persons,
                  workers,
                  issues: auditResult.issues,
                  issueReviews,
                  auditLogs,
                })
              }
              className="flex-1 py-2 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير Excel شامل</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة A4</span>
            </button>
            <button
              type="button"
              onClick={() => ensureGoldApiBridge().print.saveToPdf('تقرير_المراجعة_والتدقيق.pdf')}
              className="py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
              <span>حفظ كـ PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filters & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث في رسائل الاشتباه والملاحظات..."
              className="w-full pr-9 pl-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:border-amber-600"
            />
          </div>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as any)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none"
          >
            <option value="all">كل درجات الخطورة</option>
            <option value="high">خطورة عالية فقط (أحمر)</option>
            <option value="medium">خطورة متوسطة فقط (برتقالي)</option>
            <option value="low">تنبيهات منخفضة فقط (أصفر)</option>
          </select>

          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as any)}
            className="px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg outline-none"
          >
            <option value="all">كل أنواع العمليات</option>
            <option value="sell">بيع فقط</option>
            <option value="buy">شراء فقط</option>
            <option value="both">شراء وبيع معاً (الاثنان)</option>
          </select>

          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg outline-none"
          />

          <select
            value={personWorkerFilter}
            onChange={(e) => setPersonWorkerFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none"
          >
            <option value="all">كل الأشخاص والعمال</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                شخص: {p.name}
              </option>
            ))}
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                عامل: {w.name}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyUnreviewed}
              onChange={(e) => setOnlyUnreviewed(e.target.checked)}
              className="rounded text-amber-600"
            />
            <span>غير المراجَع فقط</span>
          </label>
        </div>
      </div>

      {/* Issues Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            جدول الاشتباهات والملاحظات ({filteredIssues.length} اشتباه)
          </h3>
          <span className="text-xs text-slate-500">
            يعرض الاشتباهات مع السبب للمراجعة ولا يتهم أحداً
          </span>
        </div>

        {filteredIssues.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
            <div className="text-base font-bold text-slate-800">
              لا توجد اشتباهات مطابقة للفلاتر الحالية
            </div>
            <p className="text-xs text-slate-500">
              جميع العمليات المفحوصة ضمن الحدود الطبيعية أو تمت مراجعتها.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-2.5 px-3 w-24">الخطورة</th>
                  <th className="py-2.5 px-3 w-28">التاريخ</th>
                  <th className="py-2.5 px-3 w-40">نوع الفحص</th>
                  <th className="py-2.5 px-3">تفاصيل الاشتباه والسبب</th>
                  <th className="py-2.5 px-3 w-28">المتوقع / الفعلي</th>
                  <th className="py-2.5 px-3 w-56">ملاحظة المراجع</th>
                  <th className="py-2.5 px-3 w-36 text-center no-print">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.map((iss) => {
                  const rev = issueReviews[iss.id] || { reviewed: false, note: '' };
                  const sevBadge =
                    iss.severity === 'high'
                      ? 'bg-red-100 text-red-900 border-red-300'
                      : iss.severity === 'medium'
                      ? 'bg-orange-100 text-orange-900 border-orange-300'
                      : 'bg-yellow-100 text-yellow-900 border-yellow-300';
                  const sevLabel =
                    iss.severity === 'high'
                      ? 'عالية'
                      : iss.severity === 'medium'
                      ? 'متوسطة'
                      : 'منخفضة';

                  return (
                    <tr
                      key={iss.id}
                      className={`border-b border-slate-200 text-xs transition-colors ${
                        rev.reviewed ? 'bg-slate-50/70 opacity-75' : 'hover:bg-amber-50/30'
                      }`}
                    >
                      <td className="py-3 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded border font-bold ${sevBadge}`}
                        >
                          {sevLabel}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums font-semibold text-slate-700">
                        {iss.date}
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-800">
                        {iss.checkTitle}
                        {(iss.personId || iss.workerId) && (
                          <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                            {(iss.personId && personsMap.get(iss.personId)) ||
                              (iss.workerId && workersMap.get(iss.workerId))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-sm font-medium text-slate-900 leading-relaxed">
                        {iss.message}
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-[11px] text-slate-600">
                        {iss.expected !== undefined && (
                          <div>المتوقع: {iss.expected}</div>
                        )}
                        {iss.actual !== undefined && (
                          <div className="font-bold text-slate-800">الفعلي: {iss.actual}</div>
                        )}
                        {iss.difference !== undefined && (
                          <div className="text-red-700 font-bold">الفرق: {iss.difference}</div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <input
                          type="text"
                          value={rev.note}
                          onChange={(e) =>
                            setIssueReviewed(iss.id, rev.reviewed, e.target.value)
                          }
                          placeholder="أضف ملاحظة مراجعة..."
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded focus:border-amber-600 outline-none"
                        />
                      </td>
                      <td className="py-3 px-3 text-center no-print">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setIssueReviewed(iss.id, !rev.reviewed, rev.note)
                            }
                            className={`px-2.5 py-1 rounded text-xs font-bold border transition-colors ${
                              rev.reviewed
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                            }`}
                          >
                            {rev.reviewed ? 'تم المراجعة ✓' : 'تم المراجعة'}
                          </button>
                          {iss.date && iss.date !== '-' && (
                            <button
                              type="button"
                              onClick={() => ignoreDateException(iss.date)}
                              title={`استثناء تاريخ ${iss.date} من الفحوصات`}
                              className="p-1 text-slate-400 hover:text-slate-700"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Explicit Privacy Confirmation Modal for Patch 8 AI Summary */}
      {showAiConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-base">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
              <span>تنبيه خصوصية قبل التلخيص الذكي</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              سيتم إرسال <strong>أرقام مجمعة فقط</strong> (عدد الاشتباهات حسب النوع، الإجماليات، وأعلى 5 اشتباهات بدون أي أسماء أشخاص وبدون صفوف خام) إلى خدمة Gemini من Google لكتابة ملخص من 5 أسطر باللهجة المصرية البسيطة.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAiConfirmModal(false)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleRunSafeAiSummary}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg"
              >
                موافق، لخّص الأرقام المجمعة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
