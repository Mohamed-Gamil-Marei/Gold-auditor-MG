import React, { useState } from 'react';
import {
  Filter,
  Search,
  X,
  Bookmark,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DayInfo,
  GoldKarat,
  Operation,
  OperationKind,
  Person,
  SavedFilterPreset,
  UnifiedFilterState,
  Worker,
} from '../../types';
import {
  formatNumber,
  formatWeight,
  getTodayIso,
  normalizeArabicName,
} from '../../utils/numerals';

export function createDefaultUnifiedFilter(
  overrides?: Partial<UnifiedFilterState>
): UnifiedFilterState {
  return {
    fromDate: '',
    toDate: '',
    datePreset: 'all',
    kinds: [],
    karats: [],
    itemQuery: '',
    personId: '',
    workerId: '',
    minWeight: '',
    maxWeight: '',
    minTotal: '',
    maxTotal: '',
    minGramPrice: '',
    maxGramPrice: '',
    severities: [],
    reviewState: 'all',
    paymentType: 'all',
    dayLockState: 'all',
    searchQuery: '',
    ...overrides,
  };
}

export function computeDatePresetRange(
  preset: UnifiedFilterState['datePreset'],
  referenceToday = getTodayIso()
): { fromDate: string; toDate: string } {
  const base = new Date(`${referenceToday}T12:00:00`);
  if (Number.isNaN(base.getTime())) {
    return { fromDate: '', toDate: '' };
  }
  const toIso = (d: Date) => d.toISOString().slice(0, 10);

  if (preset === 'today') {
    return { fromDate: referenceToday, toDate: referenceToday };
  }
  if (preset === 'yesterday') {
    const y = new Date(base);
    y.setDate(y.getDate() - 1);
    const iso = toIso(y);
    return { fromDate: iso, toDate: iso };
  }
  if (preset === 'week') {
    const w = new Date(base);
    w.setDate(w.getDate() - 6);
    return { fromDate: toIso(w), toDate: referenceToday };
  }
  if (preset === 'month') {
    const mStart = `${referenceToday.slice(0, 7)}-01`;
    return { fromDate: mStart, toDate: referenceToday };
  }
  if (preset === 'last_month') {
    const firstThisMonth = new Date(base.getFullYear(), base.getMonth(), 1);
    const lastPrevMonth = new Date(firstThisMonth.getTime() - 24 * 60 * 60 * 1000);
    const firstPrevMonth = new Date(
      lastPrevMonth.getFullYear(),
      lastPrevMonth.getMonth(),
      1
    );
    return { fromDate: toIso(firstPrevMonth), toDate: toIso(lastPrevMonth) };
  }
  if (preset === 'last_30') {
    const d30 = new Date(base);
    d30.setDate(d30.getDate() - 29);
    return { fromDate: toIso(d30), toDate: referenceToday };
  }
  return { fromDate: '', toDate: '' };
}

/**
 * Applies `UnifiedFilterState` (AND across different fields, OR within multi-select fields)
 * to a list of `Operation` records and returns filtered rows + live totals.
 */
