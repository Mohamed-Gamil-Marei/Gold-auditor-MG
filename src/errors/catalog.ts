import { DiagnosticErrorLog } from '../types';
import { getTodayIso } from '../utils/numerals';

export type ErrorCode =
  | 'E-STORE-001'
  | 'E-STORE-002'
  | 'E-STORE-003'
  | 'E-IMPORT-010'
  | 'E-IMPORT-011'
  | 'E-IMPORT-012'
  | 'E-OCR-020'
  | 'E-OCR-021'
  | 'E-OCR-022'
  | 'E-OCR-023'
  | 'E-LOCK-030'
  | 'E-PRINT-040'
  | 'E-EXPORT-045'
  | 'E-NET-050'
  | 'E-VAL-060'
  | 'E-SAFE-070'
  | 'E-UI-080';

export interface ErrorCatalogSpec {
  code: ErrorCode;
  severity: 'error' | 'warn' | 'info';
  title: string;
  explanation: string;
  recoveryHint: string;
}

export const ERROR_CATALOG: Record<ErrorCode, ErrorCatalogSpec> = {
  'E-STORE-001': {
    code: 'E-STORE-001',
    severity: 'error',
    title: 'تعذر حفظ البيانات على القرص',
    explanation: 'لم يتمكن البرنامج من كتابة ملف البيانات المحلي (state.json).',
    recoveryHint: 'تأكد من وجود مساحة فارغة على القرص وصلاحية الكتابة، أو اضغط Ctrl+S لإعادة المحاولة.',
  },
  'E-STORE-002': {
    code: 'E-STORE-002',
    severity: 'warn',
    title: 'تم عزل سجلات تالفة في الحجر الصحي',
    explanation: 'عثر البرنامج على بعض السجلات غير المطابقة للمواصفات أثناء تحميل البيانات وتم عزلها لحماية باقي الحسابات.',
    recoveryHint: 'اضغط على زر "مراجعة السجلات المعزولة" في الشريط العلوي لإصلاحها أو استعادتها.',
  },
  'E-STORE-003': {
    code: 'E-STORE-003',
    severity: 'warn',
    title: 'الفلاشة أو مجلد النسخ الخارجي غير متصل',
    explanation: 'تعذر الوصول إلى مسار النسخ الاحتياطي الخارجي المحدد في الإعدادات.',
    recoveryHint: 'وصّل الفلاشة USB أو تأكد من اتصال المجلد السحابي ثم جرب النسخ مرة أخرى.',
  },
  'E-IMPORT-010': {
    code: 'E-IMPORT-010',
    severity: 'error',
    title: 'ملف غير مقروء أو تالف',
    explanation: 'لم يتمكن البرنامج من قراءة محتوى الملف المختار أو أن صيغته غير مدعومة.',
    recoveryHint: 'تأكد أن الملف غير محمي بكلمة مرور وأن حجمه أقل من 50 ميجابايت ثم أعد المحاولة.',
  },
  'E-IMPORT-011': {
    code: 'E-IMPORT-011',
    severity: 'warn',
    title: 'حجم الملف يتجاوز الحد المسموح (50MB)',
    explanation: 'الملف المختار كبير جداً وقد يسبب بطئاً في المعالجة.',
    recoveryHint: 'قسّم الملف إلى فترات أصغر أو احفظ الشيت المطلوب فقط ثم استورده.',
  },
  'E-IMPORT-012': {
    code: 'E-IMPORT-012',
    severity: 'warn',
    title: 'تواريخ مقفولة داخل ملف الاستيراد',
    explanation: 'يحتوي الملف على عمليات في أيام تم قفلها بعد المراجعة.',
    recoveryHint: 'افتح قفل تلك الأيام أولاً مع ذكر السبب، أو استثنِ صفوفها من الاستيراد.',
  },
  'E-OCR-020': {
    code: 'E-OCR-020',
    severity: 'error',
    title: 'مفتاح Gemini غير صالح أو غير مسجل',
    explanation: 'رفضت خدمة قراءة الصور المفتاح المستخدم أو أنه لم يُسجل بعد.',
    recoveryHint: 'افتح شاشة "الإعدادات والنسخ" وأدخل مفتاح Gemini صالحاً ثم اضغط "اختبر المفتاح".',
  },
  'E-OCR-021': {
    code: 'E-OCR-021',
    severity: 'warn',
    title: 'تم تجاوز حصة الاستخدام (Quota)',
    explanation: 'وصل مفتاح Gemini للحد الأقصى المسموح به من الطلبات في الدقيقة أو اليوم.',
    recoveryHint: 'انتظر دقيقة ثم أعد المحاولة، أو استخدم الإدخال السريع بالكي-بورد.',
  },
  'E-OCR-022': {
    code: 'E-OCR-022',
    severity: 'warn',
    title: 'الموديل المحدد غير متاح حالياً',
    explanation: 'اسم موديل الذكاء الاصطناعي المحدد لا يستجيب أو غير متوفر.',
    recoveryHint: 'غيّر اسم الموديل في الإعدادات إلى gemini-2.5-flash ثم أعد المحاولة.',
  },
  'E-OCR-023': {
    code: 'E-OCR-023',
    severity: 'warn',
    title: 'استجابة JSON غير مكتملة من القارئ الضوئي',
    explanation: 'لم ترجع خدمة قراءة الصورة جدولاً منظماً بالصيغة المتوقعة.',
    recoveryHint: 'جرب تقسيم الصورة إلى نصفين (علوي وسفلي) أو تدويرها لتكون أوضح.',
  },
  'E-LOCK-030': {
    code: 'E-LOCK-030',
    severity: 'warn',
    title: 'اليوم مقفول بعد المراجعة',
    explanation: 'لا يمكن إضافة أو تعديل أو حذف عمليات في يوم مقفول لحماية الحسابات المراجَعة.',
    recoveryHint: 'اضغط على زر "مقفول" أعلى الشاشة واكتب سبب فتح القفل إذا كنت تريد التعديل.',
  },
  'E-PRINT-040': {
    code: 'E-PRINT-040',
    severity: 'error',
    title: 'تعذر الطباعة أو حفظ ملف PDF',
    explanation: 'حدث خطأ أثناء تجهيز التقرير للطباعة أو الحفظ.',
    recoveryHint: 'تأكد من إغلاق ملف PDF إذا كان مفتوحاً في برنامج آخر ثم أعد المحاولة.',
  },
  'E-EXPORT-045': {
    code: 'E-EXPORT-045',
    severity: 'error',
    title: 'تعذر تصدير الملف',
    explanation: 'فشل حفظ ملف التصدير في المسار المختار.',
    recoveryHint: 'تأكد أن الملف الهدف ليس مفتوحاً في برنامج Excel حالياً ثم أعد المحاولة.',
  },
  'E-NET-050': {
    code: 'E-NET-050',
    severity: 'warn',
    title: 'لا يوجد اتصال بالإنترنت أو انتهت مهلة الطلب',
    explanation: 'تعذر الوصول للخادم خلال المهلة المحددة (60 ثانية). البرنامج يعمل أوفلاين بالكامل ما عدا قراءة الصور.',
    recoveryHint: 'تحقق من اتصال الشبكة إذا كنت تستخدم قراءة الصور، أو أكمل عملك أوفلاين كالمعتاد.',
  },
  'E-VAL-060': {
    code: 'E-VAL-060',
    severity: 'warn',
    title: 'بيانات المدخلات غير صالحة',
    explanation: 'توجد حقول رقمية أو تواريخ غير مكتملة أو خارج النطاق المسموح.',
    recoveryHint: 'راجع الخانات المظللة باللون الأحمر أو الأصفر وصحح القيم.',
  },
  'E-SAFE-070': {
    code: 'E-SAFE-070',
    severity: 'error',
    title: 'تم تفعيل وضع الأمان (Safe Mode)',
    explanation: 'واجه البرنامج خطأ متكرراً أثناء بدء التشغيل، فتم فتحه في وضع القراءة الآمنة لحماية بياناتك.',
    recoveryHint: 'يمكنك استعادة آخر نسخة احتياطية سليمة أو تصدير تقرير المشكلة من نافذة وضع الأمان.',
  },
  'E-UI-080': {
    code: 'E-UI-080',
    severity: 'error',
    title: 'حدث خطأ غير متوقع في هذه الشاشة',
    explanation: 'تعطلت هذه الشاشة الفرعية أثناء العرض، بينما باقي البرنامج وبياناتك محفوظة وسليمة تماماً.',
    recoveryHint: 'اضغط "إعادة المحاولة" أو "العودة للرئيسية".',
  },
};

