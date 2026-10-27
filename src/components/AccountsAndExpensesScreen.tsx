import React, { useState, useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Users,
  Briefcase,
  Receipt,
  Plus,
  FileSpreadsheet,
  Printer,
  FileDown,
  Search,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  FileText,
  CalendarClock,
  Trash2,
} from 'lucide-react';
import { useAuditStore, findSuggestedGoldPrice } from '../store/useAuditStore';
import { PersonType } from '../types';
import {
  findSimilarPerson,
  formatNumber,
  formatWeight,
  getTodayIso,
  normalizeArabicName,
  parseAmountInput,
  parseWeightInput,
} from '../utils/numerals';
import { computePersonBalancesSummary } from '../utils/checks/checkPersonBalances';
import {
  exportDebtStatementExcel,
  exportPersonStatementExcel,
} from '../utils/exportImport';
import { ensureGoldApiBridge } from '../utils/goldApiBridge';

const PIE_COLORS = [
  '#d97706',
  '#0d9488',
  '#e11d48',
  '#4f46e5',
  '#0284c7',
  '#65a30d',
  '#64748b',
];

export const AccountsAndExpensesScreen: React.FC = () => {
  const {
    currentDate,
    operations,
    daysMap,
    persons,
    workers,
    settings,
    expenseCategories,
    closedSalaryMonths,
    addPerson,
    updatePerson,
    addPersonFollowUp,
    deletePersonFollowUp,
    addWorker,
    updateWorker,
    closeMonthSalaries,
    addExpenseCategory,
  } = useAuditStore();

  const [activeSubTab, setActiveSubTab] = useState<
    'persons' | 'debt_statement' | 'workers' | 'expenses'
  >('persons');

  // --- PERSONS STATE ---
  const [personFilter, setPersonFilter] = useState<
    | 'all'
    | 'owes_us'
    | 'overdue'
    | 'exceeded_limit'
    | 'no_payment_30d'
    | 'we_owe'
    | 'zero'
  >('all');
  const [personSearch, setPersonSearch] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [convertGoldToCashView, setConvertGoldToCashView] = useState(false);

  // Individual Person Statement Date Filter (F2.8)
  const [stmtFromDate, setStmtFromDate] = useState<string>('2026-01-01');
  const [stmtToDate, setStmtToDate] = useState<string>(getTodayIso());

  // Add Person Form (with F2.1 & F2.2 fields)
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonType, setNewPersonType] = useState<PersonType>('client');
  const [newPersonPhone, setNewPersonPhone] = useState('');
  const [newMaxDebtCash, setNewMaxDebtCash] = useState('');
  const [newMaxDebtGoldG, setNewMaxDebtGoldG] = useState('');
  const [newAgreedDueDate, setNewAgreedDueDate] = useState('');
  const [similarWarning, setSimilarWarning] = useState<string | null>(null);

  // Follow-up Form (F2.3)
  const [followUpNote, setFollowUpNote] = useState('');
  const [followUpPromisedDate, setFollowUpPromisedDate] = useState('');
  const [followUpPromisedAmount, setFollowUpPromisedAmount] = useState('');

  // --- WORKERS STATE ---
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    currentDate.slice(0, 7)
  );
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [carryOverNegatives, setCarryOverNegatives] = useState<boolean>(true);
  const [salaryClosedBanner, setSalaryClosedBanner] = useState<string | null>(
    null
  );
  const [salaryCloseError, setSalaryCloseError] = useState<string | null>(null);
  const [showSalaryConfirmModal, setShowSalaryConfirmModal] =
    useState<boolean>(false);

  // Add Worker Form
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerSalary, setNewWorkerSalary] = useState('');
  const [newWorkerDueDay, setNewWorkerDueDay] = useState('30');

  // --- EXPENSES STATE ---
  const [expenseMonth, setExpenseMonth] = useState<string>(() =>
    currentDate.slice(0, 7)
  );
  const [newCatInput, setNewCatInput] = useState('');

  const currentGoldPrice = findSuggestedGoldPrice(currentDate, daysMap);

  // Authoritative F2 Persons & Debt Summary
  const personsSummary = useMemo(
    () => computePersonBalancesSummary(operations, persons, currentDate),
    [operations, persons, currentDate]
  );

  // All debtors sorted by largest balance descending (F2.4)
  const sortedDebtors = useMemo(() => {
    return Array.from(personsSummary.map.values())
      .filter((st) => st.cashBalance > 0.5 || st.goldBalanceG > 0.005)
      .sort((a, b) => {
        const valA = a.cashBalance + a.goldBalanceG * (currentGoldPrice || 7400);
        const valB = b.cashBalance + b.goldBalanceG * (currentGoldPrice || 7400);
        return valB - valA;
      });
  }, [personsSummary, currentGoldPrice]);

  // Filtered Persons (F2.7)
  const filteredPersons = useMemo(() => {
    const q = normalizeArabicName(personSearch);
    return persons.filter((p) => {
      if (q && !normalizeArabicName(p.name).includes(q)) return false;
      const st = personsSummary.map.get(p.id);
      const bal = st?.cashBalance || 0;
      const gold = st?.goldBalanceG || 0;
      const age = st?.debtAgeDays || 0;
      const agreedOverdue = st?.agreedOverdueDays || 0;
      const exceeded = Boolean(st?.exceededAnyLimit);

      if (personFilter === 'owes_us' && bal <= 0 && gold <= 0) return false;
      if (
        personFilter === 'overdue' &&
        !(bal > 0 || gold > 0) &&
        agreedOverdue < 1 &&
        age < 30
      ) {
        return false;
      }
      if (
        personFilter === 'overdue' &&
        agreedOverdue < 1 &&
        age < 30
      ) {
        return false;
      }
      if (personFilter === 'exceeded_limit' && !exceeded) return false;
      if (personFilter === 'no_payment_30d' && !(bal > 0 && age >= 30)) {
        return false;
      }
      if (personFilter === 'we_owe' && bal >= 0 && gold >= 0) return false;
      if (
        personFilter === 'zero' &&
        (Math.abs(bal) > 0.5 || Math.abs(gold) > 0.005)
      ) {
        return false;
      }
      return true;
    });
  }, [persons, personSearch, personFilter, personsSummary]);

  const handleCreatePerson = (forceCreate = false) => {
    const trimmed = newPersonName.trim();
    if (!trimmed) return;
    if (!forceCreate) {
      const sim = findSimilarPerson(trimmed, persons);
      if (sim) {
        setSimilarWarning(
          `اسم مشابه موجود: "${sim.name}" — اضغط تأكيد لإضافته على أي حال.`
        );
        return;
      }
    }
    const maxCash = parseAmountInput(newMaxDebtCash);
    const maxGold = parseWeightInput(newMaxDebtGoldG);
    addPerson({
      name: trimmed,
      type: newPersonType,
      phone: newPersonPhone.trim(),
      ...(maxCash > 0 ? { maxDebtCash: maxCash } : {}),
      ...(maxGold > 0 ? { maxDebtGoldG: maxGold } : {}),
      ...(newAgreedDueDate ? { agreedDueDate: newAgreedDueDate } : {}),
    });
    setNewPersonName('');
    setNewPersonPhone('');
    setNewMaxDebtCash('');
    setNewMaxDebtGoldG('');
    setNewAgreedDueDate('');
    setSimilarWarning(null);
  };

  // --- WORKERS COMPUTED ---
  const workersComputed = useMemo(() => {
    return workers.map((w) => {
      const monthAdvances = operations.filter(
        (op) =>
          op.kind === 'advance' &&
          op.workerId === w.id &&
          op.date.startsWith(selectedMonth)
      );
      const totalAdvances = monthAdvances.reduce((s, o) => s + o.total, 0);
      const carry = w.carryOverDiff || 0;
      const netDue = w.monthlySalary - totalAdvances - carry;
      return {
        worker: w,
        monthAdvances,
        totalAdvances,
        carry,
        netDue,
      };
    });
  }, [workers, operations, selectedMonth]);

  // --- EXPENSES COMPUTED ---
  const expensesComputed = useMemo(() => {
    const [y, m] = expenseMonth.split('-').map(Number);
    const prevDate = new Date(Date.UTC(y, m - 2, 1));
    const prevMonthStr = prevDate.toISOString().slice(0, 7);

    const byCatCurrent: Record<string, number> = {};
    const byCatPrev: Record<string, number> = {};
    let totalCurrent = 0;
    let totalPrev = 0;

    for (const op of operations) {
      if (op.kind !== 'expense') continue;
      const cat = op.category || op.item || 'أخرى';
      if (op.date.startsWith(expenseMonth)) {
        byCatCurrent[cat] = (byCatCurrent[cat] || 0) + op.total;
        totalCurrent += op.total;
      } else if (op.date.startsWith(prevMonthStr)) {
        byCatPrev[cat] = (byCatPrev[cat] || 0) + op.total;
        totalPrev += op.total;
      }
    }

    const allCats = Array.from(
      new Set([
        ...expenseCategories,
        ...Object.keys(byCatCurrent),
        ...Object.keys(byCatPrev),
      ])
    );

    const rows = allCats
      .map((cat) => ({
        category: cat,
        currentTotal: byCatCurrent[cat] || 0,
        prevTotal: byCatPrev[cat] || 0,
        diff: (byCatCurrent[cat] || 0) - (byCatPrev[cat] || 0),
      }))
      .filter((r) => r.currentTotal > 0 || r.prevTotal > 0)
      .sort((a, b) => b.currentTotal - a.currentTotal);

    const pieData = rows
      .filter((r) => r.currentTotal > 0)
      .map((r) => ({ name: r.category, value: Math.round(r.currentTotal) }));

    return {
      prevMonthStr,
      totalCurrent,
      totalPrev,
      rows,
      pieData,
    };
  }, [operations, expenseMonth, expenseCategories]);

  const selectedPersonObj = persons.find((p) => p.id === selectedPersonId);
  const selectedPersonStat = selectedPersonId
    ? personsSummary.map.get(selectedPersonId)
    : undefined;

  // Individual statement filtered by [stmtFromDate, stmtToDate] with Opening Balance (F2.8)
  const selectedPersonFilteredStatement = useMemo(() => {
    if (!selectedPersonStat) return null;
    let openingCash = 0;
    let openingGold = 0;
    const periodRows = [];

    for (const row of selectedPersonStat.ledger) {
      if (row.date < stmtFromDate) {
        openingCash = row.runningCash;
        openingGold = row.runningGold;
      } else if (row.date <= stmtToDate) {
        periodRows.push(row);
      }
    }

    const closingCash =
      periodRows.length > 0
        ? periodRows[periodRows.length - 1].runningCash
        : openingCash;
    const closingGold =
      periodRows.length > 0
        ? periodRows[periodRows.length - 1].runningGold
        : openingGold;

    return {
      openingCash,
      openingGold,
      periodRows,
      closingCash,
      closingGold,
    };
  }, [selectedPersonStat, stmtFromDate, stmtToDate]);

  return (
    <div className="space-y-6 pb-12">
      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-1.5 border border-slate-200 rounded-xl w-fit no-print">
        <button
          type="button"
          onClick={() => setActiveSubTab('persons')}
          className={`px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
            activeSubTab === 'persons'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>الأشخاص وكشف الحساب الفردي</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('debt_statement')}
          className={`px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
            activeSubTab === 'debt_statement'
              ? 'bg-slate-900 text-amber-400'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>كشف المديونيات وأعمار الديون ({sortedDebtors.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('workers')}
          className={`px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
            activeSubTab === 'workers'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          <span>العمال والمرتبات والسلف</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('expenses')}
          className={`px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
            activeSubTab === 'expenses'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>المصاريف الشهرية</span>
        </button>
      </div>

      {/* F2.6 Reconciliation Alert Banner (if any mismatch exists) */}
      {(Math.abs(personsSummary.reconciliationDiffCash) > 1 ||
        Math.abs(personsSummary.reconciliationDiffGoldG) > 0.01) && (
        <div className="p-3.5 bg-red-50 border-2 border-red-400 rounded-xl text-xs text-red-950 flex flex-wrap items-center justify-between gap-2 no-print">
          <div className="flex items-center gap-2 font-bold">
            <AlertOctagon className="w-5 h-5 text-red-600 shrink-0" />
            <span>
              تنبيه مطابقة المديونيات التلقائي: مجموع أرصدة الأشخاص المسجلين (
              {formatNumber(personsSummary.netRegisteredPersonsCash)} ج.م) لا يساوي صافي
              العمليات الآجلة وحركات الأشخاص ({formatNumber(personsSummary.netAllOperationsCash)}{' '}
              ج.م) — الفرق: {formatNumber(personsSummary.reconciliationDiffCash)} ج.م (
              {personsSummary.orphanOperationIds.length} عملية غير مربوطة بشخص مسجل).
            </span>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 1: PERSONS & INDIVIDUAL ACCOUNT STATEMENT
         =================================================================== */}
      {activeSubTab === 'persons' && (
        <div className="space-y-5">
          {/* Top Totals Banner */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 no-print">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">
                إجمالي عليهم لنا (مديونية لصالح المحل — أحمر)
              </div>
              <div className="text-xl font-extrabold font-mono tabular-nums text-red-700">
                {formatNumber(personsSummary.totalOwesUsCash)} ج.م
              </div>
              <div className="text-xs font-mono text-red-800 mt-1">
                + ذهب عليهم: {formatWeight(personsSummary.totalOwesUsGoldG)} جرام
                {convertGoldToCashView && (
                  <span className="mr-1 text-slate-600">
                    (~{formatNumber(personsSummary.totalOwesUsGoldG * currentGoldPrice)} ج.م)
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">
                إجمالي المتأخر (فوق 30 يوماً أو بعد موعد السداد)
              </div>
              <div className="text-xl font-extrabold font-mono tabular-nums text-amber-700">
                {formatNumber(personsSummary.totalOverdueCash)} ج.م
              </div>
              <div className="text-xs text-slate-500 mt-1">
                تجاوز الحد الأقصى:{' '}
                {
                  Array.from(personsSummary.map.values()).filter((p) => p.exceededAnyLimit)
                    .length
                }{' '}
                أشخاص
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">
                إجمالي لهم علينا (دائنون وأمانات — أخضر)
              </div>
              <div className="text-xl font-extrabold font-mono tabular-nums text-emerald-700">
                {formatNumber(personsSummary.totalWeOweCash)} ج.م
              </div>
              <div className="text-xs font-mono text-emerald-800 mt-1">
                + ذهب لهم: {formatWeight(personsSummary.totalWeOweGoldG)} جرام
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
              <div className="text-xs text-slate-600">
                تحويل أرصدة الجرامات عند الأشخاص بالسعر اليومي (
                {formatNumber(currentGoldPrice)} ج.م/جرام):
              </div>
              <button
                type="button"
                onClick={() => setConvertGoldToCashView((v) => !v)}
                className={`mt-2 py-2 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                  convertGoldToCashView
                    ? 'bg-amber-500 text-slate-950 border-amber-500'
                    : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Calculator className="w-4 h-4" />
                <span>
                  {convertGoldToCashView
                    ? 'إخفاء القيمة المعادلة بالجنيه'
                    : 'تحويل رصيد الجرامات بالسعر اليومي'}
                </span>
              </button>
            </div>
          </div>

          {/* Add Person + Filter Bar */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 no-print">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
              <h3 className="text-xs font-bold text-slate-800">
                إضافة شخص جديد (مع حد الدين الأقصى وموعد السداد)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={newPersonName}
                  onChange={(e) => {
                    setNewPersonName(e.target.value);
                    setSimilarWarning(null);
                  }}
                  placeholder="الاسم الكامل..."
                  className="sm:col-span-2 px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none focus:border-amber-600"
                />
                <select
                  value={newPersonType}
                  onChange={(e) => setNewPersonType(e.target.value as PersonType)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="client">عميل</option>
                  <option value="supplier">مورد / تاجر</option>
                  <option value="worker">عامل</option>
                  <option value="other">آخر / ورشة</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={newPersonPhone}
                  onChange={(e) => setNewPersonPhone(e.target.value)}
                  placeholder="رقم التليفون..."
                  className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg outline-none"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={newMaxDebtCash}
                  onChange={(e) => setNewMaxDebtCash(e.target.value)}
                  placeholder="حد الدين الأقصى (ج.م)"
                  className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg outline-none"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={newMaxDebtGoldG}
                  onChange={(e) => setNewMaxDebtGoldG(e.target.value)}
                  placeholder="حد دين الذهب (جرام)"
                  className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1 text-xs">
                  <span className="text-slate-600 whitespace-nowrap">موعد السداد:</span>
                  <input
                    type="date"
                    value={newAgreedDueDate}
                    onChange={(e) => setNewAgreedDueDate(e.target.value)}
                    className="flex-1 px-2.5 py-1 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleCreatePerson(false)}
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة</span>
                </button>
              </div>

              {similarWarning && (
                <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg flex items-center justify-between text-xs text-amber-950">
                  <span>{similarWarning}</span>
                  <button
                    type="button"
                    onClick={() => handleCreatePerson(true)}
                    className="px-2.5 py-1 bg-amber-600 text-white font-bold rounded"
                  >
                    إضافة على أي حال
                  </button>
                </div>
              )}
            </div>

            {/* F2.7 Enhanced Person Filters */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3">
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2" />
                  <input
                    type="text"
                    value={personSearch}
                    onChange={(e) => setPersonSearch(e.target.value)}
                    placeholder="بحث بالاسم (يتجاهل التشكيل والهمزات أ/إ/ا و ة/ه)..."
                    className="w-full pr-9 pl-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
                  {(
                    [
                      { id: 'all', label: 'الكل' },
                      { id: 'owes_us', label: 'عليه لنا' },
                      { id: 'overdue', label: 'متأخر' },
                      { id: 'exceeded_limit', label: 'تجاوز الحد' },
                      { id: 'no_payment_30d', label: 'بدون سداد 30 يوماً' },
                      { id: 'we_owe', label: 'له علينا' },
                      { id: 'zero', label: 'مصفّر' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setPersonFilter(f.id)}
                      className={`px-2.5 py-1 rounded font-bold transition-colors cursor-pointer ${
                        personFilter === f.id
                          ? 'bg-slate-900 text-amber-400 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-slate-500">
                اضغط على أي اسم لفتح كشف حسابه التفصيلي، تعديل حد الدين أو موعد السداد، أو إضافة وعد سداد في سجل المتابعة.
              </p>
            </div>
          </div>

          {/* Persons Table + Selected Person Statement */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden no-print">
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                      <th className="py-2.5 px-2.5">الاسم</th>
                      <th className="py-2.5 px-2.5">الرصيد</th>
                      <th className="py-2.5 px-2.5">حد الدين / الاستهلاك</th>
                      <th className="py-2.5 px-2.5">عمر الدين / الموعد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPersons.map((p) => {
                      const st = personsSummary.map.get(p.id);
                      const cash = st?.cashBalance || 0;
                      const gold = st?.goldBalanceG || 0;
                      const age = st?.debtAgeDays || 0;
                      const active = selectedPersonId === p.id;

                      return (
                        <tr
                          key={p.id}
                          onClick={() => setSelectedPersonId(p.id)}
                          className={`border-b border-slate-200 cursor-pointer transition-colors ${
                            active
                              ? 'bg-amber-50'
                              : st?.exceededAnyLimit
                              ? 'bg-red-50/50 hover:bg-red-50'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-2.5 font-bold text-slate-900">
                            <div>{p.name}</div>
                            <div className="text-[10px] text-slate-400 font-normal">
                              {p.phone || ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-2.5 font-mono tabular-nums font-bold">
                            {cash > 0 ? (
                              <div className="text-red-700">
                                عليه {formatNumber(cash)} ج.م
                              </div>
                            ) : cash < 0 ? (
                              <div className="text-emerald-700">
                                له {formatNumber(Math.abs(cash))} ج.م
                              </div>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                            {Math.abs(gold) > 0.001 && (
                              <div
                                className={`text-[11px] ${
                                  gold > 0 ? 'text-red-700' : 'text-emerald-700'
                                }`}
                              >
                                {gold > 0 ? 'عليه ' : 'له '}
                                {formatWeight(Math.abs(gold))} ج
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono">
                            {st?.maxDebtCash ? (
                              <div>
                                <div className="text-[11px] text-slate-600">
                                  حد: {formatNumber(st.maxDebtCash)}
                                </div>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    st.exceededCashLimit
                                      ? 'bg-red-600 text-white'
                                      : st.limitUsagePct >= 80
                                      ? 'bg-amber-100 text-amber-900'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {st.limitUsagePct}%
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono">
                            {cash > 0 && age > 0 && (
                              <div
                                className={
                                  age >= 90
                                    ? 'text-red-700 font-bold'
                                    : age >= 30
                                    ? 'text-amber-700 font-bold'
                                    : 'text-slate-600'
                                }
                              >
                                {age} يوم
                              </div>
                            )}
                            {st?.agreedDueDate && (
                              <div
                                className={`text-[10px] ${
                                  st.agreedOverdueDays >= 1
                                    ? 'text-red-700 font-bold'
                                    : 'text-slate-500'
                                }`}
                              >
                                موعد: {st.agreedDueDate}
                                {st.agreedOverdueDays >= 1
                                  ? ` (متأخر ${st.agreedOverdueDays}ي)`
                                  : ''}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected Person Statement & Debt Settings & Follow-up Log (F2.1, F2.2, F2.3, F2.8) */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4 print:border-0 print:shadow-none print:p-0">
              {selectedPersonObj &&
              selectedPersonStat &&
              selectedPersonFilteredStatement ? (
                <>
                  {/* F2.8 Formal Print Header for Individual Person Statement */}
                  <div className="hidden print-only border-b-2 border-slate-900 pb-3 mb-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h1 className="text-xl font-bold">
                          {settings.shopName || 'محل الذهب'} — كشف حساب رسمي للعميل
                        </h1>
                        <p className="text-sm font-bold text-slate-800 mt-1">
                          السيد / {selectedPersonObj.name}{' '}
                          {selectedPersonObj.phone ? `(${selectedPersonObj.phone})` : ''}
                        </p>
                        <p className="text-xs text-slate-600 mt-0.5">
                          الفترة من: <strong className="font-mono">{stmtFromDate}</strong> إلى:{' '}
                          <strong className="font-mono">{stmtToDate}</strong>
                        </p>
                      </div>
                      <div className="text-xs text-left">
                        <div>تاريخ الطباعة: {new Date().toLocaleDateString('ar-EG')}</div>
                        <div>المراجع: {settings.auditorName || '—'}</div>
                      </div>
                    </div>
                  </div>

                  {/* Top Controls for Selected Person */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 no-print">
                    <div>
                      <h3 className="text-base font-extrabold text-slate-900">
                        كشف حساب ومتابعة: {selectedPersonObj.name}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {selectedPersonObj.phone &&
                          `تليفون: ${selectedPersonObj.phone} · `}
                        إجمالي الحركات: {selectedPersonStat.ledger.length}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        type="date"
                        value={stmtFromDate}
                        onChange={(e) => setStmtFromDate(e.target.value)}
                        className="px-2 py-1 text-xs font-mono border border-slate-300 rounded"
                      />
                      <span className="text-xs text-slate-400">إلى</span>
                      <input
                        type="date"
                        value={stmtToDate}
                        onChange={(e) => setStmtToDate(e.target.value)}
                        className="px-2 py-1 text-xs font-mono border border-slate-300 rounded"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          exportPersonStatementExcel(
                            selectedPersonObj.name,
                            selectedPersonStat.ledger
                          )
                        }
                        className="px-2.5 py-1.5 bg-emerald-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>Excel</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="px-2.5 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>طباعة كشف للعميل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          ensureGoldApiBridge().print.saveToPdf(
                            `كشف-حساب-${selectedPersonObj.name}-${stmtFromDate}-${stmtToDate}.pdf`
                          )
                        }
                        className="px-2.5 py-1.5 bg-amber-600 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        <span>حفظ PDF</span>
                      </button>
                    </div>
                  </div>

                  {/* F2.1 & F2.2 Editable Debt Limits & Agreed Due Date */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs no-print">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        حد الدين الأقصى نقداً (ج.م):
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        defaultValue={
                          selectedPersonObj.maxDebtCash
                            ? String(selectedPersonObj.maxDebtCash)
                            : ''
                        }
                        key={`maxc-${selectedPersonObj.id}-${selectedPersonObj.maxDebtCash}`}
                        placeholder="غير محدد"
                        onBlur={(e) => {
                          const v = parseAmountInput(e.target.value);
                          updatePerson(selectedPersonObj.id, {
                            maxDebtCash: v > 0 ? v : undefined,
                          });
                        }}
                        className="w-full px-2.5 py-1 font-mono font-bold bg-white border border-slate-300 rounded"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        حد دين الذهب (جرام):
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        defaultValue={
                          selectedPersonObj.maxDebtGoldG
                            ? String(selectedPersonObj.maxDebtGoldG)
                            : ''
                        }
                        key={`maxg-${selectedPersonObj.id}-${selectedPersonObj.maxDebtGoldG}`}
                        placeholder="غير محدد"
                        onBlur={(e) => {
                          const v = parseWeightInput(e.target.value);
                          updatePerson(selectedPersonObj.id, {
                            maxDebtGoldG: v > 0 ? v : undefined,
                          });
                        }}
                        className="w-full px-2.5 py-1 font-mono font-bold bg-white border border-slate-300 rounded"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        موعد السداد المتفق عليه:
                      </label>
                      <input
                        type="date"
                        value={selectedPersonObj.agreedDueDate || ''}
                        onChange={(e) =>
                          updatePerson(selectedPersonObj.id, {
                            agreedDueDate: e.target.value || undefined,
                          })
                        }
                        className="w-full px-2.5 py-1 font-mono font-bold bg-white border border-slate-300 rounded"
                      />
                    </div>
                  </div>

                  {/* Opening & Closing Summary Row */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                      <span className="text-slate-500">رصيد أول المدة (قبل {stmtFromDate}):</span>
                      <div className="font-mono font-bold text-slate-800 mt-0.5">
                        {formatNumber(Math.abs(selectedPersonFilteredStatement.openingCash))}{' '}
                        ج.م{' '}
                        {selectedPersonFilteredStatement.openingCash > 0
                          ? '(عليه)'
                          : selectedPersonFilteredStatement.openingCash < 0
                          ? '(له)'
                          : ''}
                        {Math.abs(selectedPersonFilteredStatement.openingGold) > 0.001 &&
                          ` | ذهب: ${formatWeight(
                            Math.abs(selectedPersonFilteredStatement.openingGold)
                          )} ج`}
                      </div>
                    </div>
                    <div className="border border-amber-300 rounded-lg p-2.5 bg-amber-50/60">
                      <span className="text-amber-900 font-bold">
                        الرصيد الختامي في نهاية المدة ({stmtToDate}):
                      </span>
                      <div className="font-mono font-extrabold text-sm text-red-700 mt-0.5">
                        {formatNumber(Math.abs(selectedPersonFilteredStatement.closingCash))}{' '}
                        ج.م{' '}
                        {selectedPersonFilteredStatement.closingCash > 0
                          ? '(عليه لنا)'
                          : selectedPersonFilteredStatement.closingCash < 0
                          ? '(له علينا)'
                          : '(خالص)'}
                        {Math.abs(selectedPersonFilteredStatement.closingGold) > 0.001 &&
                          ` + ${formatWeight(
                            Math.abs(selectedPersonFilteredStatement.closingGold)
                          )} جرام`}
                      </div>
                    </div>
                  </div>

                  {/* Movements Table */}
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-right border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                          <th className="py-2 px-2">التاريخ</th>
                          <th className="py-2 px-2">البيان</th>
                          <th className="py-2 px-2">مدين (عليه)</th>
                          <th className="py-2 px-2">دائن (سدد/له)</th>
                          <th className="py-2 px-2">الرصيد التراكمي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPersonFilteredStatement.periodRows.map((row) => (
                          <tr key={row.id} className="border-b border-slate-100">
                            <td className="py-2 px-2 font-mono">{row.date}</td>
                            <td className="py-2 px-2">{row.item}</td>
                            <td className="py-2 px-2 font-mono text-red-700">
                              {row.debitCash > 0 ? formatNumber(row.debitCash) : ''}
                              {row.debitGold > 0
                                ? ` (${formatWeight(row.debitGold)} ج)`
                                : ''}
                            </td>
                            <td className="py-2 px-2 font-mono text-emerald-700">
                              {row.creditCash > 0 ? formatNumber(row.creditCash) : ''}
                              {row.creditGold > 0
                                ? ` (${formatWeight(row.creditGold)} ج)`
                                : ''}
                            </td>
                            <td className="py-2 px-2 font-mono font-bold">
                              <span
                                className={
                                  row.runningCash > 0
                                    ? 'text-red-700'
                                    : row.runningCash < 0
                                    ? 'text-emerald-700'
                                    : 'text-slate-600'
                                }
                              >
                                {formatNumber(Math.abs(row.runningCash))}{' '}
                                {row.runningCash > 0
                                  ? 'عليه'
                                  : row.runningCash < 0
                                  ? 'له'
                                  : ''}
                              </span>
                              {Math.abs(row.runningGold) > 0.001 && (
                                <span className="block text-[10px] text-amber-800">
                                  ذهب: {formatWeight(Math.abs(row.runningGold))} ج
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* F2.3 Follow-up & Promise Log (يظهر في الشاشة وفي كشف الحساب المطبوع) */}
                  <div className="border-t border-slate-200 pt-3 space-y-2.5">
                    <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <CalendarClock className="w-4 h-4 text-amber-600" />
                      سجل المتابعة والوعود بالسداد
                    </h4>

                    {/* Add Follow-up Form (No Print) */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 no-print">
                      <input
                        type="text"
                        value={followUpNote}
                        onChange={(e) => setFollowUpNote(e.target.value)}
                        placeholder="ملاحظة الاتصال / المتابعة..."
                        className="sm:col-span-2 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                      />
                      <input
                        type="date"
                        value={followUpPromisedDate}
                        onChange={(e) => setFollowUpPromisedDate(e.target.value)}
                        title="تاريخ الوعد بالسداد (يحدّث موعد السداد المتفق عليه تلقائياً)"
                        className="px-2 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                      />
                      <div className="flex gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={followUpPromisedAmount}
                          onChange={(e) => setFollowUpPromisedAmount(e.target.value)}
                          placeholder="المبلغ الموعود"
                          className="w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!followUpNote.trim() && !followUpPromisedDate) return;
                            const amt = parseAmountInput(followUpPromisedAmount);
                            addPersonFollowUp(selectedPersonObj.id, {
                              date: getTodayIso(),
                              note: followUpNote.trim() || 'وعد سداد',
                              ...(followUpPromisedDate
                                ? { promisedDate: followUpPromisedDate }
                                : {}),
                              ...(amt > 0 ? { promisedAmount: amt } : {}),
                            });
                            setFollowUpNote('');
                            setFollowUpPromisedDate('');
                            setFollowUpPromisedAmount('');
                          }}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg whitespace-nowrap cursor-pointer"
                        >
                          حفظ
                        </button>
                      </div>
                    </div>

                    {selectedPersonObj.followUps &&
                    selectedPersonObj.followUps.length > 0 ? (
                      <div className="space-y-1.5">
                        {selectedPersonObj.followUps.map((f) => (
                          <div
                            key={f.id}
                            className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs"
                          >
                            <div>
                              <span className="font-mono font-bold text-slate-700 ml-2">
                                [{f.date}]
                              </span>
                              <span className="text-slate-900 font-medium">
                                {f.note}
                              </span>
                              {f.promisedDate && (
                                <span className="mr-2 px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[11px]">
                                  وعد سداد في: {f.promisedDate}
                                  {f.promisedAmount
                                    ? ` (${formatNumber(f.promisedAmount)} ج.م)`
                                    : ''}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                deletePersonFollowUp(selectedPersonObj.id, f.id)
                              }
                              className="text-slate-400 hover:text-red-600 no-print"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400">
                        لا توجد متابعات مسجلة لهذا الشخص بعد.
                      </p>
                    )}
                  </div>

                  {/* F2.8 Dual Signature Blocks on Printed Individual Statement */}
                  <div className="hidden print-only grid-cols-2 gap-12 pt-8 mt-8 border-t border-slate-400 text-xs">
                    <div>
                      <p className="font-bold mb-8">
                        توقيع العميل بالمطابقة ({selectedPersonObj.name}):
                      </p>
                      <div className="border-b border-dashed border-slate-500 w-48" />
                    </div>
                    <div>
                      <p className="font-bold mb-8">
                        توقيع المحل ({settings.shopName || 'المسؤول'}):
                      </p>
                      <div className="border-b border-dashed border-slate-500 w-48" />
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-8 text-center text-xs text-slate-400">
                  اضغط على اسم أي شخص من الجدول لعرض كشف حسابه التفصيلي، حدود الدين، وسجل المتابعة.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 2: DEBT STATEMENT & AGING BUCKETS (F2.4 — كشف المديونيات)
         =================================================================== */}
      {activeSubTab === 'debt_statement' && (
        <div className="space-y-5">
          {/* Print Header */}
          <div className="hidden print-only border-b-2 border-slate-900 pb-3 mb-4">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-xl font-bold">
                  {settings.shopName || 'محل الذهب'} — كشف المديونيات وأعمار الديون
                </h1>
                <p className="text-xs text-slate-700 mt-1">
                  المراجع: {settings.auditorName || '—'} | تاريخ التقرير:{' '}
                  {new Date().toLocaleDateString('ar-EG')}
                </p>
              </div>
              <div className="text-xs font-mono font-bold">
                إجمالي المديونيات: {formatNumber(personsSummary.totalOwesUsCash)} ج.م
              </div>
            </div>
          </div>

          {/* Aging Buckets Summary Cards (0-30, 31-60, 61-90, >90 days) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(
              [
                {
                  key: '0-30',
                  title: 'أعمار ديون 0 - 30 يوماً (حديثة)',
                  style: 'bg-white border-slate-200 text-slate-900',
                },
                {
                  key: '31-60',
                  title: 'أعمار ديون 31 - 60 يوماً (متوسطة)',
                  style: 'bg-amber-50/70 border-amber-300 text-amber-950',
                },
                {
                  key: '61-90',
                  title: 'أعمار ديون 61 - 90 يوماً (متأخرة)',
                  style: 'bg-orange-50 border-orange-300 text-orange-950',
                },
                {
                  key: '90+',
                  title: 'أكثر من 90 يوماً (خطرة جداً)',
                  style: 'bg-red-50 border-red-300 text-red-950',
                },
              ] as const
            ).map((b) => {
              const bucket = personsSummary.agingBuckets[b.key];
              return (
                <div
                  key={b.key}
                  className={`border rounded-xl p-4 shadow-xs ${b.style}`}
                >
                  <div className="text-xs font-bold opacity-80">{b.title}</div>
                  <div className="text-xl font-extrabold font-mono mt-1">
                    {formatNumber(bucket.cashTotal)} ج.م
                  </div>
                  <div className="flex justify-between text-[11px] mt-1 opacity-80">
                    <span>عدد المدينين: {bucket.count}</span>
                    {bucket.goldTotalG > 0 && (
                      <span className="font-mono">
                        +{formatWeight(bucket.goldTotalG)} ج ذهب
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 no-print">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                جدول المدينين مرتباً بالأكبر رصيداً ({sortedDebtors.length} مدين)
              </h3>
              <p className="text-xs text-slate-500">
                يعرض الرصيد النقدي والذهبي، آخر سداد، عمر الدين، موعد السداد المتفق عليه، ونسبة استهلاك حد الدين.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => exportDebtStatementExcel(sortedDebtors)}
                className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>تصدير Excel</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة A4</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  ensureGoldApiBridge().print.saveToPdf(
                    `كشف-المديونيات-${getTodayIso()}.pdf`
                  )
                }
                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FileDown className="w-4 h-4" />
                <span>حفظ PDF</span>
              </button>
            </div>
          </div>

          {/* Full Debtors Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">الاسم</th>
                    <th className="py-2.5 px-3">الرصيد النقدي (عليه)</th>
                    <th className="py-2.5 px-3">رصيد الذهب (جرام)</th>
                    <th className="py-2.5 px-3">آخر سداد</th>
                    <th className="py-2.5 px-3">عمر الدين</th>
                    <th className="py-2.5 px-3">موعد السداد المتفق عليه</th>
                    <th className="py-2.5 px-3">حد الدين الأقصى</th>
                    <th className="py-2.5 px-3">نسبة استهلاك الحد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sortedDebtors.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        لا توجد مديونيات مستحقة حالياً.
                      </td>
                    </tr>
                  ) : (
                    sortedDebtors.map((d, idx) => (
                      <tr
                        key={d.personId}
                        onClick={() => {
                          setSelectedPersonId(d.personId);
                          setActiveSubTab('persons');
                        }}
                        className={`cursor-pointer hover:bg-amber-50/40 ${
                          d.exceededAnyLimit ? 'bg-red-50/70' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">
                          {d.person?.name || '—'}
                          {d.person?.phone && (
                            <span className="block text-[10px] font-mono text-slate-500">
                              {d.person.phone}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-extrabold text-red-700">
                          {formatNumber(d.cashBalance)} ج.م
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-amber-900">
                          {d.goldBalanceG > 0
                            ? `${formatWeight(d.goldBalanceG)} ج`
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {d.lastPaymentDate || 'لم يسدد'}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold">
                          <span
                            className={`px-2 py-0.5 rounded ${
                              d.ageBucket === '90+'
                                ? 'bg-red-100 text-red-800'
                                : d.ageBucket === '61-90'
                                ? 'bg-orange-100 text-orange-800'
                                : d.ageBucket === '31-60'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {d.debtAgeDays} يوم ({d.ageBucket})
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono">
                          {d.agreedDueDate ? (
                            <span
                              className={
                                d.agreedOverdueDays >= 1
                                  ? 'text-red-700 font-bold'
                                  : 'text-slate-700'
                              }
                            >
                              {d.agreedDueDate}
                              {d.agreedOverdueDays >= 1 &&
                                ` (متأخر ${d.agreedOverdueDays} يوم)`}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono">
                          {d.maxDebtCash ? `${formatNumber(d.maxDebtCash)} ج.م` : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-mono">
                          {d.maxDebtCash ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${
                                    d.exceededCashLimit
                                      ? 'bg-red-600'
                                      : d.limitUsagePct >= 80
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-600'
                                  }`}
                                  style={{
                                    width: `${Math.min(100, d.limitUsagePct)}%`,
                                  }}
                                />
                              </div>
                              <span
                                className={`font-bold ${
                                  d.exceededCashLimit
                                    ? 'text-red-700'
                                    : 'text-slate-700'
                                }`}
                              >
                                {d.limitUsagePct}%
                              </span>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 3: WORKERS & SALARIES
         =================================================================== */}
      {activeSubTab === 'workers' && (
        <div className="space-y-5">
          {/* Top Controls & Monthly Closing */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">الشهر</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer pt-4">
                <input
                  type="checkbox"
                  checked={carryOverNegatives}
                  onChange={(e) => setCarryOverNegatives(e.target.checked)}
                  className="rounded text-amber-600"
                />
                <span>رحّل الفرق السالب (عليه للمحل) للشهر التالي عند الإقفال</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {closedSalaryMonths.includes(selectedMonth) && (
                <span className="px-2.5 py-1 bg-emerald-100 text-emerald-900 rounded-lg text-xs font-bold">
                  تم إقفال هذا الشهر ✓
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setSalaryCloseError(null);
                  if (closedSalaryMonths.includes(selectedMonth)) {
                    setSalaryCloseError(
                      `تم إقفال مرتبات شهر ${selectedMonth} من قبل. لا يمكن إقفال نفس الشهر مرتين لمنع تكرار صرف المرتبات.`
                    );
                    return;
                  }
                  setShowSalaryConfirmModal(true);
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>إقفال مرتبات الشهر وصرف الصافي</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة كشف المرتبات</span>
              </button>
            </div>
          </div>

          {salaryCloseError && (
            <div className="p-3 bg-red-50 border border-red-300 rounded-lg text-xs font-bold text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{salaryCloseError}</span>
            </div>
          )}

          {salaryClosedBanner && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-xs font-bold text-emerald-900">
              {salaryClosedBanner}
            </div>
          )}

          {/* Pre-execution Summary Confirmation Modal for Salary Closing */}
          {showSalaryConfirmModal && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <h3 className="text-base font-extrabold text-slate-900">
                    ملخص تأكيد إقفال مرتبات شهر {selectedMonth}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {carryOverNegatives
                      ? 'سيتم ترحيل الرصيد السالب للشهر التالي'
                      : 'لن يتم ترحيل الرصيد السالب (تصفير الترحيل السابق)'}
                  </span>
                </div>

                <div className="overflow-x-auto max-h-64 border border-slate-200 rounded-lg">
                  <table className="w-full text-right border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                        <th className="py-2 px-3">العامل</th>
                        <th className="py-2 px-3">المرتب</th>
                        <th className="py-2 px-3">سلف الشهر</th>
                        <th className="py-2 px-3">ترحيل سابق</th>
                        <th className="py-2 px-3">الصافي المستحق</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workersComputed.map(
                        ({ worker, totalAdvances, carry, netDue }) => (
                          <tr key={worker.id} className="border-b border-slate-100">
                            <td className="py-2 px-3 font-bold">{worker.name}</td>
                            <td className="py-2 px-3 font-mono">
                              {formatNumber(worker.monthlySalary)}
                            </td>
                            <td className="py-2 px-3 font-mono text-amber-800">
                              {formatNumber(totalAdvances)}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-600">
                              {formatNumber(carry)}
                            </td>
                            <td className="py-2 px-3 font-mono font-bold">
                              {netDue >= 0 ? (
                                <span className="text-emerald-700">
                                  {formatNumber(netDue)} ج.م
                                </span>
                              ) : (
                                <span className="text-red-700">
                                  {formatNumber(netDue)} ج.م (سالب)
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs font-bold text-amber-950 flex items-center justify-between">
                  <span>إجمالي الصافي النقدي الذي سيُسجل كمصروف "مرتبات":</span>
                  <span className="font-mono text-base">
                    {formatNumber(
                      workersComputed.reduce(
                        (s, w) => s + (w.netDue > 0 ? w.netDue : 0),
                        0
                      )
                    )}{' '}
                    ج.م
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSalaryConfirmModal(false)}
                    className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const res = closeMonthSalaries(
                        selectedMonth,
                        getTodayIso(),
                        carryOverNegatives
                      );
                      setShowSalaryConfirmModal(false);
                      if (!res.ok) {
                        setSalaryCloseError(res.error || 'تعذر إقفال الشهر');
                        return;
                      }
                      setSalaryClosedBanner(
                        `تم إقفال مرتبات شهر ${selectedMonth} وتسجيل الصافي المصروف (${formatNumber(
                          res.netPaid
                        )} ج.م) في بند مصاريف "مرتبات" بحيث لا تُحسب السلف مرتين.`
                      );
                    }}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
                  >
                    تأكيد الإقفال وصرف الصافي
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add Worker Form */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 no-print">
            <h3 className="text-xs font-bold text-slate-800 mb-2">إضافة عامل جديد</h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={newWorkerName}
                onChange={(e) => setNewWorkerName(e.target.value)}
                placeholder="اسم العامل..."
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg flex-1 min-w-[180px]"
              />
              <input
                type="text"
                inputMode="decimal"
                value={newWorkerSalary}
                onChange={(e) => setNewWorkerSalary(e.target.value)}
                placeholder="المرتب الشهري (ج.م)..."
                className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg w-40"
              />
              <input
                type="number"
                value={newWorkerDueDay}
                onChange={(e) => setNewWorkerDueDay(e.target.value)}
                placeholder="يوم الاستحقاق (30)"
                className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg w-32"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newWorkerName.trim()) return;
                  addWorker({
                    name: newWorkerName.trim(),
                    monthlySalary: parseAmountInput(newWorkerSalary),
                    dueDay: Number(newWorkerDueDay) || 30,
                  });
                  setNewWorkerName('');
                  setNewWorkerSalary('');
                }}
                className="px-4 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg"
              >
                إضافة عامل
              </button>
            </div>
          </div>

          {/* Workers Table & Individual Worker Advance Details */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                    <th className="py-2.5 px-3">اسم العامل</th>
                    <th className="py-2.5 px-3">المرتب الشهري</th>
                    <th className="py-2.5 px-3">مجموع السلف ({selectedMonth})</th>
                    <th className="py-2.5 px-3">مرحل سابق</th>
                    <th className="py-2.5 px-3">الصافي المستحق</th>
                  </tr>
                </thead>
                <tbody>
                  {workersComputed.map(
                    ({ worker, totalAdvances, carry, netDue }) => (
                      <tr
                        key={worker.id}
                        onClick={() => setSelectedWorkerId(worker.id)}
                        className={`border-b border-slate-200 cursor-pointer ${
                          selectedWorkerId === worker.id
                            ? 'bg-amber-50'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-bold text-slate-900">
                          {worker.name}
                        </td>
                        <td className="py-2.5 px-3 font-mono">
                          <input
                            type="text"
                            value={worker.monthlySalary}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              updateWorker(worker.id, {
                                monthlySalary: parseAmountInput(e.target.value),
                              })
                            }
                            className="w-24 px-2 py-0.5 border border-slate-200 rounded bg-white font-mono"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-amber-800">
                          {formatNumber(totalAdvances)} ج.م
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {carry > 0 ? `${formatNumber(carry)} ج.م` : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-extrabold">
                          {netDue >= 0 ? (
                            <span className="text-emerald-700">
                              {formatNumber(netDue)} ج.م
                            </span>
                          ) : (
                            <span className="text-red-700">
                              {formatNumber(netDue)} ج.م (عليه للمحل)
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              {selectedWorkerId ? (
                (() => {
                  const wc = workersComputed.find(
                    (x) => x.worker.id === selectedWorkerId
                  );
                  if (!wc) return null;
                  return (
                    <>
                      <h3 className="text-sm font-bold text-slate-900">
                        تفاصيل سلف العامل: {wc.worker.name} ({selectedMonth})
                      </h3>
                      {wc.monthAdvances.length === 0 ? (
                        <p className="text-xs text-slate-400">
                          لا توجد سلف مسجلة لهذا الشهر.
                        </p>
                      ) : (
                        <table className="w-full text-right border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-100 border-b border-slate-200 font-bold">
                              <th className="py-2 px-2">التاريخ</th>
                              <th className="py-2 px-2">البيان</th>
                              <th className="py-2 px-2">المبلغ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wc.monthAdvances.map((adv) => (
                              <tr key={adv.id} className="border-b border-slate-100">
                                <td className="py-2 px-2 font-mono">{adv.date}</td>
                                <td className="py-2 px-2">
                                  {adv.item || 'سحب من المرتب'}
                                </td>
                                <td className="py-2 px-2 font-mono font-bold">
                                  {formatNumber(adv.total)} ج.م
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  );
                })()
              ) : (
                <div className="p-6 text-center text-xs text-slate-400">
                  اضغط على اسم أي عامل لعرض جدول بكل سحب وتاريخه خلال الشهر.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 4: EXPENSES
         =================================================================== */}
      {activeSubTab === 'expenses' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  شهر المصاريف
                </label>
                <input
                  type="month"
                  value={expenseMonth}
                  onChange={(e) => e.target.value && setExpenseMonth(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <div className="text-xs text-slate-500">
                  إجمالي الشهر الحالي ({expenseMonth})
                </div>
                <div className="text-lg font-extrabold font-mono text-rose-700">
                  {formatNumber(expensesComputed.totalCurrent)} ج.م
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">
                  مقارنة بالشهر السابق ({expensesComputed.prevMonthStr})
                </div>
                <div className="text-lg font-bold font-mono text-slate-700">
                  {formatNumber(expensesComputed.totalPrev)} ج.م
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newCatInput}
                onChange={(e) => setNewCatInput(e.target.value)}
                placeholder="بند مصروف جديد..."
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newCatInput.trim()) return;
                  addExpenseCategory(newCatInput.trim());
                  setNewCatInput('');
                }}
                className="px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg"
              >
                إضافة بند
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                    <th className="py-2.5 px-3">بند المصروف</th>
                    <th className="py-2.5 px-3">إجمالي {expenseMonth}</th>
                    <th className="py-2.5 px-3">
                      إجمالي {expensesComputed.prevMonthStr}
                    </th>
                    <th className="py-2.5 px-3">التغير عن الشهر السابق</th>
                  </tr>
                </thead>
                <tbody>
                  {expensesComputed.rows.map((r) => (
                    <tr key={r.category} className="border-b border-slate-200">
                      <td className="py-2.5 px-3 font-bold text-slate-900">
                        {r.category}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-rose-800">
                        {formatNumber(r.currentTotal)} ج.م
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {formatNumber(r.prevTotal)} ج.م
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold">
                        <span
                          className={
                            r.diff > 0
                              ? 'text-red-600'
                              : r.diff < 0
                              ? 'text-emerald-600'
                              : 'text-slate-400'
                          }
                        >
                          {r.diff > 0 ? '+' : ''}
                          {formatNumber(r.diff)} ج.م
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-3">
                توزيع المصاريف حسب البند ({expenseMonth})
              </h3>
              {expensesComputed.pieData.length > 0 ? (
                <div className="h-64 w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={expensesComputed.pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label
                      >
                        {expensesComputed.pieData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={PIE_COLORS[i % PIE_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: any) => `${formatNumber(Number(v))} ج.م`}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-xs text-slate-400">
                  لا توجد مصاريف مسجلة في هذا الشهر
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
