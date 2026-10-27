import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Keyboard,
  Search,
  X,
  ArrowUpRight,
  User,
  Briefcase,
  Calendar,
  Scale,
  AlertTriangle,
  History,
} from 'lucide-react';
import { useAuditStore } from '../store/useAuditStore';
import { runAllAuditChecks } from '../utils/checks';
import { formatNumber, formatWeight, normalizeArabicName } from '../utils/numerals';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, onClose }) => {
  if (!open) return null;

  const shortcuts = [
    { keys: 'F1', desc: 'التبديل الفوري لوضع (شراء ذهب)' },
    { keys: 'F2', desc: 'التبديل الفوري لوضع (بيع ذهب)' },
    { keys: 'F3', desc: 'التبديل الفوري لوضع (مصروفات المحل)' },
    { keys: 'F4', desc: 'التبديل الفوري لوضع (سلفة / سحب عامل)' },
    { keys: 'F5', desc: 'التبديل الفوري لوضع (حسابات الأشخاص له/عليه)' },
    { keys: 'Enter', desc: 'الانتقال للخانة التالية، وفي آخر خانة يحفظ الصف وينزل لسطر جديد' },
    { keys: '↑ / ↓', desc: 'التنقل بين الصفوف أو الاقتراحات أو تبديل اتجاه حركة الشخص' },
    { keys: 'Ctrl + 1 / 2 / 3 / 4', desc: 'تغيير العيار السريع (18 / 21 / 24 / آخر)' },
    { keys: 'Ctrl + Z', desc: 'التراجع الفوري عن آخر عملية تمت إضافتها' },
    { keys: 'Ctrl + Delete', desc: 'حذف الصف المحدد مع إمكانية التراجع خلال 5 ثوانٍ' },
    { keys: 'Ctrl + K', desc: 'البحث الشامل السريع في العمليات والأشخاص والعمال والاشتباهات والسجل' },
    { keys: 'Ctrl + S', desc: 'حفظ فوري للبيانات على القرص وإنشاء نسخة احتياطية فورية' },
    { keys: 'Ctrl + F1', desc: 'فتح / إغلاق نافذة اختصارات لوحة المفاتيح هذه' },
    { keys: 'F11', desc: 'تبديل وضع ملء الشاشة (Full Screen) في نسخة سطح المكتب' },
    { keys: 'Ctrl + P', desc: 'طباعة الشاشة أو الكشف الحالي على ورق A4' },
    { keys: 'Esc', desc: 'إلغاء تعديل الصف الحالي أو إغلاق النوافذ المنبثقة' },
  ];

  return (
    <div className="fixed inset-0 z-[160] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-extrabold">دليل اختصارات لوحة المفاتيح السريعة</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {shortcuts.map((s, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200"
              >
                <span className="text-xs font-bold text-slate-700 leading-snug">{s.desc}</span>
                <kbd
                  dir="ltr"
                  className="px-2.5 py-1 rounded-lg bg-slate-900 text-amber-400 font-mono text-xs font-extrabold shrink-0 shadow-xs"
                >
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold cursor-pointer"
          >
            إغلاق (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigateToDate: (date: string, opId?: string) => void;
  onNavigateToAccounts: () => void;
  onNavigateToAudit?: () => void;
  onNavigateToLog?: () => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  open,
  onClose,
  onNavigateToDate,
  onNavigateToAccounts,
  onNavigateToAudit,
  onNavigateToLog,
}) => {
  const operations = useAuditStore((s) => s.operations);
  const daysMap = useAuditStore((s) => s.daysMap);
  const persons = useAuditStore((s) => s.persons);
  const workers = useAuditStore((s) => s.workers);
  const auditLogs = useAuditStore((s) => s.auditLogs);
  const settings = useAuditStore((s) => s.settings);

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const allIssues = useMemo(() => {
    if (!open || !query.trim()) return [];
    try {
      return runAllAuditChecks(operations, daysMap, persons, workers, auditLogs, settings).issues;
    } catch {
      return [];
    }
  }, [open, query, operations, daysMap, persons, workers, auditLogs, settings]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      return {
        ops: [],
        matchingPersons: [],
        matchingWorkers: [],
        matchingIssues: [],
        matchingLogs: [],
      };
    }

    const normQ = normalizeArabicName(q);

    const matchingPersons = persons
      .filter(
        (p) =>
          normalizeArabicName(p.name).includes(normQ) ||
          (p.phone && p.phone.includes(q)) ||
          (p.note && normalizeArabicName(p.note).includes(normQ))
      )
      .slice(0, 6);

    const matchingWorkers = workers
      .filter((w) => normalizeArabicName(w.name).includes(normQ))
      .slice(0, 6);

    const personIdsMatch = new Set(matchingPersons.map((p) => p.id));
    const workerIdsMatch = new Set(matchingWorkers.map((w) => w.id));

    const ops = operations
      .filter((op) => {
        if (op.date.includes(q)) return true;
        if (op.item && normalizeArabicName(op.item).includes(normQ)) return true;
        if (op.note && normalizeArabicName(op.note).includes(normQ)) return true;
        if (op.category && normalizeArabicName(op.category).includes(normQ)) return true;
        if (String(op.total).includes(q) || String(op.weightG).includes(q)) return true;
        if (op.personId && personIdsMatch.has(op.personId)) return true;
        if (op.workerId && workerIdsMatch.has(op.workerId)) return true;
        return false;
      })
      .slice(0, 12);

    const matchingIssues = allIssues
      .filter(
        (iss) =>
          normalizeArabicName(iss.message).includes(normQ) ||
          normalizeArabicName(iss.checkTitle).includes(normQ) ||
          iss.date.includes(q)
      )
      .slice(0, 6);

    const matchingLogs = auditLogs
      .filter(
        (l) =>
          normalizeArabicName(l.description).includes(normQ) ||
          (l.reason && normalizeArabicName(l.reason).includes(normQ)) ||
          l.date.includes(q)
      )
      .slice(0, 6);

    return { ops, matchingPersons, matchingWorkers, matchingIssues, matchingLogs };
  }, [query, operations, persons, workers, allIssues, auditLogs]);

  const handleEnterKey = () => {
    if (results.ops.length > 0) {
      onNavigateToDate(results.ops[0].date, results.ops[0].id);
      onClose();
    } else if (results.matchingPersons.length > 0 || results.matchingWorkers.length > 0) {
      onNavigateToAccounts();
      onClose();
    } else if (results.matchingIssues.length > 0) {
      onNavigateToAudit?.();
      onClose();
    } else if (results.matchingLogs.length > 0) {
      onNavigateToLog?.();
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[160] bg-slate-900/70 backdrop-blur-sm flex items-start justify-center pt-14 p-4 no-print">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center gap-3">
          <Search className="w-5 h-5 text-amber-600 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'Enter') {
                e.preventDefault();
                handleEnterKey();
              }
            }}
            placeholder="ابحث في العمليات، الأشخاص، العمال، الاشتباهات، أو سجل التعديلات (اضغط Enter للفتح)..."
            className="w-full text-sm font-bold text-slate-900 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 max-h-[68vh] overflow-y-auto space-y-4">
          {!query.trim() ? (
            <div className="py-10 text-center text-slate-400 text-xs font-bold">
              اكتب أي كلمة أو رقم أو تاريخ للبحث الشامل في العمليات والأشخاص والعمال والاشتباهات والسجل (Ctrl+K)
            </div>
          ) : (
            <>
              {results.matchingPersons.length > 0 && (
                <div>
                  <div className="text-xs font-extrabold text-slate-500 mb-2 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    <span>الأشخاص ({results.matchingPersons.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {results.matchingPersons.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onNavigateToAccounts();
                          onClose();
                        }}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-amber-50 border border-slate-200 text-right transition cursor-pointer"
                      >
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">{p.name}</div>
                          <div className="text-[11px] text-slate-500">{p.phone || p.type}</div>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-slate-400" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.matchingWorkers.length > 0 && (
                <div>
                  <div className="text-xs font-extrabold text-slate-500 mb-2 flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5" />
                    <span>العمال ({results.matchingWorkers.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {results.matchingWorkers.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => {
                          onNavigateToAccounts();
                          onClose();
                        }}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-amber-50 border border-slate-200 text-right transition cursor-pointer"
                      >
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">{w.name}</div>
                          <div className="text-[11px] text-slate-500">
                            المرتب: {formatNumber(w.monthlySalary)} ج.م
                          </div>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-slate-400" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.matchingIssues.length > 0 && (
                <div>
                  <div className="text-xs font-extrabold text-red-600 mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>الاشتباهات والملاحظات ({results.matchingIssues.length})</span>
                  </div>
                  <div className="space-y-1.5">
                    {results.matchingIssues.map((iss) => (
                      <button
                        key={iss.id}
                        type="button"
                        onClick={() => {
                          onNavigateToAudit?.();
                          onClose();
                        }}
                        className="w-full flex items-center justify-between p-2.5 rounded-xl bg-red-50/70 hover:bg-red-100/80 border border-red-200 text-right transition cursor-pointer"
                      >
                        <div>
                          <div className="text-xs font-extrabold text-red-950">
                            [{iss.date}] {iss.checkTitle}
                          </div>
                          <div className="text-[11px] text-red-800">{iss.message}</div>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-red-600 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.matchingLogs.length > 0 && (
                <div>
                  <div className="text-xs font-extrabold text-slate-500 mb-2 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    <span>سجل التعديلات ({results.matchingLogs.length})</span>
                  </div>
                  <div className="space-y-1.5">
                    {results.matchingLogs.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          onNavigateToLog?.();
                          onClose();
                        }}
                        className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-amber-50 border border-slate-200 text-right transition cursor-pointer"
                      >
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">
                            [{l.date}] {l.description}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            السبب: {l.reason || '—'} · {new Date(l.timestamp).toLocaleString('ar-EG')}
                          </div>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-extrabold text-slate-500 mb-2 flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5" />
                  <span>العمليات المطابقة ({results.ops.length})</span>
                </div>
                {results.ops.length === 0 ? (
                  <div className="text-xs text-slate-400 py-4 text-center">
                    لا توجد عمليات مطابقة للبحث.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {results.ops.map((op) => (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => {
                          onNavigateToDate(op.date, op.id);
                          onClose();
                        }}
                        className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-amber-50 border border-slate-200 text-right transition cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-extrabold ${
                              op.kind === 'sell'
                                ? 'bg-emerald-100 text-emerald-800'
                                : op.kind === 'buy'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {op.kind === 'sell'
                              ? 'بيع'
                              : op.kind === 'buy'
                              ? 'شراء'
                              : op.kind === 'expense'
                              ? 'مصروف'
                              : op.kind === 'advance'
                              ? 'سلفة'
                              : 'شخص'}
                            {op.karat ? ` ${op.karat}` : ''}
                          </span>
                          <div>
                            <div className="text-xs font-extrabold text-slate-900">
                              {op.item || op.category || 'عملية بدون بيان'} —{' '}
                              <span className="font-mono">{formatNumber(op.total)} ج.م</span>
                              {op.weightG > 0 && (
                                <span className="text-slate-600 font-mono mr-1.5">
                                  ({formatWeight(op.weightG)} جرام)
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <Calendar className="w-3 h-3" />
                              <span className="font-mono">{op.date}</span>
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
                          افتح العملية <ArrowUpRight className="w-3.5 h-3.5" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
