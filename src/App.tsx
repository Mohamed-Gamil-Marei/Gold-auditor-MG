import React, { useState, useEffect, useMemo } from 'react';
import {
  Download,
  Search,
  Keyboard,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  HardDrive,
  Wrench,
  Printer,
  ShieldAlert,
} from 'lucide-react';
import { useAuditStore } from './store/useAuditStore';
import { FastEntryScreen } from './components/FastEntryScreen';
import { AuditReviewScreen } from './components/AuditReviewScreen';
import { PhotoUploadScreen } from './components/PhotoUploadScreen';
import { AccountsAndExpensesScreen } from './components/AccountsAndExpensesScreen';
import { PriceStatementScreen } from './components/PriceStatementScreen';
import { GoldPricesScreen } from './components/GoldPricesScreen';
import { GoldInventoryScreen } from './components/GoldInventoryScreen';
import { AuditVisitScreen } from './components/AuditVisitScreen';
import { DaySummaryAndLogScreen } from './components/DaySummaryAndLogScreen';
import { SettingsAndBackupScreen } from './components/SettingsAndBackupScreen';
import { AppLockOverlay } from './components/AppLockOverlay';
import { WelcomeOnboardingModal } from './components/WelcomeOnboardingModal';
import { KeyboardShortcutsModal, GlobalSearchModal } from './components/GlobalModals';
import { exportJsonBackup } from './utils/exportImport';
import { runAllAuditChecks } from './utils/checks';
import {
  ScreenErrorBoundary,
  NonIntrusiveToastContainer,
} from './components/common/ScreenErrorBoundary';
import {
  QuarantineReviewModal,
  SafetySnapshotUndoBanner,
  SafeModeRecoveryBar,
} from './components/QuarantineModal';
import { FixItModal } from './components/FixItModal';
import { ExportAndPrintModal } from './components/common/ExportAndPrintModal';
import { reportAppError } from './errors/catalog';
import { ExportColumnDef } from './export/exportService';

type ScreenTab =
  | 'fast_entry'
  | 'audit_review'
  | 'price_statement'
  | 'gold_prices'
  | 'gold_inventory'
  | 'accounts_expenses'
  | 'audit_visit'
  | 'day_summary'
  | 'photo_upload'
  | 'settings';

const KIND_LABELS_AR: Record<string, string> = {
  buy: 'شراء',
  sell: 'بيع',
  expense: 'مصروف',
  advance: 'سلفة عامل',
  person: 'حركة شخص',
};

