import React, { useState, useMemo } from 'react';
import {
  ClipboardCheck,
  Plus,
  CheckCircle2,
  Circle,
  ArrowLeft,
  Lock,
  Printer,
  FileDown,
  History,
  GitCompare,
  AlertOctagon,
  Users,
  DollarSign,
  FileText,
} from 'lucide-react';
import { useAuditStore } from '../store/useAuditStore';
import { AuditVisitChecklist, AuditVisitSummarySnapshot } from '../types';
import { addDaysLocalIso, formatNumber, formatWeight, getTodayIso } from '../utils/numerals';
import { runAllAuditChecks } from '../utils/checks';
import { computePersonBalancesSummary } from '../utils/checks/checkPersonBalances';
import { computeDayGoldInventory } from '../utils/checks/checkGoldInventoryBalance';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';

interface Props {
  onNavigateTab: (
    tab:
      | 'fast_entry'
      | 'audit_review'
      | 'price_statement'
      | 'gold_prices'
      | 'gold_inventory'
      | 'accounts_expenses'
      | 'summary_log'
      | 'audit_visit'
      | 'settings'
  ) => void;
  onShowToast?: (msg: string) => void;
}

export const AuditVisitScreen: React.FC<Props> = ({ onNavigateTab, onShowToast }) => {
  const {
    operations,
    daysMap,
    persons,
    workers,
    auditLogs,
    settings,
    issueReviews,
    auditVisits,
    activeVisitId,
    createAuditVisit,
    setActiveVisitId,
    updateAuditVisit,
    updateAuditVisitChecklist,
    completeAuditVisit,
  } = useAuditStore();

  const [subMode, setSubMode] = useState<'active' | 'history' | 'compare'>('active');
  const [showNewModal, setShowNewModal] = useState(false);
  const [confirmCompleteModal, setConfirmCompleteModal] = useState(false);

  const defaultDates = useMemo(() => {
    const today = getTodayIso();
    const completed = auditVisits
      .filter((v) => v.status === 'completed')
      .sort((a, b) => b.toDate.localeCompare(a.toDate));
    if (completed.length > 0) {
      return { from: completed[0].toDate, to: today };
    }
    const lockedDates = Object.keys(daysMap)
      .filter((d) => daysMap[d]?.locked)
      .sort();
    if (lockedDates.length > 0) {
      return { from: lockedDates[lockedDates.length - 1], to: today };
    }
    return { from: addDaysLocalIso(today, -7), to: today };
  }, [auditVisits, daysMap]);

  const [newVisitName, setNewVisitName] = useState(
    `زيارة مراجعة ${new Date().toLocaleDateString('ar-EG')}`
  );
  const [newFromDate, setNewFromDate] = useState(defaultDates.from);
  const [newToDate, setNewToDate] = useState(defaultDates.to);
  const [newNotes, setNewNotes] = useState('');

  const [compareVisitAId, setCompareVisitAId] = useState<string>('');
  const [compareVisitBId, setCompareVisitBId] = useState<string>('');

  const activeVisit = useMemo(() => {
    if (activeVisitId) {
      const found = auditVisits.find((v) => v.id === activeVisitId);
      if (found) return found;
    }
    return auditVisits[auditVisits.length - 1] || null;
  }, [auditVisits, activeVisitId]);

  const visitMetrics = useMemo(() => {
    if (!activeVisit) return null;
    const { fromDate, toDate } = activeVisit;

    const auditResult = runAllAuditChecks(
      operations,
      daysMap,
      persons,
      workers,
      auditLogs,
      settings
    );

    const allIssues = auditResult.issues.filter(
      (iss) => iss.date >= fromDate && iss.date <= toDate
    );

    const highIssues = allIssues.filter((i) => i.severity === 'high');
    const mediumIssues = allIssues.filter((i) => i.severity === 'medium');
    const lowIssues = allIssues.filter((i) => i.severity === 'low');
    const unreviewedHighIssues = highIssues.filter((i) => !issueReviews[i.id]?.reviewed);

    const datesInRange = new Set<string>();
    operations.forEach((op) => {
      if (op.date >= fromDate && op.date <= toDate) datesInRange.add(op.date);
    });
    Object.keys(daysMap).forEach((d) => {
      if (d >= fromDate && d <= toDate) datesInRange.add(d);
    });
    const sortedDates = Array.from(datesInRange).sort();

    const daysMissingGoldPrice = sortedDates.filter(
      (d) =>
        operations.some((op) => op.date === d && (op.kind === 'sell' || op.kind === 'buy')) &&
        (!daysMap[d]?.goldPricePerGram || daysMap[d].goldPricePerGram <= 0)
    );

    const daysMissingSafeCount = sortedDates.filter(
      (d) => daysMap[d]?.actualCash === undefined
    );

    const daysMissingGoldInventory = sortedDates.filter((d) => {
      const di = daysMap[d];
      if (!di) return true;
      const hasKaratActual =
        di.karatBalances &&
        Object.values(di.karatBalances).some((kb) => kb?.closingG !== undefined);
      return !hasKaratActual && di.closingBalanceG === undefined;
    });

    const periodOps = operations.filter((op) => op.date >= fromDate && op.date <= toDate);
    let buyG = 0;
    let buyTotal = 0;
    let sellG = 0;
    let sellTotal = 0;
    let expensesTotal = 0;
    let advancesTotal = 0;

    for (const op of periodOps) {
      if (op.kind === 'sell') {
        sellG += op.weightG || 0;
        sellTotal += op.total || 0;
      } else if (op.kind === 'buy') {
        buyG += op.weightG || 0;
        buyTotal += op.total || 0;
      } else if (op.kind === 'expense') {
        expensesTotal += op.total || 0;
      } else if (op.kind === 'advance') {
        advancesTotal += op.total || 0;
      }
    }

    let netSafeDiff = 0;
    let netGoldDiff21EqG = 0;
    for (const d of sortedDates) {
      const inv = computeDayGoldInventory(d, operations, daysMap[d]);
      netGoldDiff21EqG = Number((netGoldDiff21EqG + inv.totalDiff21EqG).toFixed(3));
      const di = daysMap[d];
      if (di && di.openingCash !== undefined && di.actualCash !== undefined) {
        const dayOps = operations.filter((o) => o.date === d);
        let cashIn = 0;
        let cashOut = 0;
        for (const o of dayOps) {
          if (o.kind === 'sell' && o.payment === 'cash') cashIn += o.total;
          else if (o.kind === 'buy' && o.payment === 'cash') cashOut += o.total;
          else if (o.kind === 'expense') cashOut += o.total;
          else if (o.kind === 'advance') cashOut += o.total;
          else if (o.kind === 'person') {
            if ((o.direction || 'gave_him') === 'received_from_him') cashIn += o.total;
            else cashOut += o.total;
          }
        }
        const expectedCash = di.openingCash + cashIn - cashOut;
        netSafeDiff += di.actualCash - expectedCash;
      }
    }

    const debtSummary = computePersonBalancesSummary(operations, persons, toDate);
    const exceededDebtCount = Array.from(debtSummary.map.values()).filter(
      (p) => p.exceededAnyLimit
    ).length;

    const priceIssues = allIssues.filter(
      (i) => i.checkType === 'price_anomaly' || i.checkType === 'fixed_price_rule'
    );

    return {
      allIssues,
      highIssues,
      mediumIssues,
      lowIssues,
      unreviewedHighIssues,
      priceIssues,
      daysMissingGoldPrice,
      daysMissingSafeCount,
      daysMissingGoldInventory,
      buyG,
      buyTotal,
      sellG,
      sellTotal,
      expensesTotal,
      advancesTotal,
      netSafeDiff,
      netGoldDiff21EqG,
      debtSummary,
      exceededDebtCount,
      sortedDates,
    };
  }, [activeVisit, operations, daysMap, persons, workers, auditLogs, settings, issueReviews]);

  const handleCreateVisit = () => {
    if (!newVisitName.trim()) return;
    createAuditVisit({
      name: newVisitName.trim(),
      fromDate: newFromDate,
      toDate: newToDate,
      notes: newNotes.trim(),
    });
    setShowNewModal(false);
    setSubMode('active');
    onShowToast?.('تم بدء زيارة مراجعة جديدة');
  };

  const handleCompleteVisit = async () => {
    if (!activeVisit || !visitMetrics) return;
    const summarySnapshot: AuditVisitSummarySnapshot = {
      buyG: visitMetrics.buyG,
      buyTotal: visitMetrics.buyTotal,
      sellG: visitMetrics.sellG,
      sellTotal: visitMetrics.sellTotal,
      expensesTotal: visitMetrics.expensesTotal,
      advancesTotal: visitMetrics.advancesTotal,
      netSafeDiff: visitMetrics.netSafeDiff,
      netGoldDiff21EqG: visitMetrics.netGoldDiff21EqG,
      totalDebtsOwesUs: visitMetrics.debtSummary.totalOwesUsCash,
      totalDebtsOverdue: visitMetrics.debtSummary.totalOverdueCash,
      highIssuesCount: visitMetrics.highIssues.length,
      mediumIssuesCount: visitMetrics.mediumIssues.length,
      lowIssuesCount: visitMetrics.lowIssues.length,
      unreviewedHighCount: visitMetrics.unreviewedHighIssues.length,
      sellAnomaliesImpact: 0,
      buyAnomaliesImpact: 0,
    };

    await completeAuditVisit(activeVisit.id, summarySnapshot, true);
    setConfirmCompleteModal(false);
    onShowToast?.('تم إنهاء الزيارة، قفل أيام الفترة، وحفظ نسخة التقرير بنجاح');
  };

  const handleSavePdf = async () => {
    if (!activeVisit) return;
    const api = ensureGoldApiBridge();
    await api.print.saveToPdf(
      `تقرير-زيارة-المراجعة-${activeVisit.fromDate}-إلى-${activeVisit.toDate}.pdf`
    );
  };

  const checklistItems: {
    key: keyof AuditVisitChecklist;
    label: string;
    remainingText: string;
    remainingCount: number;
    targetTab:
      | 'gold_prices'
      | 'audit_review'
      | 'summary_log'
      | 'gold_inventory'
      | 'accounts_expenses';
  }[] = visitMetrics
    ? [
        {
          key: 'pricesRecorded',
          label: '1. تسجيل أسعار الذهب لكل أيام الفترة',
          remainingCount: visitMetrics.daysMissingGoldPrice.length,
          remainingText:
            visitMetrics.daysMissingGoldPrice.length === 0
              ? 'مكتمل (0 متبقي)'
              : `متبقي ${visitMetrics.daysMissingGoldPrice.length} يوم بدون سعر`,
          targetTab: 'gold_prices',
        },
        {
          key: 'highIssuesReviewed',
          label: '2. مراجعة الاشتباهات عالية الخطورة',
          remainingCount: visitMetrics.unreviewedHighIssues.length,
          remainingText:
            visitMetrics.unreviewedHighIssues.length === 0
              ? 'مكتمل (0 غير مراجع)'
              : `متبقي ${visitMetrics.unreviewedHighIssues.length} اشتباه عالي`,
          targetTab: 'audit_review',
        },
        {
          key: 'safeVerified',
          label: '3. جرد الخزنة النقدية ومطابقة الرصيد الفعلي',
          remainingCount: visitMetrics.daysMissingSafeCount.length,
          remainingText:
            visitMetrics.daysMissingSafeCount.length === 0
              ? 'مكتمل'
              : `${visitMetrics.daysMissingSafeCount.length} يوم بدون جرد فعلي`,
          targetTab: 'summary_log',
        },
        {
          key: 'goldInventoryVerified',
          label: '4. جرد الذهب بالعيار ومطابقة الأوزان الفعلية',
          remainingCount: visitMetrics.daysMissingGoldInventory.length,
          remainingText:
            visitMetrics.daysMissingGoldInventory.length === 0
              ? 'مكتمل'
              : `${visitMetrics.daysMissingGoldInventory.length} يوم بدون جرد ذهب`,
          targetTab: 'gold_inventory',
        },
        {
          key: 'debtsMatched',
          label: '5. مطابقة المديونيات وحدود الدين ومواعيد السداد',
          remainingCount:
            visitMetrics.exceededDebtCount +
            (Math.abs(visitMetrics.debtSummary.reconciliationDiffCash) > 1 ? 1 : 0),
          remainingText:
            Math.abs(visitMetrics.debtSummary.reconciliationDiffCash) <= 1
              ? `متجاوز للحد: ${visitMetrics.exceededDebtCount}`
              : 'يوجد فرق مطابقة مديونيات!',
          targetTab: 'accounts_expenses',
        },
        {
          key: 'advancesReviewed',
          label: '6. مراجعة السلف والمرتبات وصافي مستحقات العمال',
          remainingCount: visitMetrics.allIssues.filter(
            (i) => i.checkType === 'worker_advance' && !issueReviews[i.id]?.reviewed
          ).length,
          remainingText: `سلف الفترة: ${formatNumber(visitMetrics.advancesTotal)} ج.م`,
          targetTab: 'accounts_expenses',
        },
        {
          key: 'expensesReviewed',
          label: '7. مراجعة المصاريف اليومية والتكرار',
          remainingCount: visitMetrics.allIssues.filter(
            (i) => i.checkType === 'duplicate_expense' && !issueReviews[i.id]?.reviewed
          ).length,
          remainingText: `مصاريف الفترة: ${formatNumber(visitMetrics.expensesTotal)} ج.م`,
          targetTab: 'accounts_expenses',
        },
      ]
    : [];

  const highProgressPct = useMemo(() => {
    if (!visitMetrics || visitMetrics.highIssues.length === 0) return 100;
    const reviewed = visitMetrics.highIssues.length - visitMetrics.unreviewedHighIssues.length;
    return Math.round((reviewed / visitMetrics.highIssues.length) * 100);
  }, [visitMetrics]);

  const compareVisitA = auditVisits.find((v) => v.id === compareVisitAId);
  const compareVisitB = auditVisits.find((v) => v.id === compareVisitBId);

  return (
    <div className="space-y-5 pb-12">
      {/* Top Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              زيارة المراجعة والتقرير النهائي الشامل
            </h2>
            <p className="text-xs text-slate-500">
              قائمة فحص تفاعلية خطوة بخطوة، إصدار التقرير الرسمي، وقفل أيام الزيارة
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubMode('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
              subMode === 'active'
                ? 'bg-slate-900 text-amber-400'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            الزيارة الحالية والتقرير
          </button>
          <button
            type="button"
            onClick={() => setSubMode('history')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              subMode === 'history'
                ? 'bg-slate-900 text-amber-400'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            الزيارات السابقة ({auditVisits.length})
          </button>
          <button
            type="button"
            onClick={() => setSubMode('compare')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              subMode === 'compare'
                ? 'bg-slate-900 text-amber-400'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            مقارنة زيارتين
          </button>

          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            زيارة جديدة
          </button>
        </div>
      </div>

      {/* SUBMODE: HISTORY */}
      {subMode === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 no-print">
          <h3 className="text-sm font-bold text-slate-900">سجل زيارات المراجعة</h3>
          {auditVisits.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              لم يتم إنشاء أي زيارة مراجعة بعد. اضغط على "زيارة جديدة" للبدء.
            </p>
          ) : (
            <div className="divide-y divide-slate-200">
              {[...auditVisits].reverse().map((v) => (
                <div
                  key={v.id}
                  className="py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900">{v.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          v.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {v.status === 'completed' ? 'مكتملة ومقفولة' : 'قيد المراجعة'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      الفترة: {v.fromDate} إلى {v.toDate}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveVisitId(v.id);
                        setSubMode('active');
                      }}
                      className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-900 cursor-pointer"
                    >
                      فتح التقرير والتفاصيل
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBMODE: COMPARE TWO VISITS */}
      {subMode === 'compare' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-4 no-print">
          <h3 className="text-sm font-bold text-slate-900">
            مقارنة بين زيارتين (تغير العجز، المديونيات، وعدد الاشتباهات)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                الزيارة الأولى (الأقدم):
              </label>
              <select
                value={compareVisitAId}
                onChange={(e) => setCompareVisitAId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white"
              >
                <option value="">— اختر الزيارة الأولى —</option>
                {auditVisits.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.fromDate} إلى {v.toDate})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                الزيارة الثانية (الأحدث):
              </label>
              <select
                value={compareVisitBId}
                onChange={(e) => setCompareVisitBId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white"
              >
                <option value="">— اختر الزيارة الثانية —</option>
                {auditVisits.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.fromDate} إلى {v.toDate})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {compareVisitA?.summarySnapshot && compareVisitB?.summarySnapshot ? (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="py-2.5 px-3">البند</th>
                    <th className="py-2.5 px-3">{compareVisitA.name}</th>
                    <th className="py-2.5 px-3">{compareVisitB.name}</th>
                    <th className="py-2.5 px-3">التغير (الفرق)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {[
                    {
                      label: 'إجمالي المبيعات (ج.م)',
                      a: compareVisitA.summarySnapshot.sellTotal,
                      b: compareVisitB.summarySnapshot.sellTotal,
                    },
                    {
                      label: 'إجمالي المشتريات (ج.م)',
                      a: compareVisitA.summarySnapshot.buyTotal,
                      b: compareVisitB.summarySnapshot.buyTotal,
                    },
                    {
                      label: 'فرق جرد الخزنة النقدية (ج.م)',
                      a: compareVisitA.summarySnapshot.netSafeDiff,
                      b: compareVisitB.summarySnapshot.netSafeDiff,
                    },
                    {
                      label: 'فرق جرد الذهب (جرام مكافئ 21)',
                      a: compareVisitA.summarySnapshot.netGoldDiff21EqG,
                      b: compareVisitB.summarySnapshot.netGoldDiff21EqG,
                      isWeight: true,
                    },
                    {
                      label: 'إجمالي المديونيات على العملاء (ج.م)',
                      a: compareVisitA.summarySnapshot.totalDebtsOwesUs,
                      b: compareVisitB.summarySnapshot.totalDebtsOwesUs,
                    },
                    {
                      label: 'المديونيات المتأخرة (ج.م)',
                      a: compareVisitA.summarySnapshot.totalDebtsOverdue,
                      b: compareVisitB.summarySnapshot.totalDebtsOverdue,
                    },
                    {
                      label: 'عدد الاشتباهات عالية الخطورة',
                      a: compareVisitA.summarySnapshot.highIssuesCount,
                      b: compareVisitB.summarySnapshot.highIssuesCount,
                    },
                  ].map((row, idx) => {
                    const diff = row.b - row.a;
                    return (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-bold text-slate-800">{row.label}</td>
                        <td className="py-2 px-3 font-mono">
                          {row.isWeight ? formatWeight(row.a) : formatNumber(row.a)}
                        </td>
                        <td className="py-2 px-3 font-mono">
                          {row.isWeight ? formatWeight(row.b) : formatNumber(row.b)}
                        </td>
                        <td
                          className={`py-2 px-3 font-mono font-bold ${
                            diff > 0
                              ? 'text-amber-700'
                              : diff < 0
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {diff > 0 ? '+' : ''}
                          {row.isWeight ? formatWeight(diff) : formatNumber(diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-4">
              اختر زيارتين مكتملتين لعرض جدول المقارنة التفصيلي.
            </p>
          )}
        </div>
      )}

      {/* SUBMODE: ACTIVE VISIT & REPORT */}
      {subMode === 'active' && !activeVisit && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3 no-print">
          <ClipboardCheck className="w-10 h-10 text-amber-600 mx-auto" />
          <h3 className="text-base font-bold text-slate-900">لا توجد زيارة مراجعة نشطة حالياً</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            ابدأ زيارة مراجعة جديدة لتحديد الفترة الزمنية ومتابعة خطوات الفحص السبع وإصدار التقرير الرسمي الشامل.
          </p>
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            بدء زيارة مراجعة جديدة
          </button>
        </div>
      )}

      {subMode === 'active' && activeVisit && visitMetrics && (
        <>
          {/* Interactive Checklist & Progress (No Print) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 no-print">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div>
                  <span className="text-sm font-bold text-slate-900">{activeVisit.name}</span>
                  <span className="text-xs text-slate-500 mr-2 font-mono">
                    ({activeVisit.fromDate} إلى {activeVisit.toDate})
                  </span>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                    activeVisit.status === 'completed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {activeVisit.status === 'completed' ? 'زيارة مكتملة' : 'زيارة جارية'}
                </span>
              </div>

              {/* High severity progress bar */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="flex justify-between text-xs font-bold mb-1.5">
                  <span className="text-slate-700">
                    شريط تقدم مراجعة الاشتباهات عالية الخطورة:
                  </span>
                  <span
                    className={
                      visitMetrics.unreviewedHighIssues.length === 0
                        ? 'text-emerald-700'
                        : 'text-red-600'
                    }
                  >
                    {visitMetrics.unreviewedHighIssues.length === 0
                      ? 'تمت مراجعة جميع الاشتباهات العالية (100%)'
                      : `متبقي ${visitMetrics.unreviewedHighIssues.length} من ${visitMetrics.highIssues.length} غير مراجع (${highProgressPct}%)`}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      highProgressPct === 100 ? 'bg-emerald-600' : 'bg-amber-500'
                    }`}
                    style={{ width: `${highProgressPct}%` }}
                  />
                </div>
              </div>

              {/* 7-Step Checklist */}
              <div className="divide-y divide-slate-100">
                {checklistItems.map((item) => {
                  const checked = activeVisit.checklist[item.key];
                  return (
                    <div
                      key={item.key}
                      className="py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 px-2 rounded"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          updateAuditVisitChecklist(activeVisit.id, {
                            [item.key]: !checked,
                          })
                        }
                        className="flex items-center gap-2.5 text-right flex-1 cursor-pointer"
                      >
                        {checked ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <Circle className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <span
                          className={`text-xs font-bold ${
                            checked ? 'line-through text-slate-400' : 'text-slate-800'
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>

                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            item.remainingCount === 0
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {item.remainingText}
                        </span>
                        <button
                          type="button"
                          onClick={() => onNavigateTab(item.targetTab)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          فتح الشاشة
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recommendations & Complete Action */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-800">
                  توصيات المراجع الختامية (تظهر في التقرير النهائي):
                </label>
                <textarea
                  rows={6}
                  value={activeVisit.recommendations || ''}
                  onChange={(e) =>
                    updateAuditVisit(activeVisit.id, { recommendations: e.target.value })
                  }
                  placeholder="اكتب ملاحظاتك وتوصياتك لصاحب المحل حول الجرد، المديونيات، أو التزام البائعين بالأسعار..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex-1 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    طباعة التقرير A4
                  </button>
                  <button
                    type="button"
                    onClick={handleSavePdf}
                    className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    حفظ التقرير PDF
                  </button>
                </div>

                {activeVisit.status !== 'completed' && (
                  <button
                    type="button"
                    onClick={() => setConfirmCompleteModal(true)}
                    className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    إنهاء الزيارة وقفل أيام الفترة وإصدار التقرير
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ===================================================================
              PRINTABLE MULTI-SECTION FINAL AUDIT REPORT (A4 / PDF)
             =================================================================== */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6 print:border-0 print:shadow-none print:p-0">
            {/* 1. Report Cover Header */}
            <div className="border-b-2 border-slate-900 pb-4 flex flex-wrap justify-between items-start gap-4">
              <div>
                <div className="text-xs font-bold text-amber-700 uppercase">
                  تقرير زيارة مراجعة رسمي شامل
                </div>
                <h1 className="text-xl font-bold text-slate-900 mt-0.5">
                  {settings.shopName || 'محل الذهب'} — {activeVisit.name}
                </h1>
                <p className="text-xs text-slate-600 mt-1">
                  الفترة من: <strong className="font-mono">{activeVisit.fromDate}</strong> إلى:{' '}
                  <strong className="font-mono">{activeVisit.toDate}</strong> (
                  {visitMetrics.sortedDates.length} يوم عمل)
                </p>
              </div>
              <div className="text-xs text-left space-y-0.5 bg-slate-50 border border-slate-200 rounded p-2.5">
                <div>
                  <strong>اسم المراجع:</strong> {settings.auditorName || 'المراجع المالي'}
                </div>
                <div>
                  <strong>تاريخ التقرير:</strong> {new Date().toLocaleDateString('ar-EG')}
                </div>
                <div>
                  <strong>حالة الزيارة:</strong>{' '}
                  {activeVisit.status === 'completed' ? 'معتمدة ومقفولة' : 'مسودة مراجعة'}
                </div>
              </div>
            </div>

            {/* 2. Executive Summary */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2.5 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-amber-600" />
                أولاً: الملخص التنفيذي لحركة الفترة
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 text-xs">
                <div className="border border-slate-200 rounded p-2.5 bg-slate-50">
                  <div className="text-slate-500">إجمالي المبيعات</div>
                  <div className="font-mono font-bold text-sm text-emerald-700 mt-0.5">
                    {formatNumber(visitMetrics.sellTotal)} ج.م
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    ({formatWeight(visitMetrics.sellG)} جرام)
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-2.5 bg-slate-50">
                  <div className="text-slate-500">إجمالي المشتريات</div>
                  <div className="font-mono font-bold text-sm text-amber-700 mt-0.5">
                    {formatNumber(visitMetrics.buyTotal)} ج.م
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    ({formatWeight(visitMetrics.buyG)} جرام)
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-2.5 bg-slate-50">
                  <div className="text-slate-500">إجمالي المصاريف</div>
                  <div className="font-mono font-bold text-sm text-slate-800 mt-0.5">
                    {formatNumber(visitMetrics.expensesTotal)} ج.م
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-2.5 bg-slate-50">
                  <div className="text-slate-500">سلف العمال</div>
                  <div className="font-mono font-bold text-sm text-slate-800 mt-0.5">
                    {formatNumber(visitMetrics.advancesTotal)} ج.م
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-2.5 bg-slate-50">
                  <div className="text-slate-500">فروق جرد الخزنة</div>
                  <div
                    className={`font-mono font-bold text-sm mt-0.5 ${
                      visitMetrics.netSafeDiff < 0 ? 'text-red-700' : 'text-slate-800'
                    }`}
                  >
                    {formatNumber(visitMetrics.netSafeDiff)} ج.م
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-2.5 bg-slate-50">
                  <div className="text-slate-500">فروق جرد الذهب (21)</div>
                  <div
                    className={`font-mono font-bold text-sm mt-0.5 ${
                      visitMetrics.netGoldDiff21EqG < -0.01 ? 'text-red-700' : 'text-slate-800'
                    }`}
                  >
                    {formatWeight(visitMetrics.netGoldDiff21EqG)} جرام
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Top 20 Issues & Price Anomalies */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                <AlertOctagon className="w-4 h-4 text-red-600" />
                ثانياً: أهم الاشتباهات ومخالفات أسعار البيع والشراء (أعلى 20 اشتباهاً)
              </h3>
              {visitMetrics.allIssues.length === 0 ? (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3">
                  لا توجد اشتباهات مسجلة في هذه الفترة.
                </p>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-100 text-slate-800 border-b border-slate-200">
                      <tr>
                        <th className="py-1.5 px-2.5">التاريخ</th>
                        <th className="py-1.5 px-2.5">الخطورة</th>
                        <th className="py-1.5 px-2.5">نوع الفحص والتفاصيل</th>
                        <th className="py-1.5 px-2.5">الفرق</th>
                        <th className="py-1.5 px-2.5">حالة المراجعة وملاحظة المراجع</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {visitMetrics.allIssues.slice(0, 20).map((iss) => {
                        const rev = issueReviews[iss.id];
                        return (
                          <tr key={iss.id}>
                            <td className="py-1.5 px-2.5 font-mono whitespace-nowrap">
                              {iss.date}
                            </td>
                            <td className="py-1.5 px-2.5 font-bold">
                              {iss.severity === 'high'
                                ? 'عالية'
                                : iss.severity === 'medium'
                                ? 'متوسطة'
                                : 'منخفضة'}
                            </td>
                            <td className="py-1.5 px-2.5">
                              <div className="font-bold text-slate-900">{iss.checkTitle}</div>
                              <div className="text-[11px] text-slate-600">{iss.message}</div>
                            </td>
                            <td className="py-1.5 px-2.5 font-mono font-bold text-red-700">
                              {iss.difference || '—'}
                            </td>
                            <td className="py-1.5 px-2.5">
                              <span className="font-bold">
                                {rev?.reviewed ? 'تمت المراجعة ✓' : 'غير مراجع'}
                              </span>
                              {rev?.note && (
                                <div className="text-[11px] text-slate-600 mt-0.5">
                                  ({rev.note})
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 4. Debt Aging & Exceeded Limits */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-amber-700" />
                ثالثاً: كشف المديونيات وأعمار الديون وتجاوز الحدود
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs mb-2">
                <div className="border border-slate-200 rounded p-2">
                  <span className="text-slate-500">إجمالي لنا عند العملاء:</span>
                  <div className="font-mono font-bold text-red-700">
                    {formatNumber(visitMetrics.debtSummary.totalOwesUsCash)} ج.م
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-2">
                  <span className="text-slate-500">0 - 30 يوماً:</span>
                  <div className="font-mono font-bold">
                    {formatNumber(visitMetrics.debtSummary.agingBuckets['0-30'].cashTotal)} ج.م
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-2">
                  <span className="text-slate-500">31 - 60 يوماً:</span>
                  <div className="font-mono font-bold">
                    {formatNumber(visitMetrics.debtSummary.agingBuckets['31-60'].cashTotal)} ج.م
                  </div>
                </div>
                <div className="border border-slate-200 rounded p-2">
                  <span className="text-slate-500">61 - 90 يوماً:</span>
                  <div className="font-mono font-bold text-amber-700">
                    {formatNumber(visitMetrics.debtSummary.agingBuckets['61-90'].cashTotal)} ج.م
                  </div>
                </div>
                <div className="border border-red-200 bg-red-50 rounded p-2">
                  <span className="text-red-700">أكثر من 90 يوماً:</span>
                  <div className="font-mono font-bold text-red-800">
                    {formatNumber(visitMetrics.debtSummary.agingBuckets['90+'].cashTotal)} ج.م
                  </div>
                </div>
              </div>
            </div>

            {/* 5. Auditor Recommendations & Dual Signatures */}
            <div className="border-t border-slate-200 pt-4 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-slate-700" />
                  رابعاً: توصيات المراجع الختامية
                </h3>
                <div className="border border-slate-200 rounded p-3 bg-slate-50 text-xs text-slate-800 whitespace-pre-wrap min-h-[60px]">
                  {activeVisit.recommendations || 'لا توجد توصيات إضافية مسجلة.'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-12 pt-6">
                <div>
                  <p className="text-xs font-bold text-slate-800 mb-8">
                    توقيع المراجع ({settings.auditorName || 'المراجع المالي'}):
                  </p>
                  <div className="border-b border-dashed border-slate-500 w-52" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800 mb-8">
                    توقيع صاحب المحل بالاطلاع والاستلام:
                  </p>
                  <div className="border-b border-dashed border-slate-500 w-52" />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* MODAL: Create New Visit */}
      {showNewModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">بدء زيارة مراجعة جديدة</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم الزيارة:</label>
                <input
                  type="text"
                  value={newVisitName}
                  onChange={(e) => setNewVisitName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">من تاريخ:</label>
                  <input
                    type="date"
                    value={newFromDate}
                    onChange={(e) => setNewFromDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">إلى تاريخ:</label>
                  <input
                    type="date"
                    value={newToDate}
                    onChange={(e) => setNewToDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات مبدئية:</label>
                <textarea
                  rows={2}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleCreateVisit}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
              >
                بدء الزيارة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Confirm Complete & Lock Period */}
      {confirmCompleteModal && activeVisit && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Lock className="w-5 h-5 text-emerald-700" />
              تأكيد إنهاء الزيارة وقفل أيام الفترة
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              هل أنت متأكد من إنهاء <strong>{activeVisit.name}</strong>؟ سيقوم البرنامج بقفل جميع الأيام
              المسجلة بين <strong className="font-mono">{activeVisit.fromDate}</strong> و{' '}
              <strong className="font-mono">{activeVisit.toDate}</strong> لمنع التعديل اللاحق بدون إذن، وحفظ
              لقطة رسمية من التقرير في مجلد الزيارات.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmCompleteModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={handleCompleteVisit}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
              >
                تأكيد الإنهاء والقفل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