/**
 * Scrubs sensitive data (API keys, person names, and large currency amounts) from log messages and stack traces.
 */
export function scrubSensitiveText(raw: string, sensitiveNames: string[] = []): string {
  if (!raw) return '';
  let cleaned = String(raw);

  // Scrub Gemini / Google API keys
  cleaned = cleaned.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_API_KEY]');
  cleaned = cleaned.replace(/(key|token|password|passcode)["'\s:=]+[^\s"',}]+/gi, '$1=[REDACTED]');

  // Scrub known person/worker names if provided
  for (const name of sensitiveNames) {
    const trimmed = name?.trim();
    if (trimmed && trimmed.length >= 3) {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(escaped, 'g'), '[اسم_شخص]');
    }
  }

  // Scrub sequences of digits that look like phone numbers or financial amounts (> 4 digits, excluding years 2020-2035 and error codes)
  cleaned = cleaned.replace(/\b(?!20[2-3]\d\b)\d{5,14}\b/g, '[رقم_محجوب]');

  return cleaned;
}

export interface NonIntrusiveToast {
  id: string;
  code: ErrorCode;
  severity: 'error' | 'warn' | 'info';
  title: string;
  message: string;
  hint: string;
  createdAt: number;
}

type ToastListener = (toasts: NonIntrusiveToast[]) => void;
type LogListener = (logs: DiagnosticErrorLog[]) => void;