export function applyUnifiedFilterToOperations(params: {
  operations: Operation[];
  filter: UnifiedFilterState;
  daysMap: Record<string, DayInfo>;
  persons: Person[];
  workers: Worker[];
}): {
  filtered: Operation[];
  totalWeightG: number;
  totalAmountEGP: number;
  buyWeightG: number;
  sellWeightG: number;
  activeChips: { key: string; label: string; onClear: (f: UnifiedFilterState) => UnifiedFilterState }[];
} {
  const { operations, filter, daysMap, persons, workers } = params;
  const personsMap = new Map(persons.map((p) => [p.id, p.name]));
  const workersMap = new Map(workers.map((w) => [w.id, w.name]));

  const minW = filter.minWeight.trim() !== '' ? Number(filter.minWeight) : null;
  const maxW = filter.maxWeight.trim() !== '' ? Number(filter.maxWeight) : null;
  const minT = filter.minTotal.trim() !== '' ? Number(filter.minTotal) : null;
  const maxT = filter.maxTotal.trim() !== '' ? Number(filter.maxTotal) : null;
  const minGP = filter.minGramPrice.trim() !== '' ? Number(filter.minGramPrice) : null;
  const maxGP = filter.maxGramPrice.trim() !== '' ? Number(filter.maxGramPrice) : null;

  const normItem = normalizeArabicName(filter.itemQuery);
  const normSearch = normalizeArabicName(filter.searchQuery);

  let totalWeightG = 0;
  let totalAmountEGP = 0;
  let buyWeightG = 0;
  let sellWeightG = 0;

  const filtered = operations.filter((op) => {
    if (filter.fromDate && op.date < filter.fromDate) return false;
    if (filter.toDate && op.date > filter.toDate) return false;

    if (filter.kinds.length > 0 && !filter.kinds.includes(op.kind)) return false;

    if (filter.karats.length > 0) {
      const k = op.karat || 21;
      if (!filter.karats.includes(k)) return false;
    }

    if (filter.personId && op.personId !== filter.personId) return false;
    if (filter.workerId && op.workerId !== filter.workerId) return false;

    if (filter.paymentType !== 'all' && op.payment !== filter.paymentType) return false;

    if (filter.reviewState === 'reviewed' && !op.reviewedFlag) return false;
    if (filter.reviewState === 'unreviewed' && op.reviewedFlag) return false;

    if (filter.dayLockState !== 'all') {
      const isLocked = Boolean(daysMap[op.date]?.locked);
      if (filter.dayLockState === 'locked' && !isLocked) return false;
      if (filter.dayLockState === 'open' && isLocked) return false;
    }

    if (minW !== null && Number.isFinite(minW) && op.weightG < minW) return false;
    if (maxW !== null && Number.isFinite(maxW) && op.weightG > maxW) return false;
    if (minT !== null && Number.isFinite(minT) && op.total < minT) return false;
    if (maxT !== null && Number.isFinite(maxT) && op.total > maxT) return false;

    if (minGP !== null || maxGP !== null) {
      const gp = op.weightG > 0 ? op.total / op.weightG : 0;
      if (minGP !== null && Number.isFinite(minGP) && gp < minGP) return false;
      if (maxGP !== null && Number.isFinite(maxGP) && gp > maxGP) return false;
    }

    if (normItem) {
      const hay = normalizeArabicName(`${op.item || ''} ${op.category || ''}`);
      if (!hay.includes(normItem)) return false;
    }

    if (normSearch) {
      const pName = (op.personId && personsMap.get(op.personId)) || '';
      const wName = (op.workerId && workersMap.get(op.workerId)) || '';
      const fullHay = normalizeArabicName(
        `${op.date} ${op.item || ''} ${op.category || ''} ${op.note || ''} ${pName} ${wName} ${
          op.weightG
        } ${op.total}`
      );
      if (!fullHay.includes(normSearch)) return false;
    }

    totalWeightG += op.weightG || 0;
    totalAmountEGP += op.total || 0;
    if (op.kind === 'buy') buyWeightG += op.weightG || 0;
    if (op.kind === 'sell') sellWeightG += op.weightG || 0;
    return true;
  });

  const activeChips: {
    key: string;
    label: string;
    onClear: (f: UnifiedFilterState) => UnifiedFilterState;
  }[] = [];

  if (filter.fromDate || filter.toDate) {
    activeChips.push({
      key: 'date',
      label: `الفترة: ${filter.fromDate || 'البداية'} ← ${filter.toDate || 'الآن'}`,
      onClear: (f) => ({ ...f, fromDate: '', toDate: '', datePreset: 'all' }),
    });
  }
  if (filter.kinds.length > 0) {
    const kindLabels: Record<OperationKind, string> = {
      buy: 'شراء',
      sell: 'بيع',
      expense: 'مصروف',
      advance: 'سلفة',
      person: 'شخص',
    };
    activeChips.push({
      key: 'kinds',
      label: `النوع: ${filter.kinds.map((k) => kindLabels[k]).join(' أو ')}`,
      onClear: (f) => ({ ...f, kinds: [] }),
    });
  }
  if (filter.karats.length > 0) {
    activeChips.push({
      key: 'karats',
      label: `العيار: ${filter.karats.join(' أو ')}`,
      onClear: (f) => ({ ...f, karats: [] }),
    });
  }
  if (filter.personId) {
    activeChips.push({
      key: 'person',
      label: `الشخص: ${personsMap.get(filter.personId) || filter.personId}`,
      onClear: (f) => ({ ...f, personId: '' }),
    });
  }
  if (filter.workerId) {
    activeChips.push({
      key: 'worker',
      label: `العامل: ${workersMap.get(filter.workerId) || filter.workerId}`,
      onClear: (f) => ({ ...f, workerId: '' }),
    });
  }
  if (filter.paymentType !== 'all') {
    activeChips.push({
      key: 'payment',
      label: `الدفع: ${filter.paymentType === 'credit' ? 'آجل' : 'نقدي'}`,
      onClear: (f) => ({ ...f, paymentType: 'all' }),
    });
  }
  if (filter.reviewState !== 'all') {
    activeChips.push({
      key: 'review',
      label: `المراجعة: ${filter.reviewState === 'reviewed' ? 'مراجَع' : 'غير مراجَع'}`,
      onClear: (f) => ({ ...f, reviewState: 'all' }),
    });
  }
  if (filter.dayLockState !== 'all') {
    activeChips.push({
      key: 'lock',
      label: `حالة اليوم: ${filter.dayLockState === 'locked' ? 'مقفول' : 'مفتوح'}`,
      onClear: (f) => ({ ...f, dayLockState: 'all' }),
    });
  }
  if (filter.minWeight || filter.maxWeight) {
    activeChips.push({
      key: 'weight',
      label: `الوزن: ${filter.minWeight || 0}–${filter.maxWeight || '∞'} ج`,
      onClear: (f) => ({ ...f, minWeight: '', maxWeight: '' }),
    });
  }
  if (filter.minTotal || filter.maxTotal) {
    activeChips.push({
      key: 'total',
      label: `المبلغ: ${filter.minTotal || 0}–${filter.maxTotal || '∞'} ج.م`,
      onClear: (f) => ({ ...f, minTotal: '', maxTotal: '' }),
    });
  }
  if (filter.minGramPrice || filter.maxGramPrice) {
    activeChips.push({
      key: 'gramPrice',
      label: `سعر الجرام: ${filter.minGramPrice || 0}–${filter.maxGramPrice || '∞'}`,
      onClear: (f) => ({ ...f, minGramPrice: '', maxGramPrice: '' }),
    });
  }
  if (filter.itemQuery.trim()) {
    activeChips.push({
      key: 'item',
      label: `الصنف: "${filter.itemQuery}"`,
      onClear: (f) => ({ ...f, itemQuery: '' }),
    });
  }
  if (filter.searchQuery.trim()) {
    activeChips.push({
      key: 'search',
      label: `بحث: "${filter.searchQuery}"`,
      onClear: (f) => ({ ...f, searchQuery: '' }),
    });
  }

  return {
    filtered,
    totalWeightG,
    totalAmountEGP,
    buyWeightG,
    sellWeightG,
    activeChips,
  };
}

