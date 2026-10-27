import React, { useState, useMemo } from 'react';
import {
  ClipboardCheck,
  History,
  FileText,
  Lock,
  Unlock,
  Printer,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Users,
  ArrowLeftRight,
  Award,
  BarChart3,
  Download,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  BarChart,
} from 'recharts';
import { useAuditStore } from '../store/useAuditStore';
import { runAllAuditChecks } from '../utils/checks';
import { computeDaySafeSummary } from '../utils/checks/checkDailySafe';
import {
  computePersonBalancesSummary,
  PersonComputedBalance,
} from '../utils/checks/checkPersonBalances';
import { addDaysLocalIso, formatNumber, formatWeight } from '../utils/numerals';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';

export const DaySummaryAndLogScreen: React.FC = () => {
  const {
    currentDate,
    operations,
    daysMap,
    persons,
    workers,
    auditLogs,
    settings,
    setCurrentDate,
    updateDayChecklist,
    toggleDayLock,
    updateSettings,
  } = useAuditStore();

  const [subTab, setSubTab] = useState<
    'summary' | 'audit_log' | 'monthly_report' | 'period_compare' | 'top_10'
  >('summary');

  // Audit Log Filters
  const [logDateFilter, setLogDateFilter] = useState('');
  const [logActionFilter, setLogActionFilter] = useState('all');
  const [logSearch, setLogSearch] = useState('');

  // Monthly Report Month
  const [reportMonth, setReportMonth] = useState(() => currentDate.slice(0, 7));
  const [pdfFeedback, setPdfFeedback] = useState<string | null>(null);

  // Period Comparison state (F8.2)
  const [periodAStart, setPeriodAStart] = useState(() => addDaysLocalIso(currentDate, -13));
  const [periodAEnd, setPeriodAEnd] = useState(() => addDaysLocalIso(currentDate, -7));
  const [periodBStart, setPeriodBStart] = useState(() => addDaysLocalIso(currentDate, -6));
  const [periodBEnd, setPeriodBEnd] = useState(() => currentDate);

  // Top 10 sort metric (F8.3)
  const [topMetric, setTopMetric] = useState<'total' | 'weightG'>('total');

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

  // Person summaries for Top 10 Debtors & Total Overdue (F2.5)
  const personReconciliation = useMemo(
    () => computePersonBalancesSummary(operations, persons, currentDate),
    [operations, persons, currentDate]
  );

  const debtOverview = useMemo(() => {
    const allComputed: PersonComputedBalance[] = Array.from(personReconciliation.map.values());
    const debtors = allComputed
      .filter((p) => p.cashBalance > 0 || p.goldBalanceG > 0.005)
      .sort((a, b) => b.cashBalance - a.cashBalance);
    const top10Debtors = debtors.slice(0, 10);
    const overLimitCount = debtors.filter((p) => p.exceededAnyLimit).length;
    return {
      top10Debtors,
      totalOverdueCash: personReconciliation.totalOverdueCash,
      totalDebtCash: personReconciliation.totalOwesUsCash,
      overLimitCount,
    };
  }, [personReconciliation]);

  // Compute Risk Score (0-100), 30-second summary, and Profit Margin per gram for every day (Prompt 5 & F8.4)
  const daysRiskAnalysis = useMemo(() => {
    const allDates = Array.from(
      new Set([
        ...Object.keys(daysMap),
        ...operations.map((o) => o.date),
      ])
    )
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();

    const baseDays = allDates.map((d) => {
      const info = daysMap[d];
      const dayOps = operations.filter((o) => o.date === d);
      const dayIssues = auditResult.issues.filter((i) => i.date === d);

      let buyCount = 0,
        sellCount = 0,
        buyG = 0,
        sellG = 0,
        buyTotal = 0,
        sellTotal = 0,
        buy21G = 0,
        buy21Total = 0,
        sell21G = 0,
        sell21Total = 0;

      for (const op of dayOps) {
        if (op.kind === 'buy') {
          buyCount++;
          buyG += op.weightG;
          buyTotal += op.total;
          if ((op.karat || 21) === 21) {
            buy21G += op.weightG;
            buy21Total += op.total;
          }
        } else if (op.kind === 'sell') {
          sellCount++;
          sellG += op.weightG;
          sellTotal += op.total;
          if ((op.karat || 21) === 21) {
            sell21G += op.weightG;
            sell21Total += op.total;
          }
        }
      }

      const avgBuyGram = buy21G > 0 ? buy21Total / buy21G : buyG > 0 ? buyTotal / buyG : 0;
      const avgSellGram = sell21G > 0 ? sell21Total / sell21G : sellG > 0 ? sellTotal / sellG : 0;
      const profitMarginPerGram =
        avgBuyGram > 0 && avgSellGram > 0 ? avgSellGram - avgBuyGram : 0;

      const safeSummary = computeDaySafeSummary(d, operations, info);
      const cashIn = safeSummary.cashSales + safeSummary.personReceived;
      const cashOut =
        safeSummary.cashPurchases +
        safeSummary.expenses +
        safeSummary.advances +
        safeSummary.personGiven;

      const expectedGoldG = (info?.openingBalanceG ?? 0) + buyG - sellG;
      const hasGoldActual =
        info?.closingBalanceG !== undefined && info?.closingBalanceG !== null;
      const goldDiffG = hasGoldActual ? info!.closingBalanceG! - expectedGoldG : 0;

      const highCount = dayIssues.filter((i) => i.severity === 'high').length;
      const medCount = dayIssues.filter((i) => i.severity === 'medium').length;
      const lowCount = dayIssues.filter((i) => i.severity === 'low').length;

      let riskScore = 0;
      if (safeSummary.hasActual && Math.abs(safeSummary.difference) > settings.cashDiscrepancyThreshold) {
        riskScore += 25;
      }
      if (hasGoldActual && Math.abs(goldDiffG) > settings.goldBalanceToleranceG) {
        riskScore += 25;
      }
      riskScore += Math.min(35, highCount * 15 + medCount * 7 + lowCount * 2);
      const lateEditsCount = auditLogs.filter(
        (l) => l.date === d && (l.action === 'edit' || l.action === 'delete' || l.action === 'unlock')
      ).length;
      riskScore += Math.min(15, lateEditsCount * 8);
      riskScore = Math.min(100, riskScore);

      return {
        date: d,
        info,
        buyCount,
        sellCount,
        buyG,
        sellG,
        netG: buyG - sellG,
        buyTotal,
        sellTotal,
        avgBuyGram,
        avgSellGram,
        profitMarginPerGram,
        weeklyAvgMargin: 0,
        marginDropAlert: false,
        marginDropPct: 0,
        cashIn,
        cashOut,
        safeSummary,
        expectedGoldG,
        hasGoldActual,
        goldDiffG,
        highCount,
        medCount,
        lowCount,
        riskScore,
      };
    });

    // F8.4: Compute rolling 7-day average profit margin & >30% drop alert
    return baseDays.map((dayItem, idx) => {
      const windowSlice = baseDays
        .slice(Math.max(0, idx - 6), idx + 1)
        .filter((x) => x.profitMarginPerGram > 0);
      const weeklyAvgMargin =
        windowSlice.length > 0
          ? windowSlice.reduce((s, x) => s + x.profitMarginPerGram, 0) / windowSlice.length
          : 0;
      let marginDropAlert = false;
      let marginDropPct = 0;
      if (weeklyAvgMargin > 0 && dayItem.profitMarginPerGram !== 0 && windowSlice.length >= 2) {
        marginDropPct = ((weeklyAvgMargin - dayItem.profitMarginPerGram) / weeklyAvgMargin) * 100;
        if (marginDropPct > 30) {
          marginDropAlert = true;
        }
      }
      return {
        ...dayItem,
        weeklyAvgMargin,
        marginDropAlert,
        marginDropPct,
      };
    });
  }, [daysMap, operations, auditResult.issues, auditLogs, settings]);

  const sortedByRisk = useMemo(
    () => [...daysRiskAnalysis].sort((a, b) => b.riskScore - a.riskScore),
    [daysRiskAnalysis]
  );

  const selectedDayAnalysis =
    daysRiskAnalysis.find((d) => d.date === currentDate) ||
    daysRiskAnalysis[daysRiskAnalysis.length - 1];

  const currentChecklist = daysMap[currentDate]?.checklist || {
    cashVerified: false,
    balancesMatched: false,
    advancesChecked: false,
    debtsChecked: false,
    goldInventoryChecked: false,
  };

  // Filtered Audit Logs
  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (logDateFilter && l.date !== logDateFilter) return false;
      if (logActionFilter !== 'all' && l.action !== logActionFilter) return false;
      if (q) {
        const hay = `${l.description} ${l.oldValue || ''} ${l.newValue || ''} ${
          l.reason || ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [auditLogs, logDateFilter, logActionFilter, logSearch]);

  const exportAuditLogsExcel = () => {
    const wb = XLSX.utils.book_new();
    const rows = filteredLogs.map((l) => ({
      الوقت: new Date(l.timestamp).toLocaleString('ar-EG'),
      الإجراء: l.action,
      تاريخ_العملية: l.date,
      الوصف: l.description,
      القيمة_القديمة: l.oldValue || '',
      القيمة_الجديدة: l.newValue || '',
      السبب: l.reason || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'سجل التعديلات');
    XLSX.writeFile(wb, `سجل-التعديلات-${currentDate}.xlsx`);
  };

  // Monthly One-Page Report Data (F8.1 & F8.5)
  const monthlyReportData = useMemo(() => {
    const monthOps = operations.filter((o) => o.date.startsWith(reportMonth));
    let buyG = 0,
      buyTotal = 0,
      sellG = 0,
      sellTotal = 0,
      advancesTotal = 0;
    const expensesByCat: Record<string, number> = {};

    const byKarat: Record<
      string,
      { karatLabel: string; sellG: number; sellTotal: number; buyG: number; buyTotal: number }
    > = {
      '18': { karatLabel: 'عيار 18', sellG: 0, sellTotal: 0, buyG: 0, buyTotal: 0 },
      '21': { karatLabel: 'عيار 21', sellG: 0, sellTotal: 0, buyG: 0, buyTotal: 0 },
      '24': { karatLabel: 'عيار 24', sellG: 0, sellTotal: 0, buyG: 0, buyTotal: 0 },
      other: { karatLabel: 'عيار آخر', sellG: 0, sellTotal: 0, buyG: 0, buyTotal: 0 },
    };

    for (const op of monthOps) {
      const kKey = String(op.karat || 21);
      const bucket = byKarat[kKey] || byKarat.other;
      if (op.kind === 'buy') {
        buyG += op.weightG;
        buyTotal += op.total;
        bucket.buyG += op.weightG;
        bucket.buyTotal += op.total;
      } else if (op.kind === 'sell') {
        sellG += op.weightG;
        sellTotal += op.total;
        bucket.sellG += op.weightG;
        bucket.sellTotal += op.total;
      } else if (op.kind === 'expense') {
        const cat = op.category || op.item || 'أخرى';
        expensesByCat[cat] = (expensesByCat[cat] || 0) + op.total;
      } else if (op.kind === 'advance') {
        advancesTotal += op.total;
      }
    }

    const totalSalaries = workers.reduce((s, w) => s + w.monthlySalary, 0);
    const totalExpenses = Object.values(expensesByCat).reduce((a, b) => a + b, 0);

    const owesUs = personReconciliation.totalOwesUsCash;
    const weOwe = personReconciliation.totalWeOweCash;

    const monthDays = daysRiskAnalysis.filter((d) => d.date.startsWith(reportMonth));
    const netSafeDiff = monthDays.reduce(
      (s, d) => s + (d.safeSummary.hasActual ? d.safeSummary.difference : 0),
      0
    );
    const netGoldDiffG = monthDays.reduce(
      (s, d) => s + (d.hasGoldActual ? d.goldDiffG : 0),
      0
    );

    const top10Issues = auditResult.issues
      .filter((i) => i.date.startsWith(reportMonth) || i.date === '-')
      .slice(0, 10);

    const chartDailyData = monthDays.map((d) => ({
      date: d.date.slice(5),
      سعر_اليوم: d.info?.goldPricePerGram || 0,
      متوسط_البيع: Math.round(d.avgSellGram),
      متوسط_الشراء: Math.round(d.avgBuyGram),
      جرامات_بيع: Number(d.sellG.toFixed(2)),
      جرامات_شراء: Number(d.buyG.toFixed(2)),
    }));

    const expensesChartData = Object.entries(expensesByCat).map(([name, value]) => ({
      name,
      المبلغ: value,
    }));

    return {
      buyG,
      buyTotal,
      sellG,
      sellTotal,
      netCashFlow: sellTotal - buyTotal - totalExpenses - advancesTotal,
      netGoldG: buyG - sellG,
      byKarat: Object.values(byKarat),
      expensesByCat,
      totalExpenses,
      totalSalaries,
      advancesTotal,
      owesUs,
      weOwe,
      overdueDebtCash: debtOverview.totalOverdueCash,
      netSafeDiff,
      netGoldDiffG,
      top10Issues,
      chartDailyData,
      expensesChartData,
    };
  }, [
    operations,
    workers,
    personReconciliation,
    debtOverview.totalOverdueCash,
    daysRiskAnalysis,
    auditResult.issues,
    reportMonth,
  ]);

  // Period Comparison calculation (F8.2)
  const periodComparison = useMemo(() => {
    const calcRange = (start: string, end: string) => {
      const ops = operations.filter((o) => o.date >= start && o.date <= end);
      let sellG = 0,
        sellTotal = 0,
        buyG = 0,
        buyTotal = 0,
        expenses = 0,
        advances = 0;
      for (const op of ops) {
        if (op.kind === 'sell') {
          sellG += op.weightG;
          sellTotal += op.total;
        } else if (op.kind === 'buy') {
          buyG += op.weightG;
          buyTotal += op.total;
        } else if (op.kind === 'expense') {
          expenses += op.total;
        } else if (op.kind === 'advance') {
          advances += op.total;
        }
      }
      const avgSell = sellG > 0 ? sellTotal / sellG : 0;
      const avgBuy = buyG > 0 ? buyTotal / buyG : 0;
      const margin = avgSell > 0 && avgBuy > 0 ? avgSell - avgBuy : 0;
      const issuesCount = auditResult.issues.filter(
        (i) => i.date >= start && i.date <= end
      ).length;
      return { sellG, sellTotal, buyG, buyTotal, expenses, advances, margin, issuesCount };
    };

    const a = calcRange(periodAStart, periodAEnd);
    const b = calcRange(periodBStart, periodBEnd);
    const pct = (prev: number, curr: number) =>
      prev === 0 ? (curr > 0 ? 100 : 0) : ((curr - prev) / Math.abs(prev)) * 100;

    return {
      a,
      b,
      diffs: [
        {
          label: 'المبيعات بالجرام',
          valA: `${formatWeight(a.sellG)} ج`,
          valB: `${formatWeight(b.sellG)} ج`,
          changePct: pct(a.sellG, b.sellG),
          positiveIsGood: true,
        },
        {
          label: 'المبيعات بالجنيه',
          valA: `${formatNumber(a.sellTotal)} ج.م`,
          valB: `${formatNumber(b.sellTotal)} ج.م`,
          changePct: pct(a.sellTotal, b.sellTotal),
          positiveIsGood: true,
        },
        {
          label: 'المشتريات بالجرام',
          valA: `${formatWeight(a.buyG)} ج`,
          valB: `${formatWeight(b.buyG)} ج`,
          changePct: pct(a.buyG, b.buyG),
          positiveIsGood: true,
        },
        {
          label: 'المشتريات بالجنيه',
          valA: `${formatNumber(a.buyTotal)} ج.م`,
          valB: `${formatNumber(b.buyTotal)} ج.م`,
          changePct: pct(a.buyTotal, b.buyTotal),
          positiveIsGood: true,
        },
        {
          label: 'هامش ربح الجرام',
          valA: `${formatNumber(a.margin, 0)} ج.م/ج`,
          valB: `${formatNumber(b.margin, 0)} ج.م/ج`,
          changePct: pct(a.margin, b.margin),
          positiveIsGood: true,
        },
        {
          label: 'إجمالي المصروفات',
          valA: `${formatNumber(a.expenses)} ج.م`,
          valB: `${formatNumber(b.expenses)} ج.م`,
          changePct: pct(a.expenses, b.expenses),
          positiveIsGood: false,
        },
        {
          label: 'سلف العمال',
          valA: `${formatNumber(a.advances)} ج.م`,
          valB: `${formatNumber(b.advances)} ج.م`,
          changePct: pct(a.advances, b.advances),
          positiveIsGood: false,
        },
        {
          label: 'عدد الاشتباهات المسجلة',
          valA: `${a.issuesCount} اشتباه`,
          valB: `${b.issuesCount} اشتباه`,
          changePct: pct(a.issuesCount, b.issuesCount),
          positiveIsGood: false,
        },
      ],
    };
  }, [operations, auditResult.issues, periodAStart, periodAEnd, periodBStart, periodBEnd]);

  // Top 10 / Lowest 10 & Most Sold Items (F8.3)
  const top10Analysis = useMemo(() => {
    const sells = operations.filter((o) => o.kind === 'sell' && o.weightG > 0 && o.total > 0);
    const buys = operations.filter((o) => o.kind === 'buy' && o.weightG > 0 && o.total > 0);

    const top10Sells = [...sells]
      .sort((a, b) => (topMetric === 'total' ? b.total - a.total : b.weightG - a.weightG))
      .slice(0, 10);

    const lowest10SellsByGramPrice = [...sells]
      .sort((a, b) => a.total / a.weightG - b.total / b.weightG)
      .slice(0, 10);

    const top10Buys = [...buys]
      .sort((a, b) => (topMetric === 'total' ? b.total - a.total : b.weightG - a.weightG))
      .slice(0, 10);

    const itemsMap: Record<string, { item: string; count: number; totalG: number; totalEgp: number }> = {};
    for (const op of sells) {
      const name = (op.item || '').trim();
      if (!name) continue;
      if (!itemsMap[name]) {
        itemsMap[name] = { item: name, count: 0, totalG: 0, totalEgp: 0 };
      }
      itemsMap[name].count += 1;
      itemsMap[name].totalG += op.weightG;
      itemsMap[name].totalEgp += op.total;
    }
    const mostSoldItems = Object.values(itemsMap)
      .sort((a, b) => b.count - a.count || b.totalG - a.totalG)
      .slice(0, 10);

    return {
      top10Sells,
      lowest10SellsByGramPrice,
      top10Buys,
      mostSoldItems,
    };
  }, [operations, topMetric]);

  const handleSaveMonthlyPdf = async () => {
    const api = ensureGoldApiBridge();
    const res = await api.print.saveToPdf(`التقرير-الشهري-${reportMonth}.pdf`);
    if (res.ok && res.filePath) {
      setPdfFeedback(`تم حفظ ملف PDF بنجاح: ${res.filePath}`);
      setTimeout(() => setPdfFeedback(null), 4000);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-1.5 border border-slate-200 rounded-xl w-fit no-print">
        <button
          type="button"
          onClick={() => setSubTab('summary')}
          className={`px-3.5 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
            subTab === 'summary'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ClipboardCheck className="w-4 h-4" />
          <span>ملخص اليوم (30 ثانية) والمديونيات</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('monthly_report')}
          className={`px-3.5 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
            subTab === 'monthly_report'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>التقرير الشهري والرسوم البيانية</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('period_compare')}
          className={`px-3.5 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
            subTab === 'period_compare'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>مقارنة بين فترتين</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('top_10')}
          className={`px-3.5 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
            subTab === 'top_10'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Award className="w-4 h-4" />
          <span>أكبر وأقل 10 عمليات والأصناف</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('audit_log')}
          className={`px-3.5 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
            subTab === 'audit_log'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4" />
          <span>سجل التعديلات ({auditLogs.length})</span>
        </button>
      </div>

      {/* SUBTAB 1: 30-SECOND DAY SUMMARY, RISK SCORE, CHECKLIST & TOP 10 DEBTORS (Prompt 5 + F2.5 + F8.4) */}
      {subTab === 'summary' && selectedDayAnalysis && (
        <div className="space-y-6">
          {/* F8.4: Profit Margin >30% Drop Warning Banner */}
          {selectedDayAnalysis.marginDropAlert && (
            <div className="p-3.5 rounded-xl bg-red-50 border-2 border-red-300 text-red-950 flex items-center justify-between gap-3 text-xs font-bold">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                <span>
                  تنبيه انخفاض هامش ربح الجرام: هامش ربح الجرام في يوم {selectedDayAnalysis.date} (
                  {formatNumber(selectedDayAnalysis.profitMarginPerGram, 0)} ج.م/جرام) انخفض بنسبة{' '}
                  {selectedDayAnalysis.marginDropPct.toFixed(0)}% عن المتوسط الأسبوعي (
                  {formatNumber(selectedDayAnalysis.weeklyAvgMargin, 0)} ج.م/جرام)! راجع أسعار البيع والشراء لهذا اليوم.
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Left 8 Cols: 30-Second Day Summary */}
            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-extrabold text-slate-900">
                    ملخص يوم {selectedDayAnalysis.date} (يُقرأ في 30 ثانية)
                  </h2>
                  <input
                    type="date"
                    value={currentDate}
                    onChange={(e) => e.target.value && setCurrentDate(e.target.value)}
                    className="px-2.5 py-1 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <div
                    className={`px-3 py-1.5 rounded-lg font-mono text-xs font-extrabold ${
                      selectedDayAnalysis.riskScore >= 50
                        ? 'bg-red-100 text-red-900 border border-red-300'
                        : selectedDayAnalysis.riskScore >= 20
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    }`}
                  >
                    درجة خطورة اليوم: {selectedDayAnalysis.riskScore} / 100
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      toggleDayLock(
                        selectedDayAnalysis.date,
                        !selectedDayAnalysis.info?.locked,
                        'فتح من شاشة الملخص'
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
                      selectedDayAnalysis.info?.locked
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-900 text-white'
                    }`}
                  >
                    {selectedDayAnalysis.info?.locked ? (
                      <>
                        <Lock className="w-3.5 h-3.5" /> يوم مقفول
                      </>
                    ) : (
                      <>
                        <Unlock className="w-3.5 h-3.5" /> قفل اليوم
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 6 Rapid KPI Boxes */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-slate-500 mb-1">عدد عمليات البيع والشراء</div>
                  <div className="text-base font-extrabold font-mono text-slate-900">
                    {selectedDayAnalysis.sellCount} بيع · {selectedDayAnalysis.buyCount} شراء
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-slate-500 mb-1">صافي الفرق بالجرام</div>
                  <div className="text-base font-extrabold font-mono text-amber-800">
                    {selectedDayAnalysis.netG > 0 ? '+' : ''}
                    {formatWeight(selectedDayAnalysis.netG)} جرام
                  </div>
                  <div className="text-[11px] text-slate-500">
                    شراء {formatWeight(selectedDayAnalysis.buyG)} − بيع{' '}
                    {formatWeight(selectedDayAnalysis.sellG)}
                  </div>
                </div>

                <div
                  className={`p-3.5 rounded-xl border ${
                    selectedDayAnalysis.marginDropAlert
                      ? 'bg-red-50 border-red-300'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-slate-500 mb-1">هامش ربح الجرام (يومي / أسبوعي)</div>
                  <div className="text-base font-extrabold font-mono text-emerald-800">
                    {selectedDayAnalysis.profitMarginPerGram !== 0
                      ? `${formatNumber(selectedDayAnalysis.profitMarginPerGram, 0)} ج.م/جرام`
                      : 'غير متاح'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    أسبوعي: {formatNumber(selectedDayAnalysis.weeklyAvgMargin, 0)} · بيع{' '}
                    {formatNumber(selectedDayAnalysis.avgSellGram, 0)} vs شراء{' '}
                    {formatNumber(selectedDayAnalysis.avgBuyGram, 0)}
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-slate-500 mb-1">الفلوس الداخلة والخارجة</div>
                  <div className="font-mono font-bold text-emerald-700">
                    داخل: +{formatNumber(selectedDayAnalysis.cashIn)} ج.م
                  </div>
                  <div className="font-mono font-bold text-red-700">
                    خارج: −{formatNumber(selectedDayAnalysis.cashOut)} ج.م
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-slate-500 mb-1">حالة الخزنة والجرد</div>
                  <div className="font-mono font-bold text-slate-900">
                    الخزنة:{' '}
                    {selectedDayAnalysis.safeSummary.hasActual
                      ? selectedDayAnalysis.safeSummary.difference === 0
                        ? 'مطابقة ✓'
                        : `${formatNumber(selectedDayAnalysis.safeSummary.difference)} ج.م`
                      : 'لم يُسجل جرد'}
                  </div>
                  <div className="font-mono font-bold text-slate-900">
                    الذهب:{' '}
                    {selectedDayAnalysis.hasGoldActual
                      ? Math.abs(selectedDayAnalysis.goldDiffG) <= 0.01
                        ? 'مطابق ✓'
                        : `${formatWeight(selectedDayAnalysis.goldDiffG)} ج`
                      : 'لم يُسجل جرد'}
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-slate-500 mb-1">الاشتباهات حسب الخطورة</div>
                  <div className="flex items-center gap-2 font-mono font-extrabold text-sm">
                    <span className="text-red-700">{selectedDayAnalysis.highCount} عالي</span>
                    <span>·</span>
                    <span className="text-orange-700">{selectedDayAnalysis.medCount} متوسط</span>
                    <span>·</span>
                    <span className="text-amber-700">{selectedDayAnalysis.lowCount} منخفض</span>
                  </div>
                </div>
              </div>

              {/* F2.5: Top 10 Debtors & Total Overdue Card */}
              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-red-600" />
                    <h3 className="text-xs font-extrabold text-slate-900">
                      أكبر 10 مدينين للمحل ومؤشر الديون المتأخرة
                    </h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-bold">
                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800">
                      إجمالي الديون: {formatNumber(debtOverview.totalDebtCash)} ج.م
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-red-100 text-red-900 border border-red-200">
                      إجمالي المتأخر (+30 يوماً): {formatNumber(debtOverview.totalOverdueCash)} ج.م
                    </span>
                    {debtOverview.overLimitCount > 0 && (
                      <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950">
                        تجاوز السقف: {debtOverview.overLimitCount}
                      </span>
                    )}
                  </div>
                </div>

                {debtOverview.top10Debtors.length === 0 ? (
                  <p className="text-xs text-slate-400">لا توجد مديونيات قائمة على الأشخاص حالياً.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {debtOverview.top10Debtors.map((d, idx) => (
                      <div
                        key={d.personId}
                        className={`p-2.5 rounded-lg border flex items-center justify-between ${
                          d.exceededAnyLimit || d.agreedOverdueDays > 0 || d.debtAgeDays > 30
                            ? 'bg-red-50/70 border-red-200'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div>
                          <div className="font-extrabold text-slate-900">
                            {idx + 1}. {d.person?.name || d.personId}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            فئة العمر: {d.ageBucket} يوم · عمر الدين: {d.debtAgeDays} يوم
                          </div>
                        </div>
                        <div className="text-left font-mono font-extrabold">
                          <div className="text-red-700">{formatNumber(d.cashBalance)} ج.م</div>
                          {d.goldBalanceG > 0.005 && (
                            <div className="text-[11px] text-amber-800">
                              +{formatWeight(d.goldBalanceG)} ج ذهب
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Visit Checklist */}
              <div className="pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-slate-800">
                    قائمة مراجعة اليوم السريعة ({currentChecklist.visitedAt || currentDate})
                  </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  {(
                    [
                      { key: 'cashVerified', label: '1. جرد الخزنة' },
                      { key: 'balancesMatched', label: '2. مطابقة الأرصدة' },
                      { key: 'advancesChecked', label: '3. سلف العمال' },
                      { key: 'debtsChecked', label: '4. ديون الأشخاص' },
                      { key: 'goldInventoryChecked', label: '5. جرد الذهب' },
                    ] as const
                  ).map((item) => (
                    <label
                      key={item.key}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer select-none font-bold transition-colors ${
                        currentChecklist[item.key]
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(currentChecklist[item.key])}
                        onChange={(e) =>
                          updateDayChecklist(currentDate, { [item.key]: e.target.checked })
                        }
                        className="rounded text-emerald-600"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Right 4 Cols: Days Sorted by Highest Risk */}
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <h3 className="text-sm font-bold text-slate-900">
                  ترتيب الأيام بالأخطر (درجة الخطورة من 100)
                </h3>
              </div>
              <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
                {sortedByRisk.map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setCurrentDate(d.date)}
                    className={`w-full text-right px-4 py-3 flex items-center justify-between transition-colors cursor-pointer ${
                      d.date === currentDate ? 'bg-amber-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-mono font-bold text-slate-900 flex items-center gap-1.5">
                        <span>{d.date}</span>
                        {d.info?.locked && <Lock className="w-3 h-3 text-slate-500" />}
                        {d.marginDropAlert && (
                          <span className="px-1.5 py-0.2 bg-red-100 text-red-800 rounded text-[10px]">
                            هبوط هامش!
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        عالي: {d.highCount} · متوسط: {d.medCount} · هامش الجرام:{' '}
                        {formatNumber(d.profitMarginPerGram, 0)} ج.م
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded font-mono text-xs font-extrabold ${
                        d.riskScore >= 50
                          ? 'bg-red-100 text-red-800'
                          : d.riskScore >= 20
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {d.riskScore} / 100
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 2: ONE-PAGE MONTHLY REPORT & CHARTS (F8.1 & F8.5) */}
      {subTab === 'monthly_report' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 no-print">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">اسم المحل</label>
                <input
                  type="text"
                  value={settings.shopName}
                  onChange={(e) => updateSettings({ shopName: e.target.value })}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg font-bold"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">الشهر / الفترة</label>
                <input
                  type="month"
                  value={reportMonth}
                  onChange={(e) => e.target.value && setReportMonth(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">اسم وتوقيع المراجع</label>
                <input
                  type="text"
                  value={settings.auditorName}
                  onChange={(e) => updateSettings({ auditorName: e.target.value })}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg font-bold"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveMonthlyPdf}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-extrabold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>حفظ PDF مباشر</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة التقرير الشهري A4</span>
              </button>
            </div>
          </div>

          {pdfFeedback && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-bold no-print">
              {pdfFeedback}
            </div>
          )}

          {/* Printable One-Page A4 Sheet */}
          <div className="bg-white border border-slate-300 rounded-xl p-6 space-y-5 shadow-xs">
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-4">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">
                  التقرير الشهري الشامل — {settings.shopName || 'محل الذهب'}
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  الفترة: شهر {reportMonth} · تاريخ الإصدار:{' '}
                  {new Date().toLocaleDateString('ar-EG')}
                </p>
              </div>
              <div className="text-left text-xs font-bold text-slate-800">
                <div>المراجع المسؤول: {settings.auditorName}</div>
                <div className="text-slate-500 font-normal mt-1">التوقيع: ........................</div>
              </div>
            </div>

            {/* Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 border border-slate-200 rounded-lg">
                <div className="text-slate-500">إجمالي المبيعات ({reportMonth})</div>
                <div className="text-base font-extrabold font-mono text-amber-800 mt-0.5">
                  {formatWeight(monthlyReportData.sellG)} جرام
                </div>
                <div className="font-mono font-bold text-slate-800">
                  {formatNumber(monthlyReportData.sellTotal)} ج.م
                </div>
              </div>

              <div className="p-3 border border-slate-200 rounded-lg">
                <div className="text-slate-500">إجمالي المشتريات ({reportMonth})</div>
                <div className="text-base font-extrabold font-mono text-teal-800 mt-0.5">
                  {formatWeight(monthlyReportData.buyG)} جرام
                </div>
                <div className="font-mono font-bold text-slate-800">
                  {formatNumber(monthlyReportData.buyTotal)} ج.م
                </div>
              </div>

              <div className="p-3 border border-slate-200 rounded-lg">
                <div className="text-slate-500">المصاريف والمرتبات والسلف</div>
                <div className="font-mono font-bold text-rose-800 mt-0.5">
                  مصاريف: {formatNumber(monthlyReportData.totalExpenses)} ج.م
                </div>
                <div className="font-mono text-slate-700">
                  مرتبات: {formatNumber(monthlyReportData.totalSalaries)} · سلف:{' '}
                  {formatNumber(monthlyReportData.advancesTotal)} ج.م
                </div>
              </div>

              <div className="p-3 border border-slate-200 rounded-lg">
                <div className="text-slate-500">رصيد الأشخاص والديون المتأخرة</div>
                <div className="font-mono font-bold text-red-700 mt-0.5">
                  عليهم لنا: {formatNumber(monthlyReportData.owesUs)} ج.م (متأخر:{' '}
                  {formatNumber(monthlyReportData.overdueDebtCash)})
                </div>
                <div className="font-mono font-bold text-emerald-700">
                  لهم علينا: {formatNumber(monthlyReportData.weOwe)} ج.م
                </div>
              </div>

              <div className="p-3 border border-slate-200 rounded-lg">
                <div className="text-slate-500">فروق جرد الخزنة النقدية</div>
                <div className="text-base font-extrabold font-mono mt-0.5">
                  {monthlyReportData.netSafeDiff === 0
                    ? 'مطابق (0 ج.م)'
                    : `${monthlyReportData.netSafeDiff > 0 ? '+' : ''}${formatNumber(
                        monthlyReportData.netSafeDiff
                      )} ج.م`}
                </div>
              </div>

              <div className="p-3 border border-slate-200 rounded-lg">
                <div className="text-slate-500">فروق جرد الذهب بالجرام</div>
                <div className="text-base font-extrabold font-mono mt-0.5">
                  {Math.abs(monthlyReportData.netGoldDiffG) <= 0.001
                    ? 'مطابق (0.000 ج)'
                    : `${monthlyReportData.netGoldDiffG > 0 ? '+' : ''}${formatWeight(
                        monthlyReportData.netGoldDiffG
                      )} جرام`}
                </div>
              </div>
            </div>

            {/* F8.1: Per-Karat Breakdown Table */}
            <div>
              <h3 className="text-xs font-bold text-slate-900 mb-2">
                تفصيل المبيعات والمشتريات ومتوسط سعر الجرام لكل عيار ({reportMonth}):
              </h3>
              <table className="w-full text-right border-collapse text-xs border border-slate-200">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-bold">
                    <th className="py-1.5 px-2.5">العيار</th>
                    <th className="py-1.5 px-2.5">وزن البيع (ج)</th>
                    <th className="py-1.5 px-2.5">إجمالي البيع (ج.م)</th>
                    <th className="py-1.5 px-2.5">متوسط جرام البيع</th>
                    <th className="py-1.5 px-2.5">وزن الشراء (ج)</th>
                    <th className="py-1.5 px-2.5">إجمالي الشراء (ج.م)</th>
                    <th className="py-1.5 px-2.5">متوسط جرام الشراء</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyReportData.byKarat.map((k) => (
                    <tr key={k.karatLabel} className="border-b border-slate-200 font-mono">
                      <td className="py-1.5 px-2.5 font-sans font-bold">{k.karatLabel}</td>
                      <td className="py-1.5 px-2.5 font-bold text-amber-800">
                        {formatWeight(k.sellG)}
                      </td>
                      <td className="py-1.5 px-2.5">{formatNumber(k.sellTotal)}</td>
                      <td className="py-1.5 px-2.5">
                        {k.sellG > 0 ? formatNumber(Math.round(k.sellTotal / k.sellG)) : '—'}
                      </td>
                      <td className="py-1.5 px-2.5 font-bold text-teal-800">
                        {formatWeight(k.buyG)}
                      </td>
                      <td className="py-1.5 px-2.5">{formatNumber(k.buyTotal)}</td>
                      <td className="py-1.5 px-2.5">
                        {k.buyG > 0 ? formatNumber(Math.round(k.buyTotal / k.buyG)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* F8.5: Interactive Charts (Hidden in print if desired, or cleanly shown) */}
            {monthlyReportData.chartDailyData.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 no-print">
                <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                  <div className="text-xs font-extrabold text-slate-800 mb-3 flex items-center gap-1.5">
                    <BarChart3 className="w-4 h-4 text-amber-600" />
                    <span>منحنى سعر الذهب اليومي مقابل متوسط البيع والشراء الفعلي</span>
                  </div>
                  <div className="h-56 w-full" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={monthlyReportData.chartDailyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line
                          type="monotone"
                          dataKey="سعر_اليوم"
                          stroke="#d97706"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="متوسط_البيع"
                          stroke="#059669"
                          strokeWidth={2}
                        />
                        <Line
                          type="monotone"
                          dataKey="متوسط_الشراء"
                          stroke="#0284c7"
                          strokeWidth={2}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                  <div className="text-xs font-extrabold text-slate-800 mb-3 flex items-center gap-1.5">
                    <BarChart3 className="w-4 h-4 text-teal-600" />
                    <span>حجم المبيعات والمشتريات اليومية بالجرام</span>
                  </div>
                  <div className="h-56 w-full" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyReportData.chartDailyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="جرامات_بيع" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="جرامات_شراء" fill="#0d9488" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Top 10 Critical Issues */}
            <div>
              <h3 className="text-xs font-bold text-slate-900 mb-2">
                أخطر 10 اشتباهات وملاحظات رقابية خلال الفترة:
              </h3>
              <table className="w-full text-right border-collapse text-xs border border-slate-200">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-bold">
                    <th className="py-1.5 px-2 w-10">#</th>
                    <th className="py-1.5 px-2 w-20">الخطورة</th>
                    <th className="py-1.5 px-2 w-24">التاريخ</th>
                    <th className="py-1.5 px-2 w-36">نوع الفحص</th>
                    <th className="py-1.5 px-2">تفاصيل الملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyReportData.top10Issues.map((iss, idx) => (
                    <tr key={iss.id} className="border-b border-slate-200">
                      <td className="py-1.5 px-2 font-mono">{idx + 1}</td>
                      <td className="py-1.5 px-2 font-bold">
                        {iss.severity === 'high'
                          ? 'عالية'
                          : iss.severity === 'medium'
                          ? 'متوسطة'
                          : 'منخفضة'}
                      </td>
                      <td className="py-1.5 px-2 font-mono">{iss.date}</td>
                      <td className="py-1.5 px-2 font-semibold">{iss.checkTitle}</td>
                      <td className="py-1.5 px-2">{iss.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 3: PERIOD COMPARISONS (F8.2) */}
      {subTab === 'period_compare' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                مقارنة الأداء بين فترتين (أسبوع مع أسبوع أو شهر مع شهر)
              </h2>
              <p className="text-xs text-slate-500">
                يقارن المبيعات والمشتريات والمصاريف والسلف وهامش ربح الجرام والاشتباهات مع نسبة التغير المئوية.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="font-extrabold text-slate-800">الفترة الأولى (الأساس - أ):</div>
              <div className="flex items-center gap-2">
                <span>من:</span>
                <input
                  type="date"
                  value={periodAStart}
                  onChange={(e) => setPeriodAStart(e.target.value)}
                  className="px-2.5 py-1 font-mono border border-slate-300 rounded bg-white"
                />
                <span>إلى:</span>
                <input
                  type="date"
                  value={periodAEnd}
                  onChange={(e) => setPeriodAEnd(e.target.value)}
                  className="px-2.5 py-1 font-mono border border-slate-300 rounded bg-white"
                />
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200 space-y-2">
              <div className="font-extrabold text-amber-950">الفترة الثانية (المقارنة - ب):</div>
              <div className="flex items-center gap-2">
                <span>من:</span>
                <input
                  type="date"
                  value={periodBStart}
                  onChange={(e) => setPeriodBStart(e.target.value)}
                  className="px-2.5 py-1 font-mono border border-amber-300 rounded bg-white"
                />
                <span>إلى:</span>
                <input
                  type="date"
                  value={periodBEnd}
                  onChange={(e) => setPeriodBEnd(e.target.value)}
                  className="px-2.5 py-1 font-mono border border-amber-300 rounded bg-white"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs border border-slate-200">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                  <th className="py-2.5 px-3">البند / المؤشر</th>
                  <th className="py-2.5 px-3">
                    الفترة أ ({periodAStart} ← {periodAEnd})
                  </th>
                  <th className="py-2.5 px-3">
                    الفترة ب ({periodBStart} ← {periodBEnd})
                  </th>
                  <th className="py-2.5 px-3">اتجاه ونسبة التغير</th>
                </tr>
              </thead>
              <tbody>
                {periodComparison.diffs.map((row) => {
                  const isUp = row.changePct > 0.1;
                  const isDown = row.changePct < -0.1;
                  const isGood =
                    (isUp && row.positiveIsGood) || (isDown && !row.positiveIsGood);
                  return (
                    <tr key={row.label} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-extrabold text-slate-900">{row.label}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-700">{row.valA}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{row.valB}</td>
                      <td className="py-2.5 px-3 font-mono font-extrabold">
                        {!isUp && !isDown ? (
                          <span className="text-slate-400">ثابت (0%)</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${
                              isGood
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {isUp ? (
                              <TrendingUp className="w-3.5 h-3.5" />
                            ) : (
                              <TrendingDown className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {isUp ? '↑' : '↓'} {Math.abs(row.changePct).toFixed(1)}%
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 4: TOP 10 / LOWEST 10 OPERATIONS & MOST SOLD ITEMS (F8.3) */}
      {subTab === 'top_10' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                أكبر وأقل 10 عمليات وأكثر الأصناف مبيعاً
              </h2>
              <p className="text-xs text-slate-500">
                يساعد في كشف أكبر الصفقات، وأقل عمليات البيع في سعر الجرام، والأصناف الأكثر حركة في المحل.
              </p>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setTopMetric('total')}
                className={`px-3 py-1 rounded font-bold cursor-pointer ${
                  topMetric === 'total' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                ترتيب بالمبلغ (ج.م)
              </button>
              <button
                type="button"
                onClick={() => setTopMetric('weightG')}
                className={`px-3 py-1 rounded font-bold cursor-pointer ${
                  topMetric === 'weightG' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                ترتيب بالوزن (جرام)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top 10 Sells */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-extrabold text-emerald-900">
                أكبر 10 عمليات بيع ({topMetric === 'total' ? 'حسب المبلغ' : 'حسب الوزن'})
              </h3>
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-bold">
                    <th className="py-1.5 px-2">#</th>
                    <th className="py-1.5 px-2">التاريخ</th>
                    <th className="py-1.5 px-2">الوزن</th>
                    <th className="py-1.5 px-2">الإجمالي</th>
                    <th className="py-1.5 px-2">سعر الجرام</th>
                    <th className="py-1.5 px-2">البيان</th>
                  </tr>
                </thead>
                <tbody>
                  {top10Analysis.top10Sells.map((op, i) => (
                    <tr key={op.id} className="border-b border-slate-100 font-mono">
                      <td className="py-1.5 px-2">{i + 1}</td>
                      <td className="py-1.5 px-2">{op.date}</td>
                      <td className="py-1.5 px-2 font-bold">{formatWeight(op.weightG)} ج</td>
                      <td className="py-1.5 px-2 font-bold text-emerald-800">
                        {formatNumber(op.total)}
                      </td>
                      <td className="py-1.5 px-2">
                        {formatNumber(Math.round(op.total / op.weightG))}
                      </td>
                      <td className="py-1.5 px-2 font-sans">{op.item || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Lowest 10 Sells by Gram Price */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-extrabold text-red-900">
                أقل 10 عمليات بيع في سعر الجرام (لكشف البيع بأرخص من السوق)
              </h3>
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-red-50 border-b border-red-200 font-bold text-red-950">
                    <th className="py-1.5 px-2">#</th>
                    <th className="py-1.5 px-2">التاريخ</th>
                    <th className="py-1.5 px-2">العيار</th>
                    <th className="py-1.5 px-2">الوزن</th>
                    <th className="py-1.5 px-2">سعر الجرام</th>
                    <th className="py-1.5 px-2">البيان</th>
                  </tr>
                </thead>
                <tbody>
                  {top10Analysis.lowest10SellsByGramPrice.map((op, i) => (
                    <tr key={op.id} className="border-b border-slate-100 font-mono">
                      <td className="py-1.5 px-2">{i + 1}</td>
                      <td className="py-1.5 px-2">{op.date}</td>
                      <td className="py-1.5 px-2">{op.karat || 21}</td>
                      <td className="py-1.5 px-2">{formatWeight(op.weightG)} ج</td>
                      <td className="py-1.5 px-2 font-extrabold text-red-700">
                        {formatNumber(Math.round(op.total / op.weightG))} ج.م
                      </td>
                      <td className="py-1.5 px-2 font-sans">{op.item || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Top 10 Buys */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-extrabold text-teal-900">
                أكبر 10 عمليات شراء ({topMetric === 'total' ? 'حسب المبلغ' : 'حسب الوزن'})
              </h3>
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-bold">
                    <th className="py-1.5 px-2">#</th>
                    <th className="py-1.5 px-2">التاريخ</th>
                    <th className="py-1.5 px-2">الوزن</th>
                    <th className="py-1.5 px-2">الإجمالي</th>
                    <th className="py-1.5 px-2">سعر الجرام</th>
                    <th className="py-1.5 px-2">البيان</th>
                  </tr>
                </thead>
                <tbody>
                  {top10Analysis.top10Buys.map((op, i) => (
                    <tr key={op.id} className="border-b border-slate-100 font-mono">
                      <td className="py-1.5 px-2">{i + 1}</td>
                      <td className="py-1.5 px-2">{op.date}</td>
                      <td className="py-1.5 px-2 font-bold">{formatWeight(op.weightG)} ج</td>
                      <td className="py-1.5 px-2 font-bold text-teal-800">
                        {formatNumber(op.total)}
                      </td>
                      <td className="py-1.5 px-2">
                        {formatNumber(Math.round(op.total / op.weightG))}
                      </td>
                      <td className="py-1.5 px-2 font-sans">{op.item || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Most Sold Items */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-extrabold text-amber-900">
                أكثر الأصناف مبيعاً (عند تفعيل خانة البيان/الصنف)
              </h3>
              {top10Analysis.mostSoldItems.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  لا توجد أصناف مسجلة في خانة البيان بعد.
                </p>
              ) : (
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-amber-50 border-b border-amber-200 font-bold">
                      <th className="py-1.5 px-2">#</th>
                      <th className="py-1.5 px-2">اسم الصنف / البيان</th>
                      <th className="py-1.5 px-2">عدد المبيعات</th>
                      <th className="py-1.5 px-2">إجمالي الوزن</th>
                      <th className="py-1.5 px-2">إجمالي القيمة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top10Analysis.mostSoldItems.map((it, i) => (
                      <tr key={it.item} className="border-b border-slate-100 font-mono">
                        <td className="py-1.5 px-2">{i + 1}</td>
                        <td className="py-1.5 px-2 font-sans font-bold text-slate-900">
                          {it.item}
                        </td>
                        <td className="py-1.5 px-2 font-bold">{it.count} عملية</td>
                        <td className="py-1.5 px-2">{formatWeight(it.totalG)} ج</td>
                        <td className="py-1.5 px-2 font-bold text-amber-800">
                          {formatNumber(it.totalEgp)} ج.م
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 5: AUDIT LOG */}
      {subTab === 'audit_log' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={logDateFilter}
                onChange={(e) => setLogDateFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
              />
              <select
                value={logActionFilter}
                onChange={(e) => setLogActionFilter(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="all">كل أنواع الإجراءات</option>
                <option value="add">إضافة صف</option>
                <option value="batch_add">إضافة مجمعة (صورة/إكسل)</option>
                <option value="edit">تعديل صف</option>
                <option value="delete">حذف صف</option>
                <option value="undo_add">تراجع عن إضافة (Ctrl+Z)</option>
                <option value="undo_delete">تراجع عن حذف</option>
                <option value="review_note">ملاحظة / علامة مراجعة</option>
                <option value="lock">قفل يوم</option>
                <option value="unlock">فتح قفل يوم</option>
                <option value="salary_close">إقفال مرتبات</option>
              </select>
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="بحث في السجل أو السبب..."
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg w-56"
              />
            </div>

            <button
              type="button"
              onClick={exportAuditLogsExcel}
              className="px-4 py-1.5 bg-emerald-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير السجل Excel</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                  <th className="py-2.5 px-3">وقت التسجيل</th>
                  <th className="py-2.5 px-3">تاريخ العملية</th>
                  <th className="py-2.5 px-3">الإجراء</th>
                  <th className="py-2.5 px-3">الوصف</th>
                  <th className="py-2.5 px-3">القيمة القديمة</th>
                  <th className="py-2.5 px-3">القيمة الجديدة</th>
                  <th className="py-2.5 px-3">السبب المسجل</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono text-slate-500">
                      {new Date(l.timestamp).toLocaleString('ar-EG')}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold">
                      {l.date}
                      {l.wasLocked && (
                        <span className="mr-1.5 px-1.5 py-0.5 bg-red-600 text-white rounded text-[10px]">
                          أثناء القفل!
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-bold">
                      <span
                        className={`px-2 py-0.5 rounded ${
                          l.action === 'delete' || l.action === 'unlock'
                            ? 'bg-red-100 text-red-800'
                            : l.action === 'edit' || l.action === 'undo_add' || l.action === 'undo_delete'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {l.action === 'add'
                          ? 'إضافة'
                          : l.action === 'batch_add'
                          ? 'إضافة مجمعة'
                          : l.action === 'edit'
                          ? 'تعديل'
                          : l.action === 'delete'
                          ? 'حذف'
                          : l.action === 'undo_add'
                          ? 'تراجع إضافة'
                          : l.action === 'undo_delete'
                          ? 'تراجع حذف'
                          : l.action === 'review_note'
                          ? 'ملاحظة مراجعة'
                          : l.action === 'lock'
                          ? 'قفل يوم'
                          : l.action === 'unlock'
                          ? 'فتح قفل'
                          : 'إقفال مرتبات'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{l.description}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{l.oldValue || '—'}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-900 font-semibold">
                      {l.newValue || '—'}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-amber-900">
                      {l.reason || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
