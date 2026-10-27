import React, { useState, useMemo, useRef } from 'react';
import {
  FileSpreadsheet,
  Printer,
  FileDown,
  Bookmark,
  Layers,
  AlertTriangle,
  CheckCircle2,
  ArrowUpDown,
  ExternalLink,
  MessageSquarePlus,
  X,
} from 'lucide-react';
import { useAuditStore } from '../store/useAuditStore';
import { Operation, PriceThresholdMethod } from '../types';
import {
  formatNumber,
  formatWeight,
  getEffectiveKaratPrice,
  getTodayIso,
  isCompoundItem,
  normalizeArabicName,
  parseAmountInput,
  parseWeightInput,
} from '../utils/numerals';
import { exportPriceStatementExcel } from '../utils/exportImport';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';

interface EvaluatedStatementRow {
  op: Operation;
  rowNumber: number;
  date: string;
  kind: 'buy' | 'sell';
  karatLabel: string;
  item: string;
  isCompound: boolean;
  weightG: number;
  total: number;
  actualGramPrice: number;
  dailyKaratPrice: number;
  referenceLimit: number;
  diffPerGram: number;
  diffPct: number;
  financialImpact: number; // (actualGramPrice - referenceLimit) * weightG
  isPotentialLoss: boolean;
  caseDescription: string; // F3.5: Descriptive Arabic text e.g. "بيع عيار 21 بسعر 7,050 أقل من سعر اليوم 7,450 بـ 400 جنيه للجرام"
}

interface PriceStatementScreenProps {
  onNavigateToOperation?: (date: string, opId: string) => void;
}