interface FilterBarProps {
  screenId: string;
  filter: UnifiedFilterState;
  onChange: (next: UnifiedFilterState) => void;
  totalCount: number;
  filteredCount: number;
  filteredWeightG?: number;
  filteredAmountEGP?: number;
  persons?: Person[];
  workers?: Worker[];
  savedPresets?: SavedFilterPreset[];
  onSavePreset?: (name: string, filter: UnifiedFilterState) => void;
  onDeletePreset?: (id: string) => void;
  extraActions?: React.ReactNode;
  referenceToday?: string;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  screenId,
  filter,
  onChange,
  totalCount,
  filteredCount,
  filteredWeightG,
  filteredAmountEGP,
  persons = [],
  workers = [],
  savedPresets = [],
  onSavePreset,
  onDeletePreset,
  extraActions,
  referenceToday,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [showPresetSaveInput, setShowPresetSaveInput] = useState(false);

  const screenPresets = savedPresets.filter((p) => p.screenId === screenId);

  const applyPresetButton = (preset: UnifiedFilterState['datePreset']) => {
    if (preset === 'all') {
      onChange({ ...filter, datePreset: 'all', fromDate: '', toDate: '' });
      return;
    }
    const range = computeDatePresetRange(preset, referenceToday || getTodayIso());
    onChange({
      ...filter,
      datePreset: preset,
      fromDate: range.fromDate,
      toDate: range.toDate,
    });
  };