export default function App() {
  const {
    initialized,
    saveStatus,
    saveError,
    lastSavedAt,
    recoveredFromBackupNotice,
    externalBackupWarning,
    currentDate,
    operations,
    daysMap,
    persons,
    workers,
    auditLogs,
    issueReviews,
    settings,
    expenseCategories,
    pricePresets,
    showItemColumn,
    closedSalaryMonths,
    lastBackupAt,
    quarantinedRecords,
    hydrateFromStorage,
    flushSaveNow,
    dismissRecoveryNotice,
    dismissExternalBackupWarning,
    setCurrentDate,
    setHighlightedOpId,
    loadDemoData,
    markBackupExported,
  } = useAuditStore();

  const [activeTab, setActiveTab] = useState<ScreenTab>('fast_entry');
  const [demoLoadedToast, setDemoLoadedToast] = useState(false);
  const [manualSavedToast, setManualSavedToast] = useState(false);
  const [visitToast, setVisitToast] = useState<string | null>(null);
  const [dismissBackupReminder, setDismissBackupReminder] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showGlobalSearchModal, setShowGlobalSearchModal] = useState(false);
  const [showQuarantineModal, setShowQuarantineModal] = useState(false);
  const [showFixItModal, setShowFixItModal] = useState(false);
  const [showGlobalExportModal, setShowGlobalExportModal] = useState(false);

  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  // G1.1: Global window.onerror and unhandledrejection handlers (never crash the app)
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      reportAppError({
        code: 'E-UI-080',
        screen: activeTab,
        customMessage: event.message || 'Unhandled window error',
        stack: event.error?.stack,
        silentToast: true,
      });
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportAppError({
        code: 'E-UI-080',
        screen: activeTab,
        customMessage:
          reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection'),
        stack: reason instanceof Error ? reason.stack : undefined,
        silentToast: true,
      });
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [activeTab]);

  // Flush pending writes immediately on window close / before-quit IPC
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushSaveNow(false);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    if (window.goldApi?.onFlushBeforeQuit) {
      window.goldApi.onFlushBeforeQuit(async () => {
        await flushSaveNow(false);
      });
    }
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [flushSaveNow]);

  // Global shortcuts (Ctrl+K search, Ctrl+F1 shortcuts guide, Ctrl+S immediate save, Ctrl+P export & print preview)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowGlobalSearchModal((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'F1') {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushSaveNow(true).then((ok) => {
          if (ok) {
            setManualSavedToast(true);
            setTimeout(() => setManualSavedToast(false), 2500);
          }
        });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowGlobalExportModal(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flushSaveNow]);

  // Redirect away from photo_upload if disabled in settings
  useEffect(() => {
    if (settings.disablePhotoUpload && activeTab === 'photo_upload') {
      setActiveTab('fast_entry');
    }
  }, [settings.disablePhotoUpload, activeTab]);

  // Calculate unreviewed issues count for Bottom Status Bar
  const unreviewedIssuesCount = useMemo(() => {
    if (!initialized || operations.length === 0) return 0;
    try {
      const res = runAllAuditChecks(
        operations,
        daysMap,
        persons,
        workers,
        auditLogs,
        settings
      );
      return res.issues.filter((iss) => !issueReviews[iss.id]?.reviewed).length;
    } catch {
      return 0;
    }
  }, [initialized, operations, daysMap, persons, workers, auditLogs, settings, issueReviews]);

  // Prepare rows & columns for global ExportAndPrintModal
  const globalExportColumns: ExportColumnDef[] = useMemo(
    () => [
      { key: 'date', label: 'التاريخ', type: 'date' },
      { key: 'kindLabel', label: 'نوع العملية', type: 'text' },
      { key: 'karat', label: 'العيار', type: 'text' },
      { key: 'weightG', label: 'الوزن (جرام)', type: 'weight', summable: true },
      { key: 'gramPrice', label: 'سعر الجرام', type: 'currency' },
      { key: 'total', label: 'المبلغ (ج.م)', type: 'currency', summable: true },
      { key: 'item', label: 'الصنف / البيان', type: 'text' },
      { key: 'personName', label: 'الشخص / العامل', type: 'text', isPersonSensitive: true },
      { key: 'paymentLabel', label: 'طريقة الدفع', type: 'text' },
      { key: 'note', label: 'ملاحظات', type: 'text' },
    ],
    []
  );

  const globalExportAllRows = useMemo(() => {
    const personMap = new Map<string, string>(
      persons.map((p): [string, string] => [p.id, p.name])
    );
    const workerMap = new Map<string, string>(
      workers.map((w): [string, string] => [w.id, w.name])
    );
    return operations.map((op) => ({
      id: op.id,
      date: op.date,
      kindLabel: KIND_LABELS_AR[op.kind] || op.kind,
      karat: op.karat ? String(op.karat) : '—',
      weightG: op.weightG || 0,
      gramPrice: op.weightG > 0 ? Math.round((op.total / op.weightG) * 100) / 100 : 0,
      total: op.total || 0,
      item: op.item || op.category || '',
      personName:
        (op.personId ? personMap.get(op.personId) : '') ||
        (op.workerId ? workerMap.get(op.workerId) : '') ||
        '',
      paymentLabel: op.payment === 'credit' ? 'آجل' : 'نقدي',
      note: op.note || '',
    }));
  }, [operations, persons, workers]);

  const globalExportCurrentDayRows = useMemo(
    () => globalExportAllRows.filter((r) => r.date === currentDate),
    [globalExportAllRows, currentDate]
  );

  const handleLoadDemo = () => {
    loadDemoData();
    setDemoLoadedToast(true);
    setTimeout(() => setDemoLoadedToast(false), 3500);
  };

  if (!initialized) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-600 text-sm font-bold">
        جاري تحميل ملفات بيانات مراجع الذهب المحلية...
      </div>
    );
  }

  // Show reminder if > 7 days have passed since last backup / external backup
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const lastAnyExternalBackup = settings.lastExternalBackupAt || lastBackupAt;
  const isBackupOverdue =
    operations.length > 0 &&
    !dismissBackupReminder &&
    (!lastAnyExternalBackup || Date.now() - lastAnyExternalBackup > sevenDaysMs);

  const navItems: { id: ScreenTab; label: string }[] = [
    { id: 'fast_entry', label: 'الإدخال السريع' },
    { id: 'audit_review', label: 'راجع والاشتباهات' },
    { id: 'price_statement', label: 'بيان الأسعار' },
    { id: 'gold_prices', label: 'أسعار الذهب' },
    { id: 'gold_inventory', label: 'الجرد' },
    { id: 'accounts_expenses', label: 'الأشخاص والعمال والمصاريف' },
    { id: 'audit_visit', label: 'زيارة المراجعة' },
    { id: 'day_summary', label: 'ملخص اليوم والتقارير' },
    ...(settings.disablePhotoUpload
      ? []
      : ([{ id: 'photo_upload', label: 'استيراد شامل / الدفتر' }] as const)),
    { id: 'settings', label: 'الإعدادات والنسخ' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col" dir="rtl">
      {/* Startup & Idle App Lock Overlay */}
      <AppLockOverlay />

      {/* First-Run Onboarding / Quick Setup Modal */}
      <WelcomeOnboardingModal />

      {/* G1: Safe Mode Top Recovery Bar & 10-Min Pre-Operation Safety Snapshot Undo Banner */}
      <SafeModeRecoveryBar />
      <SafetySnapshotUndoBanner />

      {/* G1: Non-Intrusive Toast Notifications */}
      <NonIntrusiveToastContainer />

      {/* G1: Quarantine Review Modal & Fix-It Smart Assistant Modal */}
      <QuarantineReviewModal
        open={showQuarantineModal}
        onClose={() => setShowQuarantineModal(false)}
      />
      <FixItModal open={showFixItModal} onClose={() => setShowFixItModal(false)} />

      {/* G2: Unified Multi-Format Export & Print Preview Modal (Ctrl+P) */}
      <ExportAndPrintModal
        open={showGlobalExportModal}
        onClose={() => setShowGlobalExportModal(false)}
        reportTitle="تقرير عمليات المحل ومراجعة الذهب"
        filenamePrefix={`تقرير_العمليات_${currentDate}`}
        columns={globalExportColumns}
        filteredRows={
          globalExportCurrentDayRows.length > 0
            ? globalExportCurrentDayRows
            : globalExportAllRows
        }
        allRows={globalExportAllRows}
        activeFilterSummary={
          globalExportCurrentDayRows.length > 0 ? `عمليات يوم ${currentDate}` : 'كل العمليات'
        }
        periodSummary={currentDate}
      />

      {/* Keyboard Shortcuts Modal (Ctrl+F1) & Global Search Modal (Ctrl+K) */}
      <KeyboardShortcutsModal
        open={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />
      <GlobalSearchModal
        open={showGlobalSearchModal}
        onClose={() => setShowGlobalSearchModal(false)}
        onNavigateToDate={(dt, opId) => {
          setCurrentDate(dt);
          if (opId) setHighlightedOpId(opId);
          setActiveTab('fast_entry');
        }}
        onNavigateToAccounts={() => setActiveTab('accounts_expenses')}
        onNavigateToAudit={() => setActiveTab('audit_review')}
        onNavigateToLog={() => setActiveTab('day_summary')}
      />

      {/* Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-2.5 sticky top-0 z-40 no-print">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-3">
          {/* Zone 1: Brand Title + Save Status Indicator */}
          <div className="flex items-center gap-2.5 shrink-0">
            <a
              href="#fast_entry"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('fast_entry');
              }}
              className="text-base sm:text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap"
            >
              مراجع الذهب
              {settings.shopName ? (
                <span className="text-xs font-bold text-amber-700 mr-1.5">
                  ({settings.shopName})
                </span>
              ) : null}
            </a>

            {saveStatus === 'saved' && (
              <span
                title={
                  lastSavedAt
                    ? `آخر حفظ: ${new Date(lastSavedAt).toLocaleTimeString('ar-EG')}`
                    : 'جميع التغييرات محفوظة على الجهاز'
                }
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold"
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                <span>تم الحفظ ✓</span>
              </span>
            )}
            {saveStatus === 'saving' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
                <RefreshCw className="w-3 h-3 text-amber-600 animate-spin" />
                <span>جاري الحفظ…</span>
              </span>
            )}
            {saveStatus === 'error' && (
              <button
                type="button"
                onClick={() => flushSaveNow(false)}
                title={saveError || 'اضغط لإعادة محاولة الحفظ'}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold cursor-pointer"
              >
                <AlertTriangle className="w-3 h-3" />
                <span>فشل الحفظ ⚠ (إعادة المحاولة)</span>
              </button>
            )}
          </div>

          {/* Zone 2: Concise single-line navigation links */}
          <nav className="hidden xl:flex items-center gap-3 text-xs font-bold text-slate-600 overflow-x-auto">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                    isActive
                      ? 'text-amber-700 border-amber-600 font-extrabold'
                      : 'border-transparent hover:text-slate-900'
                  }`}
                >
                  {item.label}
                  {item.id === 'audit_review' && unreviewedIssuesCount > 0 && (
                    <span className="mr-1 px-1.5 py-0.2 rounded-full bg-red-100 text-red-800 text-[10px] font-mono font-extrabold">
                      {unreviewedIssuesCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Quick Search (Ctrl+K), Fix-It, Export/Print (Ctrl+P), Shortcuts (Ctrl+F1) & Demo Data */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowFixItModal(true)}
              title="مساعد تصحيح الأخطاء الشائعة بنقرة واحدة (Fix-It)"
              className="px-2.5 py-1.5 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Wrench className="w-3.5 h-3.5 text-amber-700" />
              <span className="hidden md:inline">تصحيح ذكي</span>
            </button>

            <button
              type="button"
              onClick={() => setShowGlobalExportModal(true)}
              title="تصدير أو طباعة التقارير (Ctrl+P)"
              className="px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-slate-600" />
              <span className="hidden sm:inline">تصدير / طباعة</span>
            </button>

            <button
              type="button"
              onClick={() => setShowGlobalSearchModal(true)}
              title="بحث شامل سريع (Ctrl+K)"
              className="px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">بحث</span>
              <kbd dir="ltr" className="text-[10px] font-mono text-slate-400 hidden lg:inline">
                Ctrl+K
              </kbd>
            </button>

            <button
              type="button"
              onClick={() => setShowShortcutsModal(true)}
              title="دليل اختصارات لوحة المفاتيح (Ctrl+F1)"
              className="p-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Keyboard className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleLoadDemo}
              className="px-3 py-1.5 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              بيانات تجريبية ({operations.length > 0 ? `${operations.length} صف` : '100+ صف'})
            </button>
          </div>
        </div>

        {/* Secondary Horizontal Nav Bar for smaller screens */}
        <div className="flex xl:hidden items-center gap-2 overflow-x-auto pt-2.5 mt-2 border-t border-slate-100 text-xs font-bold">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === item.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {/* G1.4: Quarantined Corrupted Records Warning Banner */}
      {quarantinedRecords.length > 0 && (
        <div className="bg-amber-900 text-amber-50 px-4 py-2 text-xs font-bold no-print border-b border-amber-700">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-300 shrink-0" />
              <span>
                تم عزل {quarantinedRecords.length} سجل غير مكتمل أو تالف أثناء فحص سلامة البيانات — بقية بياناتك تعمل بشكل طبيعي تماماً.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowQuarantineModal(true)}
              className="px-3 py-1 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-lg font-extrabold cursor-pointer"
            >
              مراجعة وإصلاح السجلات المعزولة ({quarantinedRecords.length})
            </button>
          </div>
        </div>
      )}

      {/* Backup Recovery Warning Banner */}
      {recoveredFromBackupNotice && (
        <div className="bg-red-700 text-white px-4 py-2 text-xs font-bold no-print">
          <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-2">
            <span>{recoveredFromBackupNotice}</span>
            <button
              type="button"
              onClick={dismissRecoveryNotice}
              className="px-2.5 py-0.5 bg-white/20 hover:bg-white/30 rounded text-white cursor-pointer"
            >
              فهمت
            </button>
          </div>
        </div>
      )}

      {/* External Flash Drive Disconnected Warning */}
      {externalBackupWarning && (
        <div className="bg-red-100 border-b border-red-300 text-red-900 px-4 py-2 text-xs font-bold no-print">
          <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-red-700 shrink-0" />
              <span>{externalBackupWarning}</span>
            </div>
            <button
              type="button"
              onClick={dismissExternalBackupWarning}
              className="px-2.5 py-0.5 bg-red-200 hover:bg-red-300 rounded text-red-950 cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}

      {/* 7-Day External Backup Reminder Banner */}
      {isBackupOverdue && (
        <div className="bg-amber-100 border-b border-amber-300 text-amber-950 px-4 py-2 text-xs font-bold no-print">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>
              تذكير أمان البيانات: مرّ أكثر من 7 أيام منذ آخر نسخة احتياطية خارجية (فلاشة / ملف JSON). يُنصح بحفظ نسخة خارجية الآن لحماية بياناتك.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  exportJsonBackup({
                    operations,
                    daysMap,
                    persons,
                    workers,
                    auditLogs,
                    issueReviews,
                    settings,
                    expenseCategories,
                    pricePresets,
                    showItemColumn,
                    closedSalaryMonths,
                  });
                  markBackupExported();
                }}
                className="px-3 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded-lg inline-flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>تحميل نسخة خارجية الآن</span>
              </button>
              <button
                type="button"
                onClick={() => setDismissBackupReminder(true)}
                className="px-2 py-1 text-amber-800 hover:underline cursor-pointer"
              >
                لاحقاً
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Save & Backup Toast (Ctrl+S) */}
      {manualSavedToast && (
        <div className="bg-emerald-800 text-white px-4 py-1.5 text-xs font-bold text-center no-print">
          تم الحفظ الفوري وإنشاء نسخة احتياطية تلقائية بنجاح (Ctrl+S) ✓
        </div>
      )}

      {/* Visit Toast */}
      {visitToast && (
        <div className="bg-emerald-900 text-white px-4 py-2 text-xs font-bold text-center no-print">
          {visitToast}
        </div>
      )}

      {/* Demo Data Loaded Feedback Banner */}
      {demoLoadedToast && (
        <div className="bg-emerald-900 text-white px-4 py-2 text-xs font-bold text-center no-print">
          تم توليد أكثر من 100 صف من البيانات التجريبية المتكاملة شاملة البيع بمصنعية عادية، الشراء بخصم كسر، عيار 18/21/24، المديونيات المتأخرة، وزيارة مراجعة سابقة — تصفح الأقسام لفحصها.
        </div>
      )}

      {/* Main Content Container — Every Screen Protected by Independent ScreenErrorBoundary (G1.1) */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5">
        {activeTab === 'fast_entry' && (
          <ScreenErrorBoundary
            screenName="الإدخال السريع"
            onGoHome={() => setActiveTab('fast_entry')}
          >
            <FastEntryScreen onGoToAudit={() => setActiveTab('audit_review')} />
          </ScreenErrorBoundary>
        )}
        {activeTab === 'audit_review' && (
          <ScreenErrorBoundary
            screenName="راجع والاشتباهات"
            onGoHome={() => setActiveTab('fast_entry')}
          >
            <AuditReviewScreen />
          </ScreenErrorBoundary>
        )}
        {activeTab === 'price_statement' && (
          <ScreenErrorBoundary
            screenName="بيان الأسعار"
            onGoHome={() => setActiveTab('fast_entry')}
          >
            <PriceStatementScreen
              onNavigateToOperation={(dt, opId) => {
                setCurrentDate(dt);
                setHighlightedOpId(opId);
                setActiveTab('fast_entry');
              }}
            />
          </ScreenErrorBoundary>
        )}
        {activeTab === 'gold_prices' && (
          <ScreenErrorBoundary
            screenName="أسعار الذهب"
            onGoHome={() => setActiveTab('fast_entry')}
          >
            <GoldPricesScreen
              onOpenDayInFastEntry={(dt) => {
                setCurrentDate(dt);
                setActiveTab('fast_entry');
              }}
            />
          </ScreenErrorBoundary>
        )}
        {activeTab === 'gold_inventory' && (
          <ScreenErrorBoundary
            screenName="الجرد"
            onGoHome={() => setActiveTab('fast_entry')}
          >
            <GoldInventoryScreen
              onOpenDayInFastEntry={(dt) => {
                setCurrentDate(dt);
                setActiveTab('fast_entry');
              }}
            />
          </ScreenErrorBoundary>
        )}
        {activeTab === 'accounts_expenses' && (
          <ScreenErrorBoundary
            screenName="الأشخاص والعمال والمصاريف"
            onGoHome={() => setActiveTab('fast_entry')}
          >
            <AccountsAndExpensesScreen />
          </ScreenErrorBoundary>
        )}
        {activeTab === 'audit_visit' && (
          <ScreenErrorBoundary
            screenName="زيارة المراجعة"
            onGoHome={() => setActiveTab('fast_entry')}
          >
            <AuditVisitScreen
              onNavigateTab={(t) => {
                if (t === 'summary_log') setActiveTab('day_summary');
                else setActiveTab(t);
              }}
              onShowToast={(msg) => {
                setVisitToast(msg);
                setTimeout(() => setVisitToast(null), 4000);
              }}
            />
          </ScreenErrorBoundary>
        )}
        {activeTab === 'day_summary' && (
          <ScreenErrorBoundary
            screenName="ملخص اليوم والتقارير"
            onGoHome={() => setActiveTab('fast_entry')}
          >
            <DaySummaryAndLogScreen />
          </ScreenErrorBoundary>
        )}
        {activeTab === 'photo_upload' && !settings.disablePhotoUpload && (
          <ScreenErrorBoundary
            screenName="الاستيراد الشامل وصورة الدفتر"
            onGoHome={() => setActiveTab('fast_entry')}
          >
            <PhotoUploadScreen onAddedSuccess={() => setActiveTab('fast_entry')} />
          </ScreenErrorBoundary>
        )}
        {activeTab === 'settings' && (
          <ScreenErrorBoundary
            screenName="الإعدادات والنسخ الاحتياطي"
            onGoHome={() => setActiveTab('fast_entry')}
          >
            <SettingsAndBackupScreen />
          </ScreenErrorBoundary>
        )}
      </main>

      {/* Bottom Status Bar */}
      <footer className="bg-slate-900 text-slate-300 border-t border-slate-800 px-4 sm:px-6 py-2 text-[11px] font-semibold no-print">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <span>
              المحل:{' '}
              <strong className="text-white">
                {settings.shopName ? settings.shopName : 'غير محدد (اضبطه من الإعدادات)'}
              </strong>
            </span>
            <span className="text-slate-600">|</span>
            <span>
              آخر حفظ محلي:{' '}
              <strong className="text-emerald-400 font-mono">
                {lastSavedAt
                  ? new Date(lastSavedAt).toLocaleTimeString('ar-EG')
                  : 'محفوظ'}
              </strong>
            </span>
            <span className="text-slate-600">|</span>
            <span>
              آخر نسخة خارجية:{' '}
              <strong className="text-amber-300 font-mono">
                {settings.lastExternalBackupAt || lastBackupAt
                  ? new Date(
                      (settings.lastExternalBackupAt || lastBackupAt)!
                    ).toLocaleDateString('ar-EG')
                  : 'لم تُنسخ بعد'}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-4">
            {quarantinedRecords.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowQuarantineModal(true)}
                  className="text-amber-300 hover:text-amber-200 cursor-pointer font-bold"
                >
                  سجلات معزولة: {quarantinedRecords.length}
                </button>
                <span className="text-slate-600">|</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('audit_review')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              الاشتباهات غير المراجعة:{' '}
              <strong
                className={`font-mono px-1.5 py-0.5 rounded ${
                  unreviewedIssuesCount > 0
                    ? 'bg-red-600 text-white'
                    : 'bg-emerald-800 text-emerald-200'
                }`}
              >
                {unreviewedIssuesCount}
              </strong>
            </button>
            <span className="text-slate-600">|</span>
            <span className="font-mono text-slate-400">مراجع الذهب v2.1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

