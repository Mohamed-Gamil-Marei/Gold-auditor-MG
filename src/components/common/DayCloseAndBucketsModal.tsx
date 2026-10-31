import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Lock,
  Unlock,
  Scale,
  Wallet,
  X,
  ArrowLeftRight,
  Layers,
  Copy,
  HelpCircle,
} from 'lucide-react';
import { useAuditStore } from '../../store/useAuditStore';
import { Operation, SalesSourceBucket } from '../../types';
import { formatNumber, formatWeight, parseAmountInput, parseWeightInput } from '../../utils/numerals';
import {
  computeDayCloseReconciliation,
  formatSourceRef,
} from '../../utils/sourceBuckets';
import { LedgerPageViewerModal } from './LedgerPageViewerModal';

interface DayCloseAndBucketsModalProps {
  isOpen: boolean;
  date: string;
  onClose: () => void;
}

const MATCH_FIELD_LABELS: Record<string, string> = {
  sell_total: 'يطابق إجمالي مبلغ المبيعات',
  buy_total: 'يطابق إجمالي مبلغ المشتريات',
  sell_weight: 'يطابق إجمالي وزن المبيعات',
  buy_weight: 'يطابق إجمالي وزن المشتريات',
  net_cash: 'يطابق صافي النقدية (بيع − شراء)',
  net_weight: 'يطابق صافي الوزن (بيع − شراء)',
  safe_balance: 'يطابق رصيد الخزنة المتوقع',
};

