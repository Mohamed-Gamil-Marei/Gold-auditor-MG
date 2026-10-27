import React, { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Coins,
  Upload,
  ClipboardPaste,
  AlertTriangle,
  AlertOctagon,
  Lock,
  Unlock,
  CheckCircle2,
  Printer,
  FileDown,
} from 'lucide-react';
import { useAuditStore } from '../store/useAuditStore';
import {
  formatNumber,
  getEffectiveKaratPrice,
  parseAmountInput,
  parseFlexibleDate,
} from '../utils/numerals';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';

interface GoldPricesScreenProps {
  onOpenDayInFastEntry?: (date: string) => void;
}

export const GoldPricesScreen: React.FC<GoldPricesScreenProps> = ({
  onOpenDayInFastEntry,
}) => {
  const {
    currentDate,
    operations,
    daysMap,
    settings,
    setDayGoldPrice,
    setBulkGoldPrices,
    updateDayInfo,
    toggleDayLock,
  } = useAuditStore();

  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    currentDate.slice(0, 7)
  );
  const [showOnlyMissingOpsDays, setShowOnlyMissingOpsDays] = useState(false);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteStartDate, setPasteStartDate] = useState<string>(() => `${currentDate.slice(0, 7)}-01`);
  const [pasteRawText, setPasteRawText] = useState('');
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'ok' | 'warn' | 'err';
    text: string;
  } | null>(null);

  // Unlock modal for locked days
  const [unlockModalDate, setUnlockModalDate] = useState<string | null>(null);
  const [unlockReason, setUnlockReason] = useState('');

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Count operations per date
  const opsCountByDate = useMemo(() => {
    const map: Record<string, { totalOps: number; goldOps: number }> = {};
    for (const op of operations) {
      if (!map[op.date]) map[op.date] = { totalOps: 0, goldOps: 0 };
      map[op.date].totalOps += 1;
      if (op.kind === 'buy' || op.kind === 'sell') {
        map[op.date].goldOps += 1;
      }
    }
    return map;
  }, [operations]);

  // All dates across ledger that have gold operations but NO confirmed gold price
  const allMissingPriceDatesWithOps = useMemo(() => {
    return Object.keys(opsCountByDate)
      .filter((d) => {
        if (opsCountByDate[d].goldOps <= 0) return false;
        const info = daysMap[d];
        return !info || !info.goldPricePerGram || info.goldPricePerGram <= 0 || info.priceConfirmed === false;
      })
      .sort();
  }, [opsCountByDate, daysMap]);

  // Generate calendar days of selectedMonth (plus any extra dates with missing prices if filter is active)
  const monthRows = useMemo(() => {
    const [yStr, mStr] = selectedMonth.split('-');
    const year = Number(yStr) || 2026;
    const month = Number(mStr) || 10;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const datesList: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      datesList.push(
        `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      );
    }

    // Compute >5% jump relative to previous recorded price
    const allRecordedDates = Array.from(
      new Set([...Object.keys(daysMap), ...datesList])
    ).sort();
    const prevPriceMap: Record<string, { prevDate: string; prevPrice: number }> = {};
    let lastKnown: { date: string; price: number } | null = null;
    for (const dt of allRecordedDates) {
      if (lastKnown) {
        prevPriceMap[dt] = { prevDate: lastKnown.date, prevPrice: lastKnown.price };
      }
      const p = daysMap[dt]?.goldPricePerGram || 0;
      if (p > 0 && daysMap[dt]?.priceConfirmed !== false) {
        lastKnown = { date: dt, price: p };
      }
    }

    const weekdayFormatter = new Intl.DateTimeFormat('ar-EG', { weekday: 'short' });

    const rows = datesList.map((dt) => {
      const info = daysMap[dt];
      const price21 =
        info && info.goldPricePerGram > 0 && info.priceConfirmed !== false
          ? info.goldPricePerGram
          : 0;
      const price18 = getEffectiveKaratPrice(info, 18);
      const price24 = getEffectiveKaratPrice(info, 24);
      const priceOther = info?.goldPriceOther || 0;
      const locked = Boolean(info?.locked);
      const goldOpsCount = opsCountByDate[dt]?.goldOps || 0;
      const isMissingWithOps = goldOpsCount > 0 && price21 <= 0;

      const prevRef = prevPriceMap[dt];
      let jumpPct = 0;
      let hasJumpWarning = false;
      if (price21 > 0 && prevRef && prevRef.prevPrice > 0) {
        jumpPct = ((price21 - prevRef.prevPrice) / prevRef.prevPrice) * 100;
        if (Math.abs(jumpPct) > 5) {
          hasJumpWarning = true;
        }
      }

      const dObj = new Date(`${dt}T00:00:00Z`);
      const dayName = weekdayFormatter.format(dObj);

      return {
        date: dt,
        dayName,
        info,
        price21,
        price18,
        price24,
        priceOther,
        locked,
        goldOpsCount,
        isMissingWithOps,
        jumpPct,
        hasJumpWarning,
        prevRef,
      };
    });

    if (showOnlyMissingOpsDays) {
      return rows.filter((r) => r.isMissingWithOps);
    }
    return rows;
  }, [selectedMonth, daysMap, opsCountByDate, showOnlyMissingOpsDays]);

  const handlePrice21Commit = (date: string, rawVal: string, nextDate?: string) => {
    const dayInfo = daysMap[date];
    if (dayInfo?.locked) {
      setFeedbackBanner({
        type: 'err',
        text: `يوم ${date} مقفول بعد المراجعة — لا يمكن تعديل سعر الذهب إلا بعد فتح القفل مع ذكر السبب.`,
      });
      return;
    }

    const parsed = parseAmountInput(rawVal);
    if (parsed > 0) {
      setDayGoldPrice(date, parsed, true);
    }
    if (nextDate && inputRefs.current[nextDate]) {
      inputRefs.current[nextDate]?.focus();
      inputRefs.current[nextDate]?.select();
    }
  };

  // Handle Ctrl+V multi-line paste directly inside any day's 21K price input
  const handleDirectColumnPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    startDate: string
  ) => {
    const clip = e.clipboardData.getData('text');
    if (!clip || (!clip.includes('\n') && !clip.includes('\t'))) {
      return; // normal single value paste
    }
    e.preventDefault();
    applyPastedLinesFromStartDate(clip, startDate);
  };

  const applyPastedLinesFromStartDate = (rawText: string, startDate: string) => {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return;

    const entries: { date: string; price21: number }[] = [];
    let currentCursorDate = startDate;

    const addDaysIso = (iso: string, add: number): string => {
      const dt = new Date(`${iso}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + add);
      return dt.toISOString().slice(0, 10);
    };

    for (const line of lines) {
      const parts = line.split(/[\t,;]+/).map((p) => p.trim());
      if (parts.length >= 2) {
        const maybeDate = parseFlexibleDate(parts[0], settings.dateFormatOrder);
        const maybePrice = parseAmountInput(parts[1]);
        if (maybeDate && maybePrice > 0) {
          entries.push({ date: maybeDate, price21: maybePrice });
          currentCursorDate = addDaysIso(maybeDate, 1);
          continue;
        }
      }
      // Single column of prices -> assign sequentially starting from currentCursorDate
      const priceVal = parseAmountInput(parts[0]);
      if (priceVal > 0) {
        entries.push({ date: currentCursorDate, price21: priceVal });
        currentCursorDate = addDaysIso(currentCursorDate, 1);
      }
    }

    if (entries.length === 0) {
      setFeedbackBanner({
        type: 'err',
        text: 'لم يتم العثور على أسعار صالحة في النص الملصوق.',
      });
      return;
    }

    const res = setBulkGoldPrices(entries);
    setPasteModalOpen(false);
    setPasteRawText('');
    setFeedbackBanner({
      type: res.skippedLockedDates.length > 0 ? 'warn' : 'ok',
      text: `تم تسجيل أسعار الذهب لـ ${res.updatedCount} يوم بنجاح ✓${
        res.skippedLockedDates.length > 0
          ? ` (تم تخطي الأيام المقفولة: ${res.skippedLockedDates.join(' ، ')})`
          : ''
      }`,
    });
  };

  // Import Excel/CSV file (Date, Price)
  const handleImportExcelPrices = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

        const entries: {
          date: string;
          price21: number;
          price18?: number;
          price24?: number;
        }[] = [];

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (!Array.isArray(r) || r.length < 2) continue;
          const dt = parseFlexibleDate(r[0], settings.dateFormatOrder);
          const p21 = parseAmountInput(String(r[1] ?? ''));
          if (dt && p21 > 0) {
            const p18 = r[2] ? parseAmountInput(String(r[2])) : undefined;
            const p24 = r[3] ? parseAmountInput(String(r[3])) : undefined;
            entries.push({
              date: dt,
              price21: p21,
              ...(p18 && p18 > 0 ? { price18: p18 } : {}),
              ...(p24 && p24 > 0 ? { price24: p24 } : {}),
            });
          }
        }

        if (entries.length === 0) {
          setFeedbackBanner({
            type: 'err',
            text: 'لم يتم العثور على صفوف صالحة (العمود الأول: التاريخ، العمود الثاني: سعر عيار 21).',
          });
          return;
        }

        const res = setBulkGoldPrices(entries);
        setFeedbackBanner({
          type: res.skippedLockedDates.length > 0 ? 'warn' : 'ok',
          text: `تم استيراد أسعار الذهب لـ ${res.updatedCount} يوم من ملف Excel/CSV بنجاح ✓${
            res.skippedLockedDates.length > 0
              ? ` (تم تخطي الأيام المقفولة: ${res.skippedLockedDates.join(' ، ')})`
              : ''
          }`,
        });
      } catch {
        setFeedbackBanner({
          type: 'err',
          text: 'تعذر قراءة ملف الأسعار. تأكد أنه بصيغة Excel أو CSV.',
        });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Top Header & Counters */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                جدول أسعار الذهب اليومية بالجملة (عيار 21 و 18 و 24)
              </h2>
              <p className="text-xs text-slate-500">
                أدخل السعر واضغط Enter للانتقال لليوم التالي، أو الصق عمود أسعار من Excel مباشرة بـ Ctrl+V.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Days Missing Price Counter Badge */}
            <button
              type="button"
              onClick={() => setShowOnlyMissingOpsDays((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 border cursor-pointer transition-colors ${
                allMissingPriceDatesWithOps.length > 0
                  ? 'bg-red-100 text-red-900 border-red-300 hover:bg-red-200'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200'
              }`}
            >
              {allMissingPriceDatesWithOps.length > 0 ? (
                <>
                  <AlertOctagon className="w-4 h-4 text-red-600" />
                  <span>أيام فيها عمليات وبلا سعر: {allMissingPriceDatesWithOps.length}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>كل أيام العمليات مسجل لها سعر ✓</span>
                </>
              )}
            </button>

            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedMonth(e.target.value);
                  setPasteStartDate(`${e.target.value}-01`);
                }
              }}
              className="px-3 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded-lg bg-slate-50"
            />

            <button
              type="button"
              onClick={() => setPasteModalOpen(true)}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-extrabold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ClipboardPaste className="w-4 h-4" />
              <span>لصق عمود أسعار (Ctrl+V)</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>استيراد Excel / CSV</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportExcelPrices}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة</span>
            </button>

            <button
              type="button"
              onClick={() =>
                ensureGoldApiBridge().print.saveToPdf(`أسعار_الذهب_${selectedMonth}.pdf`)
              }
              className="px-3 py-1.5 bg-slate-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
              <span>حفظ PDF</span>
            </button>
          </div>
        </div>

        {/* All Missing Dates Banner */}
        {allMissingPriceDatesWithOps.length > 0 && (
          <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-xs text-red-950 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold">
              <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
              <span>
                تنبيه: توجد أيام مسجل بها عمليات بيع/شراء وليس لها سعر ذهب مؤكد:{' '}
                <span className="font-mono underline">
                  {allMissingPriceDatesWithOps.join(' ، ')}
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                const firstMissingMonth = allMissingPriceDatesWithOps[0].slice(0, 7);
                setSelectedMonth(firstMissingMonth);
                setShowOnlyMissingOpsDays((v) => !v);
              }}
              className="px-2.5 py-1 bg-red-700 text-white rounded-lg font-bold cursor-pointer"
            >
              {showOnlyMissingOpsDays ? 'عرض كل أيام الشهر' : 'عرض الأيام الناقصة فقط'}
            </button>
          </div>
        )}

        {feedbackBanner && (
          <div
            className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-between ${
              feedbackBanner.type === 'ok'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : feedbackBanner.type === 'warn'
                ? 'bg-amber-50 border-amber-300 text-amber-950'
                : 'bg-red-50 border-red-300 text-red-900'
            }`}
          >
            <span>{feedbackBanner.text}</span>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="text-slate-500 hover:text-slate-800 font-bold"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Monthly Prices Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                <th className="py-2.5 px-3 w-28">التاريخ</th>
                <th className="py-2.5 px-3 w-20">اليوم</th>
                <th className="py-2.5 px-3 w-28">عمليات اليوم</th>
                <th className="py-2.5 px-3 w-44">سعر عيار 21 (الأساسي)</th>
                <th className="py-2.5 px-3 w-36">سعر عيار 18</th>
                <th className="py-2.5 px-3 w-36">سعر عيار 24</th>
                <th className="py-2.5 px-3 w-36">عيار خاص / آخر</th>
                <th className="py-2.5 px-3">الحالة والتنبيهات (فرق &gt; 5%)</th>
                <th className="py-2.5 px-3 w-28 text-center no-print">القفل</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((row, idx) => {
                const nextDate = monthRows[idx + 1]?.date;
                return (
                  <tr
                    key={row.date}
                    className={`border-b border-slate-200 transition-colors ${
                      row.isMissingWithOps
                        ? 'bg-red-50/90 hover:bg-red-100/70'
                        : row.hasJumpWarning
                        ? 'bg-amber-50/70 hover:bg-amber-100/50'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2 px-3 font-mono font-bold text-slate-900">
                      <button
                        type="button"
                        onClick={() => onOpenDayInFastEntry?.(row.date)}
                        className="hover:text-amber-700 hover:underline cursor-pointer"
                        title="افتح اليوم في الإدخال السريع"
                      >
                        {row.date}
                      </button>
                    </td>
                    <td className="py-2 px-3 text-slate-600 font-semibold">{row.dayName}</td>
                    <td className="py-2 px-3 font-mono">
                      {row.goldOpsCount > 0 ? (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">
                          {row.goldOpsCount} عملية
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* 21K Base Price Input */}
                    <td className="py-1.5 px-3">
                      <input
                        ref={(el) => {
                          inputRefs.current[row.date] = el;
                        }}
                        type="text"
                        inputMode="decimal"
                        disabled={row.locked}
                        defaultValue={row.price21 > 0 ? String(row.price21) : ''}
                        key={`p21-${row.date}-${row.price21}`}
                        placeholder="أدخل سعر 21..."
                        onPaste={(e) => handleDirectColumnPaste(e, row.date)}
                        onBlur={(e) => {
                          const val = parseAmountInput(e.target.value);
                          if (val !== row.price21 && val > 0) {
                            handlePrice21Commit(row.date, e.target.value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handlePrice21Commit(
                              row.date,
                              (e.target as HTMLInputElement).value,
                              nextDate
                            );
                          }
                        }}
                        className={`w-36 px-2.5 py-1.5 font-mono font-extrabold text-sm rounded-lg border outline-none ${
                          row.locked
                            ? 'bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed'
                            : row.isMissingWithOps
                            ? 'bg-white border-2 border-red-600 text-red-900 focus:ring-2 focus:ring-red-300'
                            : 'bg-white border-slate-300 text-slate-900 focus:border-amber-600'
                        }`}
                      />
                    </td>

                    {/* 18K Price Input (auto or manual override) */}
                    <td className="py-1.5 px-3">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={row.locked || row.price21 <= 0}
                        defaultValue={row.price18 > 0 ? String(row.price18) : ''}
                        key={`p18-${row.date}-${row.price18}`}
                        placeholder={
                          row.price21 > 0
                            ? String(Math.round((row.price21 * 18) / 21))
                            : 'تلقائي'
                        }
                        onBlur={(e) => {
                          const v = parseAmountInput(e.target.value);
                          if (v > 0 && v !== row.price18) {
                            updateDayInfo(row.date, { goldPrice18: v });
                          }
                        }}
                        className="w-28 px-2 py-1 font-mono text-xs rounded border border-slate-200 bg-slate-50 focus:bg-white"
                      />
                    </td>

                    {/* 24K Price Input (auto or manual override) */}
                    <td className="py-1.5 px-3">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={row.locked || row.price21 <= 0}
                        defaultValue={row.price24 > 0 ? String(row.price24) : ''}
                        key={`p24-${row.date}-${row.price24}`}
                        placeholder={
                          row.price21 > 0
                            ? String(Math.round((row.price21 * 24) / 21))
                            : 'تلقائي'
                        }
                        onBlur={(e) => {
                          const v = parseAmountInput(e.target.value);
                          if (v > 0 && v !== row.price24) {
                            updateDayInfo(row.date, { goldPrice24: v });
                          }
                        }}
                        className="w-28 px-2 py-1 font-mono text-xs rounded border border-slate-200 bg-slate-50 focus:bg-white"
                      />
                    </td>

                    {/* Other Karat Price Input */}
                    <td className="py-1.5 px-3">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={row.locked}
                        defaultValue={row.priceOther > 0 ? String(row.priceOther) : ''}
                        key={`pOther-${row.date}-${row.priceOther}`}
                        placeholder="اختياري..."
                        onBlur={(e) => {
                          const v = parseAmountInput(e.target.value);
                          if (v !== row.priceOther) {
                            updateDayInfo(row.date, {
                              goldPriceOther: v > 0 ? v : undefined,
                            });
                          }
                        }}
                        className="w-28 px-2 py-1 font-mono text-xs rounded border border-slate-200 bg-slate-50 focus:bg-white"
                      />
                    </td>

                    {/* Status & >5% Jump Warning */}
                    <td className="py-2 px-3">
                      {row.isMissingWithOps && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 text-white font-bold">
                          <AlertOctagon className="w-3.5 h-3.5" />
                          <span>يوم به عمليات بدون سعر!</span>
                        </span>
                      )}
                      {row.hasJumpWarning && row.prevRef && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 border border-amber-400 text-amber-950 font-bold">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                          <span>
                            تغير {row.jumpPct > 0 ? '+' : ''}
                            {row.jumpPct.toFixed(1)}% عن يوم {row.prevRef.prevDate} (
                            {formatNumber(row.prevRef.prevPrice)}) — احتمال خطأ كتابة
                          </span>
                        </span>
                      )}
                      {!row.isMissingWithOps && !row.hasJumpWarning && row.price21 > 0 && (
                        <span className="text-emerald-700 font-bold inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> مسجل ومؤكد
                        </span>
                      )}
                    </td>

                    {/* Lock / Unlock */}
                    <td className="py-2 px-3 text-center no-print">
                      {row.locked ? (
                        <button
                          type="button"
                          onClick={() => {
                            setUnlockModalDate(row.date);
                            setUnlockReason('');
                          }}
                          className="px-2.5 py-1 rounded bg-red-100 hover:bg-red-200 text-red-900 font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Lock className="w-3 h-3" />
                          <span>مقفول (فتح)</span>
                        </button>
                      ) : (
                        <span className="text-slate-400 inline-flex items-center gap-1">
                          <Unlock className="w-3 h-3" /> مفتوح
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

      {/* Paste Column Modal */}
      {pasteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-extrabold text-slate-900">
              لصق عمود أسعار من Excel دفعة واحدة
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              يمكنك لصق عمود أسعار فقط (كل يوم في سطر بدءاً من تاريخ البداية المحدد) أو لصق عمودين (التاريخ + السعر).
            </p>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                تاريخ أول سطر (إذا كان الملصوق أرقام أسعار فقط):
              </label>
              <input
                type="date"
                value={pasteStartDate}
                onChange={(e) => setPasteStartDate(e.target.value)}
                className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <textarea
              rows={7}
              value={pasteRawText}
              onChange={(e) => setPasteRawText(e.target.value)}
              placeholder={`مثال:\n7450\n7465\n7440\nأو:\n2026-10-01\t7450`}
              className="w-full p-3 text-xs font-mono border border-slate-300 rounded-lg outline-none focus:border-amber-600"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPasteModalOpen(false)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => applyPastedLinesFromStartDate(pasteRawText, pasteStartDate)}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-extrabold rounded-lg"
              >
                تطبيق الأسعار الآن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlock Day Reason Modal (F6: تعديل سعر يوم مقفول يتطلب فتح القفل بسبب ويُسجل في السجل) */}
      {unlockModalDate && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-extrabold text-slate-900">
              فتح قفل يوم {unlockModalDate} لتعديل السعر
            </h3>
            <p className="text-xs text-slate-600">
              هذا اليوم مقفول بعد المراجعة. يرجى كتابة سبب فتح القفل ليتم تسجيله في سجل التعديلات:
            </p>
            <input
              type="text"
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              placeholder="مثال: تصحيح سعر الذهب اليومي من الدفتر..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg outline-none focus:border-amber-600"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnlockModalDate(null)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!unlockReason.trim()) return;
                  toggleDayLock(unlockModalDate, false, unlockReason.trim());
                  setUnlockModalDate(null);
                  setUnlockReason('');
                }}
                disabled={!unlockReason.trim()}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg"
              >
                فتح القفل وتسجيل السبب
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
