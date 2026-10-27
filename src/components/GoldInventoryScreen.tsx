import React, { useState, useMemo } from 'react';
import {
  Scale,
  Printer,
  FileDown,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useAuditStore } from '../store/useAuditStore';
import { KaratKey } from '../types';
import { formatNumber, formatWeight, parseWeightInput } from '../utils/numerals';
import { computeDayGoldInventory, KARAT_KEYS } from '../utils/checks/checkGoldInventoryBalance';
import { exportGoldInventoryExcel } from '../utils/exportImport';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';

interface Props {
  onOpenDayInFastEntry?: (date: string) => void;
}

const KARAT_TABS: { key: KaratKey | 'all_21'; label: string }[] = [
  { key: '21', label: 'عيار 21' },
  { key: '18', label: 'عيار 18' },
  { key: '24', label: 'عيار 24' },
  { key: 'other', label: 'عيار آخر' },
  { key: 'all_21', label: 'المكافئ الإجمالي (عيار 21)' },
];

export const GoldInventoryScreen: React.FC<Props> = ({ onOpenDayInFastEntry }) => {
  const {
    operations,
    daysMap,
    settings,
    currentDate,
    setCurrentDate,
    updateDayKaratBalance,
    updateDayInfo,
    updateSettings,
  } = useAuditStore();

  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date(`${currentDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState<string>(currentDate);
  const [selectedKaratTab, setSelectedKaratTab] = useState<KaratKey | 'all_21'>('21');

  const activeDates = useMemo(() => {
    const dateSet = new Set<string>();
    Object.keys(daysMap).forEach((d) => {
      if (d >= fromDate && d <= toDate) dateSet.add(d);
    });
    operations.forEach((op) => {
      if (op.date >= fromDate && op.date <= toDate) dateSet.add(op.date);
    });
    if (currentDate >= fromDate && currentDate <= toDate) {
      dateSet.add(currentDate);
    }
    return Array.from(dateSet).sort();
  }, [daysMap, operations, fromDate, toDate, currentDate]);

  const inventoryRows = useMemo(() => {
    return activeDates.map((date) =>
      computeDayGoldInventory(date, operations, daysMap[date])
    );
  }, [activeDates, operations, daysMap]);

  const periodSummary = useMemo(() => {
    let totalBuyG = 0;
    let totalSellG = 0;
    let totalPersonInG = 0;
    let totalPersonOutG = 0;
    let totalDiffG = 0;
    let totalDiffEgp = 0;
    let daysWithActualCount = 0;
    let daysExceedingTolerance = 0;

    const isCombined = settings.combinedGoldInventory || selectedKaratTab === 'all_21';
    const tol = isCombined
      ? settings.goldBalanceToleranceG || 0.5
      : settings.karatToleranceG?.[selectedKaratTab as KaratKey] ??
        settings.goldBalanceToleranceG ??
        0.5;

    for (const row of inventoryRows) {
      if (settings.combinedGoldInventory) {
        totalBuyG += row.combinedBuyG;
        totalSellG += row.combinedSellG;
        totalPersonInG += row.combinedPersonInG;
        totalPersonOutG += row.combinedPersonOutG;
        if (row.hasCombinedOpening && row.hasCombinedClosing) {
          daysWithActualCount++;
          totalDiffG += row.combinedDiffG;
          totalDiffEgp += row.combinedDiffValueEGP;
          if (Math.abs(row.combinedDiffG) > tol) daysExceedingTolerance++;
        }
      } else if (selectedKaratTab === 'all_21') {
        totalBuyG += row.totalBuy21EqG;
        totalSellG += row.totalSell21EqG;
        if (row.totalPersonNet21EqG > 0) totalPersonInG += row.totalPersonNet21EqG;
        else totalPersonOutG += Math.abs(row.totalPersonNet21EqG);
        if (row.hasAnyKaratData) {
          daysWithActualCount++;
          totalDiffG += row.totalDiff21EqG;
          totalDiffEgp += row.totalDiffValueEGP;
          if (Math.abs(row.totalDiff21EqG) > tol) daysExceedingTolerance++;
        }
      } else {
        const kData = row.byKarat[selectedKaratTab];
        totalBuyG += kData.buyG;
        totalSellG += kData.sellG;
        totalPersonInG += kData.personInG;
        totalPersonOutG += kData.personOutG;
        if (kData.hasOpening && kData.hasActualClosing) {
          daysWithActualCount++;
          totalDiffG += kData.diffG;
          totalDiffEgp += kData.estimatedDiffValueEGP;
          if (Math.abs(kData.diffG) > tol) daysExceedingTolerance++;
        }
      }
    }

    return {
      totalBuyG,
      totalSellG,
      totalPersonInG,
      totalPersonOutG,
      totalDiffG,
      totalDiffEgp,
      daysWithActualCount,
      daysExceedingTolerance,
      toleranceG: tol,
    };
  }, [inventoryRows, selectedKaratTab, settings]);

  const handleSavePdf = async () => {
    const api = ensureGoldApiBridge();
    await api.print.saveToPdf(`جرد-الذهب-${fromDate}-إلى-${toDate}.pdf`);
  };

  const handleExportExcel = () => {
    exportGoldInventoryExcel(inventoryRows, fromDate, toDate);
  };

  const handleToggleCombined = () => {
    const next = !settings.combinedGoldInventory;
    updateSettings({ combinedGoldInventory: next });
    if (next) {
      setSelectedKaratTab('all_21');
    } else {
      setSelectedKaratTab('21');
    }
  };

  const handleEnterKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    colType: 'opening' | 'actual'
  ) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextEl = document.getElementById(`inv-input-${colType}-${rowIndex + 1}`);
      if (nextEl) {
        (nextEl as HTMLInputElement).focus();
        (nextEl as HTMLInputElement).select();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevEl = document.getElementById(`inv-input-${colType}-${rowIndex - 1}`);
      if (prevEl) {
        (prevEl as HTMLInputElement).focus();
        (prevEl as HTMLInputElement).select();
      }
    }
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Print Header */}
      <div className="hidden print-only border-b-2 border-slate-900 pb-3 mb-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold">{settings.shopName || 'محل الذهب'} — كشف جرد الذهب بالعيار</h1>
            <p className="text-sm text-slate-700">
              المراجع: {settings.auditorName || '—'} | الفترة: من {fromDate} إلى {toDate}
            </p>
          </div>
          <div className="text-xs text-left">
            <div>تاريخ الطباعة: {new Date().toLocaleDateString('ar-EG')}</div>
            <div>
              نوع الجرد:{' '}
              {settings.combinedGoldInventory
                ? 'جرد مجمّع بالجرام'
                : selectedKaratTab === 'all_21'
                ? 'المكافئ الإجمالي (عيار 21)'
                : `عيار ${selectedKaratTab === 'other' ? 'آخر' : selectedKaratTab}`}
            </div>
          </div>
        </div>
      </div>

      {/* Top Controls Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              جرد الذهب بالعيار والمكافئ (عيار 21)
            </h2>
            <p className="text-xs text-slate-500">
              رصيد أول اليوم + شراء - بيع + وارد أشخاص - منصرف أشخاص = الرصيد المتوقع ومقارنته بالجرد الفعلي
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-600">من:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-transparent font-mono font-bold text-slate-800 focus:outline-none"
            />
            <span className="text-slate-400">إلى:</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-transparent font-mono font-bold text-slate-800 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={handleToggleCombined}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition-colors cursor-pointer ${
              settings.combinedGoldInventory
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
            title="خيار جرد مجمّع للمحلات التي لا تفصل العيارات في الجرد"
          >
            {settings.combinedGoldInventory ? (
              <ToggleRight className="w-4 h-4 text-amber-600" />
            ) : (
              <ToggleLeft className="w-4 h-4 text-slate-500" />
            )}
            جرد مجمّع
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            تصدير Excel
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            طباعة A4
          </button>

          <button
            type="button"
            onClick={handleSavePdf}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            حفظ PDF
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="text-xs text-slate-500">إجمالي شراء الذهب في الفترة</div>
          <div className="text-lg font-extrabold font-mono text-emerald-700 mt-1">
            +{formatWeight(periodSummary.totalBuyG)} جرام
          </div>
          {periodSummary.totalPersonInG > 0 && (
            <div className="text-[11px] text-slate-500 mt-0.5">
              + وارد من أشخاص: {formatWeight(periodSummary.totalPersonInG)} ج
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="text-xs text-slate-500">إجمالي بيع الذهب في الفترة</div>
          <div className="text-lg font-extrabold font-mono text-amber-700 mt-1">
            -{formatWeight(periodSummary.totalSellG)} جرام
          </div>
          {periodSummary.totalPersonOutG > 0 && (
            <div className="text-[11px] text-slate-500 mt-0.5">
              - منصرف لأشخاص: {formatWeight(periodSummary.totalPersonOutG)} ج
            </div>
          )}
        </div>

        <div
          className={`border rounded-xl p-3.5 ${
            Math.abs(periodSummary.totalDiffG) > periodSummary.toleranceG
              ? 'bg-red-50 border-red-300'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="text-xs text-slate-600">صافي العجز / الزيادة بالجرام</div>
          <div
            className={`text-lg font-extrabold font-mono mt-1 ${
              periodSummary.totalDiffG < -0.01
                ? 'text-red-700'
                : periodSummary.totalDiffG > 0.01
                ? 'text-amber-700'
                : 'text-emerald-700'
            }`}
          >
            {periodSummary.totalDiffG > 0 ? '+' : ''}
            {formatWeight(periodSummary.totalDiffG)} جرام
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {periodSummary.totalDiffG < -0.01
              ? 'عجز في الجرد الفعلي'
              : periodSummary.totalDiffG > 0.01
              ? 'زيادة في الجرد الفعلي'
              : 'مطابق'}
          </div>
        </div>

        <div
          className={`border rounded-xl p-3.5 ${
            Math.abs(periodSummary.totalDiffEgp) > 1000
              ? 'bg-red-50 border-red-300'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="text-xs text-slate-600">القيمة التقديرية للفرق بالجنيه</div>
          <div
            className={`text-lg font-extrabold font-mono mt-1 ${
              periodSummary.totalDiffEgp < 0
                ? 'text-red-700'
                : periodSummary.totalDiffEgp > 0
                ? 'text-amber-700'
                : 'text-slate-800'
            }`}
          >
            {periodSummary.totalDiffEgp > 0 ? '+' : ''}
            {formatNumber(Math.round(periodSummary.totalDiffEgp))} ج.م
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">بسعر جرام العيار في كل يوم</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="text-xs text-slate-500">أيام تتجاوز التسامح المسموح</div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`text-lg font-extrabold font-mono ${
                periodSummary.daysExceedingTolerance > 0 ? 'text-red-600' : 'text-emerald-700'
              }`}
            >
              {periodSummary.daysExceedingTolerance} يوم
            </span>
            <span className="text-xs text-slate-400">
              (تسامح: {formatWeight(periodSummary.toleranceG)} ج)
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            تم جرد {periodSummary.daysWithActualCount} من {inventoryRows.length} يوم
          </div>
        </div>
      </div>

      {/* Karat Selector Tabs */}
      {!settings.combinedGoldInventory && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl p-2.5 no-print">
          <div className="flex flex-wrap gap-1.5">
            {KARAT_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSelectedKaratTab(tab.key)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  selectedKaratTab === tab.key
                    ? 'bg-slate-900 text-amber-400 shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {selectedKaratTab !== 'all_21' && (
            <div className="flex items-center gap-2 text-xs px-2">
              <span className="text-slate-600">هامش التسامح المسموح لهذا العيار (جرام):</span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={String(
                  settings.karatToleranceG?.[selectedKaratTab] ??
                    settings.goldBalanceToleranceG ??
                    0.5
                )}
                key={`tol-${selectedKaratTab}`}
                onBlur={(e) => {
                  const val = parseWeightInput(e.target.value);
                  if (val >= 0) {
                    updateSettings({
                      karatToleranceG: {
                        ...(settings.karatToleranceG || {
                          '18': 0.5,
                          '21': 0.5,
                          '24': 0.5,
                          other: 0.5,
                        }),
                        [selectedKaratTab]: val,
                      },
                    });
                  }
                }}
                className="w-16 border border-slate-300 rounded px-2 py-1 font-mono font-bold text-center"
              />
            </div>
          )}
        </div>
      )}

      {/* Main Inventory Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="py-2.5 px-3 font-bold">التاريخ</th>
                <th className="py-2.5 px-3 font-bold">رصيد أول اليوم (ج)</th>
                <th className="py-2.5 px-3 font-bold text-emerald-300">+ شراء (ج)</th>
                <th className="py-2.5 px-3 font-bold text-amber-300">- بيع (ج)</th>
                <th className="py-2.5 px-3 font-bold text-sky-300">حركة أشخاص (ج)</th>
                <th className="py-2.5 px-3 font-bold bg-slate-800">المتوقع آخر اليوم (ج)</th>
                <th className="py-2.5 px-3 font-bold bg-amber-950/60 text-amber-200">
                  الجرد الفعلي (إدخال سريع Enter)
                </th>
                <th className="py-2.5 px-3 font-bold">الفرق (فعلي - متوقع)</th>
                <th className="py-2.5 px-3 font-bold">القيمة التقديرية للفرق</th>
                <th className="py-2.5 px-3 font-bold">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {inventoryRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400">
                    لا توجد أيام مسجلة في هذه الفترة
                  </td>
                </tr>
              ) : (
                inventoryRows.map((row, idx) => {
                  const isCombinedOnly = settings.combinedGoldInventory;
                  const isEq21Tab = !isCombinedOnly && selectedKaratTab === 'all_21';
                  const kData =
                    !isCombinedOnly && !isEq21Tab
                      ? row.byKarat[selectedKaratTab as KaratKey]
                      : null;

                  const hasOpening = isCombinedOnly
                    ? row.hasCombinedOpening
                    : isEq21Tab
                    ? row.hasAnyKaratData
                    : kData!.hasOpening;
                  const hasActual = isCombinedOnly
                    ? row.hasCombinedClosing
                    : isEq21Tab
                    ? row.hasAnyKaratData
                    : kData!.hasActualClosing;

                  const openingG = isCombinedOnly
                    ? row.combinedOpeningG
                    : isEq21Tab
                    ? row.totalOpening21EqG
                    : kData!.openingG;
                  const buyG = isCombinedOnly
                    ? row.combinedBuyG
                    : isEq21Tab
                    ? row.totalBuy21EqG
                    : kData!.buyG;
                  const sellG = isCombinedOnly
                    ? row.combinedSellG
                    : isEq21Tab
                    ? row.totalSell21EqG
                    : kData!.sellG;
                  const personNetG = isCombinedOnly
                    ? row.combinedPersonInG - row.combinedPersonOutG
                    : isEq21Tab
                    ? row.totalPersonNet21EqG
                    : kData!.personInG - kData!.personOutG;
                  const expectedG = isCombinedOnly
                    ? row.combinedExpectedClosingG
                    : isEq21Tab
                    ? row.totalExpected21EqG
                    : kData!.expectedClosingG;
                  const actualG = isCombinedOnly
                    ? row.combinedActualClosingG
                    : isEq21Tab
                    ? row.totalActual21EqG
                    : kData!.actualClosingG;
                  const diffG = isCombinedOnly
                    ? row.combinedDiffG
                    : isEq21Tab
                    ? row.totalDiff21EqG
                    : kData!.diffG;
                  const estEgp = isCombinedOnly
                    ? row.combinedDiffValueEGP
                    : isEq21Tab
                    ? row.totalDiffValueEGP
                    : kData!.estimatedDiffValueEGP;

                  const exceedsTol =
                    hasOpening &&
                    hasActual &&
                    Math.abs(diffG) > periodSummary.toleranceG;
                  const dayLocked = Boolean(daysMap[row.date]?.locked);

                  return (
                    <tr
                      key={row.date}
                      className={`hover:bg-slate-50 transition-colors ${
                        exceedsTol ? 'bg-red-50/70' : ''
                      }`}
                    >
                      <td className="py-2 px-3 font-bold text-slate-900 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentDate(row.date);
                            onOpenDayInFastEntry?.(row.date);
                          }}
                          className="hover:text-amber-700 underline decoration-dotted font-mono cursor-pointer"
                        >
                          {row.date}
                        </button>
                      </td>

                      {/* Opening Balance Input */}
                      <td className="py-2 px-3">
                        {isEq21Tab ? (
                          <span className="font-mono font-bold text-slate-700">
                            {formatWeight(openingG)} ج
                          </span>
                        ) : (
                          <input
                            id={`inv-input-opening-${idx}`}
                            type="text"
                            inputMode="decimal"
                            disabled={dayLocked}
                            defaultValue={hasOpening ? String(openingG) : ''}
                            key={`open-${row.date}-${selectedKaratTab}-${openingG}`}
                            placeholder="0.000"
                            onKeyDown={(e) => handleEnterKeyDown(e, idx, 'opening')}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              const val = raw === '' ? undefined : parseWeightInput(raw);
                              if (isCombinedOnly) {
                                updateDayInfo(
                                  row.date,
                                  { openingBalanceG: val },
                                  { isManualOpening: true }
                                );
                              } else {
                                updateDayKaratBalance(row.date, selectedKaratTab as KaratKey, {
                                  openingG: val,
                                });
                              }
                            }}
                            className="w-24 border border-slate-300 rounded px-2 py-1 font-mono font-bold text-slate-800 focus:border-amber-500 focus:outline-none disabled:bg-slate-100"
                          />
                        )}
                      </td>

                      <td className="py-2 px-3 font-mono font-bold text-emerald-700">
                        {buyG > 0 ? `+${formatWeight(buyG)}` : '—'}
                      </td>

                      <td className="py-2 px-3 font-mono font-bold text-amber-700">
                        {sellG > 0 ? `-${formatWeight(sellG)}` : '—'}
                      </td>

                      <td className="py-2 px-3 font-mono text-sky-700">
                        {Math.abs(personNetG) > 0.001
                          ? `${personNetG > 0 ? '+' : ''}${formatWeight(personNetG)}`
                          : '—'}
                      </td>

                      <td className="py-2 px-3 font-mono font-bold text-slate-900 bg-slate-50">
                        {formatWeight(expectedG)} ج
                      </td>

                      {/* Actual Closing Input */}
                      <td className="py-2 px-3 bg-amber-50/40">
                        {isEq21Tab ? (
                          <span className="font-mono font-bold text-amber-950">
                            {formatWeight(actualG)} ج
                          </span>
                        ) : (
                          <input
                            id={`inv-input-actual-${idx}`}
                            type="text"
                            inputMode="decimal"
                            disabled={dayLocked}
                            defaultValue={hasActual ? String(actualG) : ''}
                            key={`act-${row.date}-${selectedKaratTab}-${actualG}`}
                            placeholder="أدخل الفعلي..."
                            onKeyDown={(e) => handleEnterKeyDown(e, idx, 'actual')}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              const val = raw === '' ? undefined : parseWeightInput(raw);
                              if (isCombinedOnly) {
                                updateDayInfo(row.date, { closingBalanceG: val });
                              } else {
                                updateDayKaratBalance(row.date, selectedKaratTab as KaratKey, {
                                  closingG: val,
                                });
                              }
                            }}
                            className="w-28 border border-amber-300 bg-white rounded px-2 py-1 font-mono font-bold text-slate-900 focus:border-amber-600 focus:ring-1 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100"
                          />
                        )}
                      </td>

                      <td className="py-2 px-3 font-mono font-bold">
                        {!hasOpening || !hasActual ? (
                          <span className="text-slate-400">لم يُجرد</span>
                        ) : (
                          <span
                            className={
                              diffG < -0.01
                                ? 'text-red-700'
                                : diffG > 0.01
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                            }
                          >
                            {diffG > 0 ? '+' : ''}
                            {formatWeight(diffG)} ج
                          </span>
                        )}
                      </td>

                      <td className="py-2 px-3 font-mono">
                        {!hasOpening || !hasActual ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span
                            className={`font-bold ${
                              estEgp < 0
                                ? 'text-red-700'
                                : estEgp > 0
                                ? 'text-amber-700'
                                : 'text-slate-600'
                            }`}
                          >
                            {estEgp > 0 ? '+' : ''}
                            {formatNumber(Math.round(estEgp))} ج.م
                          </span>
                        )}
                      </td>

                      <td className="py-2 px-3">
                        {!hasOpening || !hasActual ? (
                          <span className="text-[11px] text-slate-400">بانتظار الجرد</span>
                        ) : exceedsTol ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[11px]">
                            <AlertTriangle className="w-3 h-3" />
                            {diffG < 0 ? 'عجز يتجاوز الحد' : 'زيادة تتجاوز الحد'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                            <CheckCircle2 className="w-3 h-3" />
                            مطابق
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Multi-karat breakdown summary table for the last day in range */}
      {inventoryRows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 mb-3">
            ملخص كافة العيارات لآخر يوم في الفترة ({inventoryRows[inventoryRows.length - 1].date})
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            {KARAT_KEYS.map(({ key, label }) => {
              const lastRow = inventoryRows[inventoryRows.length - 1];
              const kd = lastRow.byKarat[key];
              return (
                <div key={key} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  <div className="font-bold text-slate-800 mb-1">{label}</div>
                  <div className="flex justify-between text-slate-600">
                    <span>المتوقع:</span>
                    <span className="font-mono font-bold">
                      {formatWeight(kd.expectedClosingG)} ج
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600 mt-0.5">
                    <span>الفعلي:</span>
                    <span className="font-mono font-bold">
                      {kd.hasActualClosing ? `${formatWeight(kd.actualClosingG)} ج` : 'لم يُجرد'}
                    </span>
                  </div>
                  {kd.hasOpening && kd.hasActualClosing && (
                    <div className="flex justify-between mt-1 pt-1 border-t border-slate-200">
                      <span>الفرق:</span>
                      <span
                        className={`font-mono font-bold ${
                          kd.diffG < 0
                            ? 'text-red-700'
                            : kd.diffG > 0
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {kd.diffG > 0 ? '+' : ''}
                        {formatWeight(kd.diffG)} ج
                      </span>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="border-2 border-amber-300 rounded-lg p-3 bg-amber-50/60">
              <div className="font-bold text-amber-900 mb-1">المكافئ الإجمالي (عيار 21)</div>
              <div className="flex justify-between text-amber-800">
                <span>المتوقع (21):</span>
                <span className="font-mono font-bold">
                  {formatWeight(inventoryRows[inventoryRows.length - 1].totalExpected21EqG)} ج
                </span>
              </div>
              <div className="flex justify-between text-amber-800 mt-0.5">
                <span>الفعلي (21):</span>
                <span className="font-mono font-bold">
                  {inventoryRows[inventoryRows.length - 1].hasAnyKaratData
                    ? `${formatWeight(
                        inventoryRows[inventoryRows.length - 1].totalActual21EqG
                      )} ج`
                    : 'لم يُجرد'}
                </span>
              </div>
              {inventoryRows[inventoryRows.length - 1].hasAnyKaratData && (
                <div className="flex justify-between mt-1 pt-1 border-t border-amber-200">
                  <span>الفرق (21):</span>
                  <span className="font-mono font-bold text-red-700">
                    {formatWeight(inventoryRows[inventoryRows.length - 1].totalDiff21EqG)} ج
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Print Signatures Footer */}
      <div className="hidden print-only grid-cols-2 gap-12 mt-12 pt-6 border-t border-slate-400 text-xs">
        <div>
          <p className="font-bold mb-6">
            توقيع المراجع ({settings.auditorName || '................'}):
          </p>
          <div className="border-b border-dashed border-slate-500 w-48" />
        </div>
        <div>
          <p className="font-bold mb-6">توقيع صاحب المحل / المسؤول:</p>
          <div className="border-b border-dashed border-slate-500 w-48" />
        </div>
      </div>
    </div>
  );
};
