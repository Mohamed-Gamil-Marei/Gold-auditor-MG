import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Lock,
  Unlock,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  RotateCcw,
  Camera,
  Eye,
  Plus,
  Coins,
  Scale,
  CircleDot,
  Filter,
  Sparkles,
} from 'lucide-react';
import { useAuditStore } from '../store/useAuditStore';
import {
  DayInfo,
  GoldKarat,
  Operation,
  OperationKind,
  PaymentType,
  PersonDirection,
} from '../types';
import {
  findSimilarPerson,
  formatNumber,
  formatWeight,
  getEffectiveKaratPrice,
  inspectAmbiguousSpaceWeight,
  normalizeArabicName,
  parseAmountInput,
  parseWeightInput,
} from '../utils/numerals';
import { evaluateLiveRowStatus } from '../utils/checks';
import { computeDaySafeSummary } from '../utils/checks/checkDailySafe';
import {
  detectFastEntryInlineTypo,
  FastEntryInlineTypoHint,
} from '../utils/fixItEngine';
import {
  FilterBar,
  createDefaultUnifiedFilter,
  applyUnifiedFilterToOperations,
} from './common/FilterBar';

const KIND_META: Record<
  OperationKind,
  {
    shortcut: string;
    label: string;
    bannerBg: string;
    activeBtn: string;
    borderAccent: string;
    badgeBg: string;
  }
> = {
  buy: {
    shortcut: 'F1',
    label: 'شراء ذهب',
    bannerBg: 'bg-teal-950 text-white',
    activeBtn: 'bg-teal-700 text-white ring-2 ring-teal-400 shadow-sm',
    borderAccent: 'border-teal-600',
    badgeBg: 'text-teal-800 bg-teal-50',
  },
  sell: {
    shortcut: 'F2',
    label: 'بيع ذهب',
    bannerBg: 'bg-amber-950 text-white',
    activeBtn: 'bg-amber-600 text-white ring-2 ring-amber-300 shadow-sm',
    borderAccent: 'border-amber-600',
    badgeBg: 'text-amber-900 bg-amber-50',
  },
  expense: {
    shortcut: 'F3',
    label: 'مصروف يومي',
    bannerBg: 'bg-rose-950 text-white',
    activeBtn: 'bg-rose-700 text-white ring-2 ring-rose-300 shadow-sm',
    borderAccent: 'border-rose-600',
    badgeBg: 'text-rose-800 bg-rose-50',
  },
  advance: {
    shortcut: 'F4',
    label: 'سلفة / سحب عامل',
    bannerBg: 'bg-indigo-950 text-white',
    activeBtn: 'bg-indigo-700 text-white ring-2 ring-indigo-300 shadow-sm',
    borderAccent: 'border-indigo-600',
    badgeBg: 'text-indigo-800 bg-indigo-50',
  },
  person: {
    shortcut: 'F5',
    label: 'فلوس / جرامات أشخاص',
    bannerBg: 'bg-sky-950 text-white',
    activeBtn: 'bg-sky-700 text-white ring-2 ring-sky-300 shadow-sm',
    borderAccent: 'border-sky-600',
    badgeBg: 'text-sky-800 bg-sky-50',
  },
};

const KARAT_OPTIONS: { value: GoldKarat; label: string; shortcut: string }[] = [
  { value: 18, label: '18', shortcut: 'Ctrl+1' },
  { value: 21, label: '21', shortcut: 'Ctrl+2' },
  { value: 24, label: '24', shortcut: 'Ctrl+3' },
  { value: 'other', label: 'آخر', shortcut: 'Ctrl+4' },
];

interface MemoRowProps {
  index: number;
  op: Operation;
  dayInfo: DayInfo;
  dayOps: Operation[];
  showItemColumn: boolean;
  isLocked: boolean;
  personName?: string;
  workerName?: string;
  onUpdate: (id: string, patch: Partial<Operation>, reason?: string) => void;
  onDelete: (id: string, reason?: string) => void;
  onToggleReview: (id: string) => void;
  onFocusRowInput: (rowIndex: number, dir: 'up' | 'down') => void;
  rowRefSetter: (index: number, el: HTMLInputElement | null) => void;
}

