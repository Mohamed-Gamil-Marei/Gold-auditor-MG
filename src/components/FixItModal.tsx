import React, { useMemo, useState } from 'react';
import {
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Sparkles,
  X,
  ArrowLeft,
} from 'lucide-react';
import { useAuditStore } from '../store/useAuditStore';
import { FixItSuggestion, scanForFixItSuggestions } from '../utils/fixItEngine';

interface FixItModalProps {
  open: boolean;
  onClose: () => void;
}

export const FixItModal: React.FC<FixItModalProps> = ({ open, onClose }) => {
  const {
    operations,
    daysMap,
    persons,
    settings,
    applyFixItSuggestion,
    applyBulkFixItSuggestions,
    toggleDayLock,
  } = useAuditStore();

  const [ignoredIds, setIgnoredIds] = useState<string[]>([]);
  const [appliedCountBanner, setAppliedCountBanner] = useState<string | null>(null);
  const [unlockPromptForSuggestion, setUnlockPromptForSuggestion] = useState<{
    suggestion: FixItSuggestion;
    reason: string;
  } | null>(null);

  const suggestions = useMemo(() => {
    if (!open) return [];
    const all = scanForFixItSuggestions({
      operations,
      daysMap,
      persons,
      settings,
    });
    return all.filter((s) => !ignoredIds.includes(s.id));
  }, [open, operations, daysMap, persons, settings, ignoredIds]);

  if (!open) return null;

  const safeUnlockedSuggestions = suggestions.filter(
    (s) => s.safeToAutoApply && !s.isDayLocked
  );

  const handleApplySingle = (sug: FixItSuggestion) => {
    if (sug.isDayLocked) {
      setUnlockPromptForSuggestion({ suggestion: sug, reason: '' });
      return;
    }
    const ok = applyFixItSuggestion(sug);
    if (ok) {
      setAppliedCountBanner(`تم تطبيق التصحيح بنجاح وتوثيقه في سجل التعديلات: ${sug.title} ✓`);
    }
  };

  const handleApplyAllSafe = () => {
    if (safeUnlockedSuggestions.length === 0) return;
    const count = applyBulkFixItSuggestions(safeUnlockedSuggestions);
    setAppliedCountBanner(
      `تم تطبيق ${count} تصحيح آمن دفعة واحدة مع أخذ لقطة أمان للتراجع خلال 10 دقائق ✓`
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold">
                أداة تصحيح الأخطاء الشائعة الذكية (Fix-It)
              </h2>
              <p className="text-xs text-slate-300">
                فحص الأصفار الزائدة/الناقصة، انعكاس الوزن والسعر، التواريخ الخاطئة، تكرار الأشخاص، وقيود التسوية
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {safeUnlockedSuggestions.length > 0 && (
              <button
                type="button"
                onClick={handleApplyAllSafe}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>طبّق الكل الآمن ({safeUnlockedSuggestions.length})</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {appliedCountBanner && (
          <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 text-emerald-900 text-xs font-bold flex items-center justify-between">
            <span>{appliedCountBanner}</span>
            <button
              type="button"
              onClick={() => setAppliedCountBanner(null)}
              className="text-emerald-700 hover:underline"
            >
              إغلاق
            </button>
          </div>
        )}

        {/* Unlock Day Prompt for Locked Day Fix */}
        {unlockPromptForSuggestion && (
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-300 text-xs space-y-2">
            <div className="font-bold text-amber-950 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-amber-700" />
              <span>
                اليوم ({unlockPromptForSuggestion.suggestion.date}) مقفول بعد المراجعة. لتطبيق هذا التصحيح، أدخل سبب فتح القفل أولاً:
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={unlockPromptForSuggestion.reason}
                onChange={(e) =>
                  setUnlockPromptForSuggestion({
                    ...unlockPromptForSuggestion,
                    reason: e.target.value,
                  })
                }
                placeholder="سبب فتح القفل (مثال: تصحيح صفر زائد عبر أداة Fix-It)..."
                className="flex-1 px-3 py-1.5 bg-white border border-amber-400 rounded-lg outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const r =
                    unlockPromptForSuggestion.reason.trim() ||
                    'فتح لتطبيق تصحيح Fix-It';
                  toggleDayLock(unlockPromptForSuggestion.suggestion.date, false, r);
                  applyFixItSuggestion({
                    ...unlockPromptForSuggestion.suggestion,
                    isDayLocked: false,
                  });
                  setUnlockPromptForSuggestion(null);
                  setAppliedCountBanner('تم فتح قفل اليوم وتطبيق التصحيح وتوثيقه في السجل ✓');
                }}
                className="px-3.5 py-1.5 bg-amber-700 text-white font-bold rounded-lg cursor-pointer"
              >
                فتح القفل وتطبيق التصحيح
              </button>
              <button
                type="button"
                onClick={() => setUnlockPromptForSuggestion(null)}
                className="px-2.5 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-3 bg-slate-50">
          {suggestions.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <div className="text-sm font-extrabold text-slate-900">
                لا توجد أخطاء إدخال شائعة تحتاج لتصحيح!
              </div>
              <p className="text-xs text-slate-500">
                تم فحص جميع العمليات والأوزان والأسعار والتواريخ وأسماء الأشخاص وأرصدة اليوميات بنجاح.
              </p>
            </div>
          ) : (
            suggestions.map((sug) => (
              <div
                key={sug.id}
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px] font-extrabold">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                      {sug.title}
                    </span>
                    {sug.safeToAutoApply && (
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                        آمن للتصحيح السريع
                      </span>
                    )}
                    {sug.isDayLocked && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-800 text-[10px] font-bold">
                        <Lock className="w-3 h-3" />
                        يوم مقفول (يتطلب فتح القفل بسبب)
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">{sug.description}</p>

                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-mono">
                    <span className="px-2.5 py-1 rounded bg-red-50 text-red-800 border border-red-200 line-through">
                      قبل: {sug.oldValueLabel}
                    </span>
                    <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
                    <span className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-900 border border-emerald-300 font-bold">
                      بعد: {sug.newValueLabel}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleApplySingle(sug)}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-lg cursor-pointer"
                  >
                    طبّق
                  </button>
                  <button
                    type="button"
                    onClick={() => setIgnoredIds((prev) => [...prev, sug.id])}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
                  >
                    تجاهل
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>
            كل تصحيح يُطبّق يتم تسجيله تلقائياً في سجل التعديلات بالقيمة القديمة والجديدة مع سبب "تصحيح تلقائي بموافقة المراجع".
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 text-white font-bold rounded-lg cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