  const toggleKind = (k: OperationKind) => {
    const exists = filter.kinds.includes(k);
    const nextKinds = exists
      ? filter.kinds.filter((x) => x !== k)
      : [...filter.kinds, k];
    onChange({ ...filter, kinds: nextKinds });
  };

  const toggleKarat = (k: GoldKarat) => {
    const exists = filter.karats.includes(k);
    const nextKarats = exists
      ? filter.karats.filter((x) => x !== k)
      : [...filter.karats, k];
    onChange({ ...filter, karats: nextKarats });
  };

  const resetAll = () => {
    onChange(createDefaultUnifiedFilter());
  };

  const hasAnyActiveFilter =
    Boolean(filter.fromDate) ||
    Boolean(filter.toDate) ||
    filter.kinds.length > 0 ||
    filter.karats.length > 0 ||
    Boolean(filter.itemQuery.trim()) ||
    Boolean(filter.personId) ||
    Boolean(filter.workerId) ||
    Boolean(filter.minWeight) ||
    Boolean(filter.maxWeight) ||
    Boolean(filter.minTotal) ||
    Boolean(filter.maxTotal) ||
    Boolean(filter.minGramPrice) ||
    Boolean(filter.maxGramPrice) ||
    filter.reviewState !== 'all' ||
    filter.paymentType !== 'all' ||
    filter.dayLockState !== 'all' ||
    Boolean(filter.searchQuery.trim());

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3 shadow-2xs no-print">
      {/* Row 1: Quick Date Presets, Free Text Search, Advanced Toggle, Live Counter & Totals, Extra Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex items-center gap-1 text-xs font-extrabold text-slate-800 ml-1">
            <Filter className="w-3.5 h-3.5 text-amber-600" />
            <span>الفلترة:</span>
          </div>

          {/* Date Quick Buttons */}
          {(
            [
              { id: 'all', label: 'الكل' },
              { id: 'today', label: 'اليوم' },
              { id: 'yesterday', label: 'أمس' },
              { id: 'week', label: 'الأسبوع' },
              { id: 'month', label: 'الشهر' },
              { id: 'last_month', label: 'الشهر الماضي' },
              { id: 'last_30', label: 'آخر 30 يوماً' },
            ] as const
          ).map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => applyPresetButton(btn.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                filter.datePreset === btn.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {btn.label}
            </button>
          ))}

          {/* Quick Search Input */}
          <div className="relative min-w-[180px] sm:min-w-[210px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2" />
            <input
              type="text"
              value={filter.searchQuery}
              onChange={(e) => onChange({ ...filter, searchQuery: e.target.value })}
              placeholder="بحث نصي في البيان أو الشخص..."
              className="w-full pr-8 pl-2.5 py-1 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:border-amber-600 outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1 border cursor-pointer ${
              expanded || hasAnyActiveFilter
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>فلاتر متقدمة</span>
          </button>

          {hasAnyActiveFilter && (
            <button
              type="button"
              onClick={resetAll}
              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-700 hover:bg-red-100 inline-flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>مسح الكل</span>
            </button>
          )}
        </div>

        {/* Right Side: Live Counter + Totals + Extra Actions (e.g., Export / Print button) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-bold text-slate-800 flex flex-wrap items-center gap-2">
            <span>
              تم عرض{' '}
              <strong className="font-mono text-amber-800">
                {formatNumber(filteredCount)}
              </strong>{' '}
              من{' '}
              <strong className="font-mono">{formatNumber(totalCount)}</strong>
            </span>
            {filteredWeightG !== undefined && filteredWeightG > 0 && (
              <>
                <span className="text-slate-300">|</span>
                <span className="font-mono text-teal-800">
                  {formatWeight(filteredWeightG)} جرام
                </span>
              </>
            )}
            {filteredAmountEGP !== undefined && filteredAmountEGP > 0 && (
              <>
                <span className="text-slate-300">|</span>
                <span className="font-mono text-slate-900">
                  {formatNumber(filteredAmountEGP)} ج.م
                </span>
              </>
            )}
          </div>
          {extraActions}
        </div>
      </div>

      {/* Expanded Multi-Field Composable Filters */}
      {expanded && (
        <div className="pt-3 border-t border-slate-200 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Custom Date Range */}
            <div className="flex items-center gap-1.5">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  من تاريخ:
                </label>
                <input
                  type="date"
                  value={filter.fromDate}
                  onChange={(e) =>
                    onChange({
                      ...filter,
                      fromDate: e.target.value,
                      datePreset: 'custom',
                    })
                  }
                  className="w-full px-2 py-1 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  إلى تاريخ:
                </label>
                <input
                  type="date"
                  value={filter.toDate}
                  onChange={(e) =>
                    onChange({
                      ...filter,
                      toDate: e.target.value,
                      datePreset: 'custom',
                    })
                  }
                  className="w-full px-2 py-1 font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Kind Multi-Select (OR within field) */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                نوع العملية (يمكن اختيار أكثر من نوع):
              </label>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { id: 'sell', label: 'بيع' },
                    { id: 'buy', label: 'شراء' },
                    { id: 'expense', label: 'مصروف' },
                    { id: 'advance', label: 'سلفة' },
                    { id: 'person', label: 'شخص' },
                  ] as const
                ).map((k) => {
                  const active = filter.kinds.includes(k.id);
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => toggleKind(k.id)}
                      className={`px-2 py-1 rounded font-bold cursor-pointer ${
                        active
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Karat Multi-Select */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                العيار (18 / 21 / 24 / آخر):
              </label>
              <div className="flex flex-wrap gap-1">
                {([18, 21, 24, 'other'] as GoldKarat[]).map((kr) => {
                  const active = filter.karats.includes(kr);
                  return (
                    <button
                      key={String(kr)}
                      type="button"
                      onClick={() => toggleKarat(kr)}
                      className={`px-2.5 py-1 rounded font-mono font-bold cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-amber-400'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {kr === 'other' ? 'آخر' : kr}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Item / Statement Filter */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                الصنف / البيان (خاتم، غويشة، سبيكة...):
              </label>
              <input
                type="text"
                value={filter.itemQuery}
                onChange={(e) => onChange({ ...filter, itemQuery: e.target.value })}
                placeholder="اكتب اسم الصنف..."
                className="w-full px-2.5 py-1 border border-slate-300 rounded-lg"
              />
            </div>

            {/* Person & Worker Selectors */}
            {persons.length > 0 && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  الشخص (عميل / مورد):
                </label>
                <select
                  value={filter.personId}
                  onChange={(e) => onChange({ ...filter, personId: e.target.value })}
                  className="w-full px-2 py-1 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">كل الأشخاص</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {workers.length > 0 && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  العامل:
                </label>
                <select
                  value={filter.workerId}
                  onChange={(e) => onChange({ ...filter, workerId: e.target.value })}
                  className="w-full px-2 py-1 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">كل العمال</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Weight & Total & GramPrice Ranges */}
            <div className="flex items-center gap-1.5">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  أقل وزن (ج):
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={filter.minWeight}
                  onChange={(e) => onChange({ ...filter, minWeight: e.target.value })}
                  placeholder="من"
                  className="w-full px-2 py-1 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  أقصى وزن (ج):
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={filter.maxWeight}
                  onChange={(e) => onChange({ ...filter, maxWeight: e.target.value })}
                  placeholder="إلى"
                  className="w-full px-2 py-1 font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  أقل مبلغ (ج.م):
                </label>
                <input
                  type="number"
                  value={filter.minTotal}
                  onChange={(e) => onChange({ ...filter, minTotal: e.target.value })}
                  placeholder="من"
                  className="w-full px-2 py-1 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  أقصى مبلغ (ج.م):
                </label>
                <input
                  type="number"
                  value={filter.maxTotal}
                  onChange={(e) => onChange({ ...filter, maxTotal: e.target.value })}
                  placeholder="إلى"
                  className="w-full px-2 py-1 font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Payment, Review Status, Lock Status */}
            <div className="grid grid-cols-3 gap-1.5 sm:col-span-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  طريقة الدفع:
                </label>
                <select
                  value={filter.paymentType}
                  onChange={(e) =>
                    onChange({
                      ...filter,
                      paymentType: e.target.value as UnifiedFilterState['paymentType'],
                    })
                  }
                  className="w-full px-2 py-1 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">الكل</option>
                  <option value="cash">نقدي</option>
                  <option value="credit">آجل</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  حالة المراجعة:
                </label>
                <select
                  value={filter.reviewState}
                  onChange={(e) =>
                    onChange({
                      ...filter,
                      reviewState: e.target.value as UnifiedFilterState['reviewState'],
                    })
                  }
                  className="w-full px-2 py-1 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">الكل</option>
                  <option value="reviewed">مراجَع ✓</option>
                  <option value="unreviewed">غير مراجَع</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  قفل اليوم:
                </label>
                <select
                  value={filter.dayLockState}
                  onChange={(e) =>
                    onChange({
                      ...filter,
                      dayLockState: e.target.value as UnifiedFilterState['dayLockState'],
                    })
                  }
                  className="w-full px-2 py-1 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">الكل</option>
                  <option value="locked">مقفول فقط</option>
                  <option value="open">مفتوح فقط</option>
                </select>
              </div>
            </div>
          </div>

          {/* Saved Filter Presets Row */}
          {onSavePreset && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                  <Bookmark className="w-3.5 h-3.5 text-amber-600" />
                  <span>فلاتر محفوظة:</span>
                </span>
                {screenPresets.length === 0 ? (
                  <span className="text-[11px] text-slate-400">لا توجد فلاتر محفوظة</span>
                ) : (
                  screenPresets.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-900 font-bold"
                    >
                      <button
                        type="button"
                        onClick={() => onChange(p.filter)}
                        className="hover:underline cursor-pointer"
                      >
                        {p.name}
                      </button>
                      {onDeletePreset && (
                        <button
                          type="button"
                          onClick={() => onDeletePreset(p.id)}
                          className="text-red-600 hover:text-red-800 font-bold"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>

              {!showPresetSaveInput ? (
                <button
                  type="button"
                  onClick={() => setShowPresetSaveInput(true)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer"
                >
                  + حفظ الفلتر الحالي باسم
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={presetNameInput}
                    onChange={(e) => setPresetNameInput(e.target.value)}
                    placeholder="اسم الفلتر (مثال: بيع عيار 21)..."
                    className="px-2.5 py-1 border border-amber-400 rounded-lg bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!presetNameInput.trim()) return;
                      onSavePreset(presetNameInput.trim(), filter);
                      setPresetNameInput('');
                      setShowPresetSaveInput(false);
                    }}
                    className="px-2.5 py-1 bg-amber-600 text-white font-bold rounded-lg cursor-pointer"
                  >
                    حفظ
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPresetSaveInput(false)}
                    className="px-2 py-1 text-slate-500"
                  >
                    إلغاء
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Active Filter Chips Bar */}
      {hasAnyActiveFilter && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {filter.fromDate || filter.toDate ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-950 text-[11px] font-bold">
              <span>
                التاريخ: {filter.fromDate || '...'} ← {filter.toDate || '...'}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChange({ ...filter, fromDate: '', toDate: '', datePreset: 'all' })
                }
                className="hover:text-red-700 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ) : null}

          {filter.kinds.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-950 text-[11px] font-bold">
              <span>النوع ({filter.kinds.length})</span>
              <button
                type="button"
                onClick={() => onChange({ ...filter, kinds: [] })}
                className="hover:text-red-700 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {filter.karats.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-950 text-[11px] font-bold">
              <span>العيار: {filter.karats.join(', ')}</span>
              <button
                type="button"
                onClick={() => onChange({ ...filter, karats: [] })}
                className="hover:text-red-700 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {filter.itemQuery.trim() && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-950 text-[11px] font-bold">
              <span>الصنف: {filter.itemQuery}</span>
              <button
                type="button"
                onClick={() => onChange({ ...filter, itemQuery: '' })}
                className="hover:text-red-700 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {filter.searchQuery.trim() && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-950 text-[11px] font-bold">
              <span>بحث: {filter.searchQuery}</span>
              <button
                type="button"
                onClick={() => onChange({ ...filter, searchQuery: '' })}
                className="hover:text-red-700 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
};