export const DayCloseAndBucketsModal: React.FC<DayCloseAndBucketsModalProps> = ({
  isOpen,
  date,
  onClose,
}) => {
  const {
    operations,
    daysMap,
    settings,
    updateDayInfo,
    updateDayBucketReconciliation,
    updateOperation,
    toggleDayLock,
  } = useAuditStore();

  const [activeStepTab, setActiveStepTab] = useState<
    'all' | 'buckets' | 'safe_h9' | 'free_notes'
  >('all');
  const [lockReason, setLockReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showWhereIsSafeDiff, setShowWhereIsSafeDiff] = useState(false);
  const [viewerOp, setViewerOp] = useState<Operation | null>(null);

  const dayInfo = daysMap[date];
  const isLocked = Boolean(dayInfo?.locked);

  const summary = useMemo(
    () =>
      computeDayCloseReconciliation({
        date,
        operations,
        daysMap,
        settings,
      }),
    [date, operations, daysMap, settings]
  );

  // Suspect operations for H9.3 (د) "أين الفرق؟" in safe balance
  const suspectSafeOps = useMemo(() => {
    const dayOps = operations.filter((o) => o.date === date);
    const diff = Math.abs(
      summary.safeBookVsAppDiff ?? summary.safeAppVsActualDiff ?? 0
    );
    return dayOps
      .map((op) => {
        let score = 0;
        const reasons: string[] = [];
        if (typeof op.ocrConfidence === 'number' && op.ocrConfidence < 0.75) {
          score += 40;
          reasons.push(`ثقة قراءة منخفضة (${Math.round(op.ocrConfidence * 100)}%)`);
        }
        if (diff > 0 && Math.abs(op.total - diff) <= Math.max(25, diff * 0.05)) {
          score += 65;
          reasons.push(`مبلغ العملية (${formatNumber(op.total)}) يساوي تقريباً قيمة فرق الخزنة`);
        }
        if (op.payment === 'credit') {
          score += 30;
          reasons.push('مسجلة آجل (قد تكون محسوبة نقداً في الدفتر)');
        }
        return { op, score, reasons };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [operations, date, summary]);

  if (!isOpen) return null;

  const handleConfirmAllGuessedSources = () => {
    const daySellOps = operations.filter(
      (o) => o.date === date && o.kind === 'sell' && o.sourceGuessed
    );
    for (const op of daySellOps) {
      updateOperation(op.id, { sourceGuessed: false }, 'تأكيد مصدر البيع قبل قفل اليوم');
    }
    setSuccessMsg(`تم تأكيد مصدر البيع لعدد ${daySellOps.length} صف.`);
  };

  const handleCopyBookCashToApp = (field: 'opening' | 'closing') => {
    if (isLocked) return;
    if (field === 'opening' && typeof summary.bookOpeningCash === 'number') {
      updateDayInfo(
        date,
        { openingCash: summary.bookOpeningCash, openingCashManual: true },
        { isManualOpening: true }
      );
      setSuccessMsg('تم نسخ رصيد الخزنة الافتتاحي من الدفتر إلى خزنة البرنامج.');
    } else if (field === 'closing' && typeof summary.bookClosingCash === 'number') {
      updateDayInfo(date, { actualCash: summary.bookClosingCash });
      setSuccessMsg('تم نسخ رصيد الخزنة الختامي من الدفتر إلى الجرد الفعلي.');
    }
  };

  const handleLockDay = () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (isLocked) {
      if (!lockReason.trim()) {
        setErrorMsg('يرجى كتابة سبب فتح قفل اليوم لتسجيله في سجل المراجعة.');
        return;
      }
      toggleDayLock(date, false, lockReason.trim());
      setLockReason('');
      setSuccessMsg('تم فتح قفل اليوم بنجاح.');
      return;
    }

    // H10.6: Prevent locking an imported day before H3 totals match and source confirmation
    if (summary.hasUnapprovedLedgerTotalDiff) {
      setErrorMsg(
        'لا يمكن قفل اليوم قبل مطابقة أو اعتماد فرق إجمالي الدفتر المكتوب بخط اليد (H3).'
      );
      return;
    }
    if (summary.unconfirmedSourceRowsCount > 0) {
      setErrorMsg(
        `يوجد ${summary.unconfirmedSourceRowsCount} صف بيع بمصدر مخمّن غير مؤكد — اضغط "تأكيد كل المصادر المخمّنة" أولاً.`
      );
      return;
    }

    // H10.5: Do not lock a day with a discrepancy above tolerance without a written reason
    if (summary.requiresLockReason && !lockReason.trim()) {
      setErrorMsg(
        'يوجد فرق في الخزنة أو الوزن أو تجاوز للمتاح فوق الهامش المسموح — يجب كتابة سبب واضح لتسجيله في سجل التعديلات قبل قفل اليوم.'
      );
      return;
    }

    if (lockReason.trim()) {
      updateDayInfo(date, { lockWithDiffReason: lockReason.trim() });
    }
    toggleDayLock(
      date,
      true,
      lockReason.trim() || 'قفل اليوم بعد مطابقة النقدية والوزن والمصادر (H10)'
    );
    setLockReason('');
    setSuccessMsg('تم قفل اليوم وترحيل الأرصدة الختامية لليوم التالي تلقائياً ✓');
  };

  const statusBadge = (st: 'match' | 'small_diff' | 'large_diff' | 'missing') => {
    if (st === 'match') {
      return (
        <span className="text-xs font-bold text-emerald-700">
          ✅ مطابق ضمن الهامش
        </span>
      );
    }
    if (st === 'small_diff') {
      return (
        <span className="text-xs font-bold text-amber-700">
          ⚠ فرق صغير
        </span>
      );
    }
    if (st === 'large_diff') {
      return (
        <span className="text-xs font-bold text-red-700">
          ❌ فرق كبير يحتاج مراجعة
        </span>
      );
    }
    return (
      <span className="text-xs font-semibold text-slate-500">
        ❔ بانتظار إدخال الجرد الفعلي
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
        dir="rtl"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Scale className="w-5 h-5 text-amber-400" />
              قفل اليوم ومطابقة النقدية والوزن والمصادر (H7 / H9 / H10) — يوم{' '}
              <span className="font-mono text-amber-300">{date}</span>
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              المبيعات − المشتريات (نقدية ووزن) · مطابقة مصادر البيع (الريون / الكيس / القديم) · مطابقة خزنة الدفتر
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded ${
                isLocked
                  ? 'bg-red-500/20 text-red-200 border border-red-400/40'
                  : 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
              }`}
            >
              {isLocked ? 'اليوم مقفول 🔒' : 'اليوم مفتوح للمراجعة'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sub-navigation */}
        <div className="px-6 py-2.5 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveStepTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeStepTab === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
              }`}
            >
              خطوات قفل اليوم الكاملة (1 ← 6)
            </button>
            <button
              type="button"
              onClick={() => setActiveStepTab('buckets')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeStepTab === 'buckets'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
              }`}
            >
              مطابقة المخزون حسب المصادر (H7)
            </button>
            <button
              type="button"
              onClick={() => setActiveStepTab('safe_h9')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeStepTab === 'safe_h9'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
              }`}
            >
              مطابقة الخزنة (الدفتر ↔ البرنامج ↔ الجرد H9)
            </button>
            {summary.matchedFreeAreaNotes.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveStepTab('free_notes')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeStepTab === 'free_notes'
                    ? 'bg-purple-700 text-white'
                    : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                }`}
              >
                حسابات المساحة الفاضية بالدفتر ({summary.matchedFreeAreaNotes.length})
              </button>
            )}
          </div>

          {summary.unconfirmedSourceRowsCount > 0 && !isLocked && (
            <button
              type="button"
              onClick={handleConfirmAllGuessedSources}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200"
            >
              تأكيد كل المصادر المخمّنة ({summary.unconfirmedSourceRowsCount} صف) ✓
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-xs font-bold text-red-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Step 1 & 2: Sales vs Purchases Summary + Net Cash & Net Weight (H10.1 & H10.4) */}
          {(activeStepTab === 'all' || activeStepTab === 'buckets') && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-1.5">
                <div className="text-xs font-bold text-emerald-900">
                  1) إجمالي المبيعات (الورقة اليمنى)
                </div>
                <div className="text-lg font-extrabold font-mono tabular-nums text-emerald-950">
                  {formatWeight(summary.sellWeightG)} جرام ·{' '}
                  {formatNumber(summary.sellTotalAmount)} ج.م
                </div>
                <div className="text-[11px] text-emerald-800">
                  نقدي: {formatNumber(summary.sellCashAmount)} ج.م · آجل:{' '}
                  {formatNumber(summary.sellCreditAmount)} ج.م · عدد القطع الحمراء:{' '}
                  {summary.sellPiecesTotal} قطعة
                </div>
              </div>

              <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-xl space-y-1.5">
                <div className="text-xs font-bold text-blue-900">
                  1) إجمالي المشتريات (الورقة اليسرى)
                </div>
                <div className="text-lg font-extrabold font-mono tabular-nums text-blue-950">
                  {formatWeight(summary.buyWeightG)} جرام ·{' '}
                  {formatNumber(summary.buyTotalAmount)} ج.م
                </div>
                <div className="text-[11px] text-blue-800">
                  نقدي: {formatNumber(summary.buyCashAmount)} ج.م · آجل:{' '}
                  {formatNumber(summary.buyCreditAmount)} ج.م
                </div>
              </div>

              <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1.5">
                <div className="text-xs font-bold text-amber-900">
                  2) صافي النقدية وصافي الوزن (بيع − شراء)
                </div>
                <div className="text-sm font-extrabold text-slate-900">
                  {summary.netWeightDirectionText}
                </div>
                <div className="text-xs font-mono font-bold text-slate-800">
                  صافي النقدية (مبيعات − مشتريات):{' '}
                  <span
                    className={
                      summary.netCashFlow >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }
                  >
                    {summary.netCashFlow >= 0 ? '+' : ''}
                    {formatNumber(summary.netCashFlow)} ج.م
                  </span>
                </div>
                {summary.inventoryDrawdownG > 0 && (
                  <div className="text-[11px] font-bold text-amber-800">
                    سحب من المخزون الافتتاحي بمقدار:{' '}
                    {formatWeight(summary.inventoryDrawdownG)} جرام (مغطى بالرصيد الافتتاحي ✓)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* H10.4 Banner: "الذهب ما ينفعش يتباع أكتر من المتاح" */}
          {(summary.exceededTotalAvailable ||
            summary.exceededBuckets.length > 0 ||
            summary.firstNegativeRow) && (
            <div className="p-4 bg-red-50 border-2 border-red-300 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-extrabold text-red-900 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  تنبيه عالي الخطورة (H10): الذهب لا ينفع يُباع أكثر من المتاح!
                </div>
                {summary.firstNegativeRow && (
                  <button
                    type="button"
                    onClick={() => setViewerOp(summary.firstNegativeRow!.op)}
                    className="px-3 py-1 bg-white border border-red-300 rounded-lg text-xs font-bold text-red-800 hover:bg-red-100 flex items-center gap-1.5"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    اعرض السطر في ورقة الدفتر
                  </button>
                )}
              </div>
              {summary.firstNegativeRow && (
                <p className="text-xs font-bold text-red-800">
                  أول صف نزل عنده المخزون تحت الصفر حسب ترتيب الكتلة والسطر:{' '}
                  <span className="underline">
                    {summary.firstNegativeRow.sourceRefText}
                  </span>{' '}
                  — الصنف: "{summary.firstNegativeRow.op.item || 'بدون بيان'}" (الوزن:{' '}
                  {formatWeight(summary.firstNegativeRow.op.weightG)} ج، عجز التغطية:{' '}
                  {formatWeight(summary.firstNegativeRow.deficitG)} ج).
                </p>
              )}
            </div>
          )}

          {/* Step 3: Safe Reconciliation (H9 & H10.2) */}
          {(activeStepTab === 'all' || activeStepTab === 'safe_h9') && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-700" />
                  3) مطابقة الخزنة الثلاثية (الدفتر ↔ البرنامج ↔ الجرد الفعلي — H9 & H10)
                </h3>
                <div className="flex items-center gap-3">
                  {statusBadge(summary.safeStatus)}
                  <button
                    type="button"
                    onClick={() => setShowWhereIsSafeDiff((v) => !v)}
                    className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 flex items-center gap-1"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                    أين الفرق؟
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {/* Opening Safe */}
                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                  <label className="block text-[11px] font-bold text-slate-600">
                    افتتاحي الخزنة (البرنامج)
                  </label>
                  <input
                    type="text"
                    disabled={isLocked}
                    value={dayInfo?.openingCash ?? summary.openingSafeCash}
                    onChange={(e) => {
                      const val = parseAmountInput(e.target.value);
                      updateDayInfo(
                        date,
                        { openingCash: val, openingCashManual: true },
                        { isManualOpening: true }
                      );
                    }}
                    className="w-full px-2.5 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded focus:border-amber-600 outline-none"
                  />
                  {typeof summary.bookOpeningCash === 'number' && (
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <span>بالدفتر: {formatNumber(summary.bookOpeningCash)}</span>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => handleCopyBookCashToApp('opening')}
                          className="text-amber-700 hover:underline font-bold flex items-center gap-0.5"
                        >
                          <Copy className="w-3 h-3" /> انسخ
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Net Movements */}
                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                  <div className="text-[11px] font-bold text-slate-600">
                    صافي النقدية والمصاريف
                  </div>
                  <div className="text-xs font-mono font-bold text-slate-800">
                    صافي بيع−شراء: {formatNumber(summary.netCashFlow)}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    مصاريف: -{formatNumber(summary.expensesCash)} · سلف: -
                    {formatNumber(summary.advancesCash)}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    أشخاص: +{formatNumber(summary.personReceivedCash)} / -
                    {formatNumber(summary.personGaveCash)}
                  </div>
                </div>

                {/* Expected App Safe */}
                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                  <div className="text-[11px] font-bold text-slate-600">
                    المتوقع في خزنة البرنامج
                  </div>
                  <div className="text-base font-extrabold font-mono text-slate-900">
                    {formatNumber(summary.expectedAppSafeCash)} ج.م
                  </div>
                  <div className="text-[11px] text-slate-500">
                    افتتاحي + صافي النقدية − مصاريف − سلف ± أشخاص
                  </div>
                </div>

                {/* Book Closing Cash (H9) */}
                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                  <label className="block text-[11px] font-bold text-slate-600">
                    ختامي الدفتر (ورقة المبيعات H9)
                  </label>
                  <input
                    type="text"
                    disabled={isLocked}
                    placeholder="غير مسجل..."
                    value={dayInfo?.bookClosingCash ?? summary.bookClosingCash ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      updateDayInfo(date, {
                        bookClosingCash: raw === '' ? undefined : parseAmountInput(raw),
                      });
                    }}
                    className="w-full px-2.5 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded focus:border-amber-600 outline-none"
                  />
                  {typeof summary.safeBookVsAppDiff === 'number' && (
                    <div
                      className={`text-[11px] font-mono font-bold ${
                        Math.abs(summary.safeBookVsAppDiff) <= 50
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      فرق الدفتر عن البرنامج: {summary.safeBookVsAppDiff > 0 ? '+' : ''}
                      {formatNumber(summary.safeBookVsAppDiff)} ج.م
                    </div>
                  )}
                </div>

                {/* Actual Safe Cash (Enter to save) */}
                <div className="bg-white p-3 rounded-lg border-2 border-amber-400 space-y-1">
                  <label className="block text-[11px] font-bold text-amber-900">
                    الخزنة الفعلية (الجرد النقدي)
                  </label>
                  <input
                    type="text"
                    disabled={isLocked}
                    placeholder="أدخل الجرد الفعلي..."
                    value={dayInfo?.actualCash ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      updateDayInfo(date, {
                        actualCash: raw === '' ? undefined : parseAmountInput(raw),
                      });
                    }}
                    className="w-full px-2.5 py-1.5 text-xs font-mono font-extrabold bg-amber-50/40 border border-amber-300 rounded focus:border-amber-600 outline-none"
                  />
                  {typeof summary.actualSafeCash === 'number' && (
                    <div
                      className={`text-[11px] font-mono font-bold ${
                        Math.abs(summary.safeAppVsActualDiff) <= 50
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      الفرق (فعلي − متوقع):{' '}
                      {summary.safeAppVsActualDiff > 0 ? '+' : ''}
                      {formatNumber(summary.safeAppVsActualDiff)} ج.م
                    </div>
                  )}
                </div>
              </div>

              {/* H9.3 (د) "أين الفرق؟" suspect operations list */}
              {showWhereIsSafeDiff && (
                <div className="p-3 bg-white border border-amber-200 rounded-lg space-y-2">
                  <div className="text-xs font-bold text-amber-900">
                    العمليات المشتبه في تسببها بفرق الخزنة (مرتبة بالأعلى اشتباهاً):
                  </div>
                  {suspectSafeOps.length === 0 ? (
                    <div className="text-xs text-slate-500">
                      لا توجد عمليات مشتبه فيها واضحة — راجع رصيد أول اليوم أو المصاريف غير المسجلة.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {suspectSafeOps.map(({ op, reasons }) => (
                        <div
                          key={op.id}
                          className="flex items-center justify-between text-xs p-2 bg-amber-50/50 rounded border border-amber-100"
                        >
                          <div>
                            <span className="font-bold text-slate-900">
                              {op.kind === 'sell' ? 'بيع' : op.kind === 'buy' ? 'شراء' : op.kind}{' '}
                              — {op.item || 'بدون بيان'}
                            </span>{' '}
                            <span className="font-mono font-bold text-slate-700">
                              ({formatWeight(op.weightG)} ج · {formatNumber(op.total)} ج.م)
                            </span>
                            <span className="text-amber-800 mr-2">
                              [{reasons.join(' ، ')}]
                            </span>
                          </div>
                          {op.sourcePageRef && (
                            <button
                              type="button"
                              onClick={() => setViewerOp(op)}
                              className="px-2 py-0.5 bg-white border border-amber-300 rounded text-[11px] font-bold text-amber-800 hover:bg-amber-100"
                            >
                              {formatSourceRef(op.sourcePageRef, op.kind, op.date)}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Source Buckets Inventory Reconciliation (H7.3 & H10.3) */}
          {(activeStepTab === 'all' || activeStepTab === 'buckets') && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-600" />
                  4) مطابقة أوزان وقطع مصادر البيع آخر اليوم (الريون / الكيس / الذهب القديم — H7)
                </h3>
                <span className="text-xs text-slate-600">
                  المعادلة: المتوقع = الوزن قبل + الوارد − المباع
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="py-2.5 px-3">المصدر (المخزن)</th>
                      <th className="py-2.5 px-3">الوزن قبل (افتتاحي)</th>
                      <th className="py-2.5 px-3">الوارد التلقائي</th>
                      <th className="py-2.5 px-3">الوارد اليدوي</th>
                      <th className="py-2.5 px-3">المباع اليوم</th>
                      <th className="py-2.5 px-3">المتوقع (ج)</th>
                      <th className="py-2.5 px-3">الوزن الحالي (الفعلي)</th>
                      <th className="py-2.5 px-3">الفرق (ج / ج.م)</th>
                      <th className="py-2.5 px-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['rayon', 'bag', 'old_gold', 'other'] as SalesSourceBucket[]).map(
                      (bKey) => {
                        const b = summary.buckets[bKey];
                        const savedRec = dayInfo?.bucketReconciliation?.[bKey] || {};
                        return (
                          <tr
                            key={bKey}
                            className="border-b border-slate-200 hover:bg-slate-50/80"
                          >
                            <td className="py-2.5 px-3 font-bold text-slate-900">
                              {b.name}
                              {bKey === 'rayon' && (
                                <div className="text-[11px] font-normal text-amber-700 mt-0.5">
                                  يتتبع الوزن + عدد القطع الحمراء
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <input
                                type="text"
                                disabled={isLocked}
                                value={savedRec.beforeG ?? b.beforeG}
                                onChange={(e) => {
                                  const w = parseWeightInput(e.target.value);
                                  updateDayBucketReconciliation(date, bKey, {
                                    beforeG: w,
                                    beforeManual: true,
                                  });
                                }}
                                className="w-24 px-2 py-1 font-mono font-bold border border-slate-300 rounded focus:border-amber-600 outline-none"
                              />
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-700">
                              {formatWeight(b.autoInflowG)} ج
                              {bKey === 'old_gold' && b.autoInflowG > 0 && (
                                <span className="block text-[10px] text-purple-700">
                                  (مشتريات كسر/قديم H-B)
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <input
                                type="text"
                                disabled={isLocked}
                                value={savedRec.manualInflowG ?? b.manualInflowG}
                                onChange={(e) => {
                                  const w = parseWeightInput(e.target.value);
                                  updateDayBucketReconciliation(date, bKey, {
                                    manualInflowG: w,
                                  });
                                }}
                                className="w-24 px-2 py-1 font-mono border border-slate-300 rounded focus:border-amber-600 outline-none"
                              />
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-emerald-800">
                              {formatWeight(b.soldG)} ج
                            </td>
                            <td className="py-2.5 px-3 font-mono font-extrabold text-slate-900">
                              {formatWeight(b.expectedG)} ج
                            </td>
                            <td className="py-2.5 px-3">
                              <input
                                type="text"
                                disabled={isLocked}
                                placeholder="الجرد الفعلي..."
                                value={savedRec.actualG ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  updateDayBucketReconciliation(date, bKey, {
                                    actualG:
                                      raw === ''
                                        ? undefined
                                        : parseWeightInput(raw),
                                  });
                                }}
                                className="w-28 px-2 py-1 font-mono font-extrabold bg-amber-50/40 border border-amber-300 rounded focus:border-amber-600 outline-none"
                              />
                            </td>
                            <td className="py-2.5 px-3 font-mono">
                              {typeof b.actualG === 'number' ? (
                                <span
                                  className={
                                    Math.abs(b.diffG) <= 0.25
                                      ? 'text-emerald-700 font-bold'
                                      : 'text-red-700 font-bold'
                                  }
                                >
                                  {b.diffG > 0 ? '+' : ''}
                                  {formatWeight(b.diffG)} ج ({formatNumber(b.diffValueEgp)}{' '}
                                  ج.م)
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="py-2.5 px-3">{statusBadge(b.status)}</td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              </div>

              {/* Rayon Piece Count Reconciliation Row (H5 & H7.3) */}
              <div className="px-4 py-3 bg-amber-50/60 border-t border-amber-200 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="font-bold text-amber-950">
                  مطابقة عدد قطع الريون (من الأعداد الحمراء H5):
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5">
                    <span className="text-slate-600">القطع قبل:</span>
                    <input
                      type="number"
                      disabled={isLocked}
                      value={
                        dayInfo?.bucketReconciliation?.rayon?.piecesBefore ??
                        summary.buckets.rayon.piecesBefore
                      }
                      onChange={(e) =>
                        updateDayBucketReconciliation(date, 'rayon', {
                          piecesBefore: Number(e.target.value) || 0,
                        })
                      }
                      className="w-20 px-2 py-1 font-mono font-bold bg-white border border-amber-300 rounded"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-slate-600">+ وارد قطع:</span>
                    <input
                      type="number"
                      disabled={isLocked}
                      value={
                        dayInfo?.bucketReconciliation?.rayon?.piecesInflow ??
                        summary.buckets.rayon.piecesInflow
                      }
                      onChange={(e) =>
                        updateDayBucketReconciliation(date, 'rayon', {
                          piecesInflow: Number(e.target.value) || 0,
                        })
                      }
                      className="w-20 px-2 py-1 font-mono bg-white border border-amber-300 rounded"
                    />
                  </label>
                  <span className="font-mono font-bold text-red-700">
                    − المباع (أحمر): {summary.buckets.rayon.piecesSold} قطعة
                  </span>
                  <span className="font-mono font-extrabold text-slate-900">
                    = المتوقع: {summary.buckets.rayon.piecesExpected} قطعة
                  </span>
                  <label className="flex items-center gap-1.5">
                    <span className="font-bold text-amber-900">القطع الحالي:</span>
                    <input
                      type="number"
                      disabled={isLocked}
                      placeholder="الفعلي..."
                      value={
                        dayInfo?.bucketReconciliation?.rayon?.piecesActual ?? ''
                      }
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        updateDayBucketReconciliation(date, 'rayon', {
                          piecesActual: raw === '' ? undefined : Number(raw),
                        });
                      }}
                      className="w-20 px-2 py-1 font-mono font-extrabold bg-white border-2 border-amber-400 rounded"
                    />
                  </label>
                  {typeof summary.buckets.rayon.piecesActual === 'number' && (
                    <span
                      className={`font-mono font-bold ${
                        summary.buckets.rayon.piecesDiff === 0
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      (فرق القطع: {summary.buckets.rayon.piecesDiff > 0 ? '+' : ''}
                      {summary.buckets.rayon.piecesDiff})
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* H-C.3: Free Area Handwritten Notes Comparison */}
          {(activeStepTab === 'all' || activeStepTab === 'free_notes') &&
            summary.matchedFreeAreaNotes.length > 0 && (
              <div className="bg-purple-50/50 border border-purple-200 rounded-xl p-4 space-y-2.5">
                <h3 className="text-xs font-bold text-purple-950 flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-purple-700" />
                  مقارنة حسابات المساحة الفاضية آخر اليوم المكتوبة باليد في الدفتر (H-C.3) مع حسابات البرنامج:
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {summary.matchedFreeAreaNotes.map((note) => (
                    <div
                      key={note.id}
                      className="p-2.5 bg-white rounded-lg border border-purple-200 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-bold text-slate-900">
                          المكتوب بالدفتر: "{note.text}"
                        </span>
                        {note.locationHint && (
                          <span className="text-slate-500 mr-1.5">
                            ({note.locationHint})
                          </span>
                        )}
                      </div>
                      <div>
                        {note.matchedField ? (
                          <span className="font-bold text-emerald-700">
                            ✅ {MATCH_FIELD_LABELS[note.matchedField] || 'مطابق'}
                          </span>
                        ) : (
                          <span className="font-semibold text-amber-700">
                            للمراجعة ({note.suggestedCategory})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Step 5 & 6: Final Day Close & Lock Action (H10.5) */}
          <div className="p-4 bg-slate-100 border border-slate-300 rounded-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-bold text-slate-900">
                5 & 6) النتيجة النهائية وإقفال اليوم (يرحّل الختامي لليوم التالي تلقائياً):
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span>حالة الخزنة: {statusBadge(summary.safeStatus)}</span>
                <span>حالة الذهب: {statusBadge(summary.goldStatus)}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <input
                type="text"
                value={lockReason}
                onChange={(e) => setLockReason(e.target.value)}
                placeholder={
                  isLocked
                    ? 'اكتب سبب فتح قفل اليوم...'
                    : summary.requiresLockReason
                    ? 'إجباري: اكتب سبب قفل اليوم رغم وجود فرق فوق الهامش...'
                    : 'ملاحظة أو سبب قفل اليوم (اختياري عند التطابق)...'
                }
                className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:border-amber-600 outline-none"
              />
              <button
                type="button"
                onClick={handleLockDay}
                className={`px-5 py-2 rounded-lg text-xs font-extrabold text-white flex items-center justify-center gap-2 transition ${
                  isLocked
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-slate-900 hover:bg-slate-800'
                }`}
              >
                {isLocked ? (
                  <>
                    <Unlock className="w-4 h-4" />
                    افتح قفل اليوم
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    اقفل اليوم ورحّل الختامي لليوم التالي
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {viewerOp && (
        <LedgerPageViewerModal
          isOpen={Boolean(viewerOp)}
          date={viewerOp.date}
          highlightOperation={viewerOp}
          onClose={() => setViewerOp(null)}
        />
      )}
    </div>
  );
};
