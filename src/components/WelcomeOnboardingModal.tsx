import React, { useState, useRef } from 'react';
import {
  Scale,
  Upload,
  Database,
  CheckCircle2,
  Store,
  ShieldCheck,
  Briefcase,
  Coins,
  Plus,
} from 'lucide-react';
import { useAuditStore } from '../store/useAuditStore';
import { getTodayIso, parseAmountInput } from '../utils/numerals';

interface WelcomeOnboardingModalProps {
  onClose?: () => void;
  forceOpen?: boolean;
}

export const WelcomeOnboardingModal: React.FC<WelcomeOnboardingModalProps> = ({
  onClose,
  forceOpen = false,
}) => {
  const isFirstRun = useAuditStore((s) => s.isFirstRun);
  const operationsCount = useAuditStore((s) => s.operations.length);
  const settings = useAuditStore((s) => s.settings);
  const expenseCategories = useAuditStore((s) => s.expenseCategories);
  const workers = useAuditStore((s) => s.workers);
  const updateSettings = useAuditStore((s) => s.updateSettings);
  const addExpenseCategory = useAuditStore((s) => s.addExpenseCategory);
  const addWorker = useAuditStore((s) => s.addWorker);
  const setDayGoldPrice = useAuditStore((s) => s.setDayGoldPrice);
  const loadDemoData = useAuditStore((s) => s.loadDemoData);
  const importFullBackup = useAuditStore((s) => s.importFullBackup);
  const flushSaveNow = useAuditStore((s) => s.flushSaveNow);

  const [shopName, setShopName] = useState(settings.shopName || '');
  const [auditorName, setAuditorName] = useState(settings.auditorName || 'المراجع المالي');
  const [sellMinBelow, setSellMinBelow] = useState(
    String(settings.allowedPriceRange?.sellMinBelowDaily ?? 0)
  );
  const [sellMaxMaking, setSellMaxMaking] = useState(
    String(settings.allowedPriceRange?.sellMaxMakingCharge ?? 250)
  );
  const [buyMaxDiscount, setBuyMaxDiscount] = useState(
    String(settings.allowedPriceRange?.buyMaxDiscount ?? 150)
  );

  // F7.5: Today's gold price, custom expense categories, and workers
  const [todayPrice21, setTodayPrice21] = useState('7450');
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerSalary, setNewWorkerSalary] = useState('');

  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const shouldShow =
    forceOpen || (isFirstRun && !settings.onboardingCompleted && operationsCount === 0);

  if (!shouldShow) return null;

  const saveQuickSettings = () => {
    const x = Math.max(0, parseAmountInput(sellMinBelow));
    const y = Math.max(0, parseAmountInput(sellMaxMaking));
    const z = Math.max(0, parseAmountInput(buyMaxDiscount));
    const p21 = parseAmountInput(todayPrice21);

    updateSettings({
      shopName: shopName.trim(),
      auditorName: auditorName.trim() || 'المراجع المالي',
      allowedPriceRange: {
        sellMinBelowDaily: x,
        sellMaxMakingCharge: y,
        buyMaxDiscount: z,
      },
      onboardingCompleted: true,
    });

    if (p21 > 0) {
      setDayGoldPrice(getTodayIso(), p21);
    }
  };

  const handleStartFresh = async () => {
    saveQuickSettings();
    useAuditStore.setState({ isFirstRun: false });
    await flushSaveNow();
    onClose?.();
  };

  const handleStartWithDemo = async () => {
    saveQuickSettings();
    loadDemoData();
    useAuditStore.setState({ isFirstRun: false });
    await flushSaveNow();
    onClose?.();
  };

  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || ''));
        if (!parsed || !Array.isArray(parsed.operations)) {
          setImportError('ملف JSON غير صالح: لا يحتوي على سجل العمليات.');
          return;
        }
        saveQuickSettings();
        const res = importFullBackup(parsed);
        if (!res.ok) {
          setImportError(res.error || 'تعذر استيراد النسخة الاحتياطية.');
          return;
        }
        await flushSaveNow();
        onClose?.();
      } catch {
        setImportError('ملف JSON تالف أو غير صالح للقراءة.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-[150] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full overflow-hidden">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-500 flex items-center justify-center text-slate-950 shadow-md shrink-0">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold">مرحباً بك في مراجع الذهب (إعداد المحل السريع)</h2>
            <p className="text-xs text-slate-300 mt-0.5">
              اضبط بيانات المحل وقواعد الأسعار وأسماء العمال وبنود المصاريف قبل البدء — تُحفظ البيانات محلياً على جهازك
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* Step 1: Shop, Auditor & Today's Gold Price */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
              <Store className="w-4 h-4 text-amber-600" />
              <span>1) بيانات المحل والمراجع وسعر ذهب اليوم (عيار 21)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  اسم محل الذهب
                </label>
                <input
                  type="text"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="مثال: مجوهرات النور..."
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  اسم المراجع
                </label>
                <input
                  type="text"
                  value={auditorName}
                  onChange={(e) => setAuditorName(e.target.value)}
                  placeholder="المراجع المالي"
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">
                  سعر الذهب اليوم عيار 21 (ج.م)
                </label>
                <div className="relative">
                  <Coins className="w-3.5 h-3.5 text-amber-600 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={todayPrice21}
                    onChange={(e) => setTodayPrice21(e.target.value)}
                    placeholder="7450"
                    className="w-full h-9 px-3 rounded-lg border border-amber-400 bg-amber-50/50 text-xs font-mono font-extrabold focus:border-amber-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Step 2: Allowed Daily Price Range (X, Y, Z) */}
          <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-3">
            <div className="flex items-center gap-2 text-sm font-extrabold text-amber-950">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              <span>2) قواعد المحل للأسعار (المصنعية المسموحة والخصم المسموح للجرام)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white p-2.5 rounded-lg border border-amber-200">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  بيع أقل من سعر اليوم بـ (X)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={sellMinBelow}
                  onChange={(e) => setSellMinBelow(e.target.value)}
                  className="w-full h-8 px-2.5 rounded border border-slate-300 text-xs font-mono font-bold"
                />
                <span className="block text-[10px] text-slate-500 mt-1">
                  الافتراضي 0 ج.م (أي بيع أقل من سعر اليوم يُنبه عليه)
                </span>
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-amber-200">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  أقصى مصنعية بيع عادية (Y)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={sellMaxMaking}
                  onChange={(e) => setSellMaxMaking(e.target.value)}
                  className="w-full h-8 px-2.5 rounded border border-slate-300 text-xs font-mono font-bold"
                />
                <span className="block text-[10px] text-slate-500 mt-1">
                  المصنعية المسموحة فوق سعر اليوم (مثال: 250 ج.م)
                </span>
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-amber-200">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  أقصى خصم شراء كسر (Z)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={buyMaxDiscount}
                  onChange={(e) => setBuyMaxDiscount(e.target.value)}
                  className="w-full h-8 px-2.5 rounded border border-slate-300 text-xs font-mono font-bold"
                />
                <span className="block text-[10px] text-slate-500 mt-1">
                  الخصم المسموح تحت سعر اليوم عند الشراء (مثال: 150 ج.م)
                </span>
              </div>
            </div>
          </div>

          {/* Step 3 (F7.5): Expense Categories & Workers Quick Setup */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Expense Categories */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="text-xs font-extrabold text-slate-800">
                3) بنود المصروفات المعتادة ({expenseCategories.length})
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newCategoryInput}
                  onChange={(e) => setNewCategoryInput(e.target.value)}
                  placeholder="أضف بند مصروف..."
                  className="flex-1 h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newCategoryInput.trim()) {
                      addExpenseCategory(newCategoryInput.trim());
                      setNewCategoryInput('');
                    }
                  }}
                  className="px-2.5 h-8 bg-slate-900 text-white text-xs font-bold rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {expenseCategories.map((c) => (
                  <span
                    key={c}
                    className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[11px] font-semibold text-slate-700"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>

            {/* Workers & Salaries */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-indigo-600" />
                <span>4) العمال ومرتباتهم الشهرية ({workers.length})</span>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newWorkerName}
                  onChange={(e) => setNewWorkerName(e.target.value)}
                  placeholder="اسم العامل..."
                  className="flex-1 h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={newWorkerSalary}
                  onChange={(e) => setNewWorkerSalary(e.target.value)}
                  placeholder="المرتب..."
                  className="w-24 h-8 px-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => {
                    const sal = parseAmountInput(newWorkerSalary);
                    if (newWorkerName.trim()) {
                      addWorker({
                        name: newWorkerName.trim(),
                        monthlySalary: sal > 0 ? sal : 6000,
                        dueDay: 30,
                        note: '',
                      });
                      setNewWorkerName('');
                      setNewWorkerSalary('');
                    }
                  }}
                  className="px-2.5 h-8 bg-indigo-600 text-white text-xs font-bold rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {workers.map((w) => (
                  <span
                    key={w.id}
                    className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[11px] font-semibold text-slate-700"
                  >
                    {w.name} ({w.monthlySalary} ج.م)
                  </span>
                ))}
              </div>
            </div>
          </div>

          {importError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700">
              {importError}
            </div>
          )}

          {/* Step 5: Choose how to start */}
          <div className="space-y-2">
            <div className="text-xs font-extrabold text-slate-700">
              5) اختر طريقة البدء:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={handleStartFresh}
                className="flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-sm shadow-sm transition cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>ابدأ ببيانات جديدة</span>
                <span className="text-[11px] font-normal text-slate-800">
                  فتح شاشة الإدخال السريع لليوم
                </span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-sm shadow-sm transition cursor-pointer"
              >
                <Upload className="w-5 h-5 text-amber-400" />
                <span>استورد نسخة سابقة (JSON)</span>
                <span className="text-[11px] font-normal text-slate-300">
                  استعادة بيانات من ملف سابق
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportJsonFile}
                className="hidden"
              />

              <button
                type="button"
                onClick={handleStartWithDemo}
                className="flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 font-extrabold text-sm transition cursor-pointer"
              >
                <Database className="w-5 h-5 text-amber-600" />
                <span>تجربة ببيانات جاهزة</span>
                <span className="text-[11px] font-normal text-slate-500">
                  أكثر من 100 عملية لتجربة الفحوصات
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