const activeToasts: NonIntrusiveToast[] = [];
const inMemoryErrorLogs: DiagnosticErrorLog[] = [];
const toastListeners = new Set<ToastListener>();
const logListeners = new Set<LogListener>();

const LOCAL_ERROR_LOGS_KEY = 'gold_audit_diagnostic_logs_v2';

function loadPersistedLogs(): DiagnosticErrorLog[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(LOCAL_ERROR_LOGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Retain last 14 days only
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return parsed.filter((l: DiagnosticErrorLog) => l && l.timestamp >= cutoff);
  } catch {
    return [];
  }
}

function savePersistedLogs(logs: DiagnosticErrorLog[]) {
  try {
    if (typeof localStorage === 'undefined') return;
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const filtered = logs.filter((l) => l.timestamp >= cutoff).slice(0, 300);
    localStorage.setItem(LOCAL_ERROR_LOGS_KEY, JSON.stringify(filtered));
  } catch {
    // ignore storage quota errors
  }
}

// Initialize in-memory logs
if (typeof window !== 'undefined') {
  inMemoryErrorLogs.push(...loadPersistedLogs());
}

export function getDiagnosticErrorLogs(): DiagnosticErrorLog[] {
  return [...inMemoryErrorLogs];
}

export function clearDiagnosticErrorLogs(): void {
  inMemoryErrorLogs.length = 0;
  savePersistedLogs([]);
  logListeners.forEach((fn) => fn([]));
}

export function subscribeToDiagnosticLogs(listener: LogListener): () => void {
  logListeners.add(listener);
  listener([...inMemoryErrorLogs]);
  return () => {
    logListeners.delete(listener);
  };
}

export function subscribeToErrorToasts(listener: ToastListener): () => void {
  toastListeners.add(listener);
  listener([...activeToasts]);
  return () => {
    toastListeners.delete(listener);
  };
}

export function dismissErrorToast(id: string): void {
  const idx = activeToasts.findIndex((t) => t.id === id);
  if (idx !== -1) {
    activeToasts.splice(idx, 1);
    toastListeners.forEach((fn) => fn([...activeToasts]));
  }
}

export function reportAppError(params: {
  code: ErrorCode;
  screen?: string;
  customMessage?: string;
  stack?: string;
  sensitiveNames?: string[];
  silentToast?: boolean;
}): DiagnosticErrorLog {
  const spec = ERROR_CATALOG[params.code] || ERROR_CATALOG['E-UI-080'];
  const now = Date.now();
  const scrubbedMsg = scrubSensitiveText(
    params.customMessage || spec.explanation,
    params.sensitiveNames
  );
  const scrubbedStack = params.stack
    ? scrubSensitiveText(params.stack, params.sensitiveNames)
    : undefined;

  const entry: DiagnosticErrorLog = {
    id: `err-${now}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now,
    date: getTodayIso(),
    screen: params.screen || 'عام',
    code: spec.code,
    severity: spec.severity,
    title: spec.title,
    message: scrubbedMsg,
    hint: spec.recoveryHint,
    stack: scrubbedStack,
  };

  inMemoryErrorLogs.unshift(entry);
  if (inMemoryErrorLogs.length > 300) {
    inMemoryErrorLogs.length = 300;
  }
  savePersistedLogs(inMemoryErrorLogs);
  logListeners.forEach((fn) => fn([...inMemoryErrorLogs]));

  // Send to main process daily rotating log file if bridge is available
  try {
    if (typeof window !== 'undefined' && (window as any).goldApi?.diagnostics?.logError) {
      (window as any).goldApi.diagnostics.logError(entry).catch(() => {});
    }
  } catch {
    // ignore
  }

  if (!params.silentToast) {
    const toast: NonIntrusiveToast = {
      id: entry.id,
      code: spec.code,
      severity: spec.severity,
      title: spec.title,
      message: params.customMessage || spec.explanation,
      hint: spec.recoveryHint,
      createdAt: now,
    };
    activeToasts.unshift(toast);
    if (activeToasts.length > 3) {
      activeToasts.length = 3;
    }
    toastListeners.forEach((fn) => fn([...activeToasts]));

    setTimeout(() => {
      dismissErrorToast(toast.id);
    }, 6500);
  }

  return entry;
}
