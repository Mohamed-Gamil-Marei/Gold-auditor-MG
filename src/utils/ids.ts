/**
 * لاحقة عشوائية آمنة (base36) للمعرّفات، بدل Math.random().
 * تحافظ على نفس شكل المعرّفات القديمة: `${prefix}-${Date.now()}-${randomSuffix(4)}`.
 */
export function randomSuffix(length = 4): string {
  const n = Math.max(1, Math.floor(length));
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < n; i++) out += (bytes[i] % 36).toString(36);
  return out;
}