const FastTableRow = React.memo(function FastTableRow({
  index,
  op,
  dayInfo,
  dayOps,
  showItemColumn,
  isLocked,
  personName,
  workerName,
  onUpdate,
  onDelete,
  onToggleReview,
  onFocusRowInput,
  rowRefSetter,
}: MemoRowProps) {
  const settings = useAuditStore((s) => s.settings);
  const persons = useAuditStore((s) => s.persons);
  const allOperations = useAuditStore((s) => s.operations);
  const highlightedOpId = useAuditStore((s) => s.highlightedOpId);
  const setHighlightedOpId = useAuditStore((s) => s.setHighlightedOpId);
  const trRef = useRef<HTMLTableRowElement | null>(null);
  const isHighlighted = highlightedOpId === op.id;

  useEffect(() => {
    if (isHighlighted && trRef.current) {
      trRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = setTimeout(() => setHighlightedOpId(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [isHighlighted, setHighlightedOpId]);

  const [editingWeight, setEditingWeight] = useState(
    op.weightG > 0 ? op.weightG.toFixed(3) : ''
  );
  const [editingTotal, setEditingTotal] = useState(
    op.total > 0 ? String(op.total) : ''
  );
  const [editingItem, setEditingItem] = useState(op.item || '');
  const [AskingReasonModal, setAskingReasonModal] = useState<{
    type: 'edit' | 'delete';
    patch?: Partial<Operation>;
  } | null>(null);
  const [reasonText, setReasonText] = useState('');

  useEffect(() => {
    setEditingWeight(op.weightG > 0 ? op.weightG.toFixed(3) : '');
    setEditingTotal(op.total > 0 ? String(op.total) : '');
    setEditingItem(op.item || '');
  }, [op.weightG, op.total, op.item]);

  const liveEval = useMemo(
    () => evaluateLiveRowStatus(op, dayInfo, dayOps, settings, persons, allOperations),
    [op, dayInfo, dayOps, settings, persons, allOperations]
  );

  const gramPrice =
    op.weightG > 0 && op.total > 0 ? Math.round(op.total / op.weightG) : 0;

  const commitWeightEdit = () => {
    if (isLocked) return;
    const parsed = parseWeightInput(editingWeight, settings.shortSpaceWeightMode);
    if (parsed > 0 && Math.abs(parsed - op.weightG) > 0.0005) {
      setAskingReasonModal({ type: 'edit', patch: { weightG: parsed } });
    } else {
      setEditingWeight(op.weightG > 0 ? op.weightG.toFixed(3) : '');
    }
  };

  const commitTotalEdit = () => {
    if (isLocked) return;
    const parsed = parseAmountInput(editingTotal);
    if (parsed > 0 && Math.abs(parsed - op.total) > 0.01) {
      setAskingReasonModal({ type: 'edit', patch: { total: parsed } });
    } else {
      setEditingTotal(op.total > 0 ? String(op.total) : '');
    }
  };

  const commitItemEdit = () => {
    if (isLocked) return;
    if (editingItem.trim() !== (op.item || '').trim()) {
      onUpdate(op.id, { item: editingItem.trim() });
    }
  };

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onFocusRowInput(index, 'up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onFocusRowInput(index, 'down');
    } else if (e.key === 'Escape') {
      setEditingWeight(op.weightG > 0 ? op.weightG.toFixed(3) : '');
      setEditingTotal(op.total > 0 ? String(op.total) : '');
      setEditingItem(op.item || '');
      (e.target as HTMLInputElement).blur();
    } else if (e.ctrlKey && e.key === 'Delete') {
      e.preventDefault();
      if (!isLocked) {
        setAskingReasonModal({ type: 'delete' });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

  const confirmReasonAction = () => {
    if (!AskingReasonModal) return;
    if (AskingReasonModal.type === 'delete') {
      onDelete(op.id, reasonText.trim() || 'حذف سريع');
    } else if (AskingReasonModal.patch) {
      onUpdate(op.id, AskingReasonModal.patch, reasonText.trim() || 'تعديل مباشر');
    }
    setAskingReasonModal(null);
    setReasonText('');
  };

  const kindInfo = KIND_META[op.kind] || KIND_META.sell;

  const contextLabel = useMemo(() => {
    if (op.kind === 'expense') return `بند: ${op.category || op.item || 'أخرى'}`;
    if (op.kind === 'advance') return `عامل: ${workerName || op.item || '-'}`;
    if (op.kind === 'person') {
      const dirWord =
        (op.direction || 'gave_him') === 'gave_him'
          ? 'أعطيناه / سددنا له'
          : 'استلمنا منه';
      return `${personName || 'شخص'} (${dirWord})`;
    }
    if (op.payment === 'credit') {
      return `آجل — ${personName || 'بدون اسم!'}`;
    }
    return op.item || '-';
  }, [op, personName, workerName]);

  return (
    <>
      <tr
        ref={trRef}
        className={`border-b border-slate-200 transition-colors text-sm ${
          isHighlighted
            ? 'bg-amber-100/90 ring-2 ring-amber-500 font-bold'
            : 'hover:bg-slate-50/90'
        }`}
      >
        <td className="py-2 px-3 font-mono text-slate-500 tabular-nums w-12 text-center">
          {index + 1}
        </td>
        <td className="py-2 px-3 w-28">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${kindInfo.badgeBg}`}>
            {kindInfo.label}
          </span>
        </td>
        <td className="py-1.5 px-2 w-20 text-center">
          {op.kind === 'buy' || op.kind === 'sell' ? (
            <select
              disabled={isLocked}
              value={op.karat || 21}
              onChange={(e) => {
                const val = e.target.value;
                const nextKarat: GoldKarat =
                  val === 'other' ? 'other' : (Number(val) as 18 | 21 | 24);
                onUpdate(op.id, { karat: nextKarat }, 'تغيير العيار');
              }}
              className="px-1.5 py-1 text-xs font-mono font-bold bg-slate-100 border border-slate-200 rounded text-slate-800 outline-none focus:border-amber-600 disabled:opacity-60"
            >
              <option value={18}>18</option>
              <option value={21}>21</option>
              <option value={24}>24</option>
              <option value="other">آخر</option>
            </select>
          ) : (
            <span className="text-slate-400 text-xs">—</span>
          )}
        </td>
        <td className="py-1.5 px-3 w-36">
          {op.kind === 'buy' || op.kind === 'sell' || (op.kind === 'person' && op.weightG > 0) ? (
            <input
              ref={(el) => rowRefSetter(index, el)}
              type="text"
              inputMode="decimal"
              disabled={isLocked}
              value={editingWeight}
              onChange={(e) => setEditingWeight(e.target.value)}
              onBlur={commitWeightEdit}
              onKeyDown={handleRowKeyDown}
              className="w-full px-2.5 py-1.5 font-mono tabular-nums text-base font-semibold bg-white border border-slate-200 rounded focus:border-amber-600 focus:ring-1 focus:ring-amber-600 outline-none disabled:bg-slate-100"
            />
          ) : (
            <span className="text-slate-400 font-mono text-xs px-2">—</span>
          )}
        </td>
        <td className="py-1.5 px-3 w-40">
          <input
            ref={(el) => {
              if (op.kind !== 'buy' && op.kind !== 'sell') {
                rowRefSetter(index, el);
              }
            }}
            type="text"
            inputMode="decimal"
            disabled={isLocked}
            value={editingTotal}
            onChange={(e) => setEditingTotal(e.target.value)}
            onBlur={commitTotalEdit}
            onKeyDown={handleRowKeyDown}
            className="w-full px-2.5 py-1.5 font-mono tabular-nums text-base font-semibold bg-white border border-slate-200 rounded focus:border-amber-600 focus:ring-1 focus:ring-amber-600 outline-none disabled:bg-slate-100"
          />
        </td>
        <td className="py-2 px-3 font-mono tabular-nums text-slate-700 font-medium w-32">
          {gramPrice > 0 ? `${formatNumber(gramPrice)} ج.م` : '—'}
        </td>
        {(showItemColumn || op.kind !== 'buy') && (
          <td className="py-1.5 px-3 min-w-[160px]">
            {op.kind === 'buy' || op.kind === 'sell' ? (
              <input
                type="text"
                disabled={isLocked}
                value={editingItem}
                placeholder={op.payment === 'credit' ? contextLabel : 'البيان...'}
                onChange={(e) => setEditingItem(e.target.value)}
                onBlur={commitItemEdit}
                onKeyDown={handleRowKeyDown}
                className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-200 rounded focus:border-amber-600 outline-none disabled:bg-slate-100"
              />
            ) : (
              <span className="text-xs font-medium text-slate-700">{contextLabel}</span>
            )}
          </td>
        )}
        <td className="py-2 px-3 w-36">
          <div
            className="inline-flex items-center gap-1.5 cursor-help"
            title={liveEval.reasons.join(' | ')}
          >
            {liveEval.status === 'neutral' && (
              <>
                <CircleDot className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-xs text-slate-400">محايد</span>
              </>
            )}
            {liveEval.status === 'ok' && (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-xs font-medium text-emerald-700">سليم</span>
              </>
            )}
            {liveEval.status === 'warn' && (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-xs font-semibold text-amber-700 truncate max-w-[110px]">
                  {liveEval.reasons[0]}
                </span>
              </>
            )}
            {liveEval.status === 'danger' && (
              <>
                <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
                <span className="text-xs font-bold text-red-700 truncate max-w-[110px]">
                  {liveEval.reasons[0]}
                </span>
              </>
            )}
          </div>
        </td>
        <td className="py-2 px-3 w-28 text-center">
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => onToggleReview(op.id)}
              className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                op.reviewedFlag
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {op.reviewedFlag ? 'مراجَع ✓' : 'مراجعة'}
            </button>
            {!isLocked && (
              <button
                type="button"
                onClick={() => setAskingReasonModal({ type: 'delete' })}
                title="حذف الصف (Ctrl+Delete)"
                className="p-1 text-slate-400 hover:text-red-600 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </td>
      </tr>

      {AskingReasonModal && (
        <tr className="bg-amber-50/90 border-b border-amber-200">
          <td colSpan={9} className="py-2 px-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold text-amber-900">
                {AskingReasonModal.type === 'delete'
                  ? 'سبب حذف الصف (اضغط Enter للتأكيد، يمكن تركه فارغاً مع تنبيه في السجل):'
                  : 'سبب تعديل الوزن/المبلغ (اضغط Enter للتأكيد):'}
              </span>
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <input
                  type="text"
                  autoFocus
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      confirmReasonAction();
                    } else if (e.key === 'Escape') {
                      setAskingReasonModal(null);
                    }
                  }}
                  placeholder="اكتب سبباً قصيراً ثم اضغط Enter..."
                  className="flex-1 px-3 py-1 text-xs bg-white border border-amber-300 rounded outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={confirmReasonAction}
                  className="px-3 py-1 bg-amber-700 text-white text-xs font-semibold rounded hover:bg-amber-800"
                >
                  تأكيد
                </button>
                <button
                  type="button"
                  onClick={() => setAskingReasonModal(null)}
                  className="px-2.5 py-1 bg-white border border-slate-300 text-slate-700 text-xs rounded"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
});

export const FastEntryScreen: React.FC<{ onGoToAudit: () => void }> = ({ onGoToAudit }) => {
  const {
    currentDate,
    currentKind,
    currentKarat,
    showItemColumn,
    operations,
    daysMap,
    persons,
    workers,
    expenseCategories,
    settings,
    deletedOpUndo,
    carryOverConflict,
    setCurrentDate,
    setCurrentKind,
    setCurrentKarat,
    setShowItemColumn,
    setDayGoldPrice,
    confirmDayGoldPrice,
    updateDayInfo,
    resolveCarryOverConflict,
    toggleDayLock,
    addOperation,
    updateOperation,
    deleteOperation,
    undoDeleteOperation,
    undoLastAddedOperation,
    toggleOperationReviewed,
    addPerson,
    addWorker,
    addExpenseCategory,
  } = useAuditStore();

  const dayInfo: DayInfo = daysMap[currentDate] || {
    date: currentDate,
    goldPricePerGram: 0,
    priceConfirmed: false,
    locked: false,
  };
  const isLocked = Boolean(dayInfo.locked);
  const isPriceConfirmed =
    dayInfo.goldPricePerGram > 0 && dayInfo.priceConfirmed !== false;

  // Toggle for custom karat prices override (Fix A.1)
  const [showKaratPricesOverride, setShowKaratPricesOverride] = useState(false);

  // Entry Row State
  const [weightInput, setWeightInput] = useState('');
  const [totalInput, setTotalInput] = useState('');
  const [itemInput, setItemInput] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType>('cash');
  const [personDirection, setPersonDirection] = useState<PersonDirection>('gave_him');
  const [lookupQuery, setLookupQuery] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState<string>('');
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [pendingCreateConfirm, setPendingCreateConfirm] = useState(false);
  const [similarPersonHint, setSimilarPersonHint] = useState<string | null>(null);

  // Fix C.13: Ambiguous space-separated weight confirmation ("12 5" -> 12.500 vs 12.005)
  const [ambiguousWeightPrompt, setAmbiguousWeightPrompt] = useState<{
    decimalVal: number;
    milliVal: number;
    nextFocusTarget: 'total' | 'commit';
  } | null>(null);

  // Shake states when pressing Enter on empty/zero
  const [shakeField, setShakeField] = useState<'weight' | 'total' | 'lookup' | null>(null);

  // Debounced live status for the active entry row (150ms)
  const [debouncedDraft, setDebouncedDraft] = useState<{ weightG: number; total: number }>({
    weightG: 0,
    total: 0,
  });

  // Unlock modal state
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false);
  const [unlockReasonInput, setUnlockReasonInput] = useState('');

  // Quick Safe & Inventory drawer toggle
  const [showReconcileStrip, setShowReconcileStrip] = useState(false);
  const [showAttachedImageModal, setShowAttachedImageModal] = useState(false);

  // Undo toast timer
  const [showUndoBanner, setShowUndoBanner] = useState(false);

  // G1.8: Inline Fast-Entry Typo Suggestion (non-focus-stealing)
  const [inlineTypoSuggestion, setInlineTypoSuggestion] = useState<{
    suggestion: FastEntryInlineTypoHint;
    originalWeightG: number;
    originalTotal: number;
  } | null>(null);

  // G2: Optional Unified FilterBar inside FastEntryScreen
  const [showTableFilter, setShowTableFilter] = useState(false);
  const [tableFilter, setTableFilter] = useState(() => createDefaultUnifiedFilter());
  const savedFilterPresets = useAuditStore((s) => s.savedFilterPresets);
  const saveFilterPreset = useAuditStore((s) => s.saveFilterPreset);
  const deleteFilterPreset = useAuditStore((s) => s.deleteFilterPreset);

  // Refs for instant <50ms focus transitions without mouse/Tab
  const goldPriceInputRef = useRef<HTMLInputElement | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const secondInputRef = useRef<HTMLInputElement | null>(null);
  const thirdInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const activeEntryRowTrRef = useRef<HTMLTableRowElement | null>(null);

  const setRowRef = useCallback((idx: number, el: HTMLInputElement | null) => {
    rowRefs.current[idx] = el;
  }, []);

  // Focus first field immediately on mount or when changing kind/date
  const focusFirstFieldImmediate = useCallback(() => {
    requestAnimationFrame(() => {
      if (firstInputRef.current) {
        firstInputRef.current.focus();
        firstInputRef.current.select?.();
      }
      activeEntryRowTrRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    focusFirstFieldImmediate();
  }, [currentKind, currentDate, focusFirstFieldImmediate]);

  // Global keyboard shortcuts: F1-F5, Ctrl+1..4 for Karat, Ctrl+Z for Undo
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setCurrentKind('buy');
      } else if (e.key === 'F2') {
        e.preventDefault();
        setCurrentKind('sell');
      } else if (e.key === 'F3') {
        e.preventDefault();
        setCurrentKind('expense');
      } else if (e.key === 'F4') {
        e.preventDefault();
        setCurrentKind('advance');
      } else if (e.key === 'F5') {
        e.preventDefault();
        setCurrentKind('person');
      } else if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        setCurrentKarat(18);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '2') {
        e.preventDefault();
        setCurrentKarat(21);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '3') {
        e.preventDefault();
        setCurrentKarat(24);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '4') {
        e.preventDefault();
        setCurrentKarat('other');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const activeTag = document.activeElement?.tagName;
        if (activeTag !== 'INPUT' || (document.activeElement as HTMLInputElement).value === '') {
          e.preventDefault();
          undoLastAddedOperation();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [setCurrentKind, setCurrentKarat, undoLastAddedOperation]);

  // Show 5-second undo banner when a row is deleted
  useEffect(() => {
    if (deletedOpUndo) {
      setShowUndoBanner(true);
      const timer = setTimeout(() => {
        setShowUndoBanner(false);
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setShowUndoBanner(false);
    }
  }, [deletedOpUndo]);

  // 150ms debounced live check for the current draft entry row
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedDraft({
        weightG: parseWeightInput(weightInput, settings.shortSpaceWeightMode),
        total: parseAmountInput(totalInput),
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [weightInput, totalInput, settings.shortSpaceWeightMode]);

  // Filter today's operations without re-sorting on every keystroke
  const rawDayOperations = useMemo(
    () => operations.filter((op) => op.date === currentDate),
    [operations, currentDate]
  );

  const filterResult = useMemo(() => {
    return applyUnifiedFilterToOperations({
      operations: rawDayOperations,
      filter: { ...tableFilter, datePreset: 'all', fromDate: '', toDate: '' },
      daysMap,
      persons,
      workers,
    });
  }, [rawDayOperations, tableFilter, daysMap, persons, workers]);

  const dayOperations = useMemo(() => {
    if (!showTableFilter) return rawDayOperations;
    return filterResult.filtered;
  }, [rawDayOperations, showTableFilter, filterResult]);

  // Virtualization slice if > 1000 rows
  const [virtualStart, setVirtualStart] = useState(0);
  const visibleOperations = useMemo(() => {
    if (dayOperations.length <= 1000) return dayOperations;
    return dayOperations.slice(virtualStart, virtualStart + 300);
  }, [dayOperations, virtualStart]);

  const personsMap = useMemo(
    () => new Map(persons.map((p) => [p.id, p.name])),
    [persons]
  );
  const workersMap = useMemo(
    () => new Map(workers.map((w) => [w.id, w.name])),
    [workers]
  );

  // Suggestions for Autocomplete
  const suggestions = useMemo(() => {
    const normQuery = normalizeArabicName(lookupQuery);

    if (currentKind === 'expense') {
      return expenseCategories
        .filter((cat) => !normQuery || normalizeArabicName(cat).includes(normQuery))
        .map((cat) => ({ id: cat, label: cat, sub: 'بند مصروف' }));
    }

    if (currentKind === 'advance') {
      return workers
        .filter((w) => !normQuery || normalizeArabicName(w.name).includes(normQuery))
        .map((w) => ({
          id: w.id,
          label: w.name,
          sub: `المرتب: ${formatNumber(w.monthlySalary)} ج.م`,
        }));
    }

    if (currentKind === 'person' || paymentType === 'credit') {
      const recentPersonIds: string[] = [];
      for (let i = operations.length - 1; i >= 0; i--) {
        const pid = operations[i].personId;
        if (pid && !recentPersonIds.includes(pid)) {
          recentPersonIds.push(pid);
          if (recentPersonIds.length >= 5) break;
        }
      }

      const filtered = persons.filter(
        (p) => !normQuery || normalizeArabicName(p.name).includes(normQuery)
      );

      filtered.sort((a, b) => {
        const idxA = recentPersonIds.indexOf(a.id);
        const idxB = recentPersonIds.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.name.localeCompare(b.name, 'ar');
      });

      return filtered.slice(0, 8).map((p) => ({
        id: p.id,
        label: p.name,
        sub:
          p.type === 'client'
            ? 'عميل'
            : p.type === 'supplier'
            ? 'مورد'
            : p.type === 'worker'
            ? 'عامل'
            : 'حساب',
      }));
    }

    return [];
  }, [currentKind, paymentType, lookupQuery, expenseCategories, workers, persons, operations]);

  const triggerShake = (field: 'weight' | 'total' | 'lookup') => {
    setShakeField(field);
    setTimeout(() => setShakeField(null), 400);
  };

  // Live calculated gram price in draft row
  const draftWeightG = parseWeightInput(weightInput, settings.shortSpaceWeightMode);
  const draftTotal = parseAmountInput(totalInput);
  const draftGramPrice =
    draftWeightG > 0 && draftTotal > 0 ? Math.round(draftTotal / draftWeightG) : 0;

  const draftLiveStatus = useMemo(
    () =>
      evaluateLiveRowStatus(
        {
          kind: currentKind,
          karat: currentKarat,
          weightG: debouncedDraft.weightG,
          total: debouncedDraft.total,
          payment: paymentType,
          direction: personDirection,
          personId: selectedEntityId || undefined,
          workerId: selectedEntityId || undefined,
          category: lookupQuery || undefined,
        },
        dayInfo,
        dayOperations,
        settings,
        persons,
        operations
      ),
    [
      currentKind,
      currentKarat,
      debouncedDraft,
      paymentType,
      personDirection,
      selectedEntityId,
      lookupQuery,
      dayInfo,
      dayOperations,
      settings,
      persons,
      operations,
    ]
  );

  // Save the current entry row and immediately reset & focus first input in <50ms
  const commitNewEntryRow = (
    forcedWeightG?: number,
    forcedTotal?: number,
    skipInlineTypoCheck = false
  ) => {
    if (isLocked) return;

    if (currentKind === 'buy' || currentKind === 'sell') {
      if (forcedWeightG === undefined && settings.shortSpaceWeightMode === 'ask') {
        const amb = inspectAmbiguousSpaceWeight(weightInput);
        if (amb) {
          setAmbiguousWeightPrompt({ ...amb, nextFocusTarget: 'commit' });
          return;
        }
      }

      const w =
        forcedWeightG !== undefined
          ? forcedWeightG
          : parseWeightInput(weightInput, settings.shortSpaceWeightMode);
      const t = forcedTotal !== undefined ? forcedTotal : parseAmountInput(totalInput);
      if (w <= 0) {
        triggerShake('weight');
        firstInputRef.current?.focus();
        return;
      }
      if (t <= 0) {
        triggerShake('total');
        secondInputRef.current?.focus();
        return;
      }

      // G1.8: Inline typo check when gram price is >5x or <1/5th of daily price or swapped
      if (!skipInlineTypoCheck) {
        const typo = detectFastEntryInlineTypo({
          kind: currentKind,
          karat: currentKarat,
          weightG: w,
          total: t,
          dayInfo,
        });
        if (typo && typo.hasTypo) {
          setInlineTypoSuggestion({
            suggestion: typo,
            originalWeightG: w,
            originalTotal: t,
          });
          return;
        }
      }

      let resolvedPersonId = selectedEntityId || undefined;
      if (paymentType === 'credit' && !resolvedPersonId && lookupQuery.trim()) {
        const exact = persons.find(
          (p) => normalizeArabicName(p.name) === normalizeArabicName(lookupQuery)
        );
        if (exact) {
          resolvedPersonId = exact.id;
        } else {
          const created = addPerson({
            name: lookupQuery.trim(),
            type: currentKind === 'sell' ? 'client' : 'supplier',
          });
          resolvedPersonId = created.id;
        }
      }

      addOperation({
        date: currentDate,
        kind: currentKind,
        karat: currentKarat,
        weightG: w,
        total: t,
        item: itemInput.trim(),
        payment: paymentType,
        personId: resolvedPersonId,
      });

      setWeightInput('');
      setTotalInput('');
      setItemInput('');
      setLookupQuery('');
      setSelectedEntityId('');
      setAmbiguousWeightPrompt(null);
      setInlineTypoSuggestion(null);
      focusFirstFieldImmediate();
      return;
    }

    if (currentKind === 'expense') {
      const cat = lookupQuery.trim();
      const t = parseAmountInput(totalInput);
      if (!cat) {
        triggerShake('lookup');
        firstInputRef.current?.focus();
        return;
      }
      if (t <= 0) {
        triggerShake('total');
        secondInputRef.current?.focus();
        return;
      }
      addExpenseCategory(cat);
      addOperation({
        date: currentDate,
        kind: 'expense',
        category: cat,
        item: itemInput.trim() || cat,
        weightG: 0,
        total: t,
        payment: 'cash',
      });
      setLookupQuery('');
      setTotalInput('');
      setItemInput('');
      focusFirstFieldImmediate();
      return;
    }

    if (currentKind === 'advance') {
      const wName = lookupQuery.trim();
      const t = parseAmountInput(totalInput);
      if (!wName) {
        triggerShake('lookup');
        firstInputRef.current?.focus();
        return;
      }
      if (t <= 0) {
        triggerShake('total');
        secondInputRef.current?.focus();
        return;
      }
      let workerId = selectedEntityId;
      if (!workerId) {
        const match = workers.find(
          (w) => normalizeArabicName(w.name) === normalizeArabicName(wName)
        );
        if (match) {
          workerId = match.id;
        } else {
          const created = addWorker({
            name: wName,
            monthlySalary: 0,
            dueDay: 30,
          });
          workerId = created.id;
        }
      }
      addOperation({
        date: currentDate,
        kind: 'advance',
        workerId,
        item: itemInput.trim() || `سحب من المرتب - ${wName}`,
        weightG: 0,
        total: t,
        payment: 'cash',
      });
      setLookupQuery('');
      setSelectedEntityId('');
      setTotalInput('');
      setItemInput('');
      focusFirstFieldImmediate();
      return;
    }

    if (currentKind === 'person') {
      const pName = lookupQuery.trim();
      const t = parseAmountInput(totalInput);
      const w = parseWeightInput(weightInput, settings.shortSpaceWeightMode);
      if (!pName) {
        triggerShake('lookup');
        firstInputRef.current?.focus();
        return;
      }
      if (t <= 0 && w <= 0) {
        triggerShake('total');
        secondInputRef.current?.focus();
        return;
      }
      let personId = selectedEntityId;
      if (!personId) {
        const match = persons.find(
          (p) => normalizeArabicName(p.name) === normalizeArabicName(pName)
        );
        if (match) {
          personId = match.id;
        } else {
          const created = addPerson({
            name: pName,
            type: 'client',
          });
          personId = created.id;
        }
      }
      addOperation({
        date: currentDate,
        kind: 'person',
        personId,
        direction: personDirection,
        weightG: w,
        total: t,
        item:
          itemInput.trim() ||
          (personDirection === 'gave_him' ? 'أعطيناه دفعة / سداد' : 'استلمنا منه دفعة'),
        payment: 'cash',
      });
      setLookupQuery('');
      setSelectedEntityId('');
      setTotalInput('');
      setWeightInput('');
      setItemInput('');
      setPendingCreateConfirm(false);
      setSimilarPersonHint(null);
      focusFirstFieldImmediate();
    }
  };

  // Handle Lookup Field Enter & Arrow Navigation (for F3, F4, F5)
  const handleLookupKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (showDropdown && suggestions.length > 0) {
        setDropdownIndex((prev) => (prev + 1) % suggestions.length);
      } else if (currentKind === 'person') {
        setPersonDirection((d) => (d === 'gave_him' ? 'received_from_him' : 'gave_him'));
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (showDropdown && suggestions.length > 0) {
        setDropdownIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (currentKind === 'person') {
        setPersonDirection((d) => (d === 'gave_him' ? 'received_from_him' : 'gave_him'));
      }
      return;
    }
    if ((e.key === '+' || e.key === '-') && currentKind === 'person' && !lookupQuery) {
      e.preventDefault();
      setPersonDirection((d) => (d === 'gave_him' ? 'received_from_him' : 'gave_him'));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = lookupQuery.trim();
      if (!trimmed) {
        triggerShake('lookup');
        return;
      }

      if (suggestions.length > 0 && showDropdown) {
        const chosen = suggestions[dropdownIndex] || suggestions[0];
        setLookupQuery(chosen.label);
        setSelectedEntityId(chosen.id);
        setShowDropdown(false);
        setPendingCreateConfirm(false);
        setSimilarPersonHint(null);
        secondInputRef.current?.focus();
        secondInputRef.current?.select?.();
        return;
      }

      if ((currentKind === 'person' || currentKind === 'advance') && !pendingCreateConfirm) {
        if (currentKind === 'person') {
          const sim = findSimilarPerson(trimmed, persons);
          if (sim) {
            setSimilarPersonHint(`اسم مشابه موجود: "${sim.name}" — اضغط Enter للإنشاء أو اختره`);
          }
        }
        setPendingCreateConfirm(true);
        return;
      }

      setPendingCreateConfirm(false);
      setShowDropdown(false);
      secondInputRef.current?.focus();
      secondInputRef.current?.select?.();
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setPendingCreateConfirm(false);
    }
  };

  const handleRowFocusNavigation = useCallback(
    (rowIndex: number, dir: 'up' | 'down') => {
      const targetIdx = dir === 'up' ? rowIndex - 1 : rowIndex + 1;
      if (targetIdx >= 0 && targetIdx < dayOperations.length) {
        rowRefs.current[targetIdx]?.focus();
        rowRefs.current[targetIdx]?.select?.();
      } else if (targetIdx >= dayOperations.length) {
        firstInputRef.current?.focus();
      }
    },
    [dayOperations.length]
  );

  // Handle attaching compressed ledger photo to the day
  const handleAttachDayPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 1400;
        const scale = img.width > maxW ? maxW / img.width : 1;
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);
          updateDayInfo(currentDate, { ledgerImageDataUrl: compressedDataUrl });
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Real-time daily totals for sticky bottom bar
  const dayStats = useMemo(() => {
    let buyG = 0;
    let buyTotal = 0;
    let sellG = 0;
    let sellTotal = 0;

    for (const op of dayOperations) {
      if (op.kind === 'buy') {
        buyG += op.weightG;
        buyTotal += op.total;
      } else if (op.kind === 'sell') {
        sellG += op.weightG;
        sellTotal += op.total;
      }
    }

    const safeSummary = computeDaySafeSummary(currentDate, operations, dayInfo);
    const openingGoldG = dayInfo.openingBalanceG ?? 0;
    const expectedClosingGoldG = openingGoldG + buyG - sellG;
    const hasActualGold =
      dayInfo.closingBalanceG !== undefined && dayInfo.closingBalanceG !== null;
    const goldDiffG = hasActualGold ? dayInfo.closingBalanceG! - expectedClosingGoldG : 0;

    return {
      buyG,
      buyTotal,
      sellG,
      sellTotal,
      netG: buyG - sellG,
      netCashSalesMinusBuy: sellTotal - buyTotal,
      safeSummary,
      openingGoldG,
      expectedClosingGoldG,
      hasActualGold,
      goldDiffG,
    };
  }, [dayOperations, currentDate, operations, dayInfo]);

  const currentMeta = KIND_META[currentKind];
  const effective18Price = getEffectiveKaratPrice(dayInfo, 18);
  const effective24Price = getEffectiveKaratPrice(dayInfo, 24);

  return (
    <div className="space-y-4 pb-20">
      {/* Fix A.4: Red Banner if today's gold price is missing or unconfirmed */}
      {!isPriceConfirmed && (
        <div className="bg-red-600 text-white px-4 py-2.5 rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs font-bold">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 shrink-0" />
            <span>
              {dayInfo.goldPricePerGram > 0
                ? `سجّل سعر الذهب اليوم أولاً: السعر المقترح من آخر يوم (${formatNumber(
                    dayInfo.goldPricePerGram
                  )} ج.م/جرام عيار 21) بانتظار التأكيد — اضغط Enter في خانة السعر لتأكيده.`
                : 'سجّل سعر الذهب اليوم أولاً: نقاط المراجعة الحية تظل محايدة حتى يتم تسجيل وتأكيد سعر الذهب اليومي.'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {dayInfo.goldPricePerGram > 0 && (
              <button
                type="button"
                onClick={() => {
                  confirmDayGoldPrice(currentDate);
                  focusFirstFieldImmediate();
                }}
                className="px-3 py-1 bg-white text-red-900 rounded-lg font-extrabold hover:bg-red-50"
              >
                تأكيد السعر المقترح ({formatNumber(dayInfo.goldPricePerGram)})
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                goldPriceInputRef.current?.focus();
                goldPriceInputRef.current?.select?.();
              }}
              className="px-3 py-1 bg-red-800 hover:bg-red-900 text-white rounded-lg"
            >
              انتقل لخانة السعر
            </button>
          </div>
        </div>
      )}

      {/* Fix B.4: Carry-over conflict prompt if next active day had manual opening balances */}
      {carryOverConflict && (
        <div className="bg-amber-100 border border-amber-400 text-amber-950 px-4 py-2.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs font-bold">
          <span>
            تنبيه ترحيل: اليوم اللاحق ({carryOverConflict.targetDate}) يحتوي على رصيد أول اليوم مُدخل يدوياً من قبل. هل تريد استبداله بالجرد الفعلي الجديد؟
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => resolveCarryOverConflict(true)}
              className="px-3 py-1 bg-amber-700 text-white rounded-lg hover:bg-amber-800"
            >
              نعم، استبدل الرصيد الافتتاحي
            </button>
            <button
              type="button"
              onClick={() => resolveCarryOverConflict(false)}
              className="px-3 py-1 bg-white border border-amber-400 text-amber-900 rounded-lg"
            >
              لا، احتفظ باليدوي
            </button>
          </div>
        </div>
      )}

      {/* Top Fast Entry Control Header */}
      <div
        className={`rounded-xl p-4 transition-colors duration-150 border ${currentMeta.bannerBg} ${currentMeta.borderAccent}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Date & Daily Gold Price */}
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-xs text-slate-300 mb-1">التاريخ (اليومية)</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={currentDate}
                  onChange={(e) => e.target.value && setCurrentDate(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white font-mono text-sm outline-none focus:border-amber-400"
                />
                {isLocked ? (
                  <button
                    type="button"
                    onClick={() => setShowUnlockPrompt(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600/90 hover:bg-red-600 text-white text-xs font-bold whitespace-nowrap"
                    title="اليوم مقفول — اضغط لفتح القفل بسبب"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    مقفول
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleDayLock(currentDate, true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium whitespace-nowrap"
                    title="قفل اليوم لمنع التعديل بعد المراجعة"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    قفل اليوم
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs text-slate-300">
                  سعر الذهب اليوم (عيار 21 — Enter للتأكيد)
                </label>
                <button
                  type="button"
                  onClick={() => setShowKaratPricesOverride((v) => !v)}
                  className="text-[11px] text-amber-300 hover:underline"
                >
                  {showKaratPricesOverride ? 'إخفاء الأعيرة' : `18 (${effective18Price || '—'}) · 24 (${effective24Price || '—'})`}
                </button>
              </div>
              <div className="relative">
                <input
                  ref={goldPriceInputRef}
                  type="text"
                  inputMode="decimal"
                  value={dayInfo.goldPricePerGram || ''}
                  onChange={(e) => {
                    const val = parseAmountInput(e.target.value);
                    setDayGoldPrice(currentDate, val, true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (dayInfo.goldPricePerGram > 0) {
                        confirmDayGoldPrice(currentDate);
                        focusFirstFieldImmediate();
                      }
                    }
                  }}
                  className={`w-40 px-3 py-1.5 rounded-lg bg-white text-slate-900 font-mono tabular-nums text-base font-bold outline-none ${
                    !isPriceConfirmed
                      ? 'border-2 border-red-500 ring-2 ring-red-400/50'
                      : 'focus:ring-2 focus:ring-amber-400'
                  }`}
                  placeholder="سجّل سعر 21..."
                />
                <span className="absolute left-2.5 top-2 text-xs text-slate-500 font-semibold">
                  ج.م
                </span>
              </div>
            </div>

            {/* Mode Switcher F1 - F5 */}
            <div className="flex flex-wrap items-center gap-1.5 pt-4 sm:pt-0">
              {(Object.keys(KIND_META) as OperationKind[]).map((k) => {
                const m = KIND_META[k];
                const active = currentKind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setCurrentKind(k)}
                    className={`px-3.5 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                      active
                        ? m.activeBtn
                        : 'bg-white/10 text-slate-200 hover:bg-white/20'
                    }`}
                  >
                    <span className="font-mono text-xs opacity-80">[{m.shortcut}]</span>
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Controls: Show Item toggle, Reconcile Drawer, Ledger Photo */}
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-2 cursor-pointer bg-white/10 px-3 py-1.5 rounded-lg text-xs font-medium text-white select-none">
              <input
                type="checkbox"
                checked={showItemColumn}
                onChange={(e) => setShowItemColumn(e.target.checked)}
                className="rounded text-amber-500 focus:ring-0"
              />
              <span>إظهار البيان {currentKind === 'person' ? '+ الجرامات' : ''}</span>
            </label>

            <button
              type="button"
              onClick={() => setShowReconcileStrip((s) => !s)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                showReconcileStrip
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              <Coins className="w-3.5 h-3.5" />
              <span>خزنة وجرد اليوم</span>
            </button>

            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium cursor-pointer whitespace-nowrap">
              <Camera className="w-3.5 h-3.5" />
              <span>{dayInfo.ledgerImageDataUrl ? 'تغيير صورة الدفتر' : 'إرفاق صورة الدفتر'}</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleAttachDayPhoto}
                className="hidden"
              />
            </label>

            {dayInfo.ledgerImageDataUrl && (
              <button
                type="button"
                onClick={() => setShowAttachedImageModal(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>عرض الدفتر</span>
              </button>
            )}
          </div>
        </div>

        {/* Multi-Karat Daily Prices Manual Override Strip (Fix A.1) */}
        {showKaratPricesOverride && (
          <div className="mt-3 pt-3 border-t border-white/15 flex flex-wrap items-center gap-4 text-xs">
            <span className="text-slate-300 font-semibold">
              أسعار الأعيرة اليوم (تُحسب تلقائياً من عيار 21 ويمكنك تخصيصها يدوياً):
            </span>
            <div className="flex items-center gap-1.5">
              <label className="text-slate-200">عيار 18:</label>
              <input
                type="text"
                inputMode="decimal"
                value={dayInfo.goldPrice18 ?? ''}
                placeholder={String(effective18Price || '')}
                onChange={(e) =>
                  updateDayInfo(currentDate, {
                    goldPrice18:
                      e.target.value.trim() === '' ? undefined : parseAmountInput(e.target.value),
                  })
                }
                className="w-24 px-2 py-1 rounded bg-white text-slate-900 font-mono font-bold"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-slate-200">عيار 24:</label>
              <input
                type="text"
                inputMode="decimal"
                value={dayInfo.goldPrice24 ?? ''}
                placeholder={String(effective24Price || '')}
                onChange={(e) =>
                  updateDayInfo(currentDate, {
                    goldPrice24:
                      e.target.value.trim() === '' ? undefined : parseAmountInput(e.target.value),
                  })
                }
                className="w-24 px-2 py-1 rounded bg-white text-slate-900 font-mono font-bold"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-slate-200">عيار آخر:</label>
              <input
                type="text"
                inputMode="decimal"
                value={dayInfo.goldPriceOther ?? ''}
                placeholder={String(dayInfo.goldPricePerGram || '')}
                onChange={(e) =>
                  updateDayInfo(currentDate, {
                    goldPriceOther:
                      e.target.value.trim() === '' ? undefined : parseAmountInput(e.target.value),
                  })
                }
                className="w-24 px-2 py-1 rounded bg-white text-slate-900 font-mono font-bold"
              />
            </div>
          </div>
        )}

        {/* Unlock Modal inline if locked */}
        {showUnlockPrompt && (
          <div className="mt-3 p-3 rounded-lg bg-red-950/90 border border-red-400 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-bold text-red-100">
              هذا اليوم مقفول بعد المراجعة. لفتح القفل وتعديل الصفوف، اكتب سبب الفتح (يُسجل في سجل التعديلات):
            </span>
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <input
                type="text"
                autoFocus
                value={unlockReasonInput}
                onChange={(e) => setUnlockReasonInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && unlockReasonInput.trim()) {
                    toggleDayLock(currentDate, false, unlockReasonInput.trim());
                    setShowUnlockPrompt(false);
                    setUnlockReasonInput('');
                  }
                }}
                placeholder="مثال: تصحيح فاتورة بيع سقطت سهواً..."
                className="flex-1 px-3 py-1 text-xs rounded bg-white text-slate-900 outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (!unlockReasonInput.trim()) return;
                  toggleDayLock(currentDate, false, unlockReasonInput.trim());
                  setShowUnlockPrompt(false);
                  setUnlockReasonInput('');
                }}
                className="px-3 py-1 bg-amber-500 text-slate-950 text-xs font-bold rounded"
              >
                فتح القفل
              </button>
              <button
                type="button"
                onClick={() => setShowUnlockPrompt(false)}
                className="px-2.5 py-1 bg-white/10 text-white text-xs rounded"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Collapsible Daily Safe & Gold Inventory Reconciliation Strip */}
      {showReconcileStrip && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          {/* Daily Safe Cash */}
          <div className="space-y-3 border-b lg:border-b-0 lg:border-l border-slate-200 pb-4 lg:pb-0 lg:pl-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Coins className="w-4 h-4 text-amber-600" />
                <span>خزنة اليوم (التسوية النقدية — {currentDate})</span>
              </h3>
              <span className="text-xs text-slate-500">
                يُرحّل الجرد الفعلي لأقرب يوم عمل لاحق تلقائياً
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">رصيد أول اليوم (نقدية)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={dayInfo.openingCash ?? ''}
                  onChange={(e) =>
                    updateDayInfo(
                      currentDate,
                      {
                        openingCash:
                          e.target.value === '' ? undefined : parseAmountInput(e.target.value),
                      },
                      { isManualOpening: true }
                    )
                  }
                  placeholder="غير مسجل"
                  className="w-full px-2.5 py-1.5 font-mono tabular-nums font-semibold border border-slate-300 rounded bg-slate-50 focus:bg-white outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">الرصيد المتوقع بالخزنة</label>
                <div className="px-2.5 py-1.5 font-mono tabular-nums font-bold bg-slate-100 rounded border border-slate-200 text-slate-900">
                  {formatNumber(dayStats.safeSummary.expectedCash)} ج.م
                </div>
              </div>
              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  الرصيد الفعلي (الجرد)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={dayInfo.actualCash ?? ''}
                  onChange={(e) =>
                    updateDayInfo(currentDate, {
                      actualCash:
                        e.target.value === '' ? undefined : parseAmountInput(e.target.value),
                    })
                  }
                  placeholder="أدخل جرد النقدية..."
                  className="w-full px-2.5 py-1.5 font-mono tabular-nums font-bold border-2 border-amber-500 rounded bg-white outline-none"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              <div className="text-slate-600 space-x-2 space-x-reverse">
                <span>+مبيعات نقدية: {formatNumber(dayStats.safeSummary.cashSales)}</span>
                <span>·</span>
                <span>−مشتريات نقدية: {formatNumber(dayStats.safeSummary.cashPurchases)}</span>
                <span>·</span>
                <span>−مصاريف: {formatNumber(dayStats.safeSummary.expenses)}</span>
                <span>·</span>
                <span>−سلف: {formatNumber(dayStats.safeSummary.advances)}</span>
              </div>
              {dayStats.safeSummary.hasActual && (
                <div
                  className={`font-mono font-bold px-2.5 py-1 rounded ${
                    !dayStats.safeSummary.hasOpening
                      ? 'bg-yellow-100 text-yellow-900'
                      : Math.abs(dayStats.safeSummary.difference) <= settings.cashDiscrepancyThreshold
                      ? 'bg-emerald-50 text-emerald-800'
                      : dayStats.safeSummary.difference < 0
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {!dayStats.safeSummary.hasOpening
                    ? 'رصيد أول اليوم غير مسجل'
                    : dayStats.safeSummary.difference === 0
                    ? 'مطابق تماماً ✓'
                    : dayStats.safeSummary.difference < 0
                    ? `عجز خزنة: ${formatNumber(Math.abs(dayStats.safeSummary.difference))} ج.م`
                    : `زيادة خزنة: +${formatNumber(dayStats.safeSummary.difference)} ج.م`}
                </div>
              )}
            </div>
          </div>

          {/* Daily Gold Inventory */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-teal-600" />
                <span>جرد الذهب بالجرامات (مخزون المحل — {currentDate})</span>
              </h3>
              <span className="text-xs text-slate-500">
                هامش السماح: {settings.goldBalanceToleranceG} جرام
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">رصيد أول اليوم (جرام)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={dayInfo.openingBalanceG ?? ''}
                  onChange={(e) =>
                    updateDayInfo(
                      currentDate,
                      {
                        openingBalanceG:
                          e.target.value === ''
                            ? undefined
                            : parseWeightInput(e.target.value, settings.shortSpaceWeightMode),
                      },
                      { isManualOpening: true }
                    )
                  }
                  placeholder="غير مسجل"
                  className="w-full px-2.5 py-1.5 font-mono tabular-nums font-semibold border border-slate-300 rounded bg-slate-50 focus:bg-white outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">الرصيد المتوقع بالمحل</label>
                <div className="px-2.5 py-1.5 font-mono tabular-nums font-bold bg-slate-100 rounded border border-slate-200 text-slate-900">
                  {formatWeight(dayStats.expectedClosingGoldG)} جرام
                </div>
              </div>
              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  الجرد الفعلي بالجرام
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={dayInfo.closingBalanceG ?? ''}
                  onChange={(e) =>
                    updateDayInfo(currentDate, {
                      closingBalanceG:
                        e.target.value === ''
                          ? undefined
                          : parseWeightInput(e.target.value, settings.shortSpaceWeightMode),
                    })
                  }
                  placeholder="أدخل جرد الجرامات..."
                  className="w-full px-2.5 py-1.5 font-mono tabular-nums font-bold border-2 border-teal-600 rounded bg-white outline-none"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              <div className="text-slate-600">
                أول اليوم ({formatWeight(dayStats.openingGoldG)}) + شراء ({formatWeight(dayStats.buyG)}) − بيع ({formatWeight(dayStats.sellG)})
              </div>
              {dayStats.hasActualGold && (
                <div
                  className={`font-mono font-bold px-2.5 py-1 rounded ${
                    dayInfo.openingBalanceG === undefined
                      ? 'bg-yellow-100 text-yellow-900'
                      : Math.abs(dayStats.goldDiffG) <= settings.goldBalanceToleranceG
                      ? 'bg-emerald-50 text-emerald-800'
                      : dayStats.goldDiffG < 0
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {dayInfo.openingBalanceG === undefined
                    ? 'رصيد أول اليوم غير مسجل'
                    : Math.abs(dayStats.goldDiffG) <= 0.001
                    ? 'مطابق تماماً ✓'
                    : `${dayStats.goldDiffG < 0 ? 'عجز جرد:' : 'زيادة جرد:'} ${formatWeight(
                        Math.abs(dayStats.goldDiffG)
                      )} جرام (~${formatNumber(
                        Math.abs(dayStats.goldDiffG) * (dayInfo.goldPricePerGram || 0)
                      )} ج.م)`}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Undo Delete 5-Second Banner */}
      {showUndoBanner && deletedOpUndo && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs">
          <span>
            تم حذف صف ({KIND_META[deletedOpUndo.kind].label} —{' '}
            {formatNumber(deletedOpUndo.total)} ج.م). يمكنك التراجع خلال 5 ثوانٍ.
          </span>
          <button
            type="button"
            onClick={undoDeleteOperation}
            className="inline-flex items-center gap-1 px-3 py-1 rounded bg-amber-500 text-slate-950 font-bold hover:bg-amber-400"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>تراجع عن الحذف</span>
          </button>
        </div>
      )}

      {/* Main Excel-like Fast Entry Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-visible">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-900">
              وضع الإدخال الحالي: {currentMeta.label} ({currentMeta.shortcut})
            </span>
            <span>·</span>
            <span>
              Enter ينقل للخانة التالية ويحفظ فوراً بدون ماوس — اكتب الوزن مثل{' '}
              <code className="font-mono bg-slate-200 px-1 rounded">12.350</code> أو{' '}
              <code className="font-mono bg-slate-200 px-1 rounded">12 350</code>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Fix A.1: Karat selector pills with Ctrl+1/2/3/4 shortcuts */}
            {(currentKind === 'buy' || currentKind === 'sell') && (
              <div className="flex items-center gap-1 bg-slate-200/80 p-0.5 rounded-lg">
                <span className="text-[11px] font-bold text-slate-600 px-1.5">العيار:</span>
                {KARAT_OPTIONS.map((kOpt) => (
                  <button
                    key={String(kOpt.value)}
                    type="button"
                    title={`اختصار ${kOpt.shortcut}`}
                    onClick={() => setCurrentKarat(kOpt.value)}
                    className={`px-2 py-1 rounded-md text-xs font-mono font-bold transition-colors ${
                      currentKarat === kOpt.value
                        ? 'bg-slate-900 text-amber-400 shadow-xs'
                        : 'text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    {kOpt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Payment cash/credit toggle for buy/sell */}
            {(currentKind === 'buy' || currentKind === 'sell') && (
              <div className="flex items-center gap-1 bg-slate-200/80 p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => setPaymentType('cash')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                    paymentType === 'cash'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  نقدي (يدخل الخزنة)
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('credit')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                    paymentType === 'credit'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  آجل (على حساب شخص)
                </button>
              </div>
            )}

            {currentKind === 'person' && (
              <div className="flex items-center gap-1 bg-slate-200/80 p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => setPersonDirection('gave_him')}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                    personDirection === 'gave_him'
                      ? 'bg-red-600 text-white'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  أعطيناه فلوس / سددنا له (↑↓)
                </button>
                <button
                  type="button"
                  onClick={() => setPersonDirection('received_from_him')}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                    personDirection === 'received_from_him'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  استلمنا منه فلوس / أمانة (↑↓)
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowTableFilter((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 border transition-colors cursor-pointer ${
                showTableFilter
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>فلترة وبحث في اليوم</span>
            </button>
          </div>
        </div>

        {showTableFilter && (
          <div className="p-3 bg-slate-50 border-b border-slate-200">
            <FilterBar
              screenId="fast_entry"
              filter={tableFilter}
              onChange={setTableFilter}
              totalCount={rawDayOperations.length}
              filteredCount={dayOperations.length}
              filteredWeightG={filterResult.totalWeightG}
              filteredAmountEGP={filterResult.totalAmountEGP}
              persons={persons}
              workers={workers}
              savedPresets={savedFilterPresets}
              onSavePreset={(name) => saveFilterPreset(name, tableFilter, 'fast_entry')}
              onDeletePreset={deleteFilterPreset}
            />
          </div>
        )}

        {/* Virtualization pagination bar if > 1000 rows */}
        {dayOperations.length > 1000 && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between text-xs">
            <span>
              يوجد {dayOperations.length} عملية في هذا اليوم — يتم عرض الصفوف من {virtualStart + 1}{' '}
              إلى {Math.min(dayOperations.length, virtualStart + 300)} للحفاظ على السرعة الفائقة.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={virtualStart === 0}
                onClick={() => setVirtualStart((s) => Math.max(0, s - 300))}
                className="px-2.5 py-1 bg-white border border-slate-300 rounded disabled:opacity-50"
              >
                السابق
              </button>
              <button
                type="button"
                disabled={virtualStart + 300 >= dayOperations.length}
                onClick={() => setVirtualStart((s) => s + 300)}
                className="px-2.5 py-1 bg-white border border-slate-300 rounded disabled:opacity-50"
              >
                الأحدث
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="py-2.5 px-3 w-12 text-center">#</th>
                <th className="py-2.5 px-3 w-28">النوع</th>
                <th className="py-2.5 px-2 w-20 text-center">العيار</th>
                <th className="py-2.5 px-3 w-36">
                  {currentKind === 'buy' || currentKind === 'sell'
                    ? 'الوزن (جرام)'
                    : currentKind === 'expense'
                    ? 'بند المصروف'
                    : currentKind === 'advance'
                    ? 'اسم العامل'
                    : 'اسم الشخص'}
                </th>
                <th className="py-2.5 px-3 w-40">السعر / المبلغ (ج.م)</th>
                <th className="py-2.5 px-3 w-32">سعر الجرام</th>
                {(showItemColumn || currentKind !== 'buy') && (
                  <th className="py-2.5 px-3 min-w-[160px]">
                    {paymentType === 'credit' && (currentKind === 'buy' || currentKind === 'sell')
                      ? 'اسم الشخص (للآجل) / البيان'
                      : currentKind === 'person' && showItemColumn
                      ? 'جرامات ذهب (اختياري) + البيان'
                      : 'البيان / التفاصيل'}
                  </th>
                )}
                <th className="py-2.5 px-3 w-36">نقطة المراجعة الحية</th>
                <th className="py-2.5 px-3 w-28 text-center">علامة المراجعة</th>
              </tr>
            </thead>
            <tbody>
              {visibleOperations.map((op, idx) => (
                <FastTableRow
                  key={op.id}
                  index={virtualStart + idx}
                  op={op}
                  dayInfo={dayInfo}
                  dayOps={dayOperations}
                  showItemColumn={showItemColumn}
                  isLocked={isLocked}
                  personName={op.personId ? personsMap.get(op.personId) : undefined}
                  workerName={op.workerId ? workersMap.get(op.workerId) : undefined}
                  onUpdate={updateOperation}
                  onDelete={deleteOperation}
                  onToggleReview={toggleOperationReviewed}
                  onFocusRowInput={handleRowFocusNavigation}
                  rowRefSetter={setRowRef}
                />
              ))}

              {/* ACTIVE FAST ENTRY ROW AT THE BOTTOM OF THE TABLE */}
              {!isLocked && (
                <tr
                  ref={activeEntryRowTrRef}
                  className="bg-amber-50/60 border-t-2 border-amber-400"
                >
                  <td className="py-2.5 px-3 font-mono text-xs font-bold text-amber-800 text-center">
                    <Plus className="w-4 h-4 mx-auto" />
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`text-xs font-bold px-2 py-1 rounded ${currentMeta.badgeBg}`}
                    >
                      {currentMeta.label}
                    </span>
                  </td>

                  {/* Karat selector in active row (Fix A.1) */}
                  <td className="py-2 px-2 text-center">
                    {currentKind === 'buy' || currentKind === 'sell' ? (
                      <select
                        tabIndex={-1}
                        value={currentKarat}
                        onChange={(e) => {
                          const v = e.target.value;
                          setCurrentKarat(
                            v === 'other' ? 'other' : (Number(v) as 18 | 21 | 24)
                          );
                        }}
                        className="px-1.5 py-1.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg text-slate-900"
                      >
                        <option value={18}>18</option>
                        <option value={21}>21</option>
                        <option value={24}>24</option>
                        <option value="other">آخر</option>
                      </select>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>

                  {/* Column 1 Input: Weight (for buy/sell) OR Autocomplete Lookup (for F3/F4/F5) */}
                  <td className="py-2 px-3 relative">
                    {currentKind === 'buy' || currentKind === 'sell' ? (
                      <div>
                        <input
                          ref={firstInputRef}
                          type="text"
                          inputMode="decimal"
                          enterKeyHint="next"
                          value={weightInput}
                          onChange={(e) => {
                            setWeightInput(e.target.value);
                            setAmbiguousWeightPrompt(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (settings.shortSpaceWeightMode === 'ask') {
                                const amb = inspectAmbiguousSpaceWeight(weightInput);
                                if (amb) {
                                  setAmbiguousWeightPrompt({
                                    ...amb,
                                    nextFocusTarget: 'total',
                                  });
                                  return;
                                }
                              }
                              const w = parseWeightInput(
                                weightInput,
                                settings.shortSpaceWeightMode
                              );
                              if (w <= 0) {
                                triggerShake('weight');
                                return;
                              }
                              secondInputRef.current?.focus();
                              secondInputRef.current?.select?.();
                            } else if (e.key === 'ArrowUp' && dayOperations.length > 0) {
                              e.preventDefault();
                              handleRowFocusNavigation(dayOperations.length, 'up');
                            } else if (e.key === 'Escape') {
                              setWeightInput('');
                              setTotalInput('');
                              setItemInput('');
                              setAmbiguousWeightPrompt(null);
                            }
                          }}
                          placeholder="مثال: 12.350 أو 12 350"
                          className={`w-full px-3 py-2 font-mono tabular-nums text-base font-bold bg-white border-2 rounded-lg outline-none transition-all ${
                            shakeField === 'weight'
                              ? 'border-red-600 bg-red-50 animate-shake'
                              : 'border-slate-300 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/20'
                          }`}
                        />

                        {/* Fix C.13: Inline prompt when second part after space has < 3 digits */}
                        {ambiguousWeightPrompt && (
                          <div className="mt-1.5 p-2 bg-amber-100 border border-amber-400 rounded-lg text-[11px] font-bold text-amber-950 flex flex-wrap items-center justify-between gap-2 shadow-sm">
                            <span>
                              تقصد {ambiguousWeightPrompt.milliVal.toFixed(3)} أم{' '}
                              {ambiguousWeightPrompt.decimalVal}؟
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  const chosen = ambiguousWeightPrompt.decimalVal;
                                  setWeightInput(chosen.toFixed(3));
                                  const target = ambiguousWeightPrompt.nextFocusTarget;
                                  setAmbiguousWeightPrompt(null);
                                  if (target === 'commit') {
                                    commitNewEntryRow(chosen);
                                  } else {
                                    secondInputRef.current?.focus();
                                    secondInputRef.current?.select?.();
                                  }
                                }}
                                className="px-2 py-0.5 bg-amber-700 text-white rounded hover:bg-amber-800 font-mono"
                              >
                                {ambiguousWeightPrompt.decimalVal} (عشري)
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const chosen = ambiguousWeightPrompt.milliVal;
                                  setWeightInput(chosen.toFixed(3));
                                  const target = ambiguousWeightPrompt.nextFocusTarget;
                                  setAmbiguousWeightPrompt(null);
                                  if (target === 'commit') {
                                    commitNewEntryRow(chosen);
                                  } else {
                                    secondInputRef.current?.focus();
                                    secondInputRef.current?.select?.();
                                  }
                                }}
                                className="px-2 py-0.5 bg-slate-800 text-white rounded hover:bg-slate-900 font-mono"
                              >
                                {ambiguousWeightPrompt.milliVal.toFixed(3)} (ملي)
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          ref={firstInputRef}
                          type="text"
                          enterKeyHint="next"
                          value={lookupQuery}
                          onFocus={() => setShowDropdown(true)}
                          onChange={(e) => {
                            setLookupQuery(e.target.value);
                            setSelectedEntityId('');
                            setDropdownIndex(0);
                            setShowDropdown(true);
                            setPendingCreateConfirm(false);
                          }}
                          onKeyDown={handleLookupKeyDown}
                          placeholder={
                            currentKind === 'expense'
                              ? 'ابحث عن البند (كهرباء، ضيافة...)'
                              : currentKind === 'advance'
                              ? 'اسم العامل...'
                              : 'اسم الشخص...'
                          }
                          className={`w-full px-3 py-2 text-sm font-bold bg-white border-2 rounded-lg outline-none ${
                            shakeField === 'lookup'
                              ? 'border-red-600 bg-red-50 animate-shake'
                              : 'border-slate-300 focus:border-amber-600'
                          }`}
                        />

                        {/* Instant Autocomplete Dropdown */}
                        {showDropdown && suggestions.length > 0 && (
                          <div className="absolute z-30 right-0 left-0 mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                            {suggestions.map((sug, sIdx) => (
                              <button
                                key={sug.id}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setLookupQuery(sug.label);
                                  setSelectedEntityId(sug.id);
                                  setShowDropdown(false);
                                  secondInputRef.current?.focus();
                                }}
                                className={`w-full text-right px-3 py-2 text-xs flex items-center justify-between border-b border-slate-100 last:border-0 ${
                                  sIdx === dropdownIndex
                                    ? 'bg-amber-100 text-slate-900 font-bold'
                                    : 'text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                <span>{sug.label}</span>
                                <span className="text-slate-400">{sug.sub}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {pendingCreateConfirm && (
                          <div className="mt-1 px-2 py-1 bg-amber-100 border border-amber-300 rounded text-[11px] font-bold text-amber-950">
                            {similarPersonHint ||
                              `إنشاء اسم جديد "${lookupQuery}"؟ اضغط Enter مرة ثانية للتأكيد`}
                          </div>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Column 2 Input: Total Amount */}
                  <td className="py-2 px-3">
                    <input
                      ref={secondInputRef}
                      type="text"
                      inputMode="decimal"
                      enterKeyHint={showItemColumn || paymentType === 'credit' ? 'next' : 'done'}
                      value={totalInput}
                      onChange={(e) => {
                        setTotalInput(e.target.value);
                        setInlineTypoSuggestion(null);
                      }}
                      onKeyDown={(e) => {
                        if (inlineTypoSuggestion) {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const sug = inlineTypoSuggestion.suggestion;
                            setInlineTypoSuggestion(null);
                            commitNewEntryRow(sug.suggestedWeightG, sug.suggestedTotal, true);
                            return;
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            const origW = inlineTypoSuggestion.originalWeightG;
                            const origT = inlineTypoSuggestion.originalTotal;
                            setInlineTypoSuggestion(null);
                            commitNewEntryRow(origW, origT, true);
                            return;
                          }
                        }
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const t = parseAmountInput(totalInput);
                          if (
                            t <= 0 &&
                            !(
                              currentKind === 'person' &&
                              parseWeightInput(weightInput, settings.shortSpaceWeightMode) > 0
                            )
                          ) {
                            triggerShake('total');
                            return;
                          }
                          if (
                            showItemColumn ||
                            ((currentKind === 'buy' || currentKind === 'sell') &&
                              paymentType === 'credit')
                          ) {
                            thirdInputRef.current?.focus();
                            thirdInputRef.current?.select?.();
                          } else {
                            commitNewEntryRow();
                          }
                        } else if (e.key === 'Escape') {
                          setTotalInput('');
                          setInlineTypoSuggestion(null);
                          firstInputRef.current?.focus();
                        }
                      }}
                      placeholder="المبلغ الإجمالي..."
                      className={`w-full px-3 py-2 font-mono tabular-nums text-base font-bold bg-white border-2 rounded-lg outline-none transition-all ${
                        shakeField === 'total'
                          ? 'border-red-600 bg-red-50 animate-shake'
                          : 'border-slate-300 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/20'
                      }`}
                    />
                  </td>

                  {/* Calculated Read-only Gram Price */}
                  <td className="py-2.5 px-3 font-mono tabular-nums text-sm font-bold text-slate-800">
                    {draftGramPrice > 0 ? `${formatNumber(draftGramPrice)} ج.م` : '—'}
                  </td>

                  {/* Optional Item / Credit Person / Person Gold Grams Column */}
                  {(showItemColumn || currentKind !== 'buy') && (
                    <td className="py-2 px-3">
                      {(currentKind === 'buy' || currentKind === 'sell') &&
                      paymentType === 'credit' ? (
                        <input
                          ref={thirdInputRef}
                          type="text"
                          enterKeyHint="done"
                          value={lookupQuery}
                          onChange={(e) => setLookupQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitNewEntryRow();
                            }
                          }}
                          placeholder="اسم الشخص للعملية الآجلة (ثم Enter)..."
                          className="w-full px-3 py-2 text-sm bg-white border-2 border-amber-400 rounded-lg outline-none focus:border-amber-600"
                        />
                      ) : currentKind === 'person' && showItemColumn ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            ref={thirdInputRef}
                            type="text"
                            inputMode="decimal"
                            value={weightInput}
                            onChange={(e) => setWeightInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitNewEntryRow();
                              }
                            }}
                            placeholder="ذهب (جرام)"
                            className="w-24 px-2 py-2 font-mono text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-amber-600"
                          />
                          <input
                            type="text"
                            value={itemInput}
                            onChange={(e) => setItemInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitNewEntryRow();
                              }
                            }}
                            placeholder="بيان..."
                            className="flex-1 px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-amber-600"
                          />
                        </div>
                      ) : showItemColumn ? (
                        <input
                          ref={thirdInputRef}
                          type="text"
                          enterKeyHint="done"
                          value={itemInput}
                          onChange={(e) => setItemInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitNewEntryRow();
                            }
                          }}
                          placeholder="البيان (اختياري — Enter للحفظ)..."
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg outline-none focus:border-amber-600"
                        />
                      ) : (
                        <span className="text-xs text-slate-400 px-2">
                          اضغط Enter في السعر للحفظ الفوري
                        </span>
                      )}
                    </td>
                  )}

                  {/* Live 150ms Indicator for Active Entry Row */}
                  <td className="py-2.5 px-3">
                    <div
                      className="inline-flex items-center gap-1.5"
                      title={draftLiveStatus.reasons.join(' | ')}
                    >
                      {draftLiveStatus.status === 'neutral' && (
                        <>
                          <CircleDot className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-xs text-slate-500">محايد</span>
                        </>
                      )}
                      {draftLiveStatus.status === 'ok' && (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="text-xs font-medium text-emerald-800">سليم</span>
                        </>
                      )}
                      {draftLiveStatus.status === 'warn' && (
                        <>
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span className="text-xs font-bold text-amber-800 truncate max-w-[115px]">
                            {draftLiveStatus.reasons[0]}
                          </span>
                        </>
                      )}
                      {draftLiveStatus.status === 'danger' && (
                        <>
                          <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
                          <span className="text-xs font-bold text-red-700 truncate max-w-[115px]">
                            {draftLiveStatus.reasons[0]}
                          </span>
                        </>
                      )}
                    </div>
                  </td>

                  <td className="py-2 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => commitNewEntryRow()}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
                    >
                      حفظ (Enter)
                    </button>
                  </td>
                </tr>
              )}

              {/* G1.8: Inline Fast-Entry Typo Suggestion Bar (Enter to apply, Esc to keep as-is) */}
              {!isLocked && inlineTypoSuggestion && (
                <tr className="bg-amber-900 text-white border-t border-amber-700">
                  <td colSpan={9} className="py-2.5 px-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 font-bold">
                        <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                        <span>{inlineTypoSuggestion.suggestion.message}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const sug = inlineTypoSuggestion.suggestion;
                            setInlineTypoSuggestion(null);
                            commitNewEntryRow(sug.suggestedWeightG, sug.suggestedTotal, true);
                          }}
                          className="px-3 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold rounded-lg cursor-pointer"
                        >
                          نعم، صحّح واحفظ (Enter)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const origW = inlineTypoSuggestion.originalWeightG;
                            const origT = inlineTypoSuggestion.originalTotal;
                            setInlineTypoSuggestion(null);
                            commitNewEntryRow(origW, origT, true);
                          }}
                          className="px-3 py-1 bg-white/15 hover:bg-white/25 text-white font-bold rounded-lg cursor-pointer"
                        >
                          الإبقاء كما هو (Esc)
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Attached Ledger Photo Preview Modal */}
      {showAttachedImageModal && dayInfo.ledgerImageDataUrl && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                صورة صفحة الدفتر المرفقة ليوم {currentDate}
              </h3>
              <button
                type="button"
                onClick={() => setShowAttachedImageModal(false)}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-bold"
              >
                إغلاق
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1 bg-slate-900 flex items-center justify-center">
              <img
                src={dayInfo.ledgerImageDataUrl}
                alt={`دفتر يوم ${currentDate}`}
                referrerPolicy="no-referrer"
                className="max-w-full h-auto rounded"
              />
            </div>
          </div>
        </div>
      )}

      {/* Fixed Bottom Totals Bar */}
      <div className="fixed bottom-0 right-0 left-0 z-30 bg-slate-900 text-white border-t border-slate-700 px-4 py-2.5 shadow-lg no-print">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div>
              <span className="text-slate-400 ml-1.5">إجمالي شراء اليوم:</span>
              <span className="font-mono tabular-nums font-bold text-teal-400">
                {formatWeight(dayStats.buyG)} جرام
              </span>
              <span className="mx-1 text-slate-500">/</span>
              <span className="font-mono tabular-nums font-bold text-white">
                {formatNumber(dayStats.buyTotal)} ج.م
              </span>
            </div>

            <div>
              <span className="text-slate-400 ml-1.5">إجمالي بيع اليوم:</span>
              <span className="font-mono tabular-nums font-bold text-amber-400">
                {formatWeight(dayStats.sellG)} جرام
              </span>
              <span className="mx-1 text-slate-500">/</span>
              <span className="font-mono tabular-nums font-bold text-white">
                {formatNumber(dayStats.sellTotal)} ج.م
              </span>
            </div>

            <div>
              <span className="text-slate-400 ml-1.5">صافي حركة الذهب:</span>
              <span
                className={`font-mono tabular-nums font-bold ${
                  dayStats.netG >= 0 ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {dayStats.netG > 0 ? '+' : ''}
                {formatWeight(dayStats.netG)} جرام
              </span>
            </div>

            <div className="hidden xl:block">
              <span className="text-slate-400 ml-1.5">المتوقع بالخزنة:</span>
              <span className="font-mono tabular-nums font-bold text-sky-300">
                {formatNumber(dayStats.safeSummary.expectedCash)} ج.م
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 hidden md:inline">
              عدد عمليات اليوم: {dayOperations.length}
            </span>
            <button
              type="button"
              onClick={onGoToAudit}
              className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-lg transition-colors whitespace-nowrap"
            >
              راجع الحسابات الآن ←
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