export const PriceStatementScreen: React.FC<PriceStatementScreenProps> = ({
  onNavigateToOperation,
}) => {
  const {
    operations,
    daysMap,
    persons,
    settings,
    pricePresets,
    savePricePreset,
    deletePricePreset,
    updateOperation,
    toggleOperationReviewed,
    setCurrentDate,
    setHighlightedOpId,
  } = useAuditStore();

  // Filter & Threshold State — F3.1: 'shop_rules' is the default method
  const [fromDate, setFromDate] = useState<string>('2026-10-01');
  const [toDate, setToDate] = useState<string>(getTodayIso());
  const [kindFilter, setKindFilter] = useState<'buy' | 'sell' | 'both'>('both');
  const [thresholdMethod, setThresholdMethod] = useState<PriceThresholdMethod>('shop_rules');

  // "أعلى من" and "أقل من" inputs
  const [higherThanVal, setHigherThanVal] = useState<string>('1.5');
  const [lowerThanVal, setLowerThanVal] = useState<string>('1.5');

  const [itemFilter, setItemFilter] = useState<string>('');
  const [personIdFilter, setPersonIdFilter] = useState<string>('all');
  const [minWeightG, setMinWeightG] = useState<string>('');
  const [excludeCompoundItems, setExcludeCompoundItems] = useState<boolean>(false);
  const [useLastKnownGoldPrice, setUseLastKnownGoldPrice] = useState<boolean>(true);

  const [viewModeTab, setViewModeTab] = useState<'tables' | 'by_person'>('tables');
  const [sortCol, setSortCol] = useState<
    'impact' | 'date' | 'weightG' | 'actualGramPrice' | 'diffPct'
  >('impact');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Preset Save input
  const [presetNameInput, setPresetNameInput] = useState<string>('');

  // Day operations inspection modal when clicking a row
  const [inspectDate, setInspectDate] = useState<string | null>(null);

  // Inline note modal for F3.6 "علامة مراجعة + ملاحظة"
  const [noteModalOp, setNoteModalOp] = useState<Operation | null>(null);
  const [noteText, setNoteText] = useState<string>('');

  // Refs for Enter key navigation across settings fields
  const higherInputRef = useRef<HTMLInputElement | null>(null);
  const lowerInputRef = useRef<HTMLInputElement | null>(null);
  const itemInputRef = useRef<HTMLInputElement | null>(null);
  const minWeightInputRef = useRef<HTMLInputElement | null>(null);

  const applyQuickPeriod = (
    period: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'all'
  ) => {
    const today = new Date(`${getTodayIso()}T00:00:00Z`);
    if (period === 'today') {
      const iso = today.toISOString().slice(0, 10);
      setFromDate(iso);
      setToDate(iso);
    } else if (period === 'yesterday') {
      const y = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
      setFromDate(y);
      setToDate(y);
    } else if (period === 'this_week') {
      const w = new Date(today.getTime() - 86400000 * 6).toISOString().slice(0, 10);
      setFromDate(w);
      setToDate(today.toISOString().slice(0, 10));
    } else if (period === 'this_month') {
      const iso = today.toISOString().slice(0, 10);
      setFromDate(`${iso.slice(0, 7)}-01`);
      setToDate(iso);
    } else if (period === 'last_month') {
      const firstThis = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const lastPrev = new Date(firstThis.getTime() - 86400000);
      const firstPrev = new Date(Date.UTC(lastPrev.getUTCFullYear(), lastPrev.getUTCMonth(), 1));
      setFromDate(firstPrev.toISOString().slice(0, 10));
      setToDate(lastPrev.toISOString().slice(0, 10));
    } else {
      setFromDate('2020-01-01');
      setToDate('2030-12-31');
    }
  };

  // Report title based on kindFilter (F3.3)
  const reportTitle = useMemo(() => {
    if (kindFilter === 'sell') return 'تقرير مشاكل أسعار البيع فقط';
    if (kindFilter === 'buy') return 'تقرير مشاكل أسعار الشراء فقط';
    return 'بيان أسعار الشراء والبيع الشامل';
  }, [kindFilter]);

  const thresholdDescText = useMemo(() => {
    if (thresholdMethod === 'shop_rules') {
      return `حسب قواعد المحل (بيع أقل من اليومي بـ ${settings.allowedPriceRange.sellMinBelowDaily} ج أو مصنعية فوق ${settings.allowedPriceRange.sellMaxMakingCharge} ج | شراء أعلى من اليومي أو خصم كسر فوق ${settings.allowedPriceRange.buyMaxDiscount} ج)`;
    }
    if (thresholdMethod === 'daily_diff_pct') {
      return `فرق عن سعر الذهب اليومي بنسبة (أعلى: ${higherThanVal || '-'}% / أقل: ${lowerThanVal || '-'}%)`;
    }
    if (thresholdMethod === 'daily_diff_amount') {
      return `فرق عن سعر الذهب اليومي بمبلغ (أعلى: ${higherThanVal || '-'} ج / أقل: ${lowerThanVal || '-'} ج)`;
    }
    if (thresholdMethod === 'fixed') {
      return `سعر جرام ثابت (أعلى من: ${higherThanVal || '-'} ج / أقل من: ${lowerThanVal || '-'} ج)`;
    }
    return `فرق عن متوسط الفترة المرجّح بنسبة (أعلى: ${higherThanVal || '-'}% / أقل: ${lowerThanVal || '-'}%)`;
  }, [thresholdMethod, higherThanVal, lowerThanVal, settings.allowedPriceRange]);

  // Compute statement data instantaneously
  const statementData = useMemo(() => {
    const minW = parseWeightInput(minWeightG);
    const normItem = normalizeArabicName(itemFilter);
    const highNum = higherThanVal.trim() !== '' ? parseAmountInput(higherThanVal) : null;
    const lowNum = lowerThanVal.trim() !== '' ? parseAmountInput(lowerThanVal) : null;

    const knownPriceDates = Object.keys(daysMap)
      .filter((d) => daysMap[d]?.goldPricePerGram > 0)
      .sort();

    const getDayInfoForPrice = (date: string) => {
      if (daysMap[date]?.goldPricePerGram > 0) {
        return daysMap[date];
      }
      if (!useLastKnownGoldPrice || knownPriceDates.length === 0) {
        return undefined;
      }
      const prior = knownPriceDates.filter((d) => d <= date);
      const refD = prior.length > 0 ? prior[prior.length - 1] : knownPriceDates[0];
      return daysMap[refD];
    };

    const candidateOps: { op: Operation; rowNumber: number; compound: boolean }[] = [];
    const daysMissingGoldPrice = new Set<string>();

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (op.kind !== 'buy' && op.kind !== 'sell') continue;
      if (kindFilter !== 'both' && op.kind !== kindFilter) continue;
      if (fromDate && op.date < fromDate) continue;
      if (toDate && op.date > toDate) continue;
      if (op.weightG <= 0 || op.total <= 0) continue;
      if (minW > 0 && op.weightG < minW) continue;
      if (personIdFilter !== 'all' && op.personId !== personIdFilter) continue;
      if (normItem && !normalizeArabicName(op.item || '').includes(normItem)) continue;

      const compound = isCompoundItem(op.item);
      if (excludeCompoundItems && compound) continue;

      if (!daysMap[op.date]?.goldPricePerGram) {
        daysMissingGoldPrice.add(op.date);
      }

      candidateOps.push({ op, rowNumber: i + 1, compound });
    }

    const weightedAvgByKind: Record<'buy' | 'sell', number> = { buy: 0, sell: 0 };
    let sumBuyW = 0,
      sumBuyT = 0,
      sumSellW = 0,
      sumSellT = 0;
    for (const { op } of candidateOps) {
      if (op.kind === 'buy') {
        sumBuyW += op.weightG;
        sumBuyT += op.total;
      } else {
        sumSellW += op.weightG;
        sumSellT += op.total;
      }
    }
    weightedAvgByKind.buy = sumBuyW > 0 ? sumBuyT / sumBuyW : 0;
    weightedAvgByKind.sell = sumSellW > 0 ? sumSellT / sumSellW : 0;

    const higherRows: EvaluatedStatementRow[] = [];
    const lowerRows: EvaluatedStatementRow[] = [];

    for (const { op, rowNumber, compound } of candidateOps) {
      const opKind: 'buy' | 'sell' = op.kind === 'buy' ? 'buy' : 'sell';
      const karat = op.karat || 21;
      const karatLabel = karat === 'other' ? 'عيار آخر' : `عيار ${karat}`;
      const kindWord = opKind === 'sell' ? 'بيع' : 'شراء';
      const actualGramPrice = op.total / op.weightG;

      const resolvedDayInfo = getDayInfoForPrice(op.date);
      const dailyKaratPrice = getEffectiveKaratPrice(resolvedDayInfo, karat);

      if (thresholdMethod === 'shop_rules') {
        if (dailyKaratPrice <= 0) continue;

        const { sellMinBelowDaily, sellMaxMakingCharge, buyMaxDiscount } =
          settings.allowedPriceRange;
        const fixedAboveBuy = settings.fixedRules?.enabled
          ? settings.fixedRules.buyAboveDailyByAmount || 0
          : 0;
        const fixedBelowSell = settings.fixedRules?.enabled
          ? settings.fixedRules.sellBelowDailyByAmount || 0
          : 0;

        if (opKind === 'sell') {
          const minAllowedSell = dailyKaratPrice - Math.max(sellMinBelowDaily, fixedBelowSell);
          const maxAllowedSell = dailyKaratPrice + sellMaxMakingCharge;

          if (actualGramPrice < minAllowedSell) {
            const diffFromDaily = Math.round(dailyKaratPrice - actualGramPrice);
            const diffPerGram = actualGramPrice - minAllowedSell;
            const diffPct = ((actualGramPrice - minAllowedSell) / minAllowedSell) * 100;
            const financialImpact = diffPerGram * op.weightG;
            lowerRows.push({
              op,
              rowNumber,
              date: op.date,
              kind: opKind,
              karatLabel,
              item: op.item || '',
              isCompound: compound,
              weightG: op.weightG,
              total: op.total,
              actualGramPrice,
              dailyKaratPrice,
              referenceLimit: minAllowedSell,
              diffPerGram,
              diffPct,
              financialImpact,
              isPotentialLoss: true,
              caseDescription: `${kindWord} ${karatLabel} بسعر ${formatNumber(
                actualGramPrice,
                0
              )} أقل من سعر اليوم ${formatNumber(dailyKaratPrice, 0)} بـ ${formatNumber(
                diffFromDaily,
                0
              )} جنيه للجرام`,
            });
          } else if (actualGramPrice > maxAllowedSell) {
            const diffFromDaily = Math.round(actualGramPrice - dailyKaratPrice);
            const diffPerGram = actualGramPrice - maxAllowedSell;
            const diffPct = ((actualGramPrice - maxAllowedSell) / maxAllowedSell) * 100;
            const financialImpact = diffPerGram * op.weightG;
            higherRows.push({
              op,
              rowNumber,
              date: op.date,
              kind: opKind,
              karatLabel,
              item: op.item || '',
              isCompound: compound,
              weightG: op.weightG,
              total: op.total,
              actualGramPrice,
              dailyKaratPrice,
              referenceLimit: maxAllowedSell,
              diffPerGram,
              diffPct,
              financialImpact,
              isPotentialLoss: false,
              caseDescription: `${kindWord} ${karatLabel} بسعر ${formatNumber(
                actualGramPrice,
                0
              )} أعلى من سعر اليوم ${formatNumber(dailyKaratPrice, 0)} بـ ${formatNumber(
                diffFromDaily,
                0
              )} جنيه للجرام (مصنعية تتجاوز الحد)`,
            });
          }
        } else {
          // buy
          const maxAllowedBuy = dailyKaratPrice + fixedAboveBuy;
          const minAllowedBuy = dailyKaratPrice - buyMaxDiscount;

          if (actualGramPrice > maxAllowedBuy) {
            const diffFromDaily = Math.round(actualGramPrice - dailyKaratPrice);
            const diffPerGram = actualGramPrice - maxAllowedBuy;
            const diffPct = ((actualGramPrice - maxAllowedBuy) / maxAllowedBuy) * 100;
            const financialImpact = diffPerGram * op.weightG;
            higherRows.push({
              op,
              rowNumber,
              date: op.date,
              kind: opKind,
              karatLabel,
              item: op.item || '',
              isCompound: compound,
              weightG: op.weightG,
              total: op.total,
              actualGramPrice,
              dailyKaratPrice,
              referenceLimit: maxAllowedBuy,
              diffPerGram,
              diffPct,
              financialImpact,
              isPotentialLoss: true,
              caseDescription: `${kindWord} ${karatLabel} بسعر ${formatNumber(
                actualGramPrice,
                0
              )} أعلى من سعر اليوم ${formatNumber(dailyKaratPrice, 0)} بـ ${formatNumber(
                diffFromDaily,
                0
              )} جنيه للجرام`,
            });
          } else if (actualGramPrice < minAllowedBuy) {
            const diffFromDaily = Math.round(dailyKaratPrice - actualGramPrice);
            const diffPerGram = actualGramPrice - minAllowedBuy;
            const diffPct = ((actualGramPrice - minAllowedBuy) / minAllowedBuy) * 100;
            const financialImpact = diffPerGram * op.weightG;
            lowerRows.push({
              op,
              rowNumber,
              date: op.date,
              kind: opKind,
              karatLabel,
              item: op.item || '',
              isCompound: compound,
              weightG: op.weightG,
              total: op.total,
              actualGramPrice,
              dailyKaratPrice,
              referenceLimit: minAllowedBuy,
              diffPerGram,
              diffPct,
              financialImpact,
              isPotentialLoss: false,
              caseDescription: `${kindWord} ${karatLabel} بسعر ${formatNumber(
                actualGramPrice,
                0
              )} أقل من سعر اليوم ${formatNumber(dailyKaratPrice, 0)} بـ ${formatNumber(
                diffFromDaily,
                0
              )} جنيه للجرام (خصم كسر كبير)`,
            });
          }
        }
        continue;
      }

      // Standard threshold methods (daily_diff_pct, daily_diff_amount, fixed, weighted_avg_pct)
      let baseRefPrice = 0;
      if (thresholdMethod === 'fixed') {
        baseRefPrice = actualGramPrice;
      } else if (thresholdMethod === 'daily_diff_pct' || thresholdMethod === 'daily_diff_amount') {
        if (dailyKaratPrice <= 0) continue;
        baseRefPrice = dailyKaratPrice;
      } else if (thresholdMethod === 'weighted_avg_pct') {
        baseRefPrice = weightedAvgByKind[opKind];
        if (baseRefPrice <= 0) continue;
      }

      if (highNum !== null && highNum >= 0) {
        let upperLimit = 0;
        if (thresholdMethod === 'fixed') upperLimit = highNum;
        else if (thresholdMethod === 'daily_diff_pct' || thresholdMethod === 'weighted_avg_pct') {
          upperLimit = baseRefPrice * (1 + highNum / 100);
        } else if (thresholdMethod === 'daily_diff_amount') {
          upperLimit = baseRefPrice + highNum;
        }

        if (upperLimit > 0 && actualGramPrice > upperLimit) {
          const diffPerGram = actualGramPrice - upperLimit;
          const diffPct = ((actualGramPrice - upperLimit) / upperLimit) * 100;
          const financialImpact = diffPerGram * op.weightG;
          const refCompare = dailyKaratPrice > 0 ? dailyKaratPrice : upperLimit;
          const diffVsRef = Math.round(Math.abs(actualGramPrice - refCompare));
          higherRows.push({
            op,
            rowNumber,
            date: op.date,
            kind: opKind,
            karatLabel,
            item: op.item || '',
            isCompound: compound,
            weightG: op.weightG,
            total: op.total,
            actualGramPrice,
            dailyKaratPrice,
            referenceLimit: upperLimit,
            diffPerGram,
            diffPct,
            financialImpact,
            isPotentialLoss: opKind === 'buy',
            caseDescription: `${kindWord} ${karatLabel} بسعر ${formatNumber(
              actualGramPrice,
              0
            )} أعلى من المرجعي ${formatNumber(refCompare, 0)} بـ ${formatNumber(
              diffVsRef,
              0
            )} جنيه للجرام`,
          });
        }
      }

      if (lowNum !== null && lowNum >= 0) {
        let lowerLimit = 0;
        if (thresholdMethod === 'fixed') lowerLimit = lowNum;
        else if (thresholdMethod === 'daily_diff_pct' || thresholdMethod === 'weighted_avg_pct') {
          lowerLimit = baseRefPrice * (1 - lowNum / 100);
        } else if (thresholdMethod === 'daily_diff_amount') {
          lowerLimit = baseRefPrice - lowNum;
        }

        if (lowerLimit > 0 && actualGramPrice < lowerLimit) {
          const diffPerGram = actualGramPrice - lowerLimit;
          const diffPct = ((actualGramPrice - lowerLimit) / lowerLimit) * 100;
          const financialImpact = diffPerGram * op.weightG;
          const refCompare = dailyKaratPrice > 0 ? dailyKaratPrice : lowerLimit;
          const diffVsRef = Math.round(Math.abs(refCompare - actualGramPrice));
          lowerRows.push({
            op,
            rowNumber,
            date: op.date,
            kind: opKind,
            karatLabel,
            item: op.item || '',
            isCompound: compound,
            weightG: op.weightG,
            total: op.total,
            actualGramPrice,
            dailyKaratPrice,
            referenceLimit: lowerLimit,
            diffPerGram,
            diffPct,
            financialImpact,
            isPotentialLoss: opKind === 'sell',
            caseDescription: `${kindWord} ${karatLabel} بسعر ${formatNumber(
              actualGramPrice,
              0
            )} أقل من سعر اليوم ${formatNumber(refCompare, 0)} بـ ${formatNumber(
              diffVsRef,
              0
            )} جنيه للجرام`,
          });
        }
      }
    }

    const sorter = (a: EvaluatedStatementRow, b: EvaluatedStatementRow) => {
      let cmp = 0;
      if (sortCol === 'impact') {
        cmp = Math.abs(b.financialImpact) - Math.abs(a.financialImpact);
      } else if (sortCol === 'date') {
        cmp = b.date.localeCompare(a.date);
      } else if (sortCol === 'weightG') {
        cmp = b.weightG - a.weightG;
      } else if (sortCol === 'actualGramPrice') {
        cmp = b.actualGramPrice - a.actualGramPrice;
      } else if (sortCol === 'diffPct') {
        cmp = Math.abs(b.diffPct) - Math.abs(a.diffPct);
      }
      return sortAsc ? -cmp : cmp;
    };

    higherRows.sort(sorter);
    lowerRows.sort(sorter);

    const allOutRows = [...higherRows, ...lowerRows];
    const totalOutGrams = allOutRows.reduce((s, r) => s + r.weightG, 0);
    const lossRows = allOutRows.filter((r) => r.isPotentialLoss);
    const totalPotentialLoss = lossRows.reduce((s, r) => s + Math.abs(r.financialImpact), 0);
    const worstOp =
      lossRows.sort((a, b) => Math.abs(b.financialImpact) - Math.abs(a.financialImpact))[0] ||
      null;

    // Tab: By Person / Employee
    const personsMap = new Map(persons.map((p) => [p.id, p.name]));
    const outIds = new Set(allOutRows.map((r) => r.op.id));
    const impactByOpId = new Map(allOutRows.map((r) => [r.op.id, r.financialImpact]));

    const byPersonMap: Record<
      string,
      {
        key: string;
        name: string;
        opsCount: number;
        totalWeight: number;
        totalAmount: number;
        outCount: number;
        totalImpact: number;
      }
    > = {};

    for (const { op } of candidateOps) {
      const key = op.personId || '__GENERAL__';
      const name = (op.personId && personsMap.get(op.personId)) || 'مبيعات/مشتريات نقدية عامة';
      if (!byPersonMap[key]) {
        byPersonMap[key] = {
          key,
          name,
          opsCount: 0,
          totalWeight: 0,
          totalAmount: 0,
          outCount: 0,
          totalImpact: 0,
        };
      }
      byPersonMap[key].opsCount += 1;
      byPersonMap[key].totalWeight += op.weightG;
      byPersonMap[key].totalAmount += op.total;
      if (outIds.has(op.id)) {
        byPersonMap[key].outCount += 1;
        byPersonMap[key].totalImpact += impactByOpId.get(op.id) || 0;
      }
    }

    const overallAvgGramPrice =
      sumBuyW + sumSellW > 0 ? (sumBuyT + sumSellT) / (sumBuyW + sumSellW) : 0;

    const byPersonRows = Object.values(byPersonMap).map((p) => {
      const avgGram = p.totalWeight > 0 ? p.totalAmount / p.totalWeight : 0;
      const diffFromOverallPct =
        overallAvgGramPrice > 0
          ? ((avgGram - overallAvgGramPrice) / overallAvgGramPrice) * 100
          : 0;
      return {
        ...p,
        avgGram,
        diffFromOverallPct,
        isWorseThan2Pct: Math.abs(diffFromOverallPct) > 2,
      };
    });

    return {
      higherRows,
      lowerRows,
      allOutCount: allOutRows.length,
      totalOutGrams,
      totalPotentialLoss,
      worstOp,
      daysMissingGoldPrice: Array.from(daysMissingGoldPrice).sort(),
      weightedAvgByKind,
      overallAvgGramPrice,
      byPersonRows,
    };
  }, [
    operations,
    daysMap,
    persons,
    settings,
    fromDate,
    toDate,
    kindFilter,
    thresholdMethod,
    higherThanVal,
    lowerThanVal,
    itemFilter,
    personIdFilter,
    minWeightG,
    excludeCompoundItems,
    useLastKnownGoldPrice,
    sortCol,
    sortAsc,
  ]);

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortAsc((a) => !a);
    else {
      setSortCol(col);
      setSortAsc(false);
    }
  };

  // F3.3 & F3.4: Quick Report Print/PDF handlers
  const handleQuickReport = async (mode: 'sell_only' | 'buy_only', action: 'print' | 'pdf') => {
    setKindFilter(mode === 'sell_only' ? 'sell' : 'buy');
    setThresholdMethod('shop_rules');
    setTimeout(async () => {
      if (action === 'pdf') {
        const titlePrefix =
          mode === 'sell_only' ? 'مشاكل-أسعار-البيع' : 'مشاكل-أسعار-الشراء';
        await ensureGoldApiBridge().print.saveToPdf(
          `${titlePrefix}-${fromDate}-إلى-${toDate}.pdf`
        );
      } else {
        window.print();
      }
    }, 100);
  };

  const handleSaveCurrentPdf = async () => {
    const cleanTitle = reportTitle.replace(/\s+/g, '-');
    await ensureGoldApiBridge().print.saveToPdf(
      `${cleanTitle}-${fromDate}-إلى-${toDate}.pdf`
    );
  };

  const handleGoToOperation = (op: Operation, e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentDate(op.date);
    setHighlightedOpId(op.id);
    onNavigateToOperation?.(op.date, op.id);
  };

  const renderSectionTable = (title: string, rows: EvaluatedStatementRow[]) => {
    const sumGrams = rows.reduce((s, r) => s + r.weightG, 0);
    const sumTotal = rows.reduce((s, r) => s + r.total, 0);
    const avgGram = sumGrams > 0 ? sumTotal / sumGrams : 0;
    const sumImpact = rows.reduce((s, r) => s + r.financialImpact, 0);

    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            {title} ({rows.length} عملية)
          </h3>
          <span className="text-xs text-slate-500 no-print">
            اضغط على أي صف لعرض كل عمليات نفس اليوم أو استخدم أزرار الإجراءات السريعة
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                <th className="py-2.5 px-2">رقم الصف</th>
                <th
                  onClick={() => toggleSort('date')}
                  className="py-2.5 px-2 cursor-pointer hover:text-slate-900"
                >
                  <span className="inline-flex items-center gap-1">
                    التاريخ <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th className="py-2.5 px-2">النوع والعيار</th>
                <th className="py-2.5 px-2">البيان</th>
                <th className="py-2.5 px-2">وصف الحالة التفصيلي</th>
                <th
                  onClick={() => toggleSort('weightG')}
                  className="py-2.5 px-2 cursor-pointer hover:text-slate-900"
                >
                  <span className="inline-flex items-center gap-1">
                    الوزن <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th className="py-2.5 px-2">الإجمالي</th>
                <th
                  onClick={() => toggleSort('actualGramPrice')}
                  className="py-2.5 px-2 cursor-pointer hover:text-slate-900"
                >
                  <span className="inline-flex items-center gap-1">
                    الفعلي <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th className="py-2.5 px-2">الحد المرجعي</th>
                <th
                  onClick={() => toggleSort('impact')}
                  className="py-2.5 px-2 cursor-pointer hover:text-slate-900"
                >
                  <span className="inline-flex items-center gap-1">
                    الأثر المالي <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th className="py-2.5 px-2 text-center no-print">إجراءات المراجعة</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400">
                    لا توجد عمليات في هذا القسم مطابقة للحد المحدد.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.op.id}
                    onClick={() => setInspectDate(r.date)}
                    className={`border-b border-slate-200 hover:bg-amber-50/50 cursor-pointer transition-colors ${
                      r.op.reviewedFlag ? 'bg-emerald-50/30' : ''
                    }`}
                  >
                    <td className="py-2 px-2 font-mono text-slate-500">#{r.rowNumber}</td>
                    <td className="py-2 px-2 font-mono font-semibold whitespace-nowrap">
                      {r.date}
                    </td>
                    <td className="py-2 px-2 font-bold whitespace-nowrap">
                      <span
                        className={
                          r.kind === 'buy' ? 'text-teal-800' : 'text-amber-800'
                        }
                      >
                        {r.kind === 'buy' ? 'شراء' : 'بيع'} ({r.karatLabel})
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1.5">
                        {r.isCompound && (
                          <span
                            title="صنف مركب"
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 text-[10px] font-bold"
                          >
                            <Layers className="w-3 h-3 ml-0.5" /> مركب
                          </span>
                        )}
                        <span>{r.item || '—'}</span>
                        {r.op.reviewedFlag && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        )}
                      </div>
                      {r.op.note && (
                        <div className="text-[11px] text-amber-800 font-semibold mt-0.5">
                          ملاحظة: {r.op.note}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-slate-800 font-medium leading-relaxed">
                      {r.caseDescription}
                    </td>
                    <td className="py-2 px-2 font-mono tabular-nums font-semibold">
                      {formatWeight(r.weightG)}
                    </td>
                    <td className="py-2 px-2 font-mono tabular-nums">
                      {formatNumber(r.total)}
                    </td>
                    <td className="py-2 px-2 font-mono tabular-nums font-bold text-slate-900">
                      {formatNumber(r.actualGramPrice, 0)}
                    </td>
                    <td className="py-2 px-2 font-mono tabular-nums text-slate-600">
                      {formatNumber(r.referenceLimit, 0)}
                    </td>
                    <td className="py-2 px-2 font-mono tabular-nums font-extrabold whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded ${
                          r.isPotentialLoss
                            ? 'bg-red-100 text-red-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {r.financialImpact > 0 ? '+' : ''}
                        {formatNumber(r.financialImpact, 0)} ج.م{' '}
                        {r.isPotentialLoss ? '(خسارة محتملة)' : '(ميزة)'}
                      </span>
                    </td>
                    <td
                      className="py-2 px-2 text-center no-print whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => handleGoToOperation(r.op, e)}
                          title="اذهب إلى العملية في شاشة الإدخال السريع"
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>اذهب للعملية</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNoteModalOp(r.op);
                            setNoteText(r.op.note || '');
                          }}
                          title="علامة مراجعة + ملاحظة"
                          className={`px-2 py-1 rounded text-[11px] font-bold inline-flex items-center gap-1 border cursor-pointer ${
                            r.op.reviewedFlag
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          <MessageSquarePlus className="w-3 h-3" />
                          <span>{r.op.reviewedFlag ? 'مراجَع ✓' : 'مراجعة + ملاحظة'}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900">
                  <td colSpan={5} className="py-2.5 px-3">
                    إجمالي القسم ({rows.length} عملية)
                  </td>
                  <td className="py-2.5 px-2 font-mono">{formatWeight(sumGrams)} ج</td>
                  <td className="py-2.5 px-2 font-mono">{formatNumber(sumTotal)} ج.م</td>
                  <td className="py-2.5 px-2 font-mono">
                    متوسط: {formatNumber(avgGram, 0)}
                  </td>
                  <td></td>
                  <td className="py-2.5 px-2 font-mono">
                    {sumImpact > 0 ? '+' : ''}
                    {formatNumber(sumImpact, 0)} ج.م
                  </td>
                  <td className="no-print"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* F3.5 Formal A4 Print Header */}
      <div className="hidden print-only border-b-2 border-slate-900 pb-4 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {reportTitle} — {settings.shopName || 'محل الذهب'}
            </h1>
            <p className="text-sm text-slate-700 mt-1">
              الفترة: من <strong className="font-mono">{fromDate}</strong> إلى{' '}
              <strong className="font-mono">{toDate}</strong>
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              الحدود المستخدمة: {thresholdDescText}
            </p>
          </div>
          <div className="text-left text-xs space-y-1">
            <div>
              <strong>اسم المراجع:</strong> {settings.auditorName || 'المراجع المالي'}
            </div>
            <div>
              <strong>تاريخ الطباعة:</strong> {new Date().toLocaleDateString('ar-EG')}
            </div>
          </div>
        </div>
      </div>

      {/* F3.3 Top Quick Report Buttons Bar */}
      <div className="bg-amber-50/90 border border-amber-300 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="text-xs font-bold text-amber-950">
          تقارير سريعة جاهزة للطباعة أو الحفظ كـ PDF حسب قواعد المحل:
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setKindFilter('sell');
              setThresholdMethod('shop_rules');
            }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold border transition-colors cursor-pointer ${
              kindFilter === 'sell' && thresholdMethod === 'shop_rules'
                ? 'bg-amber-600 text-white border-amber-700'
                : 'bg-white text-amber-950 border-amber-400 hover:bg-amber-100'
            }`}
          >
            مشاكل البيع فقط
          </button>
          <button
            type="button"
            onClick={() => handleQuickReport('sell_only', 'pdf')}
            className="px-2.5 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>PDF مشاكل البيع</span>
          </button>

          <span className="text-amber-400 mx-1">|</span>

          <button
            type="button"
            onClick={() => {
              setKindFilter('buy');
              setThresholdMethod('shop_rules');
            }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold border transition-colors cursor-pointer ${
              kindFilter === 'buy' && thresholdMethod === 'shop_rules'
                ? 'bg-teal-700 text-white border-teal-800'
                : 'bg-white text-teal-950 border-teal-400 hover:bg-teal-50'
            }`}
          >
            مشاكل الشراء فقط
          </button>
          <button
            type="button"
            onClick={() => handleQuickReport('buy_only', 'pdf')}
            className="px-2.5 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>PDF مشاكل الشراء</span>
          </button>

          {kindFilter !== 'both' && (
            <button
              type="button"
              onClick={() => setKindFilter('both')}
              className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-bold cursor-pointer"
            >
              إظهار البيع والشراء معاً
            </button>
          )}
        </div>
      </div>

      {/* Settings & Fast Controls Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {reportTitle} (النتيجة تظهر لحظياً)
            </h2>
            <p className="text-xs text-slate-500">
              حدد الفترة وطريقة حساب الحد المرجعي واضغط Enter للتنقل السريع بين الخانات.
            </p>
          </div>

          {/* Quick Period Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                { id: 'today', label: 'اليوم' },
                { id: 'yesterday', label: 'أمس' },
                { id: 'this_week', label: 'هذا الأسبوع' },
                { id: 'this_month', label: 'هذا الشهر' },
                { id: 'last_month', label: 'الشهر الماضي' },
                { id: 'all', label: 'كل الفترات' },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => applyQuickPeriod(btn.id)}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg transition-colors cursor-pointer"
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid of Parameters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-2">
          <div>
            <label className="block text-xs text-slate-600 mb-1">من تاريخ</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">النوع</label>
            <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg text-xs">
              {(
                [
                  { id: 'buy', label: 'شراء' },
                  { id: 'sell', label: 'بيع' },
                  { id: 'both', label: 'الاثنان' },
                ] as const
              ).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKindFilter(k.id)}
                  className={`py-1 rounded font-bold cursor-pointer ${
                    kindFilter === k.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-xs text-slate-600 mb-1">طريقة تحديد الحد المرجعي</label>
            <select
              value={thresholdMethod}
              onChange={(e) => setThresholdMethod(e.target.value as PriceThresholdMethod)}
              className="w-full px-2.5 py-1.5 text-xs font-bold border border-slate-300 rounded-lg bg-white"
            >
              <option value="shop_rules">
                د) حسب قواعد المحل (X/Y/Z والحدود الثابتة لكل عيار — افتراضي)
              </option>
              <option value="daily_diff_pct">
                ب) فرق عن سعر الذهب اليومي بنسبة %
              </option>
              <option value="daily_diff_amount">
                ب) فرق عن سعر الذهب اليومي بمبلغ (ج.م/جرام)
              </option>
              <option value="fixed">
                أ) سعر جرام ثابت (أعلى من X وأقل من Y)
              </option>
              <option value="weighted_avg_pct">
                ج) فرق عن متوسط الفترة المرجّح بالوزن بنسبة %
              </option>
            </select>
          </div>

          {thresholdMethod === 'shop_rules' ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 text-[11px] text-amber-950 flex flex-col justify-center">
              <div className="font-bold">قواعد المحل الفعالة:</div>
              <div>
                مصنعية بيع &le; {settings.allowedPriceRange.sellMaxMakingCharge} ج | خصم شراء &le;{' '}
                {settings.allowedPriceRange.buyMaxDiscount} ج
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  أعلى من {thresholdMethod.includes('pct') ? '(%)' : '(ج.م)'}
                </label>
                <input
                  ref={higherInputRef}
                  type="text"
                  inputMode="decimal"
                  value={higherThanVal}
                  onChange={(e) => setHigherThanVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      lowerInputRef.current?.focus();
                    }
                  }}
                  placeholder="اختياري"
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold border-2 border-amber-500 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  أقل من {thresholdMethod.includes('pct') ? '(%)' : '(ج.م)'}
                </label>
                <input
                  ref={lowerInputRef}
                  type="text"
                  inputMode="decimal"
                  value={lowerThanVal}
                  onChange={(e) => setLowerThanVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      itemInputRef.current?.focus();
                    }
                  }}
                  placeholder="اختياري"
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold border-2 border-amber-500 rounded-lg"
                />
              </div>
            </div>
          )}
        </div>

        {/* Secondary Filters & Save Preset */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-slate-100">
          <input
            ref={itemInputRef}
            type="text"
            value={itemFilter}
            onChange={(e) => setItemFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                minWeightInputRef.current?.focus();
              }
            }}
            placeholder="فلتر بالبيان / الصنف..."
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
          />

          <select
            value={personIdFilter}
            onChange={(e) => setPersonIdFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="all">كل الأشخاص</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <input
            ref={minWeightInputRef}
            type="text"
            inputMode="decimal"
            value={minWeightG}
            onChange={(e) => setMinWeightG(e.target.value)}
            placeholder="الحد الأدنى للوزن (جرام)..."
            className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
          />

          <div className="flex flex-col justify-center gap-1 text-xs">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeCompoundItems}
                onChange={(e) => setExcludeCompoundItems(e.target.checked)}
                className="rounded text-amber-600"
              />
              <span>استبعاد الأصناف المركبة (+)</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={useLastKnownGoldPrice}
                onChange={(e) => setUseLastKnownGoldPrice(e.target.checked)}
                className="rounded text-amber-600"
              />
              <span>استخدام آخر سعر ذهب معروف للأيام الفارغة</span>
            </label>
          </div>

          {/* Save Preset */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={presetNameInput}
              onChange={(e) => setPresetNameInput(e.target.value)}
              placeholder="اسم الإعداد لحفظه..."
              className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
            <button
              type="button"
              onClick={() => {
                if (!presetNameInput.trim()) return;
                savePricePreset({
                  name: presetNameInput.trim(),
                  kindFilter,
                  thresholdMethod,
                  higherThanVal,
                  lowerThanVal,
                  itemFilter,
                  personIdFilter,
                  minWeightG,
                  excludeCompoundItems,
                  useLastKnownGoldPrice,
                });
                setPresetNameInput('');
              }}
              className="px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>حفظ</span>
            </button>
          </div>
        </div>

        {/* Saved Presets Pills */}
        {pricePresets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="text-xs text-slate-500">إعدادات محفوظة:</span>
            {pricePresets.map((pr) => (
              <div
                key={pr.id}
                className="inline-flex items-center gap-1 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1 text-xs font-bold text-amber-900"
              >
                <button
                  type="button"
                  onClick={() => {
                    setKindFilter(pr.kindFilter);
                    setThresholdMethod(pr.thresholdMethod);
                    setHigherThanVal(pr.higherThanVal);
                    setLowerThanVal(pr.lowerThanVal);
                    setItemFilter(pr.itemFilter);
                    setPersonIdFilter(pr.personIdFilter);
                    setMinWeightG(pr.minWeightG);
                    setExcludeCompoundItems(pr.excludeCompoundItems);
                    setUseLastKnownGoldPrice(pr.useLastKnownGoldPrice);
                  }}
                >
                  {pr.name}
                </button>
                <button
                  type="button"
                  onClick={() => deletePricePreset(pr.id)}
                  className="text-amber-700 hover:text-red-600 mr-1"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Warning for Days without Recorded Gold Price */}
      {statementData.daysMissingGoldPrice.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              أيام بلا سعر ذهب مسجل صراحةً ({statementData.daysMissingGoldPrice.length} يوم):{' '}
              <span className="font-mono font-bold">
                {statementData.daysMissingGoldPrice.join(' ، ')}
              </span>
            </span>
          </div>
          <span className="font-semibold">
            {useLastKnownGoldPrice
              ? 'يتم حالياً تعويضها بآخر سعر ذهب معروف'
              : 'تم استبعادها من الحساب'}
          </span>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">عدد العمليات خارج الحد</div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900">
            {statementData.allOutCount} عملية
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            أعلى: {statementData.higherRows.length} · أقل: {statementData.lowerRows.length}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">إجمالي الجرامات خارج الحد</div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-amber-800">
            {formatWeight(statementData.totalOutGrams)} جرام
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">
            إجمالي الخسارة المحتملة (أحمر)
          </div>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-red-700">
            {formatNumber(statementData.totalPotentialLoss, 0)} ج.م
          </div>
          <div className="text-[11px] text-slate-500">
            شراء بسعر أعلى أو بيع بسعر أقل من الحد
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">أسوأ عملية (الأكبر أثراً سلبياً)</div>
          {statementData.worstOp ? (
            <>
              <div className="text-base font-extrabold font-mono text-red-700">
                أثر: {formatNumber(Math.abs(statementData.worstOp.financialImpact), 0)} ج.م
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                صف #{statementData.worstOp.rowNumber} ({statementData.worstOp.date}) —{' '}
                {formatWeight(statementData.worstOp.weightG)} جرام
              </div>
            </>
          ) : (
            <div className="text-sm text-emerald-700 font-bold mt-1">
              لا توجد عمليات ذات خسارة محتملة
            </div>
          )}
        </div>
      </div>

      {/* View Mode Sub-Tabs + Export/Print/PDF Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-1.5 bg-white p-1 border border-slate-200 rounded-xl">
          <button
            type="button"
            onClick={() => setViewModeTab('tables')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              viewModeTab === 'tables'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            جداول أعلى وأقل من الحد
          </button>
          <button
            type="button"
            onClick={() => setViewModeTab('by_person')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              viewModeTab === 'by_person'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            حسب الشخص / الموظف
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              exportPriceStatementExcel({
                higherRows: statementData.higherRows,
                lowerRows: statementData.lowerRows,
                settingsDesc: `${reportTitle} | الفترة من ${fromDate} إلى ${toDate} | ${thresholdDescText}`,
              })
            }
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>تصدير Excel</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة A4</span>
          </button>
          <button
            type="button"
            onClick={handleSaveCurrentPdf}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>حفظ PDF</span>
          </button>
        </div>
      </div>

      {viewModeTab === 'tables' ? (
        <div className="space-y-6">
          {renderSectionTable(
            'أولاً: عمليات سعرها أعلى من الحد المرجعي',
            statementData.higherRows
          )}
          {renderSectionTable(
            'ثانياً: عمليات سعرها أقل من الحد المرجعي',
            statementData.lowerRows
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              تحليل الأسعار حسب الشخص / الموظف (متوسط الجميع:{' '}
              {formatNumber(statementData.overallAvgGramPrice, 0)} ج.م/جرام)
            </h3>
            <span className="text-xs text-red-700 font-semibold">
              يتم تمييز أي اسم يبتعد عن متوسط الجميع بأكثر من 2%
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                  <th className="py-2.5 px-3">الاسم</th>
                  <th className="py-2.5 px-3">عدد العمليات</th>
                  <th className="py-2.5 px-3">إجمالي الوزن</th>
                  <th className="py-2.5 px-3">متوسط سعر الجرام</th>
                  <th className="py-2.5 px-3">مقارنة بمتوسط الجميع</th>
                  <th className="py-2.5 px-3">عدد العمليات خارج الحد</th>
                  <th className="py-2.5 px-3">إجمالي الأثر المالي</th>
                </tr>
              </thead>
              <tbody>
                {statementData.byPersonRows.map((p) => (
                  <tr
                    key={p.key}
                    className={`border-b border-slate-200 ${
                      p.isWorseThan2Pct ? 'bg-red-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2.5 px-3 font-bold text-slate-900">
                      {p.name}
                      {p.isWorseThan2Pct && (
                        <span className="mr-2 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px]">
                          فرق &gt; 2%
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono">{p.opsCount}</td>
                    <td className="py-2.5 px-3 font-mono">{formatWeight(p.totalWeight)} ج</td>
                    <td className="py-2.5 px-3 font-mono font-bold">
                      {formatNumber(p.avgGram, 0)} ج.م
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold">
                      {p.diffFromOverallPct > 0 ? '+' : ''}
                      {p.diffFromOverallPct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-amber-800">
                      {p.outCount}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold">
                      {formatNumber(p.totalImpact, 0)} ج.م
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* F3.5 Formal Print Footer with Signature Box */}
      <div className="hidden print-only grid-cols-2 gap-12 mt-12 pt-6 border-t-2 border-slate-400 text-xs">
        <div>
          <p className="font-bold mb-8">
            توقيع المراجع ({settings.auditorName || '................'}):
          </p>
          <div className="border-b border-dashed border-slate-500 w-52" />
        </div>
        <div>
          <p className="font-bold mb-8">توقيع صاحب المحل / المسؤول:</p>
          <div className="border-b border-dashed border-slate-500 w-52" />
        </div>
      </div>

      {/* F3.6 Review + Note Modal */}
      {noteModalOp && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              علامة مراجعة وملاحظة على العملية ({noteModalOp.date})
            </h3>
            <p className="text-xs text-slate-600">
              {noteModalOp.kind === 'sell' ? 'بيع' : 'شراء'} وزن{' '}
              {formatWeight(noteModalOp.weightG)} جرام بإجمالي {formatNumber(noteModalOp.total)}{' '}
              ج.م
            </p>
            <textarea
              rows={3}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="اكتب ملاحظة المراجع (تُحفظ على العملية وفي سجل التعديلات)..."
              className="w-full border border-slate-300 rounded-lg p-2.5 text-xs focus:border-amber-600 outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNoteModalOp(null)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  updateOperation(
                    noteModalOp.id,
                    {
                      reviewedFlag: true,
                      note: noteText.trim(),
                    },
                    noteText.trim() || 'تمت المراجعة من كشف الأسعار'
                  );
                  if (!noteModalOp.reviewedFlag) {
                    toggleOperationReviewed(noteModalOp.id);
                  }
                  setNoteModalOp(null);
                }}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
              >
                حفظ علامة المراجعة والملاحظة ✓
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Day Operations Drill-down Modal when clicking a row */}
      {inspectDate && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                كل عمليات يوم {inspectDate} (سعر الذهب المسجل:{' '}
                {formatNumber(daysMap[inspectDate]?.goldPricePerGram || 0)} ج.م)
              </h3>
              <button
                type="button"
                onClick={() => setInspectDate(null)}
                className="p-1 hover:bg-white/10 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                    <th className="py-2 px-2">النوع</th>
                    <th className="py-2 px-2">الوزن (جرام)</th>
                    <th className="py-2 px-2">الإجمالي</th>
                    <th className="py-2 px-2">سعر الجرام</th>
                    <th className="py-2 px-2">البيان</th>
                    <th className="py-2 px-2">ملاحظة المراجع</th>
                    <th className="py-2 px-2 text-center">علامة مراجعة</th>
                  </tr>
                </thead>
                <tbody>
                  {operations
                    .filter((o) => o.date === inspectDate)
                    .map((o) => (
                      <tr key={o.id} className="border-b border-slate-200">
                        <td className="py-2 px-2 font-bold">
                          {o.kind === 'buy'
                            ? 'شراء'
                            : o.kind === 'sell'
                            ? 'بيع'
                            : o.kind}
                        </td>
                        <td className="py-2 px-2 font-mono">{formatWeight(o.weightG)}</td>
                        <td className="py-2 px-2 font-mono">{formatNumber(o.total)}</td>
                        <td className="py-2 px-2 font-mono font-bold">
                          {o.weightG > 0 ? formatNumber(o.total / o.weightG, 0) : '—'}
                        </td>
                        <td className="py-2 px-2">{o.item || '—'}</td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={o.note || ''}
                            onChange={(e) => updateOperation(o.id, { note: e.target.value })}
                            placeholder="اكتب ملاحظة..."
                            className="w-full px-2 py-1 border border-slate-200 rounded"
                          />
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              updateOperation(o.id, { reviewedFlag: !o.reviewedFlag })
                            }
                            className={`px-2.5 py-1 rounded font-bold ${
                              o.reviewedFlag
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {o.reviewedFlag ? 'تمت المراجعة ✓' : 'علامة مراجعة'}
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
