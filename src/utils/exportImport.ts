import * as XLSX from 'xlsx';
import {
  AuditLogEntry,
  AuditSettings,
  DayInfo,
  Issue,
  IssueReviewState,
  Operation,
  Person,
  PriceStatementPreset,
  Worker,
} from '../types';
import { formatWeight } from './numerals';
import { DayGoldInventorySummary } from './checks/checkGoldInventoryBalance';
import { PersonComputedBalance } from './checks/checkPersonBalances';

const KIND_AR: Record<string, string> = {
  buy: 'شراء',
  sell: 'بيع',
  expense: 'مصروف',
  advance: 'سلفة عامل',
  person: 'حركة شخص',
};

const SEVERITY_AR: Record<string, string> = {
  high: 'عالية (خطر)',
  medium: 'متوسطة (تنبيه)',
  low: 'منخفضة (ملاحظة)',
};

export function exportFullWorkbookExcel(params: {
  operations: Operation[];
  daysMap: Record<string, DayInfo>;
  persons: Person[];
  workers: Worker[];
  issues: Issue[];
  issueReviews: Record<string, IssueReviewState>;
  auditLogs: AuditLogEntry[];
}) {
  const { operations, daysMap, persons, workers, issues, issueReviews, auditLogs } = params;
  const wb = XLSX.utils.book_new();

  const personsMap = new Map(persons.map((p) => [p.id, p.name]));
  const workersMap = new Map(workers.map((w) => [w.id, w.name]));

  // 1. Operations Sheet
  const opsRows = operations.map((op, idx) => ({
    '#': idx + 1,
    التاريخ: op.date,
    النوع: KIND_AR[op.kind] || op.kind,
    العيار: op.kind === 'buy' || op.kind === 'sell' ? op.karat || 21 : '',
    'الوزن (جرام)': op.weightG || 0,
    'الإجمالي (ج.م)': op.total || 0,
    'سعر الجرام': op.weightG > 0 ? Math.round(op.total / op.weightG) : 0,
    البيان: op.item || '',
    الدفع: op.payment === 'credit' ? 'آجل' : 'نقدي',
    'الشخص / العامل':
      (op.personId && personsMap.get(op.personId)) ||
      (op.workerId && workersMap.get(op.workerId)) ||
      '',
    البند: op.category || '',
    'تمت المراجعة': op.reviewedFlag ? 'نعم' : 'لا',
    ملاحظات: op.note || '',
  }));
  const wsOps = XLSX.utils.json_to_sheet(opsRows);
  XLSX.utils.book_append_sheet(wb, wsOps, 'العمليات');

  // 2. Issues Sheet
  const issueRows = issues.map((iss, idx) => {
    const rev = issueReviews[iss.id];
    return {
      '#': idx + 1,
      الخطورة: SEVERITY_AR[iss.severity] || iss.severity,
      'نوع الفحص': iss.checkTitle,
      التاريخ: iss.date,
      الرسالة: iss.message,
      المتوقع: iss.expected ?? '',
      الفعلي: iss.actual ?? '',
      الفرق: iss.difference ?? '',
      'حالة المراجعة': rev?.reviewed ? 'تمت المراجعة' : 'غير مراجع',
      'ملاحظة المراجع': rev?.note || '',
    };
  });
  const wsIssues = XLSX.utils.json_to_sheet(issueRows);
  XLSX.utils.book_append_sheet(wb, wsIssues, 'الاشتباهات');

  // 3. Days & Safe & Inventory Sheet
  const dayRows = Object.values(daysMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      التاريخ: d.date,
      'سعر الذهب اليومي (21)': d.goldPricePerGram || 0,
      'سعر عيار 18': d.goldPrice18 || '',
      'سعر عيار 24': d.goldPrice24 || '',
      'رصيد ذهب أول اليوم (ج)': d.openingBalanceG ?? '',
      'جرد ذهب آخر اليوم (ج)': d.closingBalanceG ?? '',
      'نقدية أول اليوم': d.openingCash ?? '',
      'جرد الخزنة الفعلي': d.actualCash ?? '',
      'حالة القفل': d.locked ? 'مقفول' : 'مفتوح',
      ملاحظة: d.cashNote || d.goldNote || '',
    }));
  const wsDays = XLSX.utils.json_to_sheet(dayRows);
  XLSX.utils.book_append_sheet(wb, wsDays, 'اليوميات والخزنة والجرد');

  // 4. Persons Sheet
  const personRows = persons.map((p) => ({
    الاسم: p.name,
    النوع:
      p.type === 'client'
        ? 'عميل'
        : p.type === 'supplier'
        ? 'مورد'
        : p.type === 'worker'
        ? 'عامل'
        : 'آخر',
    التليفون: p.phone || '',
    'حد الدين الأقصى (ج.م)': p.maxDebtCash || '',
    'حد دين الذهب (ج)': p.maxDebtGoldG || '',
    'موعد السداد المتفق عليه': p.agreedDueDate || '',
    ملاحظة: p.note || '',
  }));
  const wsPersons = XLSX.utils.json_to_sheet(personRows);
  XLSX.utils.book_append_sheet(wb, wsPersons, 'الأشخاص');

  // 5. Workers Sheet
  const workerRows = workers.map((w) => ({
    الاسم: w.name,
    'المرتب الشهري': w.monthlySalary,
    'يوم الاستحقاق': w.dueDay,
    'رصيد مرحل': w.carryOverDiff || 0,
    ملاحظة: w.note || '',
  }));
  const wsWorkers = XLSX.utils.json_to_sheet(workerRows);
  XLSX.utils.book_append_sheet(wb, wsWorkers, 'العمال');

  // 6. Audit Log Sheet
  const logRows = auditLogs.map((l) => ({
    الوقت: new Date(l.timestamp).toLocaleString('ar-EG'),
    الإجراء: l.action,
    تاريخ_العملية: l.date,
    كان_اليوم_مقفولاً: l.wasLocked ? 'نعم' : 'لا',
    الوصف: l.description,
    القيمة_القديمة: l.oldValue || '',
    القيمة_الجديدة: l.newValue || '',
    السبب: l.reason || '',
  }));
  const wsLogs = XLSX.utils.json_to_sheet(logRows);
  XLSX.utils.book_append_sheet(wb, wsLogs, 'سجل التعديلات');

  XLSX.writeFile(wb, `مراجع-الذهب-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportPriceStatementExcel(params: {
  higherRows: any[];
  lowerRows: any[];
  settingsDesc: string;
}) {
  const wb = XLSX.utils.book_new();

  const formatRow = (r: any) => ({
    'رقم الصف': r.rowNumber,
    التاريخ: r.date,
    النوع: r.kind === 'buy' ? 'شراء' : 'بيع',
    العيار: r.op?.karat || 21,
    البيان: r.item || '-',
    'وصف الحالة': r.caseDescription || '',
    'الوزن (جرام)': Number(formatWeight(r.weightG)),
    'الإجمالي (ج.م)': Math.round(r.total),
    'سعر الجرام الفعلي': Math.round(r.actualGramPrice),
    'الحد المرجعي لليوم': Math.round(r.referenceLimit),
    'الفرق (جنيه/جرام)': Math.round(r.diffPerGram),
    'الفرق %': `${r.diffPct.toFixed(2)}%`,
    'الأثر المالي المقدر': Math.round(r.financialImpact),
  });

  const headerInfo = [['بيان أسعار الشراء والبيع - مراجع الذهب'], [params.settingsDesc], []];

  const wsHigh = XLSX.utils.aoa_to_sheet(headerInfo);
  XLSX.utils.sheet_add_json(wsHigh, params.higherRows.map(formatRow), { origin: 'A4' });
  XLSX.utils.book_append_sheet(wb, wsHigh, 'أعلى من الحد');

  const wsLow = XLSX.utils.aoa_to_sheet(headerInfo);
  XLSX.utils.sheet_add_json(wsLow, params.lowerRows.map(formatRow), { origin: 'A4' });
  XLSX.utils.book_append_sheet(wb, wsLow, 'أقل من الحد');

  XLSX.writeFile(wb, `بيان-الأسعار-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportGoldInventoryExcel(
  rows: DayGoldInventorySummary[],
  fromDate: string,
  toDate: string
) {
  const wb = XLSX.utils.book_new();

  const karats: Array<{ key: '21' | '18' | '24' | 'other'; sheetName: string }> = [
    { key: '21', sheetName: 'عيار 21' },
    { key: '18', sheetName: 'عيار 18' },
    { key: '24', sheetName: 'عيار 24' },
    { key: 'other', sheetName: 'عيار آخر' },
  ];

  for (const k of karats) {
    const data = rows.map((r) => {
      const kd = r.byKarat[k.key];
      return {
        التاريخ: r.date,
        'رصيد أول اليوم (ج)': kd.hasOpening ? kd.openingG : '',
        'شراء (ج)': kd.buyG,
        'بيع (ج)': kd.sellG,
        'وارد أشخاص (ج)': kd.personInG,
        'منصرف أشخاص (ج)': kd.personOutG,
        'الرصيد المتوقع آخر اليوم (ج)': kd.expectedClosingG,
        'الجرد الفعلي آخر اليوم (ج)': kd.hasActualClosing ? kd.actualClosingG : '',
        'الفرق (فعلي - متوقع) (ج)': kd.hasOpening && kd.hasActualClosing ? kd.diffG : '',
        'القيمة التقديرية للفرق (ج.م)':
          kd.hasOpening && kd.hasActualClosing ? kd.estimatedDiffValueEGP : '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, k.sheetName);
  }

  const eqData = rows.map((r) => ({
    التاريخ: r.date,
    'أول اليوم مكافئ 21 (ج)': r.totalOpening21EqG,
    'شراء مكافئ 21 (ج)': r.totalBuy21EqG,
    'بيع مكافئ 21 (ج)': r.totalSell21EqG,
    'صافي أشخاص مكافئ 21 (ج)': r.totalPersonNet21EqG,
    'المتوقع مكافئ 21 (ج)': r.totalExpected21EqG,
    'الفعلي مكافئ 21 (ج)': r.totalActual21EqG,
    'الفرق مكافئ 21 (ج)': r.totalDiff21EqG,
    'إجمالي قيمة الفرق (ج.م)': r.totalDiffValueEGP,
  }));
  const wsEq = XLSX.utils.json_to_sheet(eqData);
  XLSX.utils.book_append_sheet(wb, wsEq, 'المكافئ الإجمالي عيار 21');

  XLSX.writeFile(wb, `جرد-الذهب-${fromDate}-إلى-${toDate}.xlsx`);
}

export function exportDebtStatementExcel(debtors: PersonComputedBalance[]) {
  const wb = XLSX.utils.book_new();
  const data = debtors.map((d, idx) => ({
    '#': idx + 1,
    الاسم: d.person?.name || '',
    التليفون: d.person?.phone || '',
    'الرصيد النقدي (عليه ج.م)': Math.round(d.cashBalance),
    'رصيد الذهب (عليه جرام)': Number(d.goldBalanceG.toFixed(3)),
    'آخر سداد': d.lastPaymentDate || 'لم يسدد',
    'عمر الدين (يوم)': d.debtAgeDays,
    'فئة عمر الدين': d.ageBucket,
    'موعد السداد المتفق عليه': d.agreedDueDate || '-',
    'أيام التأخر عن الموعد': d.agreedOverdueDays > 0 ? d.agreedOverdueDays : 0,
    'حد الدين الأقصى (ج.م)': d.maxDebtCash || '-',
    'نسبة استهلاك الحد %': d.maxDebtCash ? `${d.limitUsagePct}%` : '-',
    'الحالة': d.exceededAnyLimit ? 'تجاوز الحد!' : d.agreedOverdueDays > 0 ? 'متأخر عن الموعد' : 'ضمن الحد',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'كشف المديونيات');
  XLSX.writeFile(wb, `كشف-المديونيات-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportPersonStatementExcel(
  personName: string,
  rows: {
    date: string;
    item: string;
    debitCash: number;
    creditCash: number;
    runningCash: number;
    debitGold: number;
    creditGold: number;
    runningGold: number;
  }[]
) {
  const wb = XLSX.utils.book_new();
  const data = rows.map((r) => ({
    التاريخ: r.date,
    البيان: r.item,
    'مدين نقدية (عليه)': r.debitCash,
    'دائن نقدية (له/سدد)': r.creditCash,
    'رصيد النقدية التراكمي': r.runningCash,
    'مدين ذهب (ج)': r.debitGold,
    'دائن ذهب (ج)': r.creditGold,
    'رصيد الذهب التراكمي (ج)': r.runningGold,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'كشف حساب');
  XLSX.writeFile(wb, `كشف-حساب-${personName}.xlsx`);
}

export function exportJsonBackup(payload: {
  operations: Operation[];
  daysMap: Record<string, DayInfo>;
  persons: Person[];
  workers: Worker[];
  auditLogs: AuditLogEntry[];
  issueReviews: Record<string, IssueReviewState>;
  settings: AuditSettings;
  expenseCategories: string[];
  pricePresets?: PriceStatementPreset[];
  showItemColumn?: boolean;
  closedSalaryMonths?: string[];
}) {
  const jsonStr = JSON.stringify(
    {
      version: '2.2',
      exportedAt: new Date().toISOString(),
      ...payload,
    },
    null,
    2
  );
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `نسخة-احتياطية-مراجع-الذهب-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
