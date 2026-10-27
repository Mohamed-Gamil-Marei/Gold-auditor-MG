import crypto from 'node:crypto';

/**
 * إعدادات الخادم المحلي (وضع المعاينة / الويب) — مفصولة لتكون قابلة للاختبار.
 * القاعدة: الربط على الجهاز المحلي فقط ما لم يُطلب غير ذلك صراحةً (HOST) أو نكون على Cloud Run.
 */
export function resolveListenHost(env: Record<string, string | undefined> = process.env): string {
  const explicit = String(env.HOST || '').trim();
  if (explicit) return explicit;
  if (env.K_SERVICE) return '0.0.0.0'; // Cloud Run / AI Studio preview يتطلب الاستماع على كل الواجهات
  return '127.0.0.1';
}

export function isLoopbackHost(host: string): boolean {
  const h = String(host || '').trim().toLowerCase();
  return h === '127.0.0.1' || h === '::1' || h === 'localhost' || h.startsWith('127.');
}

/** مقارنة رمز الحماية بزمن ثابت (عبر SHA-256 لتوحيد الطول). */
export function passcodeMatches(provided: string, required: string): boolean {
  const a = crypto.createHash('sha256').update(String(provided || '')).digest();
  const b = crypto.createHash('sha256').update(String(required || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

export type DesktopGuardDecision =
  | { allowed: true }
  | { allowed: false; status: number; error: string; requirePasscode?: boolean };

/**
 * قرار حماية مسارات /api/desktop/*:
 * - ربط محلي (loopback) بلا رمز: مسموح.
 * - ربط غير محلي بلا APP_PASSCODE: مرفوض (fail closed) مع رسالة توضح الحل.
 * - APP_PASSCODE مضبوط: يجب إرسال ترويسة x-app-passcode صحيحة.
 */
export function evaluateDesktopAccess(
  host: string,
  requiredPasscode: string,
  providedHeader: string | undefined
): DesktopGuardDecision {
  const required = String(requiredPasscode || '').trim();
  if (required) {
    if (passcodeMatches(String(providedHeader || '').trim(), required)) return { allowed: true };
    return {
      allowed: false,
      status: 401,
      error: 'رمز الحماية (APP_PASSCODE) مطلوب أو غير صحيح.',
      requirePasscode: true,
    };
  }
  if (!isLoopbackHost(host)) {
    return {
      allowed: false,
      status: 403,
      error:
        'الخادم مفتوح على الشبكة بدون رمز حماية. اضبط APP_PASSCODE في ملف .env أو شغّله على 127.0.0.1 (احذف المتغير HOST).',
    };
  }
  return { allowed: true };
}
